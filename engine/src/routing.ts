import type { LinkRT, Network, NodeRT } from "./network";

/** Minimal binary min-heap keyed by number. */
class Heap {
  private k: number[] = [];
  private v: number[] = [];
  get size(): number {
    return this.k.length;
  }
  push(key: number, val: number): void {
    const k = this.k;
    const v = this.v;
    let i = k.length;
    k.push(key);
    v.push(val);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (k[p]! <= key) break;
      k[i] = k[p]!;
      v[i] = v[p]!;
      i = p;
    }
    k[i] = key;
    v[i] = val;
  }
  pop(): [number, number] {
    const k = this.k;
    const v = this.v;
    const topK = k[0]!;
    const topV = v[0]!;
    const lastK = k.pop()!;
    const lastV = v.pop()!;
    if (k.length > 0) {
      let i = 0;
      const n = k.length;
      for (;;) {
        const l = 2 * i + 1;
        if (l >= n) break;
        const r = l + 1;
        const c = r < n && k[r]! < k[l]! ? r : l;
        if (k[c]! >= lastK) break;
        k[i] = k[c]!;
        v[i] = v[c]!;
        i = c;
      }
      k[i] = lastK;
      v[i] = lastV;
    }
    return [topK, topV];
  }
}

/**
 * Link-based Dijkstra. `cost(link)` is the time to traverse a link (including
 * the junction connector at its end). Returns the cheapest route, a list of
 * links from one of the origin's outgoing links to one of the destination's
 * incoming links, or null if unreachable. Closed links are never used.
 */
export function shortestRoute(net: Network, origin: NodeRT, dest: NodeRT, cost: (l: LinkRT) => number): LinkRT[] | null {
  const n = net.links.length;
  const best = new Float64Array(n).fill(Infinity);
  const prev = new Int32Array(n).fill(-1);
  const heap = new Heap();
  for (const l of origin.outLinks) {
    if (l.closed) continue;
    const c = cost(l);
    if (c < best[l.idx]!) {
      best[l.idx] = c;
      heap.push(c, l.idx);
    }
  }
  const targets = new Set(dest.inLinks.filter((l) => !l.closed).map((l) => l.idx));
  let found = -1;
  while (heap.size > 0) {
    const [d, i] = heap.pop();
    if (d > best[i]!) continue;
    if (targets.has(i)) {
      found = i;
      break;
    }
    const link = net.links[i]!;
    for (const m of link.out) {
      const o = m.outLink;
      if (o.closed) continue;
      const nd = d + cost(o);
      if (nd < best[o.idx]!) {
        best[o.idx] = nd;
        prev[o.idx] = i;
        heap.push(nd, o.idx);
      }
    }
  }
  if (found < 0) return null;
  const route: LinkRT[] = [];
  for (let i = found; i >= 0; i = prev[i]!) route.push(net.links[i]!);
  return route.reverse();
}

/** Free-flow traversal time of a link plus a representative connector at its end. */
export function freeFlowCost(l: LinkRT): number {
  let conn = 0;
  if (l.out.length > 0) {
    let s = 0;
    let k = 0;
    for (const m of l.out) for (const c of m.connectors) {
      s += c.geom.length / c.v0;
      k++;
    }
    conn = k ? s / k : 0;
  }
  return l.length / l.v0 + conn;
}
