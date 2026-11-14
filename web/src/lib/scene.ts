/**
 * Canvas drawing of a network as the engine builds it (trimmed lanes, junction
 * connectors) plus the live vehicles. Geometry is turned into Path2D objects once, in
 * world metres; each frame only sets the view transform and strokes them. Layers are
 * drawn bottom-up (underpass, ground, flyover, upper deck) so decks cover what is below.
 */
import { signalState, type LinkRT, type Network, type SignalRT } from "@traffic/engine";
import { VEH_FLOATS } from "../workers/protocol";
import type { Basemap } from "./basemap";

export interface View {
  /** pixels per metre */
  scale: number;
  /** world point at the canvas centre */
  cx: number;
  cy: number;
}

interface LayerPaths {
  layer: number;
  /** each entry: carriageway path and its width */
  roads: { path: Path2D; width: number; link: LinkRT }[];
  junction: Path2D;
  dividers: Path2D;
  edges: Path2D;
}

interface SignalHead {
  sig: SignalRT;
  movements: string[];
  x: number;
  y: number;
  /** half-width vector across the lane */
  px: number;
  py: number;
  layer: number;
}

export interface Scene {
  net: Network;
  layers: LayerPaths[];
  heads: SignalHead[];
  bounds: { minX: number; minY: number; maxX: number; maxY: number };
}

const pathOf = (pts: { x: number; y: number }[]): Path2D => {
  const p = new Path2D();
  pts.forEach((q, i) => (i ? p.lineTo(q.x, q.y) : p.moveTo(q.x, q.y)));
  return p;
};

export function buildScene(net: Network): Scene {
  const byLayer = new Map<number, LayerPaths>();
  const get = (layer: number) => {
    let l = byLayer.get(layer);
    if (!l) byLayer.set(layer, (l = { layer, roads: [], junction: new Path2D(), dividers: new Path2D(), edges: new Path2D() }));
    return l;
  };
  for (const link of net.links) {
    const L = get(link.layer);
    const n = link.lanes.length;
    const w = n * link.laneWidth;
    L.roads.push({ path: pathOf(link.geom.pts), width: w, link });
    // lane geometry is the link reference line offset per lane; recover each lane's lateral
    // position from the first lane, then draw the boundaries between lanes
    const l0 = link.lanes[0]!.geom.poseAt(0);
    const g0 = link.geom.poseAt(0);
    const lat0 = (l0.x - g0.x) * -g0.hy + (l0.y - g0.y) * g0.hx;
    const dir = n > 1 ? Math.sign(((link.lanes[1]!.geom.poseAt(0).x - l0.x) * -g0.hy + (link.lanes[1]!.geom.poseAt(0).y - l0.y) * g0.hx)) || -1 : -1;
    for (let i = 1; i < n; i++) L.dividers.addPath(pathOf(link.geom.offset(lat0 + dir * (i - 0.5) * link.laneWidth).pts));
    L.edges.addPath(pathOf(link.geom.offset(lat0 - dir * 0.5 * link.laneWidth).pts));
    L.edges.addPath(pathOf(link.geom.offset(lat0 + dir * (n - 0.5) * link.laneWidth).pts));
  }
  for (const c of net.connectors) {
    const m = c.movement;
    get(Math.min(m.inLink.layer, m.outLink.layer)).junction.addPath(pathOf(c.geom.pts));
  }
  const heads: SignalHead[] = [];
  for (const node of net.nodes) {
    if (!node.signal) continue;
    for (const link of node.inLinks) {
      for (const lane of link.lanes) {
        if (!lane.outConns.length) continue;
        const p = lane.geom.poseAt(lane.length);
        const hw = link.laneWidth * 0.45;
        heads.push({ sig: node.signal, movements: [...new Set(lane.outConns.map((c) => c.movement.id))], x: p.x, y: p.y, px: -p.hy * hw, py: p.hx * hw, layer: link.layer });
      }
    }
  }
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const l of net.lanes)
    for (const p of l.geom.pts) {
      minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
      minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
    }
  return { net, layers: [...byLayer.values()].sort((a, b) => a.layer - b.layer), heads, bounds: { minX, minY, maxX, maxY } };
}

export function fitView(scene: Scene, w: number, h: number, padTop = 24, pad = 24): View {
  const b = scene.bounds;
  const ih = Math.max(50, h - pad - padTop);
  const scale = Math.max(0.05, Math.min((w - 2 * pad) / Math.max(1, b.maxX - b.minX), ih / Math.max(1, b.maxY - b.minY)));
  // centre the network in the area below the top overlay
  return { scale, cx: (b.minX + b.maxX) / 2, cy: (b.minY + b.maxY) / 2 + (padTop - pad) / 2 / scale };
}

export const toWorld = (v: View, w: number, h: number, sx: number, sy: number) => ({ x: v.cx + (sx - w / 2) / v.scale, y: v.cy - (sy - h / 2) / v.scale });

export interface Palette {
  ground: string;
  road: string;
  deck: string;
  junction: string;
  marking: string;
  edge: string;
  shadow: string;
  closed: string;
  select: string;
  speeds: string[];
}

export const LIGHT: Palette = {
  ground: "#eceee8",
  road: "#9aa0a8",
  deck: "#b6bcc4",
  junction: "#a3a9b1",
  marking: "rgba(255,255,255,0.9)",
  edge: "rgba(255,255,255,0.55)",
  shadow: "rgba(15,23,42,0.28)",
  closed: "#e2a3a3",
  select: "#2563eb",
  speeds: ["#dc2626", "#f97316", "#eab308", "#65a30d", "#15803d"],
};

export const DARK: Palette = {
  ground: "#14171c",
  road: "#343a44",
  deck: "#58616f",
  junction: "#3b424c",
  marking: "rgba(226,232,240,0.45)",
  edge: "rgba(226,232,240,0.25)",
  shadow: "rgba(0,0,0,0.55)",
  closed: "#6b2f35",
  select: "#60a5fa",
  speeds: ["#ef4444", "#fb923c", "#facc15", "#a3e635", "#4ade80"],
};

/** speed bucket upper bounds, km/h (legend uses the same) */
export const SPEED_BINS = [5, 15, 30, 45, Infinity];
const binOf = (kmh: number) => {
  let i = 0;
  while (kmh >= SPEED_BINS[i]!) i++;
  return i;
};

export interface DrawOptions {
  palette: Palette;
  closed: Set<string>;
  time: number;
  vehicles?: { buf: Float32Array; n: number } | null;
  /** link id → colour; replaces road colours and hides vehicles (results heatmap) */
  heat?: Map<string, string> | null;
  selected?: string | null;
  hovered?: string | null;
  /** street map drawn under the network (real networks only) */
  basemap?: Basemap | null;
  dark?: boolean;
}

export function drawScene(ctx: CanvasRenderingContext2D, scene: Scene, view: View, w: number, h: number, o: DrawOptions): void {
  const P = o.palette;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = P.ground;
  ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  const dpr = ctx.canvas.width / w;
  if (o.basemap) {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    o.basemap.draw(ctx, view, w, h, !!o.dark, o.dark ? 0.55 : 0.5);
  }
  const s = view.scale * dpr;
  ctx.setTransform(s, 0, 0, -s, (w / 2 - view.cx * view.scale) * dpr, (h / 2 + view.cy * view.scale) * dpr);
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  const px = 1 / view.scale; // one screen pixel in metres

  // vehicles grouped by layer, then by speed colour (one path per colour)
  const vehByLayer = new Map<number, Path2D[]>();
  if (o.vehicles && !o.heat) {
    const { buf, n } = o.vehicles;
    const halfW = Math.max(0.9, 2.2 * px);
    for (let k = 0; k < n; k++) {
      const i = k * VEH_FLOATS;
      const x = buf[i]!, y = buf[i + 1]!, hx = buf[i + 2]!, hy = buf[i + 3]!, v = buf[i + 4]!, len = buf[i + 5]!, layer = buf[i + 6]!;
      let paths = vehByLayer.get(layer);
      if (!paths) vehByLayer.set(layer, (paths = P.speeds.map(() => new Path2D())));
      const hl = Math.max(len / 2 - 0.3, 3.5 * px);
      const ax = hx * hl, ay = hy * hl, bx = -hy * halfW, by = hx * halfW;
      const p = paths[binOf(v * 3.6)]!;
      p.moveTo(x + ax + bx, y + ay + by);
      p.lineTo(x + ax - bx, y + ay - by);
      p.lineTo(x - ax - bx, y - ay - by);
      p.lineTo(x - ax + bx, y - ay + by);
      p.closePath();
    }
  }

  for (const L of scene.layers) {
    const elevated = L.layer > 0;
    if (elevated) {
      // drop shadow, offset south-east, grows with height
      ctx.save();
      const off = 3 * L.layer;
      ctx.translate(off * 0.7, -off);
      ctx.strokeStyle = P.shadow;
      for (const r of L.roads) {
        ctx.lineWidth = r.width + 2;
        ctx.stroke(r.path);
      }
      ctx.restore();
    }
    ctx.strokeStyle = P.junction;
    ctx.lineWidth = 3.4;
    ctx.stroke(L.junction);
    for (const r of L.roads) {
      const heat = o.heat?.get(r.link.id);
      ctx.strokeStyle = o.closed.has(r.link.id) ? P.closed : (heat ?? (elevated ? P.deck : P.road));
      ctx.lineWidth = r.width + (elevated ? 1 : 0.4);
      ctx.stroke(r.path);
    }
    if (view.scale > 0.9) {
      ctx.lineWidth = Math.max(0.15, 0.8 * px);
      ctx.strokeStyle = P.edge;
      ctx.stroke(L.edges);
      ctx.setLineDash([3, 6]);
      ctx.strokeStyle = P.marking;
      ctx.stroke(L.dividers);
      ctx.setLineDash([]);
    }
    for (const hd of scene.heads) {
      if (hd.layer !== L.layer) continue;
      let state: "green" | "amber" | "red" = "red";
      for (const m of hd.movements) {
        const st = signalState(hd.sig, m, o.time);
        if (st === "green") state = "green";
        else if (st === "amber" && state === "red") state = "amber";
      }
      ctx.strokeStyle = state === "green" ? "#22c55e" : state === "amber" ? "#f59e0b" : "#ef4444";
      ctx.lineWidth = Math.max(0.8, 2.5 * px);
      ctx.lineCap = "butt";
      ctx.beginPath();
      ctx.moveTo(hd.x + hd.px, hd.y + hd.py);
      ctx.lineTo(hd.x - hd.px, hd.y - hd.py);
      ctx.stroke();
      ctx.lineCap = "round";
    }
    const paths = vehByLayer.get(L.layer);
    if (paths)
      paths.forEach((p, i) => {
        ctx.fillStyle = P.speeds[i]!;
        ctx.fill(p);
      });
  }

  for (const [id, colour, extra] of [
    [o.hovered, P.select + "88", 1],
    [o.selected, P.select, 2.5],
  ] as const) {
    if (!id) continue;
    const r = scene.layers.flatMap((L) => L.roads).find((x) => x.link.id === id);
    if (!r) continue;
    ctx.strokeStyle = colour;
    ctx.lineWidth = r.width + extra * 2 * px * 2;
    ctx.globalAlpha = 0.55;
    ctx.stroke(r.path);
    ctx.globalAlpha = 1;
  }
}

/** Link under a world point: the highest layer wins where roads overlap. */
export function pickLink(scene: Scene, x: number, y: number, tolerance: number): LinkRT | null {
  let best: LinkRT | null = null;
  let bestLayer = -Infinity;
  let bestD = Infinity;
  for (const L of scene.layers) {
    for (const r of L.roads) {
      const pts = r.link.geom.pts;
      let d = Infinity;
      for (let i = 1; i < pts.length; i++) {
        const a = pts[i - 1]!, b = pts[i]!;
        const dx = b.x - a.x, dy = b.y - a.y;
        const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (y - a.y) * dy) / (dx * dx + dy * dy || 1)));
        d = Math.min(d, Math.hypot(a.x + t * dx - x, a.y + t * dy - y));
      }
      if (d > r.width / 2 + tolerance) continue;
      if (L.layer > bestLayer || (L.layer === bestLayer && d < bestD)) {
        best = r.link;
        bestLayer = L.layer;
        bestD = d;
      }
    }
  }
  return best;
}
