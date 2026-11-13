import { describe, expect, it } from "vitest";
import { braess, corridor, flyoverJunction, grid, NetworkSim, signalCross, type NetworkSpec, type Preset, type SimConfig } from "../src/index";

/** Run for `seconds`, checking every invariant after every step. Returns the first violations. */
function runChecked(sim: NetworkSim, seconds: number, every = 1): string[] {
  const n = Math.round(seconds / sim.dt);
  for (let i = 0; i < n; i++) {
    sim.step();
    if (i % every === 0) {
      const errs = sim.checkInvariants();
      if (errs.length) return [`t=${sim.time}`, ...errs];
    }
  }
  return [];
}

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / (xs.length || 1);
const odDelay = (sim: NetworkSim, o: string, d: string) => {
  const s = sim.odStreams.find((x) => x.stats.origin === o && x.stats.destination === d)!.stats;
  return s.delaySum / s.completed;
};

const presets: [string, () => Preset][] = [
  ["corridor", () => corridor()],
  ["signalised crossroads", () => signalCross()],
  ["flyover junction", () => flyoverJunction()],
  ["3x3 grid", () => grid()],
  ["Braess network", () => braess()],
];

describe("network invariants (checked every step for 1 h)", () => {
  it.each(presets)("%s: no collisions, conflicts exclusive, vehicles conserved, nothing stuck", (name, make) => {
    const p = make();
    const sim = new NetworkSim({ network: p.network, demand: p.demand, seed: 1 });
    expect(sim.warnings).toEqual([]);
    expect(runChecked(sim, 3600)).toEqual([]);
    expect(sim.stopLineViolations).toBe(0);
    expect(sim.dropped).toBe(0);
    expect(sim.unserved).toBe(0);
    expect(sim.gridlockAt).toBeNull();
    expect(sim.samples.at(-1)!.stuck).toBe(0);
    expect(sim.exited).toBeGreaterThan(0.9 * (sim.generated - sim.inNetwork - sim.waiting));
    // Nobody enters a junction after the all-red clearance (2 s) has ended.
    expect(sim.maxRedEntryLateness).toBeLessThanOrEqual(2);
    // No emergency braking at design demand. (Gaps of ~0 show up here as huge values long
    // before they show up as collisions, which is how several lane-change bugs were found.)
    expect(sim.hardestBrake).toBeGreaterThan(name === "Braess network" ? -8 : -5);
  });

  it.each(presets)("%s: still safe at 2.5x demand for 2 h (overload)", (_name, make) => {
    const p = make();
    const sim = new NetworkSim({ network: p.network, demand: p.demand, seed: 5, demandScale: 2.5 });
    expect(runChecked(sim, 7200, 4)).toEqual([]);
    expect(sim.stopLineViolations).toBe(0);
    expect(sim.maxRedEntryLateness).toBeLessThanOrEqual(2);
    expect(sim.hardestBrake).toBeGreaterThan(-9.81); // never more than 1 g (tyre grip), even in gridlock
  });
});

describe("determinism", () => {
  const run = (seed: number) => {
    const p = flyoverJunction();
    const sim = new NetworkSim({ network: p.network, demand: p.demand, seed });
    sim.run(900);
    return sim.stateHash();
  };
  it("same seed gives a bit-identical state; different seeds differ", () => {
    expect(run(7)).toBe(run(7));
    expect(run(7)).not.toBe(run(8));
  });
});

describe("signalised junction capacity and delay", () => {
  // One 2-lane approach, 30 s green + 3 s amber + 2 s all-red, then an equal phase for nobody: C = 70 s.
  const net: NetworkSpec = {
    id: "sig", name: "single approach",
    nodes: [
      { id: "A", x: -600, y: 0 },
      { id: "J", x: 0, y: 0, kind: "signal", signal: { phases: [{ green: 30, movements: ["AJ>JB"] }, { green: 30, movements: [] }] } },
      { id: "B", x: 600, y: 0 },
    ],
    links: [
      { id: "AJ", from: "A", to: "J", lanes: 2, speedLimitKmh: 50 },
      { id: "JB", from: "J", to: "B", lanes: 2, speedLimitKmh: 50 },
    ],
  };
  const C = 70;
  const S = 2 * 1935; // saturation flow, veh/h (measured queue discharge of the calibrated IDM)
  // Effective green = G + amber − start-up lost time (4.6 s, measured) − clearance lost time (~1.5 s).
  const G_EFF = 30 + 3 - 4.6 - 1.5;

  function measure(rate: number) {
    const sim = new NetworkSim({ network: net, demand: [{ origin: "A", destination: "B", rate }], seed: 3, speedSpread: 0 });
    sim.run(900);
    const e0 = sim.exited;
    const n0 = sim.travelTimes.length;
    sim.run(7200);
    return { flow: (sim.exited - e0) / 2, delay: mean(sim.travelTimes.slice(n0)) - sim.odStreams[0]!.tFree };
  }

  it("saturated throughput matches s · g_eff / C within 8 %", () => {
    const predicted = (S * G_EFF) / C; // ≈ 1488 veh/h
    const { flow } = measure(4000);
    expect(flow).toBeGreaterThan(predicted * 0.92);
    expect(flow).toBeLessThan(predicted * 1.08);
  });

  it.each([300, 600, 900, 1200])("delay at %i veh/h tracks Webster's formula (offset < 6 s)", (rate) => {
    const lam = G_EFF / C;
    const x = rate / (lam * S);
    const d1 = (C * (1 - lam) ** 2) / (2 * (1 - x * lam));
    const d2 = (x * x) / (2 * (rate / 3600) * (1 - x));
    const { flow, delay } = measure(rate);
    expect(Math.abs(flow - rate) / rate).toBeLessThan(0.06); // undersaturated: all demand served
    // Webster omits acceleration/deceleration delay, so the simulation sits a few seconds above it.
    expect(delay).toBeGreaterThan(d1 + d2 - 1);
    expect(delay).toBeLessThan(d1 + d2 + 6);
  });
});

describe("flyover", () => {
  const cfg = (over: Partial<SimConfig> = {}): SimConfig => {
    const p = flyoverJunction();
    return { network: p.network, demand: p.demand, seed: 2, ...over };
  };

  it("through traffic on the flyover is unaffected by an overloaded junction below", () => {
    const p = flyoverJunction();
    // Triple only the cross-road demand so the signal is heavily oversaturated.
    const demand = p.demand.map((d) => (d.origin === "E" || d.origin === "W" ? { ...d, rate: d.rate * 3 } : d));
    const sim = new NetworkSim(cfg({ demand }));
    expect(runChecked(sim, 3600, 4)).toEqual([]);
    expect(odDelay(sim, "E", "W")).toBeGreaterThan(200); // junction is jammed
    expect(odDelay(sim, "N", "S")).toBeLessThan(15); // flyover is not
    expect(odDelay(sim, "S", "N")).toBeLessThan(15);
    const fly = sim.net.linkById.get("FLY_SB")!;
    expect(sim.linkStats[fly.idx]!.exited).toBeGreaterThan(1500);
  });

  it("closing the flyover sends through traffic via the signal and delay rises sharply", () => {
    const open = new NetworkSim(cfg());
    open.run(3600);
    const closed = new NetworkSim(cfg({ closedLinks: ["FLY_SB", "FLY_NB"] }));
    expect(runChecked(closed, 3600, 4)).toEqual([]);
    expect(closed.unserved).toBe(0); // still reachable via the service roads
    for (const id of ["FLY_SB", "FLY_NB"]) {
      expect(closed.linkStats[closed.net.linkById.get(id)!.idx]!.entered).toBe(0);
    }
    expect(odDelay(open, "N", "S")).toBeLessThan(15);
    expect(odDelay(closed, "N", "S")).toBeGreaterThan(5 * odDelay(open, "N", "S"));
    expect(closed.exited).toBeLessThan(open.exited); // the junction cannot carry it all
  });
});

describe("closures and reachability", () => {
  it("grid: a closed link is never used and traffic re-routes around it", () => {
    const p = grid();
    const closedLinks = ["J0_1-J1_1+", "J0_1-J1_1-"]; // middle row, first block
    const sim = new NetworkSim({ network: p.network, demand: p.demand, seed: 1, closedLinks });
    expect(sim.warnings).toEqual([]);
    expect(runChecked(sim, 1800, 4)).toEqual([]);
    for (const id of closedLinks) expect(sim.linkStats[sim.net.linkById.get(id)!.idx]!.entered).toBe(0);
    expect(sim.unserved).toBe(0);
    const s = sim.odStreams.find((x) => x.stats.origin === "BW1" && x.stats.destination === "BE1")!.stats;
    expect(s.completed).toBeGreaterThan(50); // the affected OD pair still gets through
  });

  it("an unreachable destination is reported, not silently dropped", () => {
    const p = corridor();
    const sim = new NetworkSim({ network: p.network, demand: p.demand, seed: 1, closedLinks: ["BC+"] });
    expect(sim.warnings.some((w) => w.includes("A→C") && w.includes("no route"))).toBe(true);
    sim.run(600);
    const ac = sim.odStreams.find((x) => x.stats.origin === "A")!.stats;
    expect(ac.unserved).toBe(ac.generated);
    expect(ac.unserved).toBeGreaterThan(0);
    expect(sim.checkInvariants()).toEqual([]);
    // The other direction is unaffected.
    expect(sim.odStreams.find((x) => x.stats.origin === "C")!.stats.completed).toBeGreaterThan(100);
  });
});

describe("priority (unsignalised) junction", () => {
  // Major road W → E (2 lanes); minor road S joins at J and turns onto it.
  const net: NetworkSpec = {
    id: "t", name: "T junction",
    nodes: [
      { id: "W", x: -400, y: 0 },
      { id: "J", x: 0, y: 0, kind: "priority" },
      { id: "E", x: 400, y: 0 },
      { id: "S", x: 0, y: -300 },
    ],
    links: [
      { id: "WJ", from: "W", to: "J", lanes: 2, speedLimitKmh: 50 },
      { id: "JE", from: "J", to: "E", lanes: 2, speedLimitKmh: 50 },
      { id: "SJ", from: "S", to: "J", lanes: 1, speedLimitKmh: 30 },
    ],
  };
  const run = (major: number) => {
    const sim = new NetworkSim({
      network: net, seed: 4,
      demand: [{ origin: "W", destination: "E", rate: major }, { origin: "S", destination: "E", rate: 600 }],
    });
    const errs = runChecked(sim, 3600, 2);
    return { errs, minor: odDelay(sim, "S", "E"), major: odDelay(sim, "W", "E"), sim };
  };

  it("minor road yields: its delay grows with major flow while the major road stays near free flow", () => {
    const light = run(400);
    const heavy = run(2000);
    expect(light.errs).toEqual([]);
    expect(heavy.errs).toEqual([]);
    expect(heavy.minor).toBeGreaterThan(light.minor + 5);
    expect(light.major).toBeLessThan(10);
    expect(heavy.major).toBeLessThan(heavy.minor);
  });
});

describe("lane width", () => {
  it("narrower lanes lengthen free-flow travel time by the width factor", () => {
    const tt = (w: number) => {
      const p = corridor(2, 1000, 50);
      for (const l of p.network.links) l.laneWidth = w;
      const sim = new NetworkSim({ network: p.network, demand: [{ origin: "A", destination: "C", rate: 200 }], seed: 1, speedSpread: 0 });
      sim.run(1800);
      return mean(sim.travelTimes);
    };
    const wide = tt(3.5);
    const narrow = tt(3.0); // factor 0.85
    expect(narrow / wide).toBeGreaterThan(1.12);
    expect(narrow / wide).toBeLessThan(1.24);
  });
});

describe("merging", () => {
  it("a 2→1 lane drop carries close to one lane's capacity (zipper merge)", () => {
    const net: NetworkSpec = {
      id: "drop", name: "lane drop",
      nodes: [{ id: "A", x: 0, y: 0 }, { id: "M", x: 600, y: 0 }, { id: "B", x: 1200, y: 0 }],
      links: [
        { id: "AM", from: "A", to: "M", lanes: 2, speedLimitKmh: 50 },
        { id: "MB", from: "M", to: "B", lanes: 1, speedLimitKmh: 50 },
      ],
    };
    const sim = new NetworkSim({ network: net, demand: [{ origin: "A", destination: "B", rate: 3000 }], seed: 2 });
    sim.run(900);
    const e0 = sim.exited;
    expect(runChecked(sim, 3600)).toEqual([]);
    const flow = sim.exited - e0;
    expect(flow).toBeGreaterThan(1700); // exclusive-occupancy merging managed only ~650
    expect(flow).toBeLessThan(2012); // cannot exceed single-lane capacity
  });

});

describe("gap acceptance at a priority junction (vs HCM)", () => {
  // Single-lane major road W → E; a minor road from S merges into it.
  const net: NetworkSpec = {
    id: "t1", name: "T junction, single-lane major",
    nodes: [{ id: "W", x: -400, y: 0 }, { id: "J", x: 0, y: 0, kind: "priority" }, { id: "E", x: 400, y: 0 }, { id: "S", x: 0, y: -300 }],
    links: [
      { id: "WJ", from: "W", to: "J", lanes: 1, speedLimitKmh: 50 },
      { id: "JE", from: "J", to: "E", lanes: 1, speedLimitKmh: 50 },
      { id: "SJ", from: "S", to: "J", lanes: 1, speedLimitKmh: 30 },
    ],
  };
  /** HCM potential capacity of a minor movement: critical gap 6.2 s, follow-up time 3.3 s. */
  const hcm = (vc: number) => (vc * Math.exp((-vc * 6.2) / 3600)) / (1 - Math.exp((-vc * 3.3) / 3600));
  const run = (major: number) => {
    const sim = new NetworkSim({
      network: net, seed: 6,
      demand: [{ origin: "W", destination: "E", rate: major }, { origin: "S", destination: "E", rate: 600 }],
    });
    const errs = runChecked(sim, 3600, 2);
    const st = (o: string) => sim.odStreams.find((x) => x.stats.origin === o)!.stats;
    return { errs, minor: st("S").completed, major: st("W").completed, majorDelay: st("W").delaySum / st("W").completed, sim };
  };

  it("light major flow: the minor road is fully served (HCM capacity 744 > demand 600)", () => {
    const r = run(300);
    expect(r.errs).toEqual([]);
    expect(hcm(300)).toBeGreaterThan(600);
    expect(r.minor).toBeGreaterThan(560);
  });

  it("800 veh/h major flow: minor capacity is 60-110 % of HCM (388 veh/h); major road undisturbed", () => {
    // Measured: ~285 veh/h, i.e. 27 % below HCM. The model errs on the cautious side
    // (it never lets a minor vehicle slow the major stream by more than 1.5 m/s²).
    const r = run(800);
    expect(r.errs).toEqual([]);
    expect(r.minor).toBeGreaterThan(hcm(800) * 0.6);
    expect(r.minor).toBeLessThan(hcm(800) * 1.1);
    expect(r.majorDelay).toBeLessThan(12);
    expect(r.sim.hardestBrake).toBeGreaterThan(-5); // minor vehicles never force hard braking
  });

  it("minor capacity falls monotonically with major flow and never exceeds HCM (model is conservative)", () => {
    const flows = [800, 1200, 1600];
    const minors = flows.map((f) => run(f).minor);
    expect(minors[0]!).toBeGreaterThan(minors[1]!);
    expect(minors[1]!).toBeGreaterThan(minors[2]!);
    flows.forEach((f, k) => expect(minors[k]!).toBeLessThan(hcm(f) * 1.1));
  });
});

describe("Braess's paradox", () => {
  const meanTT = (shortcut: boolean, seed: number) => {
    const p = braess(shortcut, 1600);
    const sim = new NetworkSim({ network: p.network, demand: p.demand, seed });
    const errs = runChecked(sim, 5400, 8);
    const tts = sim.travelTimes.slice(Math.floor(sim.travelTimes.length / 3));
    return { errs, tt: mean(tts), sim };
  };

  it.each([1, 2, 3])("seed %i: adding the shortcut makes the average trip slower", (seed) => {
    const without = meanTT(false, seed);
    const withSc = meanTT(true, seed);
    expect(without.errs).toEqual([]);
    expect(withSc.errs).toEqual([]);
    // Without the shortcut the two routes share the load and stay near free flow (~108 s).
    expect(without.tt).toBeLessThan(170);
    // Measured: ~143 s without, ~195-380 s with (seed-dependent). Assert the claim, with margin.
    expect(withSc.tt).toBeGreaterThan(1.2 * without.tt);
    // The shortcut is genuinely used (it is the fastest route in free flow).
    const ab = withSc.sim.net.linkById.get("AB")!;
    expect(withSc.sim.linkStats[ab.idx]!.entered).toBeGreaterThan(200);
  });
});
