/**
 * Synthetic demand for OSM-derived networks. NOT calibrated against traffic counts.
 *
 * Every boundary node with outgoing links is an origin sending (outgoing lanes ×
 * perLane) veh/h. That flow is split over the reachable boundary destinations in
 * proportion to (incoming lanes) × (distance)^THROUGH_BIAS. The distance term makes
 * trips ACROSS the area (through traffic) outweigh trips to a neighbouring exit
 * (turns), as on real arterials. With plain lanes-only weighting about half of all
 * trips turned at Silk Board, overloading single turn lanes.
 * Destinations within U_TURN_DIST of the origin are skipped (same road, other
 * carriageway: U-turns are not modelled).
 */
import { buildNetwork, freeFlowCost, shortestRoute, type DemandSpec, type NetworkSpec } from "../src/index";

const U_TURN_DIST = 80; // m
export const THROUGH_BIAS = 2;

export function makeDemand(spec: NetworkSpec, perLane: number, throughBias = THROUGH_BIAS): DemandSpec[] {
  const net = buildNetwork(spec);
  const origins = net.nodes.filter((n) => n.kind === "boundary" && n.outLinks.length > 0);
  const dests = net.nodes.filter((n) => n.kind === "boundary" && n.inLinks.length > 0);
  const demand: DemandSpec[] = [];
  for (const o of origins) {
    const total = o.outLinks.reduce((s, l) => s + l.spec.lanes, 0) * perLane;
    const cands = dests.filter((d) => d !== o && Math.hypot(d.x - o.x, d.y - o.y) > U_TURN_DIST && shortestRoute(net, o, d, freeFlowCost));
    const w = cands.map((d) => d.inLinks.reduce((s, l) => s + l.spec.lanes, 0) * Math.pow(Math.hypot(d.x - o.x, d.y - o.y), throughBias));
    const W = w.reduce((a, b) => a + b, 0);
    cands.forEach((d, k) => {
      const rate = Math.round((total * w[k]!) / W);
      if (rate > 0) demand.push({ origin: o.id, destination: d.id, rate });
    });
  }
  return demand;
}
