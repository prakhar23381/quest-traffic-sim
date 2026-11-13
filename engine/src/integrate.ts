/**
 * Ballistic position update (Treiber & Kanagaraj, 2015): constant acceleration
 * within a step, but a vehicle that would reverse is instead stopped at the
 * point where its speed reaches zero. This avoids the negative speeds and
 * "backwards driving" of naive Euler at dt = 0.25 s.
 *
 * Returns the distance travelled during the step; writes the new speed to out.v.
 */
export function ballisticStep(v: number, acc: number, dt: number, out: { v: number }): number {
  const vNew = v + acc * dt;
  if (vNew >= 0) {
    out.v = vNew;
    return v * dt + 0.5 * acc * dt * dt;
  }
  // Stops within this step (acc < 0 here since v >= 0 and vNew < 0).
  out.v = 0;
  return (-0.5 * v * v) / acc;
}
