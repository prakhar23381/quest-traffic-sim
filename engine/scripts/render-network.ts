/**
 * Render a network as the ENGINE interprets it (trimmed lanes, junction connectors,
 * node kinds) to SVG, and print a structural summary. Used to check OSM imports by eye.
 *
 *   npx tsx scripts/render-network.ts <network.json> <out.svg> [--zoom x y halfWidth]
 */
import { readFileSync, writeFileSync } from "node:fs";
import { buildNetwork, type NetworkSpec } from "../src/index";

const [inPath, outPath, ...rest] = process.argv.slice(2);
if (!inPath || !outPath) throw new Error("usage: render-network.ts <network.json> <out.svg> [--zoom x y halfWidth]");
const raw = JSON.parse(readFileSync(inPath, "utf8"));
const spec: NetworkSpec = raw.network ?? raw;
const net = buildNetwork(spec);

let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
for (const n of net.nodes) {
  minX = Math.min(minX, n.x); maxX = Math.max(maxX, n.x);
  minY = Math.min(minY, n.y); maxY = Math.max(maxY, n.y);
}
const zi = rest.indexOf("--zoom");
if (zi >= 0) {
  const [zx, zy, zh] = rest.slice(zi + 1, zi + 4).map(Number) as [number, number, number];
  minX = zx - zh; maxX = zx + zh; minY = zy - zh; maxY = zy + zh;
}
const W = 1100;
const pad = 20;
const sc = (W - 2 * pad) / Math.max(maxX - minX, maxY - minY);
const H = Math.round((maxY - minY) * sc + 2 * pad + 30);
const X = (x: number) => (pad + (x - minX) * sc).toFixed(1);
const Y = (y: number) => (H - pad - (y - minY) * sc).toFixed(1);
const color = (layer: number) => (layer < 0 ? "#7c3aed" : layer === 0 ? "#6b7280" : layer === 1 ? "#dc2626" : "#f59e0b");
const out: string[] = [
  `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" font-family="system-ui,sans-serif" font-size="10">`,
  `<rect width="100%" height="100%" fill="#fff"/>`,
];
const laneW = Math.max(0.6, 3.2 * sc);
for (const layer of [-1, 0, 1, 2]) {
  for (const l of net.links) {
    if (l.layer !== layer) continue;
    for (const lane of l.lanes) {
      const pts = lane.geom.pts.map((p) => `${X(p.x)},${Y(p.y)}`).join(" ");
      if (layer > 0) out.push(`<polyline points="${pts}" fill="none" stroke="#000" stroke-opacity="0.15" stroke-width="${laneW + 2}"/>`);
      out.push(`<polyline points="${pts}" fill="none" stroke="${color(layer)}" stroke-width="${laneW}" stroke-opacity="0.8"/>`);
    }
    // direction arrowhead at 70 % along
    const p = l.geom.poseAt(l.length * 0.7);
    const a = 4;
    out.push(`<path d="M${X(p.x + p.hx * a)},${Y(p.y + p.hy * a)} L${X(p.x - p.hx * a - p.hy * a)},${Y(p.y - p.hy * a + p.hx * a)} L${X(p.x - p.hx * a + p.hy * a)},${Y(p.y - p.hy * a - p.hx * a)} Z" fill="#111" opacity="0.6"/>`);
  }
}
for (const c of net.connectors) {
  const pts = c.geom.pts.map((p) => `${X(p.x)},${Y(p.y)}`).join(" ");
  out.push(`<polyline points="${pts}" fill="none" stroke="#0ea5e9" stroke-width="0.7" stroke-opacity="0.7"/>`);
}
for (const n of net.nodes) {
  const fill = n.kind === "boundary" ? "#2563eb" : n.kind === "signal" ? "#16a34a" : "#111";
  const r = n.kind === "signal" ? 5 : 3;
  out.push(`<circle cx="${X(n.x)}" cy="${Y(n.y)}" r="${r}" fill="${fill}" stroke="#fff" stroke-width="1"><title>${n.id} ${n.kind}</title></circle>`);
  if (n.kind === "signal") out.push(`<text x="${+X(n.x) + 7}" y="${+Y(n.y) - 6}" fill="#166534">${n.id}</text>`);
}
out.push(`<text x="10" y="${H - 8}">grey ground · red layer 1 · amber layer 2 · purple underpass · cyan junction connectors · blue entry/exit · green signal · black priority/merge</text>`);
out.push("</svg>");
writeFileSync(outPath, out.join("\n"));

// Summary
const byKind: Record<string, number> = {};
for (const n of net.nodes) byKind[n.kind] = (byKind[n.kind] ?? 0) + 1;
console.log(`nodes ${net.nodes.length} ${JSON.stringify(byKind)} | links ${net.links.length} | connectors ${net.connectors.length} | movements ${net.movementById.size}`);
console.log(`total lane-km ${(net.links.reduce((s, l) => s + l.length * l.lanes.length, 0) / 1000).toFixed(1)}`);
console.log(`warnings (${net.warnings.length}):`);
for (const w of net.warnings.slice(0, 30)) console.log("  " + w);
for (const n of net.nodes) {
  if (n.kind !== "signal") continue;
  console.log(`signal ${n.id} at (${n.x.toFixed(0)}, ${n.y.toFixed(0)}): in [${n.inLinks.map((l) => `${l.spec.name ?? l.id}(L${l.layer},${l.spec.lanes})`).join(", ")}] out [${n.outLinks.map((l) => `${l.spec.name ?? l.id}(L${l.layer})`).join(", ")}] phases ${n.signal!.phases.length} cycle ${n.signal!.cycle}s`);
}
const elevatedAtGroundJunction = net.nodes.filter((n) => n.kind !== "boundary" && n.inLinks.some((l) => l.layer > 0) && n.outLinks.some((l) => l.layer === 0) && n.inLinks.some((l) => l.layer === 0));
console.log(`nodes joining elevated and ground roads (ramps/landings expected; a big junction would be a bug): ${elevatedAtGroundJunction.map((n) => `${n.id}[${n.kind}, ${n.inLinks.length}in/${n.outLinks.length}out]`).join(" ") || "none"}`);
