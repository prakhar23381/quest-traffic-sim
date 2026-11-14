import type { LinkRT, Network, NodeRT } from "@traffic/engine";

export const layerName = (layer: number) => (layer < 0 ? "Underpass" : layer === 0 ? "Ground" : layer === 1 ? "Flyover" : `Upper deck (level ${layer})`);

/** Compass heading of a link, from its start to its end. */
function heading(l: LinkRT): string {
  const a = l.geom.pts[0]!;
  const b = l.geom.pts[l.geom.pts.length - 1]!;
  const deg = (Math.atan2(b.x - a.x, b.y - a.y) * 180) / Math.PI;
  return ["northbound", "north-eastbound", "eastbound", "south-eastbound", "southbound", "south-westbound", "westbound", "north-westbound"][((Math.round(deg / 45) % 8) + 8) % 8]!;
}

export const linkLabel = (l: LinkRT) => `${l.spec.name ?? "Unnamed road"} · ${heading(l)}`;

export function nodeLabel(n: NodeRT): string {
  const names = [...new Set([...n.inLinks, ...n.outLinks].map((l) => l.spec.name).filter(Boolean))];
  return names.length ? names.slice(0, 2).join(" × ") : `Junction ${n.id}`;
}

/** Approaches served by a signal phase, by road name and direction. */
export function phaseLabel(net: Network, movements: Iterable<string>): string {
  const ins = new Set<string>();
  for (const id of movements) {
    const m = net.movementById.get(id);
    if (m) ins.add(linkLabel(m.inLink));
  }
  return [...ins].join("; ") || "no movements";
}
