/**
 * Agent-based network simulator: IDM car-following, MOBIL-style lane changes,
 * signalised and priority junctions with conflict-aware entry, flyovers via
 * layered links, and reactive shortest-time routing.
 */
import { CITY_IDM, idmAccel, type IdmParams } from "./idm";
import { ballisticStep } from "./integrate";
import { freeInsertionSpeed, insertionSpeed } from "./insertion";
import type { Vehicle } from "./lane";
import {
  buildNetwork, signalState,
  type ConnectorRT, type LinkRT, type MovementRT, type Network, type NetworkSpec, type NodeRT, type SimLane,
} from "./network";
import { Rng } from "./rng";
import { freeFlowCost, shortestRoute } from "./routing";
import { fnv1aFloat64 } from "./hash";

// ------------------------------------------------------------------ config

export interface DemandSpec {
  origin: string;
  destination: string;
  /** veh/h */
  rate: number;
}

export interface SimConfig {
  network: NetworkSpec;
  demand: DemandSpec[];
  seed?: number;
  /** s, default 0.25 */
  dt?: number;
  /** multiplies every demand rate */
  demandScale?: number;
  closedLinks?: string[];
  /** 'reactive' (default): routes use recently measured travel times; 'static': free-flow times */
  routing?: "reactive" | "static";
  /** s between time-series samples, default 60 */
  sampleInterval?: number;
  driver?: IdmParams;
  /** ± spread of individual desired speeds, default 0.1 (±10 %) */
  speedSpread?: number;
}

export interface NetVehicle extends Vehicle {
  lane: SimLane;
  route: LinkRT[];
  /** moves[i] connects route[i] → route[i+1] */
  moves: MovementRT[];
  /** index into route of the current link (or of the link just left, while on a connector) */
  ri: number;
  approved: ConnectorRT | null;
  od: number;
  /** individual desired-speed factor */
  v0f: number;
  tLinkEnter: number;
  tFree: number;
  lcAllowedAt: number;
  /** continuous time spent (nearly) stopped, s */
  stoppedFor: number;
  dist: number;
  /** last lane change, for rendering a lateral transition */
  lcFromIndex: number;
  lcTime: number;
  /** signal response on the current link: decided once, the first time the signal is seen not green */
  sigDecided: boolean;
  /** too close to stop comfortably when the signal changed: will go through on amber / all-red */
  committed: boolean;
  /** signal is not green and this vehicle is stopping for it */
  sigStop: boolean;
  /** the signalised node the decision above refers to */
  sigFor: NodeRT | null;
}

// --------------------------------------------------------------- constants

const LOOKAHEAD = 200; // m
const REQUEST_MIN = 40; // m before the stop line at which junction entry is requested
const DIVERGE_CLEARANCE = 3; // m the rear of a diverging leader must be into its connector
/** Firmest braking a driver accepts to stop for a signal (ITE yellow-interval value ≈ 10 ft/s²). */
const SIGNAL_STOP_DECEL = 3.0; // m/s²
/** Distance before a stop line at which drivers react to the signal, m. */
const SIGNAL_DECISION_RANGE = 100;
/**
 * Average deceleration assumed when deciding whether a stop is still possible. The driver
 * model's actual braking peaks well above its average over a stop: with 3.0 here, peaks
 * reached 6.6 m/s². 2.5 keeps peaks below 5 m/s² (measured on all presets).
 */
const STOP_DECISION_DECEL = 2.5; // m/s² (3.0: 6.6 peak; 2.5: 4.7 peak; 2.2: later red entries, no benefit)
/** Below this speed a vehicle can always stop at the line, m/s. */
const CRAWL = 1;
/**
 * Congested merging at priority junctions: once a vehicle has been stopped this
 * long, slow (queued) traffic on conflicting paths takes turns with it instead
 * of holding strict priority. Free-flowing major traffic keeps priority.
 */
const FAIR_WAIT = 4; // s
const QUEUED_SPEED = 5; // m/s, below this a stream is treated as queued
/*
 * Tried and rejected: a "courtesy yield" letting a long-waiting side-road vehicle
 * stop free-flowing major traffic. One stop turned the major road into a queue,
 * which the turn-taking rule then kept alternating: at 1,600 veh/h major demand
 * its throughput fell from 1,564 to 1,046 veh/h. Strict priority matches HCM
 * gap-acceptance capacities far better (docs/VALIDATION.md).
 */
/**
 * Largest deceleration a vehicle entering from a minor road may impose on traffic that has
 * right of way. Calibrated against HCM gap-acceptance capacities: 0.5 and 1.0 let far too
 * few minor vehicles through (186 and 230 veh/h at 800 veh/h of major flow, HCM: 388);
 * 1.5 gives 337. The model stays conservative at high major flows (docs/VALIDATION.md).
 */
const PRIORITY_DISTURBANCE = 1.5; // m/s²
/** How far up a priority approach to look for vehicles that must not be disturbed, m. */
const PRIORITY_SCAN = 150;
const T_CRIT = 3; // s, critical gap for minor-road entry at priority junctions
const B_SAFE = 4; // m/s², max braking imposed by a lane change
const MOBIL_POLITENESS = 0.3;
const MOBIL_THRESHOLD = 0.2; // m/s²
const LC_EVERY = 4; // steps between lane-change evaluations per vehicle (1 s at dt = 0.25)
const LC_COOLDOWN = 3; // s
const STUCK_REROUTE = 15; // s waiting at a stop line in a lane that cannot make the turn
/** Last resort: a vehicle stuck this long in a lane that cannot make its turn, with no reroute, is removed (counted as dropped). */
const GIVE_UP = 180; // s
/** Gridlock relief: head-of-queue vehicles stopped this long are removed (SUMO default). */
const TELEPORT = 300; // s
/** Distance before the stop line within which a blocked mandatory lane change asks the target lane to make room. */
const COOPERATION_RANGE = 150; // m
/** Movements of look-ahead for strategic lane choice. */
const STRATEGIC_DEPTH = 4;
const ROUTE_REFRESH = 10; // s
/** Per-lane discharge rate assumed when converting an entrance queue into an expected wait. */
const ENTRY_CAPACITY_VPH = 1900;
const TT_ALPHA = 0.3; // EMA weight of measured link travel times
const STOPPED_V = 0.1; // m/s
const GRIDLOCK_AFTER = 120; // s with vehicles present and none moving
const STUCK_VEHICLE = 300; // s stopped → counted as stuck
const GRIDLOCK_STUCK = 20; // stuck vehicles that flag (partial) gridlock

// ----------------------------------------------------------------- results

export interface LinkStats {
  entered: number;
  exited: number;
  vehSeconds: number;
  vehMeters: number;
  /** EMA of measured traversal times, s */
  ttEma: number;
  maxQueue: number;
  queue: number;
}

export interface Sample {
  t: number;
  inNetwork: number;
  waiting: number;
  /** space-mean speed, m/s */
  meanSpeed: number;
  completed: number;
  /** completions per hour during the last interval */
  throughput: number;
  stuck: number;
}

export interface ODStats {
  origin: string;
  destination: string;
  generated: number;
  completed: number;
  ttSum: number;
  delaySum: number;
  unserved: number;
  dropped: number;
}

interface ODStream {
  spec: DemandSpec;
  origin: NodeRT;
  dest: NodeRT;
  rate: number; // veh/s
  next: number;
  route: LinkRT[] | null;
  moves: MovementRT[];
  tFree: number;
  routeAt: number;
  stats: ODStats;
}

interface Pending {
  od: ODStream;
  route: LinkRT[];
  moves: MovementRT[];
  tFree: number;
  tGen: number;
}

interface Leader {
  gap: number;
  vLead: number | null;
  v0cap: number;
}

const FREE: Leader = { gap: Infinity, vLead: null, v0cap: Infinity };

// --------------------------------------------------------------- simulator

export class NetworkSim {
  readonly net: Network;
  readonly dt: number;
  readonly rng: Rng;
  readonly cfg: SimConfig;
  time = 0;
  stepNo = 0;

  generated = 0;
  entered = 0;
  exited = 0;
  /** vehicles removed, all causes (= droppedWrongLane + droppedGridlock) */
  dropped = 0;
  /** removed after GIVE_UP s in a lane that cannot make their turn, with no alternative route */
  droppedWrongLane = 0;
  /** removed after TELEPORT s at the head of a queue that did not move (gridlock relief) */
  droppedGridlock = 0;
  unserved = 0;
  rerouted = 0;
  /** vehicles that reached a stop line without approval (should stay 0) */
  stopLineViolations = 0;
  /** latest a vehicle entered a junction after its signal turned red, s */
  maxRedEntryLateness = 0;
  gridlockAt: number | null = null;
  /** most negative acceleration any vehicle has used, m/s² (emergency braking indicates a modelling fault) */
  hardestBrake = 0;
  readonly travelTimes: number[] = [];
  readonly linkStats: LinkStats[];
  readonly samples: Sample[] = [];
  readonly warnings: string[];
  readonly odStreams: ODStream[];

  private readonly queues: Pending[][];
  /** blocked mandatory lane changes from the last lane-change pass: the target lane should make room */
  private mergeRequests: { veh: NetVehicle; target: SimLane }[] = [];
  private nextId = 0;
  private lastProgress = 0;
  private lastSampleCompleted = 0;
  private nextSample: number;
  private readonly scratch = { v: 0 };
  private readonly driver: IdmParams;
  private readonly spread: number;
  private readonly routing: "reactive" | "static";

  constructor(cfg: SimConfig) {
    this.cfg = cfg;
    this.dt = cfg.dt ?? 0.25;
    this.rng = new Rng(cfg.seed ?? 1);
    this.driver = cfg.driver ?? CITY_IDM;
    this.spread = cfg.speedSpread ?? 0.1;
    this.routing = cfg.routing ?? "reactive";
    this.net = buildNetwork(cfg.network, { driver: this.driver, closedLinks: cfg.closedLinks });
    this.warnings = [...this.net.warnings];
    this.linkStats = this.net.links.map((l) => ({ entered: 0, exited: 0, vehSeconds: 0, vehMeters: 0, ttEma: l.length / l.v0, maxQueue: 0, queue: 0 }));
    this.queues = this.net.links.map(() => []);
    this.nextSample = cfg.sampleInterval ?? 60;

    const scale = cfg.demandScale ?? 1;
    this.odStreams = [];
    for (const d of cfg.demand) {
      const origin = this.net.nodeById.get(d.origin);
      const dest = this.net.nodeById.get(d.destination);
      if (!origin || !dest) {
        this.warnings.push(`Demand ${d.origin}→${d.destination}: unknown node`);
        continue;
      }
      if (origin.kind !== "boundary" || dest.kind !== "boundary") this.warnings.push(`Demand ${d.origin}→${d.destination}: endpoints should be boundary nodes`);
      const rate = (d.rate * scale) / 3600;
      const s: ODStream = {
        spec: d, origin, dest, rate, next: this.rng.exp(rate), route: null, moves: [], tFree: 0, routeAt: -Infinity,
        stats: { origin: d.origin, destination: d.destination, generated: 0, completed: 0, ttSum: 0, delaySum: 0, unserved: 0, dropped: 0 },
      };
      this.refreshRoute(s);
      if (!s.route) this.warnings.push(`Demand ${d.origin}→${d.destination}: no route (unreachable)`);
      this.odStreams.push(s);
    }
  }

  // ---------------------------------------------------------------- routing

  private linkCost = (l: LinkRT): number => {
    const ff = freeFlowCost(l);
    if (this.routing === "static") return ff;
    const st = this.linkStats[l.idx]!;
    let cur = 0;
    let n = 0;
    for (const lane of l.lanes) {
      n += lane.vehicles.length;
      for (const v of lane.vehicles) cur = Math.max(cur, this.time - (v as NetVehicle).tLinkEnter);
    }
    // An empty link is at free flow no matter how congested it was when last used.
    // (Without this the last measured time goes stale and the link is shunned long after it clears.)
    if (n === 0) st.ttEma = l.length / l.v0;
    // Vehicles still waiting to enter an origin link are invisible to link travel
    // times; add their expected wait so routing reacts to entrance queues too.
    const entryWait = (this.queues[l.idx]!.length * 3600) / (l.lanes.length * ENTRY_CAPACITY_VPH);
    return Math.max(ff, st.ttEma + (ff - l.length / l.v0), cur) + entryWait;
  };

  private refreshRoute(s: ODStream): void {
    s.route = shortestRoute(this.net, s.origin, s.dest, this.linkCost);
    s.moves = s.route ? movesFor(this.net, s.route) : [];
    s.tFree = s.route ? s.route.reduce((t, l) => t + freeFlowCost(l), 0) : 0;
    s.routeAt = this.time;
  }

  // ------------------------------------------------------------------- step

  step(): void {
    const dt = this.dt;
    this.signalDecisions();
    this.revokeOnSignal();
    this.approveJunctionEntries();
    this.computeAccelerations();
    this.move();
    this.transfer();
    this.laneChanges();
    this.handleStuck();
    this.relieveGridlock();
    this.generateDemand();
    this.insertVehicles();
    this.time += dt;
    this.stepNo++;
    this.bookkeeping();
  }

  run(seconds: number): void {
    const n = Math.round(seconds / this.dt);
    for (let i = 0; i < n; i++) this.step();
  }

  // -------------------------------------------------------------- junctions

  /**
   * Distance before the stop line at which a vehicle asks to enter the junction.
   * Sized so that a refusal can always be answered with a comfortable stop.
   */
  private requestDist(v: number): number {
    return Math.max(REQUEST_MIN, (v * v) / (2 * this.driver.b) + 20);
  }

  private connectorFor(m: MovementRT, laneIndex: number): ConnectorRT | null {
    const k = m.inLanes.indexOf(laneIndex);
    return k >= 0 ? m.connectors[k]! : null;
  }

  /**
   * Every vehicle approaching a signal (not just the one at the front) reacts to it.
   * The first time it sees its signal not green it decides once: stop, if it can at
   * comfortable deceleration, otherwise commit to going through. Stoppers start braking
   * immediately wherever they are in the queue; committed vehicles are admitted during
   * amber and the all-red clearance only.
   *
   * (Earlier versions let only the lane's front vehicle react. A follower that became
   * the front late in the amber then met a red light with no room to stop.)
   */
  private signalDecisions(): void {
    for (const link of this.net.links) {
      for (const lane of link.lanes) {
        for (const v of lane.vehicles) {
          const veh = v as NetVehicle;
          // The next signal on the route within SIGNAL_DECISION_RANGE: at the end of this
          // link, or at the end of the next one (a driver sees the light before reaching
          // the last link; a 56 m approach link at Madiwala was entered during amber).
          let target: NodeRT | null = null;
          let move: MovementRT | null = null;
          let dist = lane.length - veh.pos;
          if (veh.ri < veh.route.length - 1) {
            if (link.to.signal) {
              target = link.to;
              move = veh.moves[veh.ri]!;
            } else if (veh.ri + 1 < veh.route.length - 1 && veh.route[veh.ri + 1]!.to.signal) {
              const m = veh.moves[veh.ri]!;
              const c = this.connectorFor(m, lane.index) ?? m.connectors[0]!;
              dist += c.lane.length + veh.route[veh.ri + 1]!.length;
              if (dist <= SIGNAL_DECISION_RANGE) {
                target = veh.route[veh.ri + 1]!.to;
                move = veh.moves[veh.ri + 1]!;
              }
            }
          }
          if (!target || !move) {
            veh.sigStop = false;
            continue;
          }
          if (signalState(target.signal!, move.id, this.time) === "green") {
            veh.sigDecided = veh.committed = veh.sigStop = false;
            veh.sigFor = target;
            continue;
          }
          if (!veh.sigDecided || veh.sigFor !== target) {
            veh.sigDecided = true;
            veh.sigFor = target;
            veh.committed = !this.canStopBefore(veh.v, dist);
          }
          // Only vehicles on the approach link itself brake for its stop line; further back,
          // the look-ahead in leader() already treats the junction ahead as a stop.
          veh.sigStop = !veh.committed && target === link.to;
        }
      }
    }
  }

  /**
   * Can a vehicle at speed v stop at no more than SIGNAL_STOP_DECEL before a line d metres
   * ahead? Kinematic, measured to where the driver model actually stops (s0 before the
   * line). History: a plain v²/2d test asked for up to 9 m/s² (it ignored s0); the driver
   * model's own response exaggerates inside s0 and let a crawling vehicle keep its approval
   * through 91 s of red, or withdrew it from a vehicle 0.5 m out (60–1,700 m/s²).
   */
  private canStopBefore(v: number, d: number): boolean {
    if (v < CRAWL) return true;
    return v * v <= 2 * STOP_DECISION_DECEL * Math.max(d - this.driver.s0, 0);
  }

  /** May this vehicle cross the stop line under the current signal state? */
  private signalAllows(veh: NetVehicle, m: MovementRT): boolean {
    const sig = m.node.signal;
    if (!sig) return true;
    const st = signalState(sig, m.id, this.time);
    if (st === "green") return true;
    if (!veh.committed) return false;
    return st === "amber" || inClearance(sig, m.id, this.time);
  }

  private revokeOnSignal(): void {
    for (const link of this.net.links) {
      if (!link.to.signal) continue;
      for (const lane of link.lanes) {
        const veh = lane.vehicles[lane.vehicles.length - 1] as NetVehicle | undefined;
        if (!veh?.approved || this.signalAllows(veh, veh.approved.movement)) continue;
        // Withdraw only if it can still stop gently. A committed vehicle slowed by a queue
        // beyond the junction crawled to the line after the clearance ended and had its
        // approval withdrawn 1.1 m out (438 m/s²). Crossing traffic is kept clear of its
        // path by the conflict rules, and its lateness is recorded (maxRedEntryLateness).
        const d = lane.length - veh.pos;
        if (this.canStopBefore(veh.v, d)) this.unapprove(veh);
      }
    }
  }

  private unapprove(veh: NetVehicle): void {
    const c = veh.approved!;
    c.reserved--;
    c.outLane.pending -= veh.len + this.driver.s0;
    veh.approved = null;
  }

  private approveJunctionEntries(): void {
    const reqs: { veh: NetVehicle; c: ConnectorRT; d: number; eta: number }[] = [];
    for (const link of this.net.links) {
      for (const lane of link.lanes) {
        const veh = lane.vehicles[lane.vehicles.length - 1] as NetVehicle | undefined;
        if (!veh || veh.approved || veh.ri >= veh.route.length - 1) continue;
        const d = lane.length - veh.pos;
        if (d > this.requestDist(veh.v)) continue;
        const c = this.connectorFor(veh.moves[veh.ri]!, lane.index);
        if (!c) continue; // wrong lane for its turn: must change lanes first
        reqs.push({ veh, c, d, eta: d / Math.max(veh.v, 1) });
      }
    }
    reqs.sort((a, b) => a.eta - b.eta || a.veh.id - b.veh.id);
    const byConn = new Map<ConnectorRT, NetVehicle>();
    for (const r of reqs) byConn.set(r.c, r.veh);
    for (const r of reqs) {
      // Turn-taking in congestion: a queued vehicle lets a longer-waiting conflicting vehicle go first.
      if (!r.c.movement.node.signal && r.veh.v < QUEUED_SPEED) {
        let defer = false;
        for (const { other, kind } of r.c.conflicts) {
          if (kind === "diverge") continue;
          const w = byConn.get(other);
          if (!w || w.approved || w.stoppedFor <= r.veh.stoppedFor) continue;
          if (w.stoppedFor > FAIR_WAIT) {
            defer = true;
            break;
          }
        }
        if (defer) continue;
      }
      if (this.canEnter(r.veh, r.c, r.d)) {
        r.veh.approved = r.c;
        r.c.reserved++;
        r.c.outLane.pending += r.veh.len + this.driver.s0;
      }
    }
  }

  private canEnter(veh: NetVehicle, c: ConnectorRT, d: number): boolean {
    const m = c.movement;
    const node = m.node;
    if (!this.signalAllows(veh, m)) return false;
    for (const { other, kind } of c.conflicts) {
      if (kind === "diverge") continue; // handled by car-following (see sideLeader)
      if (kind === "merge") {
        // Zipper merging by car-following. Against every vehicle on (or approved for) the
        // merging connector: if it is ahead of us on the way to the merge point we must be
        // able to follow it comfortably; if it is behind, it must be able to follow us.
        const mine = d + c.lane.length;
        const b = this.driver.b;
        const s0 = this.driver.s0;
        let blocked = false;
        // Speeds through the junction: a vehicle slows to its connector's turning speed.
        const vMe = Math.min(veh.v, c.v0 * veh.v0f);
        // A stream with right of way may only be asked for a token adjustment; equals take turns.
        const theyHavePriority = !node.signal && other.movement.inLink.priority > m.inLink.priority;
        const limitForThem = theyHavePriority ? PRIORITY_DISTURBANCE : b;
        // If refused, this vehicle must stop at the line: that braking is the alternative.
        const myStop = idmAccel(c.inLane.params, veh.v, d, 0, c.inLane.params.v0 * veh.v0f);
        const check = (w: NetVehicle, wRem: number, wLane: SimLane) => {
          let gap: number;
          let harm: number; // braking that approving would cause (to us or to w)
          if (wRem < mine) {
            gap = mine - wRem - w.len;
            const vW = Math.min(w.v, other.v0 * w.v0f);
            harm = idmAccel(c.inLane.params, veh.v, gap, vW);
          } else {
            gap = wRem - mine - veh.len;
            harm = idmAccel(wLane.params, w.v, gap, vMe);
            if (theyHavePriority) {
              // Traffic with right of way is protected strictly.
              if (gap < s0 || harm < -limitForThem) blocked = true;
              return;
            }
          }
          // Between equal streams choose the lesser harm: refuse only if approving would be
          // uncomfortable AND worse than stopping at the line, or if there is no room at all.
          // (Refusing on comfort alone made a lane-drop follower stop from 14 m/s in 17 m.)
          if (gap < 0.5) blocked = true;
          else if ((gap < s0 || harm < -b) && harm < myStop) blocked = true;
        };
        for (const w of other.lane.vehicles) check(w as NetVehicle, other.lane.length - w.pos, other.lane);
        if (!blocked && other.reserved > 0) {
          const a = other.inLane.vehicles[other.inLane.vehicles.length - 1] as NetVehicle | undefined;
          if (!a || a.approved !== other) blocked = true;
          else {
            const aD = other.inLane.length - a.pos;
            check(a, other.lane.length + aD, other.inLane);
            if (blocked && !theyHavePriority) {
              // `a` reserved the merge before we reached the front of our lane. If we can no
              // longer stop gently but it still can, it gives way: whoever cannot stop goes first.
              const iCannotStop = idmAccel(c.inLane.params, veh.v, d, 0) < -SIGNAL_STOP_DECEL;
              const aCanStop = idmAccel(other.inLane.params, a.v, aD, 0) >= -b;
              // (Tried: letting the vehicle in front go whenever it cannot stop, with the one
              // behind following. Rejected: it put slow vehicles in front of fast ones that
              // could not stop either, producing 50+ m/s² braking.)
              if (iCannotStop && aCanStop) {
                this.unapprove(a);
                blocked = false;
              }
            }
          }
        }
        if (blocked) return false;
      } else if (other.reserved > 0 || other.lane.vehicles.length > 0) return false;
      // Priority junctions: do not disturb traffic that has right of way. Scan the whole
      // approaching platoon (its front vehicle may be committed and gone by the time we
      // are in the junction) and require that none of them would have to slow by more than
      // PRIORITY_DISTURBANCE to follow or pass behind us. This is speed-aware: a fixed
      // time gap is too generous to fast traffic and too strict with slow traffic.
      if (!node.signal && other.movement.inLink.priority > m.inLink.priority) {
        const vs = other.inLane.vehicles;
        const L = other.inLane.length;
        const mine = d + c.lane.length;
        const vMe = Math.min(veh.v, c.v0 * veh.v0f);
        for (let k = vs.length - 1; k >= 0; k--) {
          const f = vs[k] as NetVehicle;
          const fd = L - f.pos;
          if (fd > PRIORITY_SCAN) break;
          if (f.ri >= f.route.length - 1 || this.connectorFor(f.moves[f.ri]!, other.inLane.index) !== other) continue;
          if (veh.stoppedFor > FAIR_WAIT && f.v < QUEUED_SPEED) continue; // taking turns in a queue
          if (f.v < 0.5) continue;
          if (fd / f.v < T_CRIT) return false;
          // For a merge we end up in front of f in the same lane; for a crossing we only
          // need to be clear of the conflict area by the time it arrives.
          const gap = kind === "merge" ? fd + other.lane.length - mine - veh.len : fd;
          const vObstacle = kind === "merge" ? vMe : 0;
          const clearTime = kind === "merge" ? 0 : (d + c.lane.length + veh.len) / Math.max(vMe, 1);
          if (kind === "merge") {
            if (gap < this.driver.s0 || idmAccel(other.inLane.params, f.v, gap, vObstacle) < -PRIORITY_DISTURBANCE) return false;
          } else if (fd / f.v < clearTime + 1) return false;
        }
      }
    }
    // Don't block the box: wait for room downstream. This is a courtesy rule, not a
    // safety rule, so it applies only where a queue tail would obstruct crossing traffic
    // and only while the vehicle can still stop gently; otherwise it follows its leader in.
    if (c.conflicts.some((x) => x.kind === "cross")) {
      const out = c.outLane;
      const rear = out.vehicles[0];
      const free = (rear ? rear.pos - rear.len : out.length) - out.pending;
      if (free < veh.len + this.driver.s0 && !(rear && rear.v > 3)) {
        const lane = c.inLane;
        if (idmAccel(lane.params, veh.v, d, 0, lane.params.v0 * veh.v0f) >= -SIGNAL_STOP_DECEL) return false;
      }
    }
    return true;
  }

  // --------------------------------------------------------- car following

  /**
   * Leader of `veh` (on `lane`) starting from vehicle index `idx` in that lane.
   * Looks across lane ends: stop line (if not approved), connector, next link.
   */
  private leader(veh: NetVehicle, lane: SimLane, idx: number): Leader {
    const vs = lane.vehicles;
    if (idx < vs.length) {
      const ld = vs[idx]!;
      const gap = ld.pos - ld.len - veh.pos;
      if (lane.kind === "conn") {
        // On a connector, a vehicle on a merging (or diverging) connector may be nearer than
        // the vehicle ahead on our own. (Returning the own-lane leader alone let a vehicle
        // drive into a stopped vehicle on the other half of a lane drop.)
        const ml = sideLeader(lane.conn!, lane.length - veh.pos, veh.pos, null);
        if (ml && ml.gap < gap) return { gap: ml.gap, vLead: ml.v, v0cap: Infinity };
      }
      return { gap, vLead: ld.v, v0cap: Infinity };
    }
    let d = lane.length - veh.pos;
    let r = veh.ri;
    let next: SimLane;
    // Nearest vehicle ahead of us on a connector that merges into ours (zipper merging)
    // or that has just diverged from our lane and not yet cleared the shared stretch.
    let ml: { gap: number; v: number } | null = null;
    if (lane.kind === "link") {
      if (r >= veh.route.length - 1) return FREE;
      if (!veh.approved || veh.approved.inLane !== lane) {
        // The stop line is an obstacle only once the vehicle is close enough to have asked
        // for entry (or is stopping for a signal). Further out it drives freely; otherwise
        // free-flowing traffic would brake a little before every junction, even on green.
        if (d > this.requestDist(veh.v) && !veh.sigStop) return FREE;
        // Two obstacles: the stop line (stationary: an unapproved vehicle must be able to
        // stop there whatever happens ahead) and the tail of any vehicle that has entered
        // the junction from this lane but still overhangs the line (at its own speed).
        // Respond to whichever demands more braking.
        let best: Leader = { gap: d, vLead: 0, v0cap: Infinity };
        let worst = idmAccel(lane.params, veh.v, d, 0);
        for (const oc of lane.outConns) {
          const w = oc.lane.vehicles[0];
          if (!w) continue;
          const g = d + w.pos - w.len;
          if (g >= d) continue; // tail has cleared the line
          const a = idmAccel(lane.params, veh.v, g, w.v);
          if (a < worst) {
            worst = a;
            best = { gap: g, vLead: w.v, v0cap: Infinity };
          }
        }
        return best;
      }
      next = veh.approved.lane;
    } else {
      ml = sideLeader(lane.conn!, d, veh.pos, ml);
      next = lane.conn!.outLane;
      r++;
    }
    let v0cap = Infinity;
    const b = this.driver.b;
    const out = (gap: number, vLead: number | null): Leader => (ml && ml.gap < gap ? { gap: ml.gap, vLead: ml.v, v0cap } : { gap, vLead, v0cap });
    for (let hop = 0; hop < 4; hop++) {
      const nv0 = next.params.v0 * veh.v0f;
      v0cap = Math.min(v0cap, Math.sqrt(nv0 * nv0 + 2 * b * Math.max(d, 0)));
      if (next.kind === "conn") ml = sideLeader(next.conn!, d + next.length, -d, ml);
      const rv = next.vehicles[0];
      if (rv) return out(d + rv.pos - rv.len, rv.v);
      if (ml) return out(Infinity, null);
      d += next.length;
      if (d > LOOKAHEAD) return out(Infinity, null);
      if (next.kind === "conn") {
        next = next.conn!.outLane;
        r++;
        continue;
      }
      // Empty link lane: the route ends here, or there is another junction ahead.
      if (r >= veh.route.length - 1) return out(Infinity, null);
      const c = this.connectorFor(veh.moves[r]!, next.index);
      if (c && c.conflicts.length === 0 && !c.movement.node.signal) {
        next = c.lane;
        continue;
      }
      return out(d, 0);
    }
    return out(Infinity, null);
  }

  private accelIn(veh: NetVehicle, lane: SimLane, ld: Leader): number {
    const p = lane.params;
    const v0 = Math.min(p.v0 * veh.v0f, ld.v0cap);
    return idmAccel(p, veh.v, ld.gap, ld.vLead, v0);
  }

  private computeAccelerations(): void {
    for (const lane of this.net.lanes) {
      const vs = lane.vehicles;
      for (let i = 0; i < vs.length; i++) {
        const veh = vs[i] as NetVehicle;
        veh.acc = this.accelIn(veh, lane, this.leader(veh, lane, i + 1));
      }
    }
    this.lookPastLeader();
    this.giveWayAnticipation();
    // Vehicles stopping for a signal brake for the stop line even when they are not at the front.
    for (const link of this.net.links) {
      if (!link.to.signal) continue;
      for (const lane of link.lanes) {
        for (const v of lane.vehicles) {
          const veh = v as NetVehicle;
          if (!veh.sigStop || veh.approved) continue;
          const a = idmAccel(lane.params, veh.v, lane.length - veh.pos, 0, lane.params.v0 * veh.v0f);
          if (a < veh.acc) veh.acc = a;
        }
      }
    }
    // Cooperative merging: the nearest vehicle in the target lane that is fully
    // behind a blocked merger treats it as its leader and holds back, opening a gap.
    for (const { veh, target } of this.mergeRequests) {
      if (veh.lane.kind !== "link" || veh.lane.link !== target.link) continue;
      const vs = target.vehicles;
      const k = upperBound(vs, veh.pos - veh.len) - 1;
      const y = vs[k] as NetVehicle | undefined;
      if (!y) continue;
      const gap = veh.pos - veh.len - y.pos;
      if (gap < 0 || gap > 50) continue;
      // Making room is a courtesy: never brake harder than comfortable for it.
      const a = Math.max(idmAccel(target.params, y.v, gap, veh.v, target.params.v0 * y.v0f), -this.driver.b);
      if (a < y.acc) y.acc = a;
    }
    // Record the hardest braking actually applied (a stationary vehicle cannot brake).
    for (const lane of this.net.lanes) {
      for (const v of lane.vehicles) if (v.v > 1 && v.acc < this.hardestBrake) this.hardestBrake = v.acc;
    }
  }

  /**
   * Approaching a give-way junction on a movement that must yield, a driver keeps to a
   * speed from which it can still stop at the line comfortably, whatever the vehicle ahead
   * does: entry may be refused once it reaches the front. (Followers kept 14 m/s behind an
   * accelerating leader, were refused 20 m out, and braked at 18 m/s².) Movements with
   * priority are unaffected, so main-road capacity is unchanged.
   */
  private giveWayAnticipation(): void {
    const b = this.driver.b;
    const s0 = this.driver.s0;
    for (const link of this.net.links) {
      const node = link.to;
      if (node.kind !== "priority") continue;
      for (const lane of link.lanes) {
        for (const v of lane.vehicles) {
          const veh = v as NetVehicle;
          if (veh.approved || veh.ri >= veh.route.length - 1) continue;
          const d = lane.length - veh.pos;
          if (d > this.requestDist(veh.v)) continue;
          const c = this.connectorFor(veh.moves[veh.ri]!, lane.index);
          if (!c || !mustYield(c)) continue;
          const cap = Math.sqrt(2 * b * Math.max(0, d - s0));
          if (veh.v <= cap) continue;
          const a = idmAccel(lane.params, veh.v, Infinity, null, Math.max(cap, 0.1));
          if (a < veh.acc) veh.acc = Math.max(a, -b);
        }
      }
    }
  }

  /**
   * A vehicle near a stop line also watches the nearest vehicle on its OWN path through
   * the junction, not only the vehicle ahead in its lane. Otherwise, when the vehicle
   * ahead turns off onto a different connector, it can reveal a stopped queue a few
   * metres ahead with no room left to brake comfortably.
   */
  private lookPastLeader(): void {
    for (const link of this.net.links) {
      if (link.out.length < 2) continue; // a single movement: the lane leader is on our path anyway
      for (const lane of link.lanes) {
        const vs = lane.vehicles;
        for (let i = vs.length - 2; i >= 0; i--) {
          const veh = vs[i] as NetVehicle;
          const d = lane.length - veh.pos;
          if (d > this.requestDist(veh.v)) break; // vehicles further back are further away still
          if (veh.ri >= veh.route.length - 1) continue;
          const c = this.connectorFor(veh.moves[veh.ri]!, lane.index);
          if (!c) {
            // Wrong lane for the next turn: it cannot cross the line from here, so it must be
            // ready to stop there even while following a leader that can. (Otherwise the stop
            // line appeared 16 m ahead at 12 m/s the moment the leader crossed: 16 m/s².)
            const a = idmAccel(lane.params, veh.v, d, 0, lane.params.v0 * veh.v0f);
            if (a < veh.acc) veh.acc = a;
            continue;
          }
          let gap: number;
          let vLead: number;
          const onConn = c.lane.vehicles[0];
          if (onConn) {
            gap = d + onConn.pos - onConn.len;
            vLead = onConn.v;
          } else {
            const rear = c.outLane.vehicles[0];
            if (!rear) continue;
            gap = d + c.lane.length + rear.pos - rear.len;
            vLead = rear.v;
          }
          const a = idmAccel(lane.params, veh.v, gap, vLead, lane.params.v0 * veh.v0f);
          if (a < veh.acc) veh.acc = a;
        }
      }
    }
  }

  private move(): void {
    const dt = this.dt;
    let moving = false;
    for (const lane of this.net.lanes) {
      const st = lane.link ? this.linkStats[lane.link.idx]! : null;
      for (const v of lane.vehicles) {
        const veh = v as NetVehicle;
        const dx = ballisticStep(veh.v, veh.acc, dt, this.scratch);
        veh.pos += dx;
        veh.v = this.scratch.v;
        veh.dist += dx;
        if (veh.v > STOPPED_V) {
          veh.stoppedFor = 0;
          moving = true;
        } else veh.stoppedFor += dt;
        if (st) {
          st.vehSeconds += dt;
          st.vehMeters += dx;
        }
      }
    }
    if (moving || this.inNetwork === 0) this.lastProgress = this.time;
    else if (this.gridlockAt === null && this.time - this.lastProgress > GRIDLOCK_AFTER) this.gridlockAt = this.time;
  }

  // -------------------------------------------------------------- transfers

  private transfer(): void {
    const movers: NetVehicle[] = [];
    for (const lane of this.net.lanes) {
      const vs = lane.vehicles;
      while (vs.length > 0 && vs[vs.length - 1]!.pos >= lane.length) {
        const veh = vs[vs.length - 1] as NetVehicle;
        if (lane.kind === "link" && veh.ri < veh.route.length - 1 && veh.approved?.inLane !== lane) {
          // Overshot a stop line it had no permission to cross. Hold it at the line.
          this.stopLineViolations++;
          veh.pos = lane.length - 1e-3;
          veh.v = 0;
          break;
        }
        vs.pop();
        movers.push(veh);
      }
    }
    for (const veh of movers) this.advance(veh);
  }

  /** Move a vehicle that has passed the end of its lane into the next lane(s), or out of the network. */
  private advance(veh: NetVehicle): void {
    for (;;) {
      const lane = veh.lane;
      if (veh.pos < lane.length) {
        insertSorted(lane, veh);
        return;
      }
      if (lane.kind === "link") {
        const st = this.linkStats[lane.link!.idx]!;
        st.exited++;
        const tt = this.time + this.dt - veh.tLinkEnter;
        st.ttEma += TT_ALPHA * (tt - st.ttEma);
        if (veh.ri >= veh.route.length - 1) {
          this.finish(veh);
          return;
        }
        const c = veh.approved!;
        if (c.movement.node.signal) {
          const sig = c.movement.node.signal;
          if (signalState(sig, c.movement.id, this.time) === "red") {
            this.maxRedEntryLateness = Math.max(this.maxRedEntryLateness, redLateness(sig, c.movement.id, this.time));
          }
        }
        c.reserved--;
        veh.approved = null;
        veh.pos -= lane.length;
        veh.lane = c.lane;
      } else {
        const c = lane.conn!;
        veh.pos -= lane.length;
        c.outLane.pending -= veh.len + this.driver.s0;
        veh.ri++;
        veh.lane = c.outLane;
        veh.tLinkEnter = this.time + this.dt;
        this.linkStats[c.outLane.link!.idx]!.entered++;
      }
    }
  }

  private finish(veh: NetVehicle): void {
    this.exited++;
    const tt = this.time + this.dt - veh.tSpawn;
    this.travelTimes.push(tt);
    const od = this.odStreams[veh.od]!.stats;
    od.completed++;
    od.ttSum += tt;
    od.delaySum += tt - veh.tFree;
  }

  // ----------------------------------------------------------- lane changes

  private allowedLanes(veh: NetVehicle): number[] | null {
    return veh.ri >= veh.route.length - 1 ? null : veh.moves[veh.ri]!.inLanes;
  }

  /**
   * Strategic lane choice, two movements ahead: among the lanes allowed for the
   * next movement, those whose connector lands in a lane allowed for the movement
   * after it. Falls back to all allowed lanes.
   */
  private preferredLanes(moves: MovementRT[], ri: number): number[] | null {
    const m = moves[ri];
    if (!m) return null;
    // Work backwards from STRATEGIC_DEPTH movements ahead: at each step keep the lanes
    // whose connector lands in a lane still preferred for the movement after it. Two
    // movements of look-ahead were not enough at Silk Board: left-turners reached a
    // queued 114 m approach in the wrong lane and could not cross the queue.
    const last = Math.min(moves.length - 1, ri + STRATEGIC_DEPTH - 1);
    let target: number[] = moves[last]!.inLanes;
    for (let j = last - 1; j >= ri; j--) {
      const mj = moves[j]!;
      const ok = mj.inLanes.filter((_, k) => target.includes(mj.connectors[k]!.outLane.index));
      target = ok.length ? ok : mj.inLanes;
    }
    return target;
  }

  private laneChanges(): void {
    // Requests are re-evaluated each pass; a vehicle only asks while it is still due.
    this.mergeRequests = this.mergeRequests.filter((r) => (this.stepNo + r.veh.id) % LC_EVERY !== 0 && r.veh.lane.kind === "link");
    for (const link of this.net.links) {
      if (link.lanes.length < 2) continue;
      for (const lane of link.lanes) {
        const snapshot = lane.vehicles.slice() as NetVehicle[];
        for (const veh of snapshot) {
          if ((this.stepNo + veh.id) % LC_EVERY !== 0) continue;
          if (veh.approved || this.time < veh.lcAllowedAt || veh.lane !== lane) continue;
          const allowed = this.allowedLanes(veh);
          const pref = this.preferredLanes(veh.moves, veh.ri);
          const cur = lane.index;
          const d = lane.length - veh.pos;
          if (allowed && !allowed.includes(cur)) {
            // Mandatory: this lane cannot make the next turn.
            const target = link.lanes[cur + (allowed[0]! > cur ? 1 : -1)]!;
            if (!this.tryChange(veh, lane, target, true) && d < COOPERATION_RANGE) this.mergeRequests.push({ veh, target });
            continue;
          }
          if (pref && !pref.includes(cur)) {
            // Strategic: allowed, but the turn after next is easier from another lane.
            const step = pref[0]! > cur ? 1 : -1;
            if (allowed!.includes(cur + step)) {
              const target = link.lanes[cur + step]!;
              if (!this.tryChange(veh, lane, target, true) && d < COOPERATION_RANGE) this.mergeRequests.push({ veh, target });
            }
            continue;
          }
          if (d < 30) continue; // no discretionary changes close to the stop line
          let best: SimLane | null = null;
          let bestGain = MOBIL_THRESHOLD;
          for (const dir of [-1, 1]) {
            const t = cur + dir;
            if (t < 0 || t >= link.lanes.length) continue;
            if (pref && !pref.includes(t)) continue;
            const g = this.laneChangeGain(veh, lane, link.lanes[t]!, false);
            if (g !== null && g > bestGain) {
              bestGain = g;
              best = link.lanes[t]!;
            }
          }
          if (best) this.execChange(veh, lane, best, false);
        }
      }
    }
  }

  /** MOBIL incentive (or 0 for a safe mandatory change); null if unsafe. */
  private laneChangeGain(veh: NetVehicle, from: SimLane, to: SimLane, mandatory: boolean): number | null {
    const vs = to.vehicles;
    const idx = upperBound(vs, veh.pos);
    const minGap = mandatory ? 0.5 : this.driver.s0;
    const ld = vs[idx];
    if (ld && ld.pos - ld.len - veh.pos < minGap) return null;
    if (!ld) {
      // A vehicle that has just left the target lane onto a junction connector may still
      // overhang the end of the lane with its rear.
      for (const oc of to.outConns) {
        const w = oc.lane.vehicles[0];
        if (w && to.length - veh.pos + w.pos - w.len < minGap) return null;
      }
    }
    const fl = vs[idx - 1] as NetVehicle | undefined;
    if (fl && veh.pos - veh.len - fl.pos < minGap) return null;
    // Never cut in front of a vehicle already approved to enter the junction. Approvals are
    // held only by the front vehicle of a lane; a lane change in front of it broke that, and
    // two vehicles reached a merge side by side (342 m/s² on the Braess network).
    if (!ld && fl?.approved) return null;
    if (!fl) {
      // No follower in the target lane itself: the next vehicle to arrive may still be
      // on a junction connector feeding it. It must not be cut off either.
      for (const f of to.feeders) {
        let w = f.lane.vehicles[f.lane.vehicles.length - 1] as NetVehicle | undefined;
        let back = veh.pos - veh.len; // distance from the start of the target lane to our rear
        let wLane: SimLane = f.lane;
        if (!w) {
          // Connector empty: the vehicle already approved to enter it is next.
          const a = f.inLane.vehicles[f.inLane.vehicles.length - 1] as NetVehicle | undefined;
          if (!a || a.approved !== f) continue;
          w = a;
          back += f.lane.length;
          wLane = f.inLane;
        }
        const gap = back + (wLane.length - w.pos);
        if (gap < minGap) return null;
        if (idmAccel(wLane.params, w.v, gap, veh.v, wLane.params.v0 * w.v0f) < -B_SAFE) return null;
      }
    }
    // Lane end acts as a stop line in the target lane too (veh is unapproved).
    if (to.length - veh.pos < 1) return null;
    const aNew = this.accelIn(veh, to, this.leader(veh, to, idx));
    if (aNew < -B_SAFE) return null;
    let followerTerm = 0;
    if (fl) {
      const aFlNew = idmAccel(to.params, fl.v, veh.pos - veh.len - fl.pos, veh.v, to.params.v0 * fl.v0f);
      if (aFlNew < -B_SAFE) return null;
      followerTerm = aFlNew - fl.acc;
    }
    if (mandatory) return 0;
    return aNew - veh.acc + MOBIL_POLITENESS * followerTerm;
  }

  private tryChange(veh: NetVehicle, from: SimLane, to: SimLane, mandatory: boolean): boolean {
    if (this.laneChangeGain(veh, from, to, mandatory) === null) return false;
    this.execChange(veh, from, to, mandatory);
    return true;
  }

  private execChange(veh: NetVehicle, from: SimLane, to: SimLane, mandatory: boolean): void {
    const i = from.vehicles.indexOf(veh);
    from.vehicles.splice(i, 1);
    veh.lane = to;
    insertSorted(to, veh);
    veh.lcFromIndex = from.index;
    veh.lcTime = this.time;
    veh.lcAllowedAt = this.time + (mandatory ? LC_COOLDOWN / 2 : LC_COOLDOWN);
  }

  /** Remove a vehicle from the network, releasing any reservation it holds. */
  private remove(veh: NetVehicle): void {
    const lane = veh.lane;
    lane.vehicles.splice(lane.vehicles.indexOf(veh), 1);
    if (veh.approved) this.unapprove(veh);
    if (lane.kind === "conn") lane.conn!.outLane.pending -= veh.len + this.driver.s0;
    this.dropped++;
    this.odStreams[veh.od]!.stats.dropped++;
  }

  /**
   * Gridlock relief, as in SUMO's time-to-teleport (default 300 s): the head of a queue
   * that has not moved for TELEPORT s is removed and counted. Without it, one local
   * lock-up freezes the rest of the run and makes scenario comparisons meaningless.
   */
  private relieveGridlock(): void {
    for (const lane of this.net.lanes) {
      const veh = lane.vehicles[lane.vehicles.length - 1] as NetVehicle | undefined;
      if (!veh || veh.stoppedFor < TELEPORT) continue;
      // A vehicle waiting at a red light is not stuck: the longest red is < 180 s.
      this.remove(veh);
      this.droppedGridlock++;
    }
  }

  /** A vehicle stuck at a stop line in a lane that cannot make its turn picks a new route from there. */
  private handleStuck(): void {
    for (const link of this.net.links) {
      for (const lane of link.lanes) {
        const veh = lane.vehicles[lane.vehicles.length - 1] as NetVehicle | undefined;
        if (!veh || veh.approved || veh.stoppedFor < STUCK_REROUTE) continue;
        const allowed = this.allowedLanes(veh);
        if (!allowed || allowed.includes(lane.index)) continue;
        if (lane.length - veh.pos > 15) continue;
        const dest = this.odStreams[veh.od]!.dest;
        let best: { route: LinkRT[]; cost: number } | null = null;
        for (const m of link.out) {
          if (!m.inLanes.includes(lane.index) || m.outLink.closed) continue;
          const tail = shortestRouteFrom(this.net, m.outLink, dest, this.linkCost);
          if (tail && (!best || tail.cost < best.cost)) best = tail;
        }
        if (!best) {
          // No alternative route from this lane. Keep waiting for a gap (others yield),
          // but never deadlock forever: after GIVE_UP s the vehicle is removed and counted.
          if (veh.stoppedFor >= GIVE_UP) {
            this.remove(veh);
            this.droppedWrongLane++;
          }
          continue;
        }
        veh.route = [...veh.route.slice(0, veh.ri + 1), ...best.route];
        veh.moves = movesFor(this.net, veh.route);
        veh.sigDecided = veh.committed = veh.sigStop = false;
        veh.stoppedFor = 0;
        this.rerouted++;
      }
    }
  }

  // ---------------------------------------------------------------- demand

  private generateDemand(): void {
    for (const s of this.odStreams) {
      while (s.next <= this.time) {
        s.next += this.rng.exp(s.rate);
        this.generated++;
        s.stats.generated++;
        if (this.routing === "reactive" && this.time - s.routeAt >= ROUTE_REFRESH) this.refreshRoute(s);
        if (!s.route) {
          this.unserved++;
          s.stats.unserved++;
          continue;
        }
        this.queues[s.route[0]!.idx]!.push({ od: s, route: s.route, moves: s.moves, tFree: s.tFree, tGen: this.time });
      }
    }
  }

  private insertVehicles(): void {
    for (const link of this.net.links) {
      const q = this.queues[link.idx]!;
      for (let k = 0; k < link.lanes.length && q.length > 0; k++) {
        const p = q[0]!;
        const allowed = this.preferredLanes(p.moves, 0) ?? link.lanes.map((l) => l.index);
        let bestLane: SimLane | null = null;
        let bestSpace = -Infinity;
        let bestV = 0;
        for (const li of allowed) {
          const lane = link.lanes[li]!;
          const first = lane.vehicles[0];
          const space = first ? first.pos - first.len : Infinity;
          const v = first ? insertionSpeed(lane.params, space, first.v) : freeInsertionSpeed(lane.params);
          if (v !== null && space > bestSpace) {
            bestSpace = space;
            bestLane = lane;
            bestV = v;
          }
        }
        if (!bestLane) break;
        // The road continues beyond the study area, so a real driver would already know about
        // the junction at the end of this link. Enter no faster than allows a comfortable stop
        // before it (its entry may be refused). Without this, vehicles created at 15–20 m/s on
        // 29–56 m entry links at Silk Board braked at 35–214 m/s².
        if (p.route.length > 1) {
          bestV = Math.min(bestV, Math.sqrt(2 * this.driver.b * Math.max(0, link.length - this.driver.s0)));
        }
        q.shift();
        this.spawn(p, bestLane, bestV);
      }
    }
  }

  private spawn(p: Pending, lane: SimLane, v: number): void {
    const v0f = 1 + this.spread * (2 * this.rng.next() - 1);
    const veh: NetVehicle = {
      id: this.nextId++, pos: 0, v, acc: 0, len: 4.5, params: lane.params, tSpawn: p.tGen,
      lane, route: p.route, moves: p.moves, ri: 0, approved: null, od: this.odStreams.indexOf(p.od), v0f,
      tLinkEnter: this.time, tFree: p.tFree, lcAllowedAt: this.time + 1, stoppedFor: 0, dist: 0, lcFromIndex: lane.index, lcTime: -Infinity, sigDecided: false, committed: false, sigStop: false, sigFor: null,
    };
    lane.vehicles.unshift(veh);
    this.entered++;
    this.linkStats[lane.link!.idx]!.entered++;
  }

  // ------------------------------------------------------------ bookkeeping

  private bookkeeping(): void {
    if (this.time + 1e-9 < this.nextSample) return;
    const iv = this.cfg.sampleInterval ?? 60;
    let n = 0;
    let vSum = 0;
    let stuck = 0;
    for (const st of this.linkStats) st.queue = 0;
    for (const lane of this.net.lanes) {
      for (const v of lane.vehicles) {
        const veh = v as NetVehicle;
        n++;
        vSum += veh.v;
        if (veh.stoppedFor > STUCK_VEHICLE) stuck++;
        if (lane.link && veh.v < 2) this.linkStats[lane.link.idx]!.queue++;
      }
    }
    for (const st of this.linkStats) st.maxQueue = Math.max(st.maxQueue, st.queue);
    // Partial gridlock: a cluster of vehicles has not moved for STUCK_VEHICLE seconds.
    if (this.gridlockAt === null && stuck >= GRIDLOCK_STUCK) this.gridlockAt = this.time;
    this.samples.push({
      t: this.time, inNetwork: n, waiting: this.waiting, meanSpeed: n ? vSum / n : 0, completed: this.exited,
      throughput: ((this.exited - this.lastSampleCompleted) * 3600) / iv, stuck,
    });
    this.lastSampleCompleted = this.exited;
    this.nextSample += iv;
  }

  get inNetwork(): number {
    let n = 0;
    for (const lane of this.net.lanes) n += lane.vehicles.length;
    return n;
  }

  get waiting(): number {
    let n = 0;
    for (const q of this.queues) n += q.length;
    return n;
  }

  *vehicles(): Generator<NetVehicle> {
    for (const lane of this.net.lanes) for (const v of lane.vehicles) yield v as NetVehicle;
  }

  /** Invariant violations in the current state (empty = healthy). Used by tests. */
  checkInvariants(): string[] {
    const errs: string[] = [];
    for (const lane of this.net.lanes) {
      const vs = lane.vehicles;
      for (let i = 0; i < vs.length; i++) {
        const v = vs[i] as NetVehicle;
        if (v.lane !== lane) errs.push(`veh ${v.id} lane pointer mismatch`);
        if (v.approved && i !== vs.length - 1) errs.push(`veh ${v.id} holds an approval but is not the front of its lane`);
        if (!(v.v >= 0) || !Number.isFinite(v.pos)) errs.push(`veh ${v.id} bad state v=${v.v} pos=${v.pos}`);
        if (v.pos > lane.length + 1e-6) errs.push(`veh ${v.id} beyond lane end`);
        if (i > 0) {
          const gap = v.pos - v.len - vs[i - 1]!.pos;
          if (gap < 0) errs.push(`collision on lane ${lane.uid}: veh ${vs[i - 1]!.id} into ${v.id}, gap ${gap.toFixed(3)}`);
        }
      }
    }
    // Collisions across lane boundaries: connector → the lane it feeds, and stop line → connector.
    for (const c of this.net.connectors) {
      const front = c.lane.vehicles[c.lane.vehicles.length - 1];
      const rear = c.outLane.vehicles[0];
      if (front && rear) {
        const gap = c.lane.length - front.pos + rear.pos - rear.len;
        if (gap < 0) errs.push(`collision leaving junction ${c.movement.id}: veh ${front.id} into ${rear.id}, gap ${gap.toFixed(3)}`);
      }
      const inFront = c.inLane.vehicles[c.inLane.vehicles.length - 1] as NetVehicle | undefined;
      const connRear = c.lane.vehicles[0];
      if (inFront && connRear) {
        const gap = c.inLane.length - inFront.pos + connRear.pos - connRear.len;
        if (gap < 0) errs.push(`collision entering junction ${c.movement.id}: veh ${inFront.id} into ${connRear.id}, gap ${gap.toFixed(3)}`);
      }
    }
    for (const c of this.net.connectors) {
      if (c.lane.vehicles.length === 0) continue;
      for (const { other, kind } of c.conflicts) {
        if (other.lane.vehicles.length === 0 || c.uid > other.uid) continue;
        if (kind === "cross") {
          errs.push(`crossing connectors occupied together: ${c.movement.id} / ${other.movement.id}`);
        } else if (kind === "diverge") {
          // Two vehicles from the same lane on different connectors must not overlap near the shared start.
          for (const a of c.lane.vehicles) {
            for (const w of other.lane.vehicles) {
              const [lead, foll] = a.pos >= w.pos ? [a, w] : [w, a];
              const rearOfLead = lead.pos - lead.len;
              if (rearOfLead < DIVERGE_CLEARANCE && foll.pos > rearOfLead) {
                errs.push(`diverge overlap ${c.movement.id} / ${other.movement.id}: veh ${foll.id} into ${lead.id}`);
              }
            }
          }
        } else if (kind === "merge") {
          // Merging vehicles must be ordered without overlap on the way to the merge point.
          for (const a of c.lane.vehicles) {
            for (const w of other.lane.vehicles) {
              const ra = c.lane.length - a.pos;
              const rw = other.lane.length - w.pos;
              const gap = ra > rw ? ra - rw - w.len : rw - ra - a.len;
              if (gap < 0) errs.push(`merge overlap ${c.movement.id} / ${other.movement.id}: veh ${a.id} & ${w.id}, gap ${gap.toFixed(2)}`);
            }
          }
        }
      }
    }
    const balance = this.entered - this.exited - this.dropped - this.inNetwork;
    if (balance !== 0) errs.push(`conservation: entered - exited - dropped - inNetwork = ${balance}`);
    if (this.generated !== this.entered + this.waiting + this.unserved) errs.push("demand bookkeeping mismatch");
    return errs;
  }

  stateHash(): string {
    const arr: number[] = [this.time, this.generated, this.entered, this.exited];
    for (const lane of this.net.lanes) for (const v of lane.vehicles) arr.push(v.id, lane.uid, v.pos, v.v);
    return fnv1aFloat64(Float64Array.from(arr));
  }
}

// ---------------------------------------------------------------- helpers

/**
 * Leaders on OTHER connectors that a vehicle heading along connector `c` must follow.
 * - merge: vehicles on connectors ending in the same lane that are ahead of us on the
 *   way to the merge point (`myRem` = our distance to the end of `c`).
 * - diverge: a vehicle that left our lane onto a different connector and whose rear has
 *   not yet cleared the shared first few metres (`myPos` = our position along `c`,
 *   negative while we are still approaching its start).
 */
function sideLeader(c: ConnectorRT, myRem: number, myPos: number, best: { gap: number; v: number } | null): { gap: number; v: number } | null {
  for (const { other, kind } of c.conflicts) {
    if (kind === "merge") {
      for (const w of other.lane.vehicles) {
        const wRem = other.lane.length - w.pos;
        if (wRem >= myRem) continue; // behind us: it follows us, not the other way round
        const gap = myRem - wRem - w.len;
        if (!best || gap < best.gap) best = { gap, v: w.v };
      }
      // ...and the vehicle already approved for that connector but still on its approach,
      // whether or not the connector is occupied. (Considering it only when the connector
      // was empty made it "appear" 2 m ahead the moment the connector emptied.)
      if (other.reserved > 0) {
        const a = other.inLane.vehicles[other.inLane.vehicles.length - 1] as NetVehicle | undefined;
        if (a && a.approved === other) {
          const aRem = other.lane.length + other.inLane.length - a.pos;
          if (aRem < myRem) {
            const gap = myRem - aRem - a.len;
            if (!best || gap < best.gap) best = { gap, v: a.v };
          }
        }
      }
    } else if (kind === "diverge") {
      const w = other.lane.vehicles[0];
      if (!w || w.pos - w.len >= DIVERGE_CLEARANCE || w.pos <= myPos) continue;
      const gap = w.pos - w.len - myPos;
      if (!best || gap < best.gap) best = { gap, v: w.v };
    }
  }
  return best;
}

/** Does traffic on this connector have to give way (a crossing path, or merging into traffic with priority)? */
function mustYield(c: ConnectorRT): boolean {
  const mine = c.movement.inLink.priority;
  for (const { other, kind } of c.conflicts) {
    if (kind === "cross") return true;
    // Merging into traffic with priority, or into an equal stream (a lane drop): entry may
    // be refused when the other lane has the gap. (At Silk Board, a 2-lane road dropping
    // into a 1-lane slip road produced all 17 braking events above 1 g per 3 hours.)
    if (kind === "merge" && other.movement.inLink.priority >= mine) return true;
  }
  return false;
}

/** Is the movement in the all-red clearance interval that follows its own amber? */
function inClearance(sig: NonNullable<NodeRT["signal"]>, movementId: string, time: number): boolean {
  const tc = (((time + sig.offset) % sig.cycle) + sig.cycle) % sig.cycle;
  for (const p of sig.phases) if (p.movements.has(movementId) && tc >= p.amberEnd && tc < p.end) return true;
  return false;
}

function canStopComfortably(v: number, d: number, b: number): boolean {
  if (v < 0.5) return true;
  return (v * v) / (2 * Math.max(d, 0.1)) <= b;
}

/** Time since the movement's signal last turned red (s). */
function redLateness(sig: NonNullable<NodeRT["signal"]>, movementId: string, time: number): number {
  const tc = (((time + sig.offset) % sig.cycle) + sig.cycle) % sig.cycle;
  let best = Infinity;
  for (const p of sig.phases) {
    if (!p.movements.has(movementId)) continue;
    const since = (((tc - p.amberEnd) % sig.cycle) + sig.cycle) % sig.cycle;
    best = Math.min(best, since);
  }
  return best;
}

/** First index i with vs[i].pos > pos. */
function upperBound(vs: Vehicle[], pos: number): number {
  let lo = 0;
  let hi = vs.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (vs[mid]!.pos <= pos) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

function insertSorted(lane: SimLane, veh: Vehicle): void {
  const vs = lane.vehicles;
  const i = upperBound(vs, veh.pos);
  vs.splice(i, 0, veh);
}

export function movesFor(net: Network, route: LinkRT[]): MovementRT[] {
  const ms: MovementRT[] = [];
  for (let i = 0; i < route.length - 1; i++) {
    const m = net.movementById.get(`${route[i]!.id}>${route[i + 1]!.id}`);
    if (!m) throw new Error(`No movement ${route[i]!.id}>${route[i + 1]!.id}`);
    ms.push(m);
  }
  return ms;
}

/** Route that starts on `start` (already entered) and reaches dest; cost excludes nothing. */
function shortestRouteFrom(net: Network, start: LinkRT, dest: NodeRT, cost: (l: LinkRT) => number): { route: LinkRT[]; cost: number } | null {
  // Reuse the node-based search by temporarily treating `start` as the only origin link.
  const fakeOrigin = { outLinks: [start] } as unknown as NodeRT;
  const route = shortestRoute(net, fakeOrigin, dest, cost);
  if (!route) return null;
  return { route, cost: route.reduce((s, l) => s + cost(l), 0) };
}
