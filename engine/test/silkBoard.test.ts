/**
 * The real network: Silk Board junction, Bengaluru, built from OpenStreetMap
 * (data/build_network.py → networks/silk-board.network.json → scripts/osm-demand.ts →
 * networks/silk-board.json). Demand is synthetic; see networks/silk-board.json meta.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { buildNetwork, NetworkSim, type DemandSpec, type NetworkSpec } from "../src/index";

const scenario = JSON.parse(readFileSync(fileURLToPath(new URL("../../networks/silk-board.json", import.meta.url)), "utf8")) as {
  network: NetworkSpec;
  demand: DemandSpec[];
};
const FLYOVER = ["w40696221+", "w40696222+"]; // "Silk Board Flyover", Hosur Road deck over the junction

function run(opts: { demandScale?: number; closedLinks?: string[]; seed?: number; seconds?: number }) {
  const sim = new NetworkSim({ network: scenario.network, demand: scenario.demand, seed: opts.seed ?? 1, demandScale: opts.demandScale, closedLinks: opts.closedLinks });
  let errs: string[] = [];
  const n = (opts.seconds ?? 3600) / sim.dt;
  for (let i = 0; i < n; i++) {
    sim.step();
    if (!errs.length && i % 4 === 0) errs = sim.checkInvariants();
  }
  return { sim, errs };
}

describe("Silk Board network (OpenStreetMap)", () => {
  const net = buildNetwork(scenario.network);

  it("builds cleanly, with the flyovers present and elevated", () => {
    expect(net.warnings).toEqual([]);
    for (const id of FLYOVER) expect(net.linkById.get(id)!.layer).toBe(1);
    expect(net.links.filter((l) => l.layer >= 1).length).toBeGreaterThanOrEqual(10);
    expect(net.links.some((l) => l.layer === 2)).toBe(true); // the double-decker interchange ramp
  });

  it("no elevated road has a movement at a signalised junction (decks pass over, not through)", () => {
    for (const n of net.nodes) {
      if (n.kind !== "signal") continue;
      for (const m of n.movements) {
        expect(m.inLink.layer).toBe(0);
        expect(m.outLink.layer).toBe(0);
      }
    }
  });

  it("every link keeps at least ~20 m of usable road after junction trimming", () => {
    for (const l of net.links) expect(l.length).toBeGreaterThan(19);
  });
});

describe("Silk Board simulation", () => {
  it.each([1, 2])("default demand, seed %i: healthy for 1 h (no gridlock, invariants hold)", (seed) => {
    const { sim, errs } = run({ seed });
    expect(errs).toEqual([]);
    expect(sim.unserved).toBe(0);
    expect(sim.stopLineViolations).toBe(0);
    expect(sim.gridlockAt).toBeNull();
    expect(sim.maxRedEntryLateness).toBeLessThanOrEqual(2);
    expect(sim.dropped / sim.entered).toBeLessThan(0.005);
    expect(sim.exited / sim.entered).toBeGreaterThan(0.9);
    expect(sim.waiting).toBeLessThan(20);
    // Measured worst case over 5 seeds: −9.8 m/s². Bound it so that it cannot silently get worse.
    expect(sim.hardestBrake).toBeGreaterThan(-12);
  });

  it("2x demand overloads the area: entry queues build and trips take much longer", () => {
    const base = run({});
    const heavy = run({ demandScale: 2 });
    expect(heavy.errs).toEqual([]);
    expect(heavy.sim.waiting).toBeGreaterThan(300);
    const meanTT = (s: NetworkSim) => s.travelTimes.reduce((a, b) => a + b, 0) / s.travelTimes.length;
    expect(meanTT(heavy.sim)).toBeGreaterThan(1.5 * meanTT(base.sim));
  });

  it("closing the Silk Board Flyover: northbound traffic reroutes through the junction and slows; southbound has no ground route", () => {
    const open = run({});
    const closed = run({ closedLinks: FLYOVER });
    expect(closed.errs).toEqual([]);
    for (const id of FLYOVER) expect(closed.sim.linkStats[closed.sim.net.linkById.get(id)!.idx]!.entered).toBe(0);
    const flyLinks = FLYOVER.map((id) => open.sim.net.linkById.get(id)!);
    const nb = open.sim.net.linkById.get("w40696222+")!;
    const users = open.sim.odStreams.filter((s) => s.route?.some((l) => flyLinks.includes(l)));
    expect(users.length).toBeGreaterThan(0);
    // Southbound: in the OSM data the only way past Silk Board towards Hosur Road south is
    // the flyover itself (true even with every road class included), so those trips are
    // reported as unserved, not silently dropped or teleported.
    const sbLink = open.sim.net.linkById.get("w40696221+")!;
    const sb = users.filter((s) => s.route!.includes(sbLink)); // (one OD uses both decks)
    const unservedOD = closed.sim.odStreams.filter((s) => s.stats.unserved > 0).map((s) => `${s.stats.origin}>${s.stats.destination}`);
    for (const s of sb) expect(unservedOD).toContain(`${s.stats.origin}>${s.stats.destination}`);
    expect(closed.sim.unserved).toBeGreaterThan(0);
    // Northbound: rerouted via the signal at ground level, and slower.
    const nbUsers = users.filter((s) => s.route!.includes(nb) && !s.route!.includes(sbLink));
    expect(nbUsers.length).toBeGreaterThan(0);
    const tt = (sim: NetworkSim, o: string, d: string) => {
      const st = sim.odStreams.find((x) => x.stats.origin === o && x.stats.destination === d)!.stats;
      return st.ttSum / Math.max(1, st.completed);
    };
    for (const u of nbUsers) {
      const st = closed.sim.odStreams.find((x) => x.stats.origin === u.stats.origin && x.stats.destination === u.stats.destination)!.stats;
      expect(st.unserved).toBe(0);
      expect(tt(closed.sim, u.stats.origin, u.stats.destination)).toBeGreaterThan(tt(open.sim, u.stats.origin, u.stats.destination));
    }
  });
});
