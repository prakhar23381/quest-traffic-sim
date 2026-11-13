import { describe, expect, it } from "vitest";
import { ballisticStep, CITY_IDM, equilibriumFlow, equilibriumGap, equilibriumSpeed, idmAccel } from "../src/index";

const p = CITY_IDM;

describe("IDM", () => {
  it("accelerates at a from standstill on a free road and stops accelerating at v0", () => {
    expect(idmAccel(p, 0, 0, null)).toBeCloseTo(p.a, 12);
    expect(idmAccel(p, p.v0, 0, null)).toBeCloseTo(0, 12);
  });

  it("has zero acceleration in steady following at the equilibrium gap", () => {
    for (const v of [1, 5, 10, 14]) {
      const s = equilibriumGap(p, v);
      expect(Math.abs(idmAccel(p, v, s, v))).toBeLessThan(1e-9);
    }
  });

  it("equilibriumSpeed inverts equilibriumGap", () => {
    for (const v of [0.5, 3, 8, 12, 14.5]) {
      expect(equilibriumSpeed(p, equilibriumGap(p, v))).toBeCloseTo(v, 6);
    }
    expect(equilibriumSpeed(p, p.s0)).toBe(0);
  });

  it("brakes harder when closing in on a slower leader", () => {
    const same = idmAccel(p, 10, 20, 10);
    const closing = idmAccel(p, 10, 20, 5);
    expect(closing).toBeLessThan(same);
  });

  it("gives a lane capacity in the textbook range (1800-2200 veh/h)", () => {
    let qMax = 0;
    for (let k = 1; k <= 150; k++) qMax = Math.max(qMax, equilibriumFlow(p, k / 1000, 4.5) * 3600);
    expect(qMax).toBeGreaterThan(1800);
    expect(qMax).toBeLessThan(2200);
  });
});

describe("ballistic integrator", () => {
  it("matches constant-acceleration kinematics while moving", () => {
    const out = { v: 0 };
    const dx = ballisticStep(10, 1, 0.5, out);
    expect(out.v).toBeCloseTo(10.5, 12);
    expect(dx).toBeCloseTo(10 * 0.5 + 0.5 * 1 * 0.25, 12);
  });

  it("never produces negative speed; stops exactly at the stopping distance", () => {
    const out = { v: 0 };
    const dx = ballisticStep(2, -8, 1, out); // would reach v = -6 with Euler
    expect(out.v).toBe(0);
    expect(dx).toBeCloseTo((2 * 2) / (2 * 8), 12);
  });
});
