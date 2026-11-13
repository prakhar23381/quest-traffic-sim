/**
 * Planar geometry in metres. World frame: x east, y north.
 * Lateral offsets are positive to the LEFT of the direction of travel.
 */
export interface Pt {
  x: number;
  y: number;
}

export interface Pose {
  x: number;
  y: number;
  /** unit heading */
  hx: number;
  hy: number;
}

const EPS = 1e-9;

export class Polyline {
  readonly pts: Pt[];
  /** cumulative arc length at each vertex */
  readonly cum: number[];
  readonly length: number;

  constructor(points: Pt[]) {
    const pts: Pt[] = [];
    for (const p of points) {
      const last = pts[pts.length - 1];
      if (!last || Math.hypot(p.x - last.x, p.y - last.y) > 1e-6) pts.push({ x: p.x, y: p.y });
    }
    if (pts.length < 2) throw new Error("Polyline needs at least two distinct points");
    this.pts = pts;
    this.cum = [0];
    for (let i = 1; i < pts.length; i++) {
      this.cum.push(this.cum[i - 1]! + Math.hypot(pts[i]!.x - pts[i - 1]!.x, pts[i]!.y - pts[i - 1]!.y));
    }
    this.length = this.cum[this.cum.length - 1]!;
  }

  /** Index of the segment containing arc length s. */
  private seg(s: number): number {
    const c = this.cum;
    if (s <= 0) return 0;
    if (s >= this.length) return c.length - 2;
    let lo = 0;
    let hi = c.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (c[mid]! <= s) lo = mid;
      else hi = mid;
    }
    return lo;
  }

  /** Pose at arc length s (clamped), shifted `lateral` metres to the left. */
  poseAt(s: number, lateral = 0): Pose {
    const i = this.seg(s);
    const a = this.pts[i]!;
    const b = this.pts[i + 1]!;
    const segLen = this.cum[i + 1]! - this.cum[i]!;
    const t = segLen > 0 ? Math.min(1, Math.max(0, (s - this.cum[i]!) / segLen)) : 0;
    const hx = (b.x - a.x) / (segLen || 1);
    const hy = (b.y - a.y) / (segLen || 1);
    return { x: a.x + t * (b.x - a.x) - hy * lateral, y: a.y + t * (b.y - a.y) + hx * lateral, hx, hy };
  }

  /** Sub-polyline between arc lengths s0 < s1. */
  slice(s0: number, s1: number): Polyline {
    const pts: Pt[] = [this.poseAt(s0)];
    for (let i = 0; i < this.pts.length; i++) {
      if (this.cum[i]! > s0 + EPS && this.cum[i]! < s1 - EPS) pts.push(this.pts[i]!);
    }
    pts.push(this.poseAt(s1));
    return new Polyline(pts);
  }

  /** Parallel curve `d` metres to the left (simple miter at vertices). */
  offset(d: number): Polyline {
    if (d === 0) return this;
    const n = this.pts.length;
    const out: Pt[] = [];
    for (let i = 0; i < n; i++) {
      const prev = this.pts[Math.max(0, i - 1)]!;
      const next = this.pts[Math.min(n - 1, i + 1)]!;
      const cur = this.pts[i]!;
      // Average of adjacent segment normals.
      let nx = 0;
      let ny = 0;
      if (i > 0) {
        const l = Math.hypot(cur.x - prev.x, cur.y - prev.y);
        nx += -(cur.y - prev.y) / l;
        ny += (cur.x - prev.x) / l;
      }
      if (i < n - 1) {
        const l = Math.hypot(next.x - cur.x, next.y - cur.y);
        nx += -(next.y - cur.y) / l;
        ny += (next.x - cur.x) / l;
      }
      const nl = Math.hypot(nx, ny) || 1;
      nx /= nl;
      ny /= nl;
      // Miter length correction, capped to avoid spikes at sharp corners.
      let scale = 1;
      if (i > 0 && i < n - 1) {
        const l = Math.hypot(next.x - cur.x, next.y - cur.y);
        const sx = -(next.y - cur.y) / l;
        const sy = (next.x - cur.x) / l;
        const cos = nx * sx + ny * sy;
        scale = Math.min(2, 1 / Math.max(cos, 0.5));
      }
      out.push({ x: cur.x + nx * d * scale, y: cur.y + ny * d * scale });
    }
    return new Polyline(out);
  }
}

/** Cubic Bézier sampled into n+1 points. */
export function bezier(p0: Pt, p1: Pt, p2: Pt, p3: Pt, n = 12): Pt[] {
  const out: Pt[] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const u = 1 - t;
    out.push({
      x: u * u * u * p0.x + 3 * u * u * t * p1.x + 3 * u * t * t * p2.x + t * t * t * p3.x,
      y: u * u * u * p0.y + 3 * u * u * t * p1.y + 3 * u * t * t * p2.y + t * t * t * p3.y,
    });
  }
  return out;
}

/** Proper intersection of segments ab and cd (touching endpoints do not count). */
export function segmentsIntersect(a: Pt, b: Pt, c: Pt, d: Pt): boolean {
  const o = (p: Pt, q: Pt, r: Pt) => (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
  const d1 = o(c, d, a);
  const d2 = o(c, d, b);
  const d3 = o(a, b, c);
  const d4 = o(a, b, d);
  return ((d1 > EPS && d2 < -EPS) || (d1 < -EPS && d2 > EPS)) && ((d3 > EPS && d4 < -EPS) || (d3 < -EPS && d4 > EPS));
}

export function polylinesCross(a: Polyline, b: Polyline): boolean {
  for (let i = 0; i < a.pts.length - 1; i++) {
    for (let j = 0; j < b.pts.length - 1; j++) {
      if (segmentsIntersect(a.pts[i]!, a.pts[i + 1]!, b.pts[j]!, b.pts[j + 1]!)) return true;
    }
  }
  return false;
}

/** Signed angle from heading h1 to h2, radians in (-π, π]; positive = turn left (CCW). */
export function turnAngle(h1x: number, h1y: number, h2x: number, h2y: number): number {
  return Math.atan2(h1x * h2y - h1y * h2x, h1x * h2x + h1y * h2y);
}

export const dist = (a: Pt, b: Pt): number => Math.hypot(a.x - b.x, a.y - b.y);
