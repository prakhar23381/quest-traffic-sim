import type { IdmParams } from "./idm";

/**
 * Position convention: `pos` is the FRONT bumper, measured from the start of the
 * lane. The vehicle occupies [pos - len, pos].
 */
export interface Vehicle {
  id: number;
  pos: number;
  v: number;
  /** acceleration computed for the current step */
  acc: number;
  len: number;
  params: IdmParams;
  /** simulation time the vehicle entered the network, s */
  tSpawn: number;
}

export interface Leader {
  /** bumper-to-bumper gap, m */
  gap: number;
  vLead: number;
}

/**
 * A single lane. Vehicles are kept sorted by ascending `pos` (index 0 = most
 * upstream). Car-following on one lane cannot reorder vehicles unless they
 * collide, which the invariant checks would catch.
 */
export class Lane {
  readonly vehicles: Vehicle[] = [];

  constructor(
    readonly length: number,
    /** if true, the lane is a closed loop (ring road) */
    readonly ring = false,
  ) {
    if (!(length > 0)) throw new Error(`Lane length must be > 0, got ${length}`);
  }

  /** Leader of the vehicle at index i, or null if it has a free road ahead. */
  leaderOf(i: number): Leader | null {
    const n = this.vehicles.length;
    const me = this.vehicles[i]!;
    if (i < n - 1) {
      const ld = this.vehicles[i + 1]!;
      return { gap: ld.pos - ld.len - me.pos, vLead: ld.v };
    }
    if (this.ring) {
      // Wrap around to the most upstream vehicle (which may be `me` if n === 1).
      const ld = this.vehicles[0]!;
      return { gap: ld.pos + this.length - ld.len - me.pos, vLead: ld.v };
    }
    return null;
  }

  /** Smallest bumper-to-bumper gap in the lane (Infinity if < 2 vehicles on an open lane). */
  minGap(): number {
    let m = Infinity;
    const n = this.vehicles.length;
    const last = this.ring ? n : n - 1;
    for (let i = 0; i < last; i++) {
      const g = this.leaderOf(i);
      if (g && g.gap < m) m = g.gap;
    }
    return m;
  }
}
