/**
 * Runs the live simulation off the main thread and streams vehicle poses (~30 frames/s)
 * as transferable Float32Arrays. The main thread only draws.
 */
import { NetworkSim, prepareScenario, ScenarioError, type NetVehicle, type SimLane } from "@traffic/engine";
import { VEH_FLOATS, type LiveIn, type LiveOut } from "./protocol";

const post = (m: LiveOut, transfer: Transferable[] = []) => (self as unknown as Worker).postMessage(m, transfer);

/** seconds over which a lane change is drawn (the model changes lanes instantly) */
const LC_DRAW = 1.5;
const FRAME_MS = 33;
/** wall-clock budget per tick, so the worker stays responsive at "max" speed */
const BUDGET_MS = 28;

let sim: NetworkSim | null = null;
let duration = 3600;
let playing = false;
let speed = 4;
let budget = 0;
let last = 0;
let timer: ReturnType<typeof setTimeout> | null = null;
let rate = 0;

function layerOf(lane: SimLane): number {
  if (lane.link) return lane.link.layer;
  const m = lane.conn!.movement;
  return Math.min(m.inLink.layer, m.outLink.layer);
}

function frame(): void {
  if (!sim) return;
  const n = sim.inNetwork;
  const buf = new Float32Array(n * VEH_FLOATS);
  let i = 0;
  let vSum = 0;
  for (const lane of sim.net.lanes) {
    if (!lane.vehicles.length) continue;
    const layer = layerOf(lane);
    for (const veh of lane.vehicles) {
      const v = veh as NetVehicle;
      const s = v.pos - v.len / 2;
      let p = lane.geom.poseAt(s);
      const since = sim.time - v.lcTime;
      if (lane.link && since < LC_DRAW && v.lcFromIndex !== lane.index) {
        const from = lane.link.lanes[v.lcFromIndex];
        if (from) {
          const q = from.geom.poseAt(s);
          const f0 = since / LC_DRAW;
          const f = f0 * f0 * (3 - 2 * f0);
          const hx = p.hx * f + q.hx * (1 - f);
          const hy = p.hy * f + q.hy * (1 - f);
          // tilt the body slightly towards the target lane while changing
          const dx = p.x - q.x;
          const dy = p.y - q.y;
          const tilt = 0.12 * Math.sin(Math.PI * f0);
          p = { x: q.x + dx * f, y: q.y + dy * f, hx: hx + dx * tilt, hy: hy + dy * tilt };
          const h = Math.hypot(p.hx, p.hy) || 1;
          p.hx /= h;
          p.hy /= h;
        }
      }
      buf[i++] = p.x;
      buf[i++] = p.y;
      buf[i++] = p.hx;
      buf[i++] = p.hy;
      buf[i++] = v.v;
      buf[i++] = v.len;
      buf[i++] = layer;
      vSum += v.v;
    }
  }
  const last = sim.samples[sim.samples.length - 1];
  post(
    {
      type: "frame",
      buf,
      n,
      playing,
      stats: {
        t: sim.time,
        durationS: duration,
        inNetwork: n,
        waiting: sim.waiting,
        entered: sim.entered,
        completed: sim.exited,
        removed: sim.dropped,
        meanSpeedKmh: n ? (vSum / n) * 3.6 : 0,
        throughputVph: last?.throughput ?? 0,
        rate,
      },
    },
    [buf.buffer],
  );
}

function tick(): void {
  timer = null;
  if (!sim) return;
  const now = performance.now();
  if (playing) {
    const wall = Math.min(0.25, (now - last) / 1000);
    const t0 = sim.time;
    budget = speed > 0 ? budget + wall * speed : Infinity;
    while (budget >= sim.dt && sim.time < duration) {
      sim.step();
      budget -= sim.dt;
      if (performance.now() - now > BUDGET_MS) {
        budget = 0;
        break;
      }
    }
    if (!Number.isFinite(budget)) budget = 0;
    rate = wall > 0 ? rate * 0.8 + ((sim.time - t0) / wall) * 0.2 : rate;
    if (sim.time >= duration - 1e-9) playing = false;
  }
  last = now;
  frame();
  if (playing) timer = setTimeout(tick, FRAME_MS);
}

function kick(): void {
  if (timer === null) {
    last = performance.now();
    timer = setTimeout(tick, 0);
  }
}

self.onmessage = (ev: MessageEvent<LiveIn>) => {
  const m = ev.data;
  switch (m.type) {
    case "load": {
      try {
        const prep = prepareScenario(m.scenario);
        sim = new NetworkSim(prep.config);
        duration = prep.scenario.durationS;
        budget = 0;
        rate = 0;
        post({ type: "loaded", warnings: sim.warnings });
        frame();
      } catch (e) {
        sim = null;
        playing = false;
        post({ type: "error", issues: e instanceof ScenarioError ? e.issues : [String(e)] });
      }
      break;
    }
    case "play":
      if (sim && sim.time < duration) {
        playing = true;
        kick();
      }
      break;
    case "pause":
      playing = false;
      frame();
      break;
    case "speed":
      speed = m.speed;
      budget = 0;
      break;
    case "step":
      if (sim) {
        const target = Math.min(duration, sim.time + m.seconds);
        while (sim.time < target - 1e-9) sim.step();
        frame();
      }
      break;
  }
};
