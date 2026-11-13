/**
 * Intelligent Driver Model (Treiber, Hennecke & Helbing, 2000).
 *
 *   dv/dt = a [ 1 - (v/v0)^δ - (s*(v, Δv) / s)^2 ]
 *   s*(v, Δv) = s0 + max(0, v T + v Δv / (2 sqrt(a b)))
 *
 * Units: SI throughout (m, s, m/s, m/s²). Δv = v - v_leader (positive = approaching).
 */
export interface IdmParams {
  /** desired speed, m/s */
  v0: number;
  /** desired time headway, s */
  T: number;
  /** maximum acceleration, m/s² */
  a: number;
  /** comfortable deceleration, m/s² (positive number) */
  b: number;
  /** jam distance (minimum bumper-to-bumper gap), m */
  s0: number;
  /** acceleration exponent */
  delta: number;
}

/** Typical urban values (cf. Treiber & Kesting, "Traffic Flow Dynamics"). */
export const CITY_IDM: Readonly<IdmParams> = Object.freeze({
  v0: 15, // 54 km/h
  T: 1.0,
  a: 1.0,
  b: 1.5,
  s0: 2.0,
  delta: 4,
});

/** Smallest gap used in the interaction term, to avoid division by zero. */
const MIN_GAP = 1e-3;

/**
 * IDM acceleration.
 * @param gap bumper-to-bumper distance to the leader, m (ignored if vLead is null)
 * @param vLead leader speed, m/s, or null for a free road
 */
export function idmAccel(p: IdmParams, v: number, gap: number, vLead: number | null): number {
  const free = 1 - Math.pow(v / p.v0, p.delta);
  if (vLead === null) return p.a * free;
  const dv = v - vLead;
  const sStar = p.s0 + Math.max(0, v * p.T + (v * dv) / (2 * Math.sqrt(p.a * p.b)));
  const s = Math.max(gap, MIN_GAP);
  return p.a * (free - (sStar / s) * (sStar / s));
}

/** Equilibrium gap s_e(v) for speed v (v < v0): steady following, Δv = 0. */
export function equilibriumGap(p: IdmParams, v: number): number {
  if (v <= 0) return p.s0;
  const free = 1 - Math.pow(v / p.v0, p.delta);
  if (free <= 0) return Infinity;
  return (p.s0 + v * p.T) / Math.sqrt(free);
}

/** Equilibrium speed v_e(s) for a given gap s (inverse of equilibriumGap), by bisection. */
export function equilibriumSpeed(p: IdmParams, gap: number): number {
  if (gap <= p.s0) return 0;
  let lo = 0;
  let hi = p.v0;
  for (let i = 0; i < 60; i++) {
    const mid = 0.5 * (lo + hi);
    if (equilibriumGap(p, mid) < gap) lo = mid;
    else hi = mid;
  }
  return 0.5 * (lo + hi);
}

/**
 * Steady-state ("fundamental diagram") flow at density rho (veh/m) for vehicles of
 * length `len`: q = rho * v_e(1/rho - len). Returns veh/s.
 */
export function equilibriumFlow(p: IdmParams, rho: number, len: number): number {
  if (rho <= 0) return 0;
  const gap = 1 / rho - len;
  return rho * equilibriumSpeed(p, gap);
}
