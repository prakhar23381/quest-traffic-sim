/**
 * A scenario: a base network from the catalog plus the user's edits. Validated with zod
 * (shape and ranges) and then semantically (ids exist). The same code runs in the browser
 * and on the server, so a scenario means the same thing everywhere.
 */
import { z } from "zod";
import { catalogEntry, type CatalogEntry } from "./catalog";
import { buildNetwork, type NetworkSpec, type PhaseSpec } from "./network";
import type { DemandSpec, SimConfig } from "./networkSim";
import { retimeSignals } from "./signalTiming";

export const LIMITS = {
  maxDurationS: 7200,
  maxDemandScale: 3,
  maxLanes: 6,
  minGreen: 5,
  maxGreen: 120,
} as const;

const linkEdit = z
  .object({
    lanes: z.number().int().min(1).max(LIMITS.maxLanes).optional(),
    speedLimitKmh: z.number().min(10).max(120).optional(),
    laneWidth: z.number().min(2.5).max(4).optional(),
  })
  .strict();

export const ScenarioSchema = z
  .object({
    version: z.literal(1),
    name: z.string().trim().min(1).max(80),
    networkId: z.string().min(1).max(64),
    seed: z.number().int().min(0).max(2 ** 31 - 1),
    durationS: z.number().int().min(60).max(LIMITS.maxDurationS),
    demandScale: z.number().min(0).max(LIMITS.maxDemandScale),
    /** link ids to close (in addition to toggles switched off) */
    closedLinks: z.array(z.string().max(64)).max(500).default([]),
    /** catalog toggles switched OFF */
    togglesOff: z.array(z.string().max(64)).max(50).default([]),
    linkEdits: z.record(z.string().max(64), linkEdit).default({}),
    /** per signalised node: green time of each phase, s */
    signalGreens: z.record(z.string().max(64), z.array(z.number().min(LIMITS.minGreen).max(LIMITS.maxGreen)).min(1).max(12)).default({}),
    /** retime every signal for the (scaled) demand by Webster's method, after edits */
    retimeSignals: z.boolean().default(false),
  })
  .strict();

export type Scenario = z.infer<typeof ScenarioSchema>;
export type ScenarioInput = z.input<typeof ScenarioSchema>;

export function defaultScenario(networkId: string, name = "Baseline"): Scenario {
  return ScenarioSchema.parse({ version: 1, name, networkId, seed: 1, durationS: 3600, demandScale: 1 });
}

export interface PreparedScenario {
  scenario: Scenario;
  entry: CatalogEntry;
  network: NetworkSpec;
  demand: DemandSpec[];
  config: SimConfig;
}

export class ScenarioError extends Error {
  constructor(readonly issues: string[]) {
    super(issues.join("; "));
  }
}

/** Phases of a signalised node as explicit specs (the engine may have generated a default plan). */
export function signalPhases(network: NetworkSpec, nodeId: string): PhaseSpec[] | null {
  const ns = network.nodes.find((n) => n.id === nodeId);
  if (!ns) return null;
  if (ns.signal?.phases.length) return ns.signal.phases;
  const net = buildNetwork(network);
  const n = net.nodeById.get(nodeId);
  if (!n?.signal) return null;
  return n.signal.phases.map((p) => ({ green: p.greenEnd - p.start, amber: p.amberEnd - p.greenEnd, allRed: p.end - p.amberEnd, movements: [...p.movements] }));
}

/** Validate a scenario (shape + ids) and turn it into a simulation config. Throws ScenarioError. */
export function prepareScenario(input: unknown): PreparedScenario {
  const parsed = ScenarioSchema.safeParse(input);
  if (!parsed.success) throw new ScenarioError(parsed.error.issues.map((i) => `${i.path.join(".") || "scenario"}: ${i.message}`));
  const s = parsed.data;
  const entry = catalogEntry(s.networkId);
  if (!entry) throw new ScenarioError([`networkId: unknown network "${s.networkId}"`]);

  const issues: string[] = [];
  let network: NetworkSpec = JSON.parse(JSON.stringify(entry.network));
  const linkIds = new Set(network.links.map((l) => l.id));

  for (const [id, edit] of Object.entries(s.linkEdits)) {
    const l = network.links.find((x) => x.id === id);
    if (!l) {
      issues.push(`linkEdits: unknown link "${id}"`);
      continue;
    }
    if (edit.lanes !== undefined) l.lanes = edit.lanes;
    if (edit.speedLimitKmh !== undefined) l.speedLimitKmh = edit.speedLimitKmh;
    if (edit.laneWidth !== undefined) l.laneWidth = edit.laneWidth;
    // Lane use per movement was designed for the original lane counts; drop it at the
    // junction this link feeds so lanes are shared out again by the default rule.
    if (edit.lanes !== undefined) {
      const to = network.nodes.find((n) => n.id === l.to);
      if (to) delete to.laneWeights;
    }
  }

  for (const [nodeId, greens] of Object.entries(s.signalGreens)) {
    const phases = signalPhases(network, nodeId);
    if (!phases) {
      issues.push(`signalGreens: "${nodeId}" is not a signalised node`);
      continue;
    }
    if (greens.length !== phases.length) {
      issues.push(`signalGreens.${nodeId}: expected ${phases.length} green times, got ${greens.length}`);
      continue;
    }
    const ns = network.nodes.find((n) => n.id === nodeId)!;
    ns.signal = { ...(ns.signal ?? {}), phases: phases.map((p, i) => ({ ...p, green: greens[i]! })) };
  }

  const closed = new Set<string>();
  for (const id of s.closedLinks) {
    if (!linkIds.has(id)) issues.push(`closedLinks: unknown link "${id}"`);
    else closed.add(id);
  }
  for (const t of s.togglesOff) {
    const tog = entry.toggles.find((x) => x.id === t);
    if (!tog) issues.push(`togglesOff: unknown toggle "${t}" for ${entry.id}`);
    else tog.links.forEach((id) => closed.add(id));
  }
  if (issues.length) throw new ScenarioError(issues);

  const demand = entry.demand;
  if (s.retimeSignals) {
    const scaled = demand.map((d) => ({ ...d, rate: d.rate * s.demandScale }));
    network = retimeSignals(network, scaled).spec;
  }

  return {
    scenario: s,
    entry,
    network,
    demand,
    config: { network, demand, seed: s.seed, demandScale: s.demandScale, closedLinks: [...closed] },
  };
}
