import { describe, expect, it } from "vitest";
import { buildNetwork, CATALOG, defaultScenario, prepareScenario, runScenario, ScenarioError, signalPhases, type ScenarioInput } from "../src/index";

const base = (over: Partial<ScenarioInput> = {}): ScenarioInput => ({ ...defaultScenario("flyover-junction"), ...over });
const issues = (input: unknown): string[] => {
  try {
    prepareScenario(input);
    return [];
  } catch (e) {
    if (e instanceof ScenarioError) return e.issues;
    throw e;
  }
};

describe("catalog", () => {
  it.each(CATALOG.map((e) => [e.id, e] as const))("%s builds without warnings and its toggles name real links", (_id, e) => {
    const net = buildNetwork(e.network);
    expect(net.warnings).toEqual([]);
    for (const t of e.toggles) for (const l of t.links) expect(net.linkById.has(l)).toBe(true);
    expect(e.demand.length).toBeGreaterThan(0);
  });
});

describe("scenario validation", () => {
  it("accepts the default scenario for every network", () => {
    for (const e of CATALOG) expect(issues(defaultScenario(e.id))).toEqual([]);
  });

  it("rejects bad shapes and out-of-range values with readable messages", () => {
    expect(issues({})).not.toEqual([]);
    expect(issues(base({ durationS: 99999 })).join()).toMatch(/durationS/);
    expect(issues(base({ demandScale: -1 })).join()).toMatch(/demandScale/);
    expect(issues(base({ linkEdits: { FLY_SB: { lanes: 9 } } })).join()).toMatch(/lanes/);
    expect(issues({ ...base(), extra: 1 }).join()).toMatch(/extra|Unrecognized/i);
  });

  it("rejects ids that do not exist in the chosen network", () => {
    expect(issues(base({ networkId: "atlantis" })).join()).toMatch(/unknown network/);
    expect(issues(base({ closedLinks: ["nope"] })).join()).toMatch(/unknown link "nope"/);
    expect(issues(base({ togglesOff: ["nope"] })).join()).toMatch(/unknown toggle/);
    expect(issues(base({ signalGreens: { N: [30] } })).join()).toMatch(/not a signalised node/);
    expect(issues(base({ signalGreens: { C: [30] } })).join()).toMatch(/expected 4 green times/);
  });
});

describe("scenario edits", () => {
  it("a toggle switched off closes its links", () => {
    const p = prepareScenario(base({ togglesOff: ["flyover"] }));
    expect(new Set(p.config.closedLinks)).toEqual(new Set(["FLY_SB", "FLY_NB"]));
  });

  it("link edits change lanes and speed", () => {
    const p = prepareScenario(base({ linkEdits: { "EC+": { lanes: 3, speedLimitKmh: 30 } } }));
    const l = p.network.links.find((x) => x.id === "EC+")!;
    expect(l.lanes).toBe(3);
    expect(l.speedLimitKmh).toBe(30);
  });

  it("signal greens replace the plan's green times, keeping its phases", () => {
    const before = signalPhases(prepareScenario(base()).network, "C")!;
    const p = prepareScenario(base({ signalGreens: { C: [10, 20, 30, 40] } }));
    const after = signalPhases(p.network, "C")!;
    expect(after.map((x) => x.green)).toEqual([10, 20, 30, 40]);
    expect(after.map((x) => x.approaches ?? x.movements)).toEqual(before.map((x) => x.approaches ?? x.movements));
  });

  it("default (generated) signal plans can be edited too", () => {
    const phases = signalPhases(prepareScenario(defaultScenario("grid-3x3")).network, "J1_1")!;
    const greens = phases.map(() => 15);
    const p = prepareScenario({ ...defaultScenario("grid-3x3"), signalGreens: { J1_1: greens } });
    expect(signalPhases(p.network, "J1_1")!.map((x) => x.green)).toEqual(greens);
  });

  it("retiming produces a different plan when demand changes", () => {
    const a = prepareScenario(base({ retimeSignals: true, demandScale: 0.5 }));
    const b = prepareScenario(base({ retimeSignals: true, demandScale: 1.5 }));
    expect(signalPhases(a.network, "C")!.map((x) => x.green)).not.toEqual(signalPhases(b.network, "C")!.map((x) => x.green));
  });
});

describe("runScenario", () => {
  it("is deterministic and reports consistent KPIs", () => {
    const s = base({ durationS: 600, seed: 3 });
    const a = runScenario(s);
    const b = runScenario(s);
    expect(a.stateHash).toBe(b.stateHash);
    expect(a.kpis.completed).toBeGreaterThan(0);
    expect(a.kpis.entered).toBe(a.kpis.completed + a.kpis.inNetwork + a.kpis.droppedWrongLane + a.kpis.droppedGridlock);
    expect(a.timeseries.length).toBe(10);
    expect(a.links.length).toBe(prepareScenario(s).network.links.length);
    expect(a.durationS).toBe(600);
  });

  it("closing the flyover shows up in the results", () => {
    const open = runScenario(base({ durationS: 900 }));
    const closed = runScenario(base({ durationS: 900, togglesOff: ["flyover"] }));
    expect(closed.links.find((l) => l.id === "FLY_SB")!.closed).toBe(true);
    expect(closed.links.find((l) => l.id === "FLY_SB")!.entered).toBe(0);
    expect(closed.kpis.meanDelay).toBeGreaterThan(open.kpis.meanDelay);
  });

  it("can be stopped early", () => {
    let calls = 0;
    const r = runScenario(base({ durationS: 3600 }), { shouldStop: () => ++calls > 3 });
    expect(r.durationS).toBeLessThan(600);
  });
});
