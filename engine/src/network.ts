/**
 * Road network: serialisable spec → runtime structures used by NetworkSim.
 *
 * Conventions
 * - Left-hand traffic (India). Lane 0 is the kerb lane, i.e. the LEFTMOST lane.
 * - Every link is one-directional. A two-way road is two links (A→B and B→A);
 *   each carriageway is drawn to the left of the shared centreline.
 * - Flyovers are links with layer ≥ 1. They interact with other roads only
 *   through the nodes they connect to (their ramps), never where they merely
 *   cross another road's geometry.
 * - Junction movements are generated automatically (all turns except U-turns)
 *   and realised as lane-level "connectors": short internal lanes from an
 *   incoming lane to an outgoing lane.
 */
import { CITY_IDM, type IdmParams } from "./idm";
import { bezier, dist, Polyline, polylinesCross, turnAngle, type Pt } from "./geometry";
import { Lane } from "./lane";
import { kmhToMs } from "./units";

// ---------------------------------------------------------------- spec types

export type NodeKind = "boundary" | "signal" | "priority";

export interface PhaseSpec {
  /** green time, s */
  green: number;
  /** amber time, s (default 3) */
  amber?: number;
  /** all-red clearance after amber, s (default 2) */
  allRed?: number;
  /** movement ids "inLinkId>outLinkId" that are green in this phase */
  movements?: string[];
  /** shorthand: every movement from these incoming link ids is green */
  approaches?: string[];
}

export interface SignalPlanSpec {
  /** cycle offset, s */
  offset?: number;
  phases: PhaseSpec[];
}

export interface NodeSpec {
  id: string;
  x: number;
  y: number;
  /** inferred if omitted: degree-1 nodes are boundaries, others priority junctions */
  kind?: NodeKind;
  signal?: SignalPlanSpec;
  name?: string;
}

export interface LinkSpec {
  id: string;
  from: string;
  to: string;
  lanes: number;
  /** m, default 3.5 */
  laneWidth?: number;
  speedLimitKmh: number;
  /** 0 = ground, ≥ 1 = elevated (flyover) */
  layer?: number;
  /** intermediate shape points [x, y] between the end nodes */
  points?: [number, number][];
  /** right-of-way rank at priority junctions; default lanes × speed limit */
  priority?: number;
  name?: string;
}

export interface NetworkSpec {
  id: string;
  name: string;
  description?: string;
  nodes: NodeSpec[];
  links: LinkSpec[];
}

// ------------------------------------------------------------- runtime types

export type Turn = "left" | "through" | "right" | "uturn";

export interface SimLane extends Lane {
  uid: number;
  kind: "link" | "conn";
  /** for link lanes */
  link: LinkRT | null;
  index: number;
  /** for connector lanes */
  conn: ConnectorRT | null;
  /** IDM params for this lane (desired speed and headway already adjusted) */
  params: IdmParams;
  /** reserved entry space (len + s0) for vehicles approved into or driving on connectors toward this lane */
  pending: number;
  /** centreline of this lane in world coordinates (for rendering and lane-change geometry) */
  geom: Polyline;
  /** connectors that discharge into this lane (link lanes only) */
  feeders: ConnectorRT[];
  /** connectors that start from this lane (link lanes only) */
  outConns: ConnectorRT[];
}

export interface LinkRT {
  idx: number;
  id: string;
  spec: LinkSpec;
  from: NodeRT;
  to: NodeRT;
  /** reference geometry (trimmed at junctions), carriageway centre */
  geom: Polyline;
  length: number;
  laneWidth: number;
  layer: number;
  /** lateral offset of the carriageway centre from the node-to-node line, m (positive = left) */
  offset: number;
  lanes: SimLane[];
  /** effective desired speed, m/s (speed limit × lane-width factor) */
  v0: number;
  priority: number;
  out: MovementRT[];
  closed: boolean;
}

export interface MovementRT {
  id: string;
  node: NodeRT;
  inLink: LinkRT;
  outLink: LinkRT;
  turn: Turn;
  /** signed turn angle, rad (positive = left) */
  angle: number;
  /** allowed lane indices on the incoming link */
  inLanes: number[];
  /** connector per allowed in-lane (same order as inLanes) */
  connectors: ConnectorRT[];
}

export type ConflictKind = "diverge" | "merge" | "cross";

export interface ConnectorRT {
  uid: number;
  movement: MovementRT;
  inLane: SimLane;
  outLane: SimLane;
  lane: SimLane;
  geom: Polyline;
  v0: number;
  conflicts: { other: ConnectorRT; kind: ConflictKind }[];
  /** vehicles approved for this connector that have not yet entered it */
  reserved: number;
}

export interface PhaseRT {
  start: number;
  greenEnd: number;
  amberEnd: number;
  end: number;
  movements: Set<string>;
}

export interface SignalRT {
  cycle: number;
  offset: number;
  phases: PhaseRT[];
}

export interface NodeRT {
  idx: number;
  id: string;
  spec: NodeSpec;
  x: number;
  y: number;
  kind: NodeKind;
  inLinks: LinkRT[];
  outLinks: LinkRT[];
  movements: MovementRT[];
  connectors: ConnectorRT[];
  signal: SignalRT | null;
  /** trimming radius, m */
  radius: number;
}

export interface Network {
  spec: NetworkSpec;
  nodes: NodeRT[];
  links: LinkRT[];
  nodeById: Map<string, NodeRT>;
  linkById: Map<string, LinkRT>;
  movementById: Map<string, MovementRT>;
  lanes: SimLane[];
  connectors: ConnectorRT[];
  warnings: string[];
}

export interface BuildOptions {
  /** base driver params (v0 is replaced per link) */
  driver?: IdmParams;
  /** link ids to close (excluded from routing and spawning) */
  closedLinks?: Iterable<string>;
  /** generate U-turn movements (default false) */
  uTurns?: boolean;
}

// ------------------------------------------------------- modelling choices

/**
 * Narrow lanes are driven more slowly and with longer headways. Linear in width
 * between 2.5 m (factor 0.7) and 3.5 m (factor 1.0). A modelling assumption, documented
 * in docs/MODEL.md; not calibrated.
 */
export function laneWidthFactor(w: number): number {
  return Math.min(1, Math.max(0.7, 0.7 + 0.3 * (w - 2.5)));
}

/** Lateral acceleration used to derive turning speeds, m/s². */
const TURN_LAT_ACC = 2.0;
const MIN_TURN_SPEED = 4.0;
const DEFAULT_GREEN = 25;
const DEFAULT_AMBER = 3;
const DEFAULT_ALL_RED = 2;

/** Lane-assignment weights: through movements get more lanes. */
const TURN_WEIGHT: Record<Turn, number> = { left: 1, through: 2, right: 1, uturn: 1 };

// ------------------------------------------------------------------ builder

export function buildNetwork(spec: NetworkSpec, opts: BuildOptions = {}): Network {
  const driver = opts.driver ?? CITY_IDM;
  const closed = new Set(opts.closedLinks ?? []);
  const warnings: string[] = [];
  let laneUid = 0;
  let connUid = 0;

  // Nodes
  const nodeById = new Map<string, NodeRT>();
  spec.nodes.forEach((ns, idx) => {
    if (nodeById.has(ns.id)) throw new Error(`Duplicate node id ${ns.id}`);
    nodeById.set(ns.id, {
      idx, id: ns.id, spec: ns, x: ns.x, y: ns.y, kind: ns.kind ?? "priority",
      inLinks: [], outLinks: [], movements: [], connectors: [], signal: null, radius: 0,
    });
  });

  // Links (untrimmed first)
  const linkById = new Map<string, LinkRT>();
  const raw: { spec: LinkSpec; line: Polyline }[] = [];
  for (const ls of spec.links) {
    if (linkById.has(ls.id)) throw new Error(`Duplicate link id ${ls.id}`);
    const from = nodeById.get(ls.from);
    const to = nodeById.get(ls.to);
    if (!from || !to) throw new Error(`Link ${ls.id} references unknown node`);
    if (!(ls.lanes >= 1)) throw new Error(`Link ${ls.id} must have ≥ 1 lane`);
    const pts: Pt[] = [{ x: from.x, y: from.y }, ...(ls.points ?? []).map(([x, y]) => ({ x, y })), { x: to.x, y: to.y }];
    raw.push({ spec: ls, line: new Polyline(pts) });
    const lw = ls.laneWidth ?? 3.5;
    const link: LinkRT = {
      idx: linkById.size, id: ls.id, spec: ls, from, to,
      geom: null as unknown as Polyline, length: 0, laneWidth: lw, layer: ls.layer ?? 0, offset: 0,
      lanes: [], v0: kmhToMs(ls.speedLimitKmh) * laneWidthFactor(lw),
      priority: ls.priority ?? ls.lanes * ls.speedLimitKmh, out: [], closed: closed.has(ls.id),
    };
    linkById.set(ls.id, link);
    from.outLinks.push(link);
    to.inLinks.push(link);
  }
  for (const id of closed) if (!linkById.has(id)) warnings.push(`closedLinks: unknown link ${id}`);
  const links = [...linkById.values()];
  const nodes = [...nodeById.values()];

  // Node kinds and trimming radii
  for (const n of nodes) {
    const neighbours = new Set([...n.inLinks.map((l) => l.from.id), ...n.outLinks.map((l) => l.to.id)]);
    if (!n.spec.kind) n.kind = neighbours.size <= 1 ? "boundary" : "priority";
    if (n.spec.signal || n.kind === "signal") n.kind = "signal";
    if (n.kind === "boundary") n.radius = 0;
    else if (neighbours.size <= 2 && n.kind !== "signal") n.radius = 3; // pass-through / merge / diverge
    else {
      let w = 0;
      for (const l of [...n.inLinks, ...n.outLinks]) w = Math.max(w, l.spec.lanes * l.laneWidth);
      n.radius = w + 3;
    }
  }

  // Carriageway offsets and trimmed geometry
  const pairKey = (a: string, b: string) => `${a}|${b}`;
  const dirLinks = new Set(spec.links.map((l) => pairKey(l.from, l.to)));
  raw.forEach(({ spec: ls, line }, i) => {
    const link = links[i]!;
    const twoWay = dirLinks.has(pairKey(ls.to, ls.from));
    link.offset = twoWay ? (ls.lanes * link.laneWidth) / 2 + 0.5 : 0;
    let r0 = link.from.radius;
    let r1 = link.to.radius;
    const maxTrim = line.length - 5;
    if (r0 + r1 > maxTrim) {
      const k = Math.max(0, maxTrim) / (r0 + r1);
      r0 *= k;
      r1 *= k;
      warnings.push(`Link ${ls.id} is short (${line.length.toFixed(1)} m); junction radii reduced`);
    }
    link.geom = line.slice(r0, line.length - r1).offset(link.offset);
    link.length = link.geom.length;
    for (let li = 0; li < ls.lanes; li++) {
      const lateral = ((ls.lanes - 1) / 2 - li) * link.laneWidth;
      link.lanes.push(makeLane(link.length, "link", link, li, null, laneParams(driver, link.v0, link.laneWidth), link.geom.offset(lateral)));
    }
  });

  function makeLane(length: number, kind: "link" | "conn", link: LinkRT | null, index: number, conn: ConnectorRT | null, params: IdmParams, geom: Polyline): SimLane {
    const lane = new Lane(length) as SimLane;
    lane.uid = laneUid++;
    lane.kind = kind;
    lane.link = link;
    lane.index = index;
    lane.conn = conn;
    lane.params = params;
    lane.pending = 0;
    lane.geom = geom;
    lane.feeders = [];
    lane.outConns = [];
    return lane;
  }

  // Movements and connectors
  const movementById = new Map<string, MovementRT>();
  const connectors: ConnectorRT[] = [];
  for (const n of nodes) {
    if (n.kind === "boundary") continue;
    const nodeMoves: MovementRT[] = [];
    for (const inL of n.inLinks) {
      const hIn = inL.geom.poseAt(inL.length);
      const cands: MovementRT[] = [];
      for (const outL of n.outLinks) {
        const hOut = outL.geom.poseAt(0);
        const angle = turnAngle(hIn.hx, hIn.hy, hOut.hx, hOut.hy);
        const isU = outL.to.id === inL.from.id || Math.abs(angle) > (150 * Math.PI) / 180;
        if (isU && !opts.uTurns) continue;
        const turn: Turn = isU ? "uturn" : angle > (30 * Math.PI) / 180 ? "left" : angle < (-30 * Math.PI) / 180 ? "right" : "through";
        cands.push({ id: `${inL.id}>${outL.id}`, node: n, inLink: inL, outLink: outL, turn, angle, inLanes: [], connectors: [] });
      }
      // Leftmost movement first → kerb lanes.
      cands.sort((a, b) => b.angle - a.angle);
      assignLanes(inL.spec.lanes, cands);
      nodeMoves.push(...cands);
    }
    const throughRange = throughOutRanges(nodeMoves);
    for (const m of nodeMoves) {
      const inL = m.inLink;
      {
        const lo = m.inLanes[0]!;
        const hi = m.inLanes[m.inLanes.length - 1]!;
        const nOut = m.outLink.spec.lanes;
        for (const li of m.inLanes) {
          let oi: number;
          if (m.turn === "left") oi = Math.min(li - lo, nOut - 1);
          else if (m.turn === "right" || m.turn === "uturn") oi = Math.max(nOut - 1 - (hi - li), 0);
          else {
            const [a, b] = throughRange.get(m)!;
            oi = hi === lo ? a : a + Math.round(((li - lo) / (hi - lo)) * (b - a));
          }
          const inLane = inL.lanes[li]!;
          const outLane = m.outLink.lanes[oi]!;
          const p0 = inLane.geom.poseAt(inLane.length);
          const p3 = outLane.geom.poseAt(0);
          const k = Math.max(dist(p0, p3) / 3, 0.5);
          const pts = bezier(p0, { x: p0.x + p0.hx * k, y: p0.y + p0.hy * k }, { x: p3.x - p3.hx * k, y: p3.y - p3.hy * k }, p3, 12);
          const geom = new Polyline(pts);
          const theta = Math.abs(m.angle);
          const chord = dist(p0, p3);
          const radius = theta > 0.05 ? chord / (2 * Math.sin(theta / 2)) : Infinity;
          const vTurn = Math.max(MIN_TURN_SPEED, Math.sqrt(TURN_LAT_ACC * radius));
          const v0 = Math.min(inL.v0, m.outLink.v0, vTurn);
          const conn: ConnectorRT = {
            uid: connUid++, movement: m, inLane, outLane, lane: null as unknown as SimLane, geom, v0, conflicts: [], reserved: 0,
          };
          conn.lane = makeLane(geom.length, "conn", null, 0, conn, laneParams(driver, v0, 3.5), geom);
          outLane.feeders.push(conn);
          inLane.outConns.push(conn);
          m.connectors.push(conn);
          n.connectors.push(conn);
          connectors.push(conn);
        }
        inL.out.push(m);
        n.movements.push(m);
        movementById.set(m.id, m);
      }
    }
    // Conflicts between connectors of this node
    const cs = n.connectors;
    for (let i = 0; i < cs.length; i++) {
      for (let j = i + 1; j < cs.length; j++) {
        const a = cs[i]!;
        const b = cs[j]!;
        let kind: ConflictKind | null = null;
        if (a.inLane === b.inLane) kind = "diverge";
        else if (a.outLane === b.outLane) kind = "merge";
        else if (polylinesCross(a.geom, b.geom)) kind = "cross";
        if (kind) {
          a.conflicts.push({ other: b, kind });
          b.conflicts.push({ other: a, kind });
        }
      }
    }
    // Signals
    if (n.kind === "signal") n.signal = buildSignal(n, movementById, warnings);
  }

  // Dead ends: links that end at a non-boundary node with no way out
  for (const l of links) {
    if (l.to.kind !== "boundary" && l.out.length === 0) warnings.push(`Link ${l.id} is a dead end at node ${l.to.id}`);
  }

  const lanes: SimLane[] = [...links.flatMap((l) => l.lanes), ...connectors.map((c) => c.lane)];
  return { spec, nodes, links, nodeById, linkById, movementById, lanes, connectors, warnings };
}

function laneParams(driver: IdmParams, v0: number, laneWidth: number): IdmParams {
  const f = laneWidthFactor(laneWidth);
  return { ...driver, v0, T: driver.T * (2 - f) };
}

/**
 * Out-lane range for each through movement. When several through movements
 * from different incoming links feed the same outgoing link (e.g. a flyover
 * landing next to its service road), order them left→right as seen by the
 * outgoing link and split its lanes in proportion to their lane counts, so the
 * left road keeps to the left lanes and only the boundary lane is shared.
 */
function throughOutRanges(ms: MovementRT[]): Map<MovementRT, [number, number]> {
  const out = new Map<MovementRT, [number, number]>();
  const byOut = new Map<LinkRT, MovementRT[]>();
  for (const m of ms) {
    if (m.turn !== "through") continue;
    const g = byOut.get(m.outLink) ?? [];
    g.push(m);
    byOut.set(m.outLink, g);
  }
  for (const [outL, group] of byOut) {
    const nOut = outL.spec.lanes;
    const start = outL.geom.poseAt(0);
    // Lateral position of each incoming link's end, positive = left of the outgoing link.
    const side = (m: MovementRT) => {
      const e = m.inLink.geom.poseAt(m.inLink.length);
      return start.hx * (e.y - start.y) - start.hy * (e.x - start.x);
    };
    group.sort((a, b) => side(b) - side(a));
    const total = group.reduce((s, m) => s + m.inLanes.length, 0);
    let acc = 0;
    for (const m of group) {
      const k = m.inLanes.length;
      const lo = Math.min(nOut - 1, Math.floor((acc * nOut) / total + 1e-9));
      const hi = Math.max(lo, Math.min(nOut - 1, Math.ceil(((acc + k) * nOut) / total - 1e-9) - 1));
      out.set(m, [lo, hi]);
      acc += k;
    }
  }
  return out;
}

/**
 * Distribute n lanes over movements ordered left→right, proportionally to
 * TURN_WEIGHT. Neighbouring movements may share a lane; every movement gets ≥ 1.
 */
function assignLanes(n: number, ms: MovementRT[]): void {
  const total = ms.reduce((s, m) => s + TURN_WEIGHT[m.turn], 0);
  let acc = 0;
  for (const m of ms) {
    const w = TURN_WEIGHT[m.turn];
    const lo = Math.min(n - 1, Math.floor((acc * n) / total + 1e-9));
    const hi = Math.max(lo, Math.min(n - 1, Math.ceil(((acc + w) * n) / total - 1e-9) - 1));
    for (let i = lo; i <= hi; i++) m.inLanes.push(i);
    acc += w;
  }
}

function buildSignal(n: NodeRT, movementById: Map<string, MovementRT>, warnings: string[]): SignalRT {
  let phases: PhaseSpec[] = n.spec.signal?.phases ?? [];
  if (phases.length === 0) {
    // Default: split phasing, one phase per approach (common at Indian junctions).
    phases = n.inLinks
      .filter((l) => l.out.length > 0)
      .map((l) => ({ green: DEFAULT_GREEN, movements: l.out.map((m) => m.id) }));
  }
  const rt: PhaseRT[] = [];
  let t = 0;
  const served = new Set<string>();
  for (const p of phases) {
    const amber = p.amber ?? DEFAULT_AMBER;
    const allRed = p.allRed ?? DEFAULT_ALL_RED;
    const ms = new Set<string>();
    const ids = [...(p.movements ?? [])];
    for (const a of p.approaches ?? []) {
      const l = n.inLinks.find((x) => x.id === a);
      if (!l) warnings.push(`Signal at ${n.id}: unknown approach ${a}`);
      else ids.push(...l.out.map((m) => m.id));
    }
    for (const id of ids) {
      const m = movementById.get(id);
      if (!m || m.node !== n) warnings.push(`Signal at ${n.id}: unknown movement ${id}`);
      else {
        ms.add(id);
        served.add(id);
      }
    }
    rt.push({ start: t, greenEnd: t + p.green, amberEnd: t + p.green + amber, end: t + p.green + amber + allRed, movements: ms });
    t += p.green + amber + allRed;
  }
  for (const m of n.movements) if (!served.has(m.id)) warnings.push(`Signal at ${n.id}: movement ${m.id} is never green`);
  return { cycle: t, offset: n.spec.signal?.offset ?? 0, phases: rt };
}

export type SignalState = "green" | "amber" | "red";

export function signalState(sig: SignalRT, movementId: string, time: number): SignalState {
  if (sig.cycle <= 0) return "red";
  const tc = (((time + sig.offset) % sig.cycle) + sig.cycle) % sig.cycle;
  for (const p of sig.phases) {
    if (tc >= p.start && tc < p.end) {
      if (!p.movements.has(movementId)) return "red";
      if (tc < p.greenEnd) return "green";
      if (tc < p.amberEnd) return "amber";
      return "red";
    }
  }
  return "red";
}
