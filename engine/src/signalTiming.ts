/**
 * Fixed-time signal timing by Webster's method, for a given demand.
 *
 *   C0 = (1.5 L + 5) / (1 − Y),  effective green g_i = (C0 − L) · y_i / Y
 *
 * y_i is the critical flow ratio of phase i (max over its approaches of flow per lane
 * / saturation flow), Y = Σ y_i, L the total lost time. Approach flows come from
 * assigning each OD flow to its free-flow shortest route (an approximation: the
 * simulation itself routes reactively).
 */
import type { DemandSpec } from "./networkSim";
import { buildNetwork, type Network, type NetworkSpec, type NodeRT, type PhaseSpec, type SignalPlanSpec } from "./network";
import { freeFlowCost, shortestRoute } from "./routing";

/** Measured queue discharge of the calibrated driver model, veh/h/lane (docs/VALIDATION.md §2). */
export const SATURATION_FLOW = 1935;
const AMBER = 3;
const ALL_RED = 2;
/** start-up lost time (4.6 s, measured) + unused end of amber (~1.5 s) */
const LOST_PER_PHASE = 4.6 + 1.5 + ALL_RED;
const MIN_GREEN = 7;
const MIN_CYCLE = 60;
const MAX_CYCLE = 180;

/** Flows (veh/h) on every link and movement when each OD flow takes its free-flow shortest route. */
export function assignFlows(net: Network, demand: DemandSpec[]): { links: Map<string, number>; moves: Map<string, number> } {
  const links = new Map<string, number>();
  const moves = new Map<string, number>();
  for (const d of demand) {
    const o = net.nodeById.get(d.origin);
    const t = net.nodeById.get(d.destination);
    if (!o || !t) continue;
    const r = shortestRoute(net, o, t, freeFlowCost);
    if (!r) continue;
    for (const l of r) links.set(l.id, (links.get(l.id) ?? 0) + d.rate);
    for (let i = 0; i < r.length - 1; i++) {
      const id = `${r[i]!.id}>${r[i + 1]!.id}`;
      moves.set(id, (moves.get(id) ?? 0) + d.rate);
    }
  }
  return { links, moves };
}

/** Flow on each lane of a link: each movement's flow split equally over the lanes it may use. */
export function laneFlows(link: Network["links"][number], moves: Map<string, number>): number[] {
  const q = new Array<number>(link.lanes.length).fill(0);
  for (const m of link.out) {
    const f = moves.get(m.id) ?? 0;
    for (const li of m.inLanes) q[li]! += f / m.inLanes.length;
  }
  return q;
}

export interface TimingReport {
  node: string;
  cycle: number;
  Y: number;
  phases: { approaches: string[]; green: number; y: number }[];
  oversaturated: boolean;
}

/**
 * Webster plan for one signalised node, keeping one phase per approach (split phasing).
 * The flow ratio of an approach is that of its busiest (critical) lane: averaging over
 * lanes hid a left-turn lane at 2.3× capacity on the Outer Ring Road at Silk Board.
 */
export function websterPlan(node: NodeRT, moves: Map<string, number>): { plan: SignalPlanSpec; report: TimingReport } {
  const approaches = node.inLinks.filter((l) => l.out.length > 0);
  const ys = approaches.map((l) => Math.max(0, ...laneFlows(l, moves)) / SATURATION_FLOW);
  const Y = ys.reduce((a, b) => a + b, 0);
  const L = LOST_PER_PHASE * approaches.length;
  const oversaturated = Y >= 0.95;
  let C = oversaturated ? MAX_CYCLE : (1.5 * L + 5) / (1 - Y);
  C = Math.min(MAX_CYCLE, Math.max(MIN_CYCLE, C));
  // Effective green shared in proportion to y; displayed green = effective + lost − amber − all-red.
  const usable = C - L;
  const phases: PhaseSpec[] = approaches.map((l, i) => {
    const gEff = Y > 0 ? (usable * ys[i]!) / Y : usable / approaches.length;
    const green = Math.max(MIN_GREEN, Math.round(gEff + LOST_PER_PHASE - AMBER - ALL_RED));
    return { green, amber: AMBER, allRed: ALL_RED, approaches: [l.id] };
  });
  const cycle = phases.reduce((s, p) => s + p.green + AMBER + ALL_RED, 0);
  return {
    plan: { phases },
    report: {
      node: node.id, cycle, Y: +Y.toFixed(3), oversaturated,
      phases: phases.map((p, i) => ({ approaches: p.approaches!, green: p.green, y: +ys[i]!.toFixed(3) })),
    },
  };
}

/** Return a copy of `spec` with every signal retimed for `demand` by Webster's method. */
export function retimeSignals(spec: NetworkSpec, demand: DemandSpec[]): { spec: NetworkSpec; reports: TimingReport[] } {
  const net = buildNetwork(spec);
  const { moves } = assignFlows(net, demand);
  const out: NetworkSpec = JSON.parse(JSON.stringify(spec)); // specs are plain JSON
  const reports: TimingReport[] = [];
  for (const n of net.nodes) {
    if (n.kind !== "signal") continue;
    const { plan, report } = websterPlan(n, moves);
    const ns = out.nodes.find((x) => x.id === n.id)!;
    ns.signal = plan;
    reports.push(report);
  }
  return { spec: out, reports };
}

/**
 * Design lane use for a demand, then time the signals for it.
 *
 * OSM has no turn-lane tags here, so by default an approach's lanes are shared out with
 * fixed weights (through 2, each turn 1). Where one turn dominates, that leaves it a
 * single lane far over capacity. This gives each movement lanes in proportion to its
 * assigned flow (+1 so that every movement keeps a lane), as junction design would,
 * and then retimes every signal by Webster's method on the critical-lane flows.
 */
export function designForDemand(spec: NetworkSpec, demand: DemandSpec[]): { spec: NetworkSpec; reports: TimingReport[] } {
  const net = buildNetwork(spec);
  const { moves } = assignFlows(net, demand);
  const out: NetworkSpec = JSON.parse(JSON.stringify(spec)); // specs are plain JSON
  for (const n of net.nodes) {
    if (n.kind === "boundary") continue;
    const w: Record<string, number> = {};
    for (const m of n.movements) w[m.id] = (moves.get(m.id) ?? 0) + 1;
    out.nodes.find((x) => x.id === n.id)!.laneWeights = w;
  }
  return retimeSignals(out, demand);
}
