import type { IdmParams } from "./idm";

/**
 * Speed at which a new vehicle may be inserted behind a leader, or null if it
 * must keep waiting.
 *
 * Rule: enter at the leader's speed (capped at v0), but only once the gap is at
 * least the IDM desired gap at that speed, s0 + v T. On a saturated entrance
 * this discharges at ~2000 veh/h/lane (≈ equilibrium capacity) with at most mild
 * braking (~0.7 m/s² < b).
 *
 * The rejected alternative, "insert as soon as gap ≥ s0 + 1 at the equilibrium
 * speed for that gap", makes every entrant start from near standstill. The
 * entrance then behaves like a jam front and caps demand at ~1200 veh/h/lane,
 * which would silently throttle scenario demand. See PLAN.md / docs/VALIDATION.md.
 */
export function insertionSpeed(p: IdmParams, gap: number, vLead: number): number | null {
  const v = Math.min(vLead, p.v0);
  return gap >= p.s0 + v * p.T ? v : null;
}

/** Speed for inserting onto an empty lane / free road. */
export function freeInsertionSpeed(p: IdmParams): number {
  return 0.9 * p.v0;
}
