/**
 * Deterministic seeded PRNG (mulberry32). Every random draw in the engine goes
 * through one of these so a run is fully reproducible from its seed.
 */
export class Rng {
  private s: number;

  constructor(seed: number) {
    // Avoid the all-zero state; any 32-bit integer seed is accepted.
    this.s = seed >>> 0 || 0x9e3779b9;
  }

  /** Uniform in [0, 1). */
  next(): number {
    let t = (this.s = (this.s + 0x6d2b79f5) >>> 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Exponential inter-arrival time for a Poisson process with `rate` events/s. */
  exp(rate: number): number {
    if (!(rate > 0)) return Infinity;
    return -Math.log(1 - this.next()) / rate;
  }

  /** Uniform in [lo, hi). */
  uniform(lo: number, hi: number): number {
    return lo + (hi - lo) * this.next();
  }

  get state(): number {
    return this.s;
  }
}
