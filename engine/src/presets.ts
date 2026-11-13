/**
 * Synthetic networks used for validation and as presets in the app.
 * Coordinates in metres (x east, y north). Left-hand traffic.
 */
import type { LinkSpec, NetworkSpec, NodeSpec } from "./network";
import type { DemandSpec } from "./networkSim";

export interface Preset {
  network: NetworkSpec;
  demand: DemandSpec[];
}

function twoWay(id: string, a: string, b: string, lanes: number, speedLimitKmh: number, extra: Partial<LinkSpec> = {}): LinkSpec[] {
  const rev = extra.points ? { ...extra, points: [...extra.points].reverse() } : extra;
  return [
    { id: `${id}+`, from: a, to: b, lanes, speedLimitKmh, ...extra },
    { id: `${id}-`, from: b, to: a, lanes, speedLimitKmh, ...rev },
  ];
}

/** A — B — C straight two-way road with a pass-through node in the middle. */
export function corridor(lanes = 2, length = 1000, speedLimitKmh = 50): Preset {
  return {
    network: {
      id: "corridor",
      name: "Straight corridor",
      nodes: [
        { id: "A", x: 0, y: 0 },
        { id: "B", x: length / 2, y: 0 },
        { id: "C", x: length, y: 0 },
      ],
      links: [...twoWay("AB", "A", "B", lanes, speedLimitKmh), ...twoWay("BC", "B", "C", lanes, speedLimitKmh)],
    },
    demand: [
      { origin: "A", destination: "C", rate: 1200 },
      { origin: "C", destination: "A", rate: 1200 },
    ],
  };
}

/** Four-arm signalised junction; 2 lanes each way, arms of `arm` metres. */
export function signalCross(arm = 300, lanes = 2, green = 25): Preset {
  const nodes: NodeSpec[] = [
    { id: "C", x: 0, y: 0, kind: "signal" },
    { id: "N", x: 0, y: arm },
    { id: "S", x: 0, y: -arm },
    { id: "E", x: arm, y: 0 },
    { id: "W", x: -arm, y: 0 },
  ];
  const links = ["N", "S", "E", "W"].flatMap((d) => twoWay(`${d}C`, d, "C", lanes, 50));
  const net: NetworkSpec = { id: "signal-cross", name: "Signalised crossroads", nodes, links };
  // Split phasing, one phase per approach.
  nodes[0]!.signal = {
    phases: ["N", "E", "S", "W"].map((d) => ({
      green,
      movements: ["N", "S", "E", "W"].filter((o) => o !== d).map((o) => `${d}C+>${o}C-`),
    })),
  };
  const demand: DemandSpec[] = [];
  for (const o of ["N", "S", "E", "W"]) for (const d of ["N", "S", "E", "W"]) if (o !== d) demand.push({ origin: o, destination: d, rate: 120 });
  return { network: net, demand };
}

/**
 * Flyover over a signalised junction (the Silk Board pattern).
 *
 *            N
 *            |  (3 lanes each way)
 *           Nd ── diverge/merge
 *          /  \
 *  service    flyover (layer 1, 2 lanes each way, no junction at C)
 *          \  /
 *  W ───────C─────── E   (signalised; E-W road 2 lanes each way)
 *          /  \
 *           Sd ── diverge/merge
 *            |
 *            S
 */
export function flyoverJunction(): Preset {
  const nodes: NodeSpec[] = [
    { id: "N", x: 0, y: 700 },
    { id: "Nd", x: 0, y: 300 },
    {
      id: "C", x: 0, y: 0, kind: "signal", name: "Junction under the flyover",
      // Busy cross road gets most of the 120 s cycle; the service roads carry only turning traffic.
      signal: {
        phases: [
          { green: 35, approaches: ["EC+"] },
          { green: 15, approaches: ["SVC_N_SB"] },
          { green: 35, approaches: ["WC+"] },
          { green: 15, approaches: ["SVC_S_NB"] },
        ],
      },
    },
    { id: "Sd", x: 0, y: -300 },
    { id: "S", x: 0, y: -700 },
    { id: "E", x: 500, y: 0 },
    { id: "W", x: -500, y: 0 },
  ];
  const links: LinkSpec[] = [
    ...twoWay("NNd", "N", "Nd", 3, 60),
    ...twoWay("SdS", "Sd", "S", 3, 60),
    // Flyover deck: straight over C, elevated.
    { id: "FLY_SB", from: "Nd", to: "Sd", lanes: 2, speedLimitKmh: 60, layer: 1, name: "Flyover (southbound)" },
    { id: "FLY_NB", from: "Sd", to: "Nd", lanes: 2, speedLimitKmh: 60, layer: 1, name: "Flyover (northbound)" },
    // Service roads at ground level, splayed out beside the flyover.
    // Southbound traffic keeps left = east (+x); northbound keeps left = west (−x).
    { id: "SVC_N_SB", from: "Nd", to: "C", lanes: 2, speedLimitKmh: 40, points: [[14, 230], [14, 60]], name: "Service road (north, southbound)" },
    { id: "SVC_N_NB", from: "C", to: "Nd", lanes: 2, speedLimitKmh: 40, points: [[-14, 60], [-14, 230]], name: "Service road (north, northbound)" },
    { id: "SVC_S_SB", from: "C", to: "Sd", lanes: 2, speedLimitKmh: 40, points: [[14, -60], [14, -230]], name: "Service road (south, southbound)" },
    { id: "SVC_S_NB", from: "Sd", to: "C", lanes: 2, speedLimitKmh: 40, points: [[-14, -230], [-14, -60]], name: "Service road (south, northbound)" },
    ...twoWay("EC", "E", "C", 2, 50),
    ...twoWay("WC", "W", "C", 2, 50),
  ];
  const demand: DemandSpec[] = [
    { origin: "N", destination: "S", rate: 1800 },
    { origin: "S", destination: "N", rate: 1800 },
    { origin: "E", destination: "W", rate: 500 },
    { origin: "W", destination: "E", rate: 500 },
    { origin: "N", destination: "E", rate: 150 },
    { origin: "N", destination: "W", rate: 150 },
    { origin: "S", destination: "E", rate: 150 },
    { origin: "S", destination: "W", rate: 150 },
    { origin: "E", destination: "N", rate: 150 },
    { origin: "E", destination: "S", rate: 150 },
    { origin: "W", destination: "N", rate: 150 },
    { origin: "W", destination: "S", rate: 150 },
  ];
  return { network: { id: "flyover-junction", name: "Flyover over a signalised junction", nodes, links }, demand };
}

/** n × n grid of signalised junctions with boundary entries on every edge road. */
export function grid(n = 3, block = 250, lanes = 2): Preset {
  const nodes: NodeSpec[] = [];
  const links: LinkSpec[] = [];
  const id = (i: number, j: number) => `J${i}_${j}`;
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) nodes.push({ id: id(i, j), x: i * block, y: j * block, kind: "signal" });
  const boundary: string[] = [];
  for (let k = 0; k < n; k++) {
    const sides: [string, number, number, number, number][] = [
      [`BW${k}`, -block, k * block, 0, k],
      [`BE${k}`, n * block, k * block, n - 1, k],
      [`BS${k}`, k * block, -block, k, 0],
      [`BN${k}`, k * block, n * block, k, n - 1],
    ];
    for (const [bid, x, y, i, j] of sides) {
      nodes.push({ id: bid, x, y });
      links.push(...twoWay(`${bid}-${id(i, j)}`, bid, id(i, j), lanes, 50));
      boundary.push(bid);
    }
  }
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      if (i + 1 < n) links.push(...twoWay(`${id(i, j)}-${id(i + 1, j)}`, id(i, j), id(i + 1, j), lanes, 50));
      if (j + 1 < n) links.push(...twoWay(`${id(i, j)}-${id(i, j + 1)}`, id(i, j), id(i, j + 1), lanes, 50));
    }
  }
  // Opposite-side OD pairs.
  const demand: DemandSpec[] = [];
  for (let k = 0; k < n; k++) {
    demand.push({ origin: `BW${k}`, destination: `BE${k}`, rate: 300 }, { origin: `BE${k}`, destination: `BW${k}`, rate: 300 });
    demand.push({ origin: `BS${k}`, destination: `BN${k}`, rate: 300 }, { origin: `BN${k}`, destination: `BS${k}`, rate: 300 });
  }
  return { network: { id: `grid-${n}x${n}`, name: `${n}×${n} signalised grid`, nodes, links }, demand };
}

/**
 * Braess network. Two routes S→T, each with one narrow (bottleneck) link and one
 * long wide link, arranged in opposite order:
 *
 *   S ──narrow──▶ A ════long wide════▶ T
 *   S ════long wide════▶ B ──narrow──▶ T
 *
 * and an optional short shortcut A → B. With the shortcut, the route
 * S→A→B→T is the shortest in free flow but uses BOTH bottlenecks; at
 * equilibrium everyone is slower than without it (Braess's paradox).
 */
export function braess(withShortcut = true, rate = 1600): Preset {
  const nodes: NodeSpec[] = [
    { id: "S", x: 0, y: 0, kind: "boundary" },
    { id: "A", x: 300, y: 50 },
    { id: "B", x: 300, y: -50 },
    { id: "T", x: 600, y: 0, kind: "boundary" },
  ];
  const links: LinkSpec[] = [
    { id: "SA", from: "S", to: "A", lanes: 1, speedLimitKmh: 50, name: "Narrow link S→A" },
    { id: "AT", from: "A", to: "T", lanes: 2, speedLimitKmh: 60, points: [[300, 600], [600, 600]], name: "Long wide road A→T" },
    { id: "SB", from: "S", to: "B", lanes: 2, speedLimitKmh: 60, points: [[0, -600], [300, -600]], name: "Long wide road S→B" },
    { id: "BT", from: "B", to: "T", lanes: 1, speedLimitKmh: 50, name: "Narrow link B→T" },
  ];
  if (withShortcut) links.push({ id: "AB", from: "A", to: "B", lanes: 1, speedLimitKmh: 60, name: "Shortcut A→B" });
  return {
    network: { id: withShortcut ? "braess" : "braess-no-shortcut", name: `Braess network${withShortcut ? "" : " (no shortcut)"}`, nodes, links },
    demand: [{ origin: "S", destination: "T", rate }],
  };
}
