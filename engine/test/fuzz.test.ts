/**
 * Release-readiness audit (2026-11-15): property tests on the one entry point that takes
 * untrusted input, prepareScenario, and on the simulator under random valid edits.
 */
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { CATALOG, defaultScenario, LIMITS, NetworkSim, prepareScenario, ScenarioError } from "../src/index";

/** Arbitrary JSON-ish values, including the awkward ones. */
const weird = fc.oneof(
  fc.jsonValue(),
  fc.constant(undefined),
  fc.constant(NaN),
  fc.constant(Infinity),
  fc.constant(-0),
  fc.string({ unit: "grapheme-composite" }),
  fc.constantFrom("__proto__", "constructor", "'; DROP TABLE scenarios;--", "<script>alert(1)</script>", "\u0000", "‮", "x".repeat(100_000)),
);

function outcome(input: unknown): "ok" | "rejected" {
  try {
    prepareScenario(input);
    return "ok";
  } catch (e) {
    if (e instanceof ScenarioError) {
      expect(e.issues.length).toBeGreaterThan(0);
      return "rejected";
    }
    throw e; // any other error type is a bug: it would surface as a 500 on the server
  }
}

/** FUZZ_SCALE=10 runs ten times as many cases (used once for the audit) */
const K = Number(process.env.FUZZ_SCALE ?? 1);

describe("prepareScenario with hostile input", () => {
  it("arbitrary values are accepted or rejected cleanly, never crash", () => {
    fc.assert(fc.property(weird, (v) => void outcome(v)), { numRuns: 2000 * K });
  });

  it("objects with the right keys but arbitrary values are handled cleanly", () => {
    const keys = ["version", "name", "networkId", "seed", "durationS", "demandScale", "closedLinks", "togglesOff", "linkEdits", "signalGreens", "retimeSignals"];
    const obj = fc.dictionary(fc.constantFrom(...keys, "__proto__", "constructor", "extra"), weird);
    fc.assert(fc.property(obj, (v) => void outcome(v)), { numRuns: 3000 * K });
  });

  it("a valid scenario with one field mutated to a hostile value never crashes", () => {
    const base = JSON.parse(JSON.stringify(defaultScenario("silk-board")));
    const field = fc.constantFrom(...Object.keys(base));
    fc.assert(
      fc.property(field, weird, (k, v) => {
        // JSON.parse keeps "__proto__" as an own key, as a request body would
        void outcome({ ...base, [k]: v });
      }),
      { numRuns: 3000 * K },
    );
  });

  it("prototype-named ids are 'unknown' (or stripped for __proto__), never inherited or polluting", () => {
    for (const bad of ["constructor", "toString", "hasOwnProperty"]) {
      const net = defaultScenario("corridor");
      expect(() => prepareScenario({ ...net, linkEdits: JSON.parse(`{"${bad}":{"lanes":2}}`) })).toThrow(ScenarioError);
      expect(() => prepareScenario({ ...net, signalGreens: JSON.parse(`{"${bad}":[10]}`) })).toThrow(ScenarioError);
      expect(() => prepareScenario({ ...net, networkId: bad })).toThrow(ScenarioError);
    }
    // zod drops an own "__proto__" key: the scenario is accepted with no edits, and nothing leaks
    const net = defaultScenario("corridor");
    const p = prepareScenario({ ...net, linkEdits: JSON.parse('{"__proto__":{"lanes":2}}') });
    expect(Object.keys(p.scenario.linkEdits)).toEqual([]);
    expect(({} as Record<string, unknown>).lanes).toBeUndefined();
  });
});

describe("simulator under random valid edits", () => {
  const small = CATALOG.filter((e) => e.id !== "silk-board");

  it("keeps every safety invariant and finite results", () => {
    let totalEntered = 0;
    let runsWithTraffic = 0;
    fc.assert(
      fc.property(
        fc.constantFrom(...small.map((e) => e.id)),
        fc.integer({ min: 0, max: 1000 }),
        fc.double({ min: 0.3, max: LIMITS.maxDemandScale, noNaN: true }),
        fc.boolean(),
        fc.array(fc.nat(100), { maxLength: 3 }),
        fc.integer({ min: 1, max: LIMITS.maxLanes }),
        fc.double({ min: 2.5, max: 4, noNaN: true }),
        (id, seed, demand, retime, closeIdx, lanes, width) => {
          const probe = prepareScenario({ ...defaultScenario(id), durationS: 60 });
          const links = probe.network.links.map((l) => l.id);
          const edits: Record<string, { lanes: number; laneWidth: number }> = {};
          for (const i of closeIdx.slice(0, 1)) edits[links[i % links.length]!] = { lanes, laneWidth: Math.round(width * 4) / 4 };
          const prep = prepareScenario({
            ...defaultScenario(id),
            seed,
            durationS: 180,
            demandScale: demand,
            retimeSignals: retime,
            linkEdits: edits,
            closedLinks: closeIdx.length > 2 ? [links[closeIdx[2]! % links.length]!] : [],
          });
          const sim = new NetworkSim(prep.config);
          for (let i = 0; i < 720; i++) sim.step(); // 180 simulated seconds
          expect(sim.checkInvariants()).toEqual([]);
          expect(Number.isFinite(sim.hardestBrake)).toBe(true);
          expect(sim.entered).toBeGreaterThanOrEqual(sim.exited);
          totalEntered += sim.entered;
          if (sim.entered > 0) runsWithTraffic++;
        },
      ),
      { numRuns: 60 * K },
    );
    // guard against a vacuous pass: the random scenarios must really have carried traffic
    expect(totalEntered).toBeGreaterThan(2000 * K * 0.8);
    expect(runsWithTraffic).toBeGreaterThan(40 * K * 0.8);
    console.log(`property run: ${runsWithTraffic}/${60 * K} simulations carried traffic, ${totalEntered} vehicles in total`);
  }, 1_800_000);
});
