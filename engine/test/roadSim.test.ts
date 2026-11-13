import { describe, expect, it } from "vitest";
import { CITY_IDM, equilibriumFlow, RoadSim } from "../src/index";

const LEN = 4.5;

/** Ring-road measurement: warm up, then return Edie flow, loop flow and speed stats. */
function ringRun(rhoPerKm: number, opts: { L?: number; warmup?: number; measure?: number; dt?: number } = {}) {
  const L = opts.L ?? 2000;
  const n = Math.round((rhoPerKm * L) / 1000);
  const sim = new RoadSim({ length: L, ring: true, ringVehicles: n, ringPerturbation: 1, detectors: [L / 2], dt: opts.dt });
  sim.run(opts.warmup ?? 1800);
  const det = sim.detectors[0]!;
  det.count = 0;
  const T = opts.measure ?? 1800;
  let vSum = 0;
  const steps = Math.round(T / sim.dt);
  let vMin = Infinity;
  for (let i = 0; i < steps; i++) {
    sim.step();
    vSum += sim.meanSpeed();
    for (const v of sim.lane.vehicles) vMin = Math.min(vMin, v.v);
  }
  return {
    sim,
    n,
    qEq: equilibriumFlow(CITY_IDM, n / L, LEN) * 3600,
    qEdie: (n / L) * (vSum / steps) * 3600,
    qLoop: (det.count / T) * 3600,
    vMin,
  };
}

describe("ring road: fundamental diagram", () => {
  it.each([10, 20, 30, 40, 50, 60])("stable density %i veh/km matches IDM equilibrium flow", (rho) => {
    const r = ringRun(rho);
    expect(r.qEdie).toBeGreaterThan(r.qEq * 0.99);
    expect(r.qEdie).toBeLessThan(r.qEq * 1.01);
    // Independent point-detector measurement agrees.
    expect(Math.abs(r.qLoop - r.qEdie) / r.qEdie).toBeLessThan(0.02);
    expect(r.vMin).toBeGreaterThan(0.5);
  });

  it.each([80, 100, 120])("unstable density %i veh/km forms stop-and-go waves and loses flow", (rho) => {
    // Long measurement window: the loop count has an error of up to n crossings,
    // so it only converges to the Edie flow over long times.
    const r = ringRun(rho, { measure: 7200 });
    expect(r.vMin).toBeLessThan(0.5); // vehicles come to a stop inside waves
    expect(r.qEdie).toBeLessThan(r.qEq * 0.85); // capacity drop vs. homogeneous equilibrium
    expect(Math.abs(r.qLoop - r.qEdie) / r.qEdie).toBeLessThan(0.03);
    expect(r.sim.minGapSeen).toBeGreaterThan(0); // and no collisions
  });

  it("free-flows at v0 when nearly empty", () => {
    const r = ringRun(2);
    expect(r.qEdie / (r.n / 2000) / 3600).toBeGreaterThan(CITY_IDM.v0 * 0.99);
  });
});

describe("safety invariants", () => {
  it.each([0.1, 0.25, 0.5])("no collisions or negative speeds in jammed traffic at dt=%f s", (dt) => {
    const r = ringRun(100, { dt, warmup: 600, measure: 3600 });
    expect(r.sim.minGapSeen).toBeGreaterThan(0);
    expect(r.sim.badState).toBe(false);
  });

  it("open road under oversaturated demand: no collisions, vehicles conserved", () => {
    const sim = new RoadSim({ length: 1500, inflow: 3000 / 3600, seed: 7 });
    let maxErr = 0;
    for (let i = 0; i < (3600 / sim.dt); i++) {
      sim.step();
      maxErr = Math.max(maxErr, Math.abs(sim.entered - sim.exited - sim.inNetwork));
    }
    expect(maxErr).toBe(0);
    expect(sim.minGapSeen).toBeGreaterThan(0);
    expect(sim.badState).toBe(false);
    expect(sim.waiting).toBeGreaterThan(0); // demand exceeds what can enter
    // A saturated entrance must discharge at close to lane capacity (~2012 veh/h).
    // Regression guard: a naive insertion rule caps this at ~1200 veh/h.
    expect(sim.entered).toBeGreaterThan(1900); // over one hour
    expect(sim.entered).toBeLessThan(2100);
  });

  it("insertion never forces braking harder than the comfortable deceleration b", () => {
    const sim = new RoadSim({ length: 1500, inflow: 3000 / 3600, seed: 11 });
    let hardest = 0;
    for (let i = 0; i < 3600 / sim.dt; i++) {
      sim.step();
      for (const v of sim.lane.vehicles) hardest = Math.min(hardest, v.acc);
    }
    expect(hardest).toBeGreaterThan(-CITY_IDM.b);
  });
});

describe("open road: free flow", () => {
  it("light demand: everyone gets through at about free-flow travel time", () => {
    const L = 2000;
    const sim = new RoadSim({ length: L, inflow: 200 / 3600, seed: 3 });
    sim.run(3600);
    expect(sim.waiting).toBeLessThanOrEqual(1);
    const mean = sim.travelTimes.reduce((a, b) => a + b, 0) / sim.travelTimes.length;
    const tFree = (L + LEN) / CITY_IDM.v0;
    expect(mean).toBeGreaterThan(tFree);
    expect(mean).toBeLessThan(tFree * 1.1);
    // Poisson demand: ~200 arrivals in an hour.
    expect(sim.generated).toBeGreaterThan(150);
    expect(sim.generated).toBeLessThan(250);
  });
});

describe("determinism", () => {
  const run = (seed: number) => {
    const sim = new RoadSim({ length: 1500, inflow: 1500 / 3600, seed });
    sim.run(1200);
    return sim.stateHash();
  };
  it("same seed gives a bit-identical state", () => {
    expect(run(42)).toBe(run(42));
  });
  it("different seeds give different states", () => {
    expect(run(42)).not.toBe(run(43));
  });
});
