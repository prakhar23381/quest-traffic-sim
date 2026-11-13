/**
 * Run a scenario headless and summarise it. Used for background runs on the server and
 * for side-by-side comparison in the browser, so both produce identical results.
 */
import { NetworkSim, type Sample } from "./networkSim";
import { prepareScenario, type Scenario } from "./scenario";
import { msToKmh } from "./units";

export interface Kpis {
  /** vehicles that entered the network */
  entered: number;
  completed: number;
  /** still waiting to enter when the run ended */
  waiting: number;
  inNetwork: number;
  unserved: number;
  droppedWrongLane: number;
  droppedGridlock: number;
  rerouted: number;
  /** completed trips per hour */
  throughputVph: number;
  /** mean / 90th percentile travel time of completed trips, s (includes waiting to enter) */
  meanTravelTime: number;
  p90TravelTime: number;
  /** mean delay against free-flow travel time, s */
  meanDelay: number;
  /** vehicle-km travelled and vehicle-hours spent on links */
  vkt: number;
  vht: number;
  meanSpeedKmh: number;
  /** s since start, or null */
  gridlockAt: number | null;
  hardestBrake: number;
  maxRedEntryLateness: number;
}

export interface LinkResult {
  id: string;
  name: string | null;
  layer: number;
  lanes: number;
  entered: number;
  exited: number;
  /** mean speed while on the link, km/h (null if never used) */
  meanSpeedKmh: number | null;
  /** most vehicles crawling (< 2 m/s) at any sample */
  maxQueue: number;
  closed: boolean;
}

export interface ODResult {
  origin: string;
  destination: string;
  generated: number;
  completed: number;
  meanTravelTime: number | null;
  meanDelay: number | null;
  unserved: number;
  dropped: number;
}

export interface RunResult {
  scenario: Scenario;
  networkName: string;
  durationS: number;
  kpis: Kpis;
  timeseries: Sample[];
  links: LinkResult[];
  od: ODResult[];
  warnings: string[];
  /** bit-level fingerprint of the final state (parity checks) */
  stateHash: string;
  wallMs: number;
}

export function summarize(sim: NetworkSim, scenario: Scenario, networkName: string, wallMs: number): RunResult {
  const tt = [...sim.travelTimes].sort((a, b) => a - b);
  const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
  let vehM = 0;
  let vehS = 0;
  for (const st of sim.linkStats) {
    vehM += st.vehMeters;
    vehS += st.vehSeconds;
  }
  let delaySum = 0;
  let done = 0;
  for (const s of sim.odStreams) {
    delaySum += s.stats.delaySum;
    done += s.stats.completed;
  }
  const kpis: Kpis = {
    entered: sim.entered,
    completed: sim.exited,
    waiting: sim.waiting,
    inNetwork: sim.inNetwork,
    unserved: sim.unserved,
    droppedWrongLane: sim.droppedWrongLane,
    droppedGridlock: sim.droppedGridlock,
    rerouted: sim.rerouted,
    throughputVph: sim.time > 0 ? (sim.exited * 3600) / sim.time : 0,
    meanTravelTime: mean(tt),
    p90TravelTime: tt.length ? tt[Math.min(tt.length - 1, Math.floor(0.9 * tt.length))]! : 0,
    meanDelay: done ? delaySum / done : 0,
    vkt: vehM / 1000,
    vht: vehS / 3600,
    meanSpeedKmh: vehS > 0 ? msToKmh(vehM / vehS) : 0,
    gridlockAt: sim.gridlockAt,
    hardestBrake: sim.hardestBrake,
    maxRedEntryLateness: sim.maxRedEntryLateness,
  };
  const links: LinkResult[] = sim.net.links.map((l) => {
    const st = sim.linkStats[l.idx]!;
    return {
      id: l.id,
      name: l.spec.name ?? null,
      layer: l.layer,
      lanes: l.lanes.length,
      entered: st.entered,
      exited: st.exited,
      meanSpeedKmh: st.vehSeconds > 0 ? msToKmh(st.vehMeters / st.vehSeconds) : null,
      maxQueue: st.maxQueue,
      closed: l.closed,
    };
  });
  const od: ODResult[] = sim.odStreams.map((s) => ({
    origin: s.stats.origin,
    destination: s.stats.destination,
    generated: s.stats.generated,
    completed: s.stats.completed,
    meanTravelTime: s.stats.completed ? s.stats.ttSum / s.stats.completed : null,
    meanDelay: s.stats.completed ? s.stats.delaySum / s.stats.completed : null,
    unserved: s.stats.unserved,
    dropped: s.stats.dropped,
  }));
  return { scenario, networkName, durationS: sim.time, kpis, timeseries: sim.samples, links, od, warnings: sim.warnings, stateHash: sim.stateHash(), wallMs };
}

/**
 * Run a scenario to completion. `onProgress(fraction)` is called about every simulated
 * minute; `shouldStop()` lets a caller abort early (the partial result is returned).
 */
export function runScenario(input: unknown, opts: { onProgress?: (f: number) => void; shouldStop?: () => boolean } = {}): RunResult {
  const t0 = Date.now();
  const prep = prepareScenario(input);
  const sim = new NetworkSim(prep.config);
  const steps = Math.round(prep.scenario.durationS / sim.dt);
  const every = Math.round(60 / sim.dt);
  for (let i = 0; i < steps; i++) {
    sim.step();
    if (i % every === 0) {
      opts.onProgress?.(i / steps);
      if (opts.shouldStop?.()) break;
    }
  }
  opts.onProgress?.(1);
  return summarize(sim, prep.scenario, prep.entry.name, Date.now() - t0);
}
