/**
 * A faint street map under real (OpenStreetMap) networks, so the place is recognisable.
 * Standard OpenStreetMap raster tiles (no key needed; light use with attribution is allowed by
 * the OSM tile policy), greyed and faded so the simulation stays the focus, placed with the same local
 * projection the network was built with (data/build_network.py: x = (lon - lon0)·kx,
 * y = (lat - lat0)·ky). Over a ~1.5 km area the difference between that projection and
 * the tiles' Web Mercator is well under a metre.
 */
import type { View } from "./scene";

export interface Projection {
  lat0: number;
  lon0: number;
  kx: number;
  ky: number;
}

export const BASEMAP_ATTRIBUTION = "© OpenStreetMap contributors";

// (CARTO's light/dark basemaps were tried first: they now need an API key and serve watermarks.)
const tileUrl = (z: number, x: number, y: number) => `https://tile.openstreetmap.org/${z}/${x}/${y}.png`;

const lonToX = (lon: number, z: number) => ((lon + 180) / 360) * 2 ** z;
const latToY = (lat: number, z: number) => {
  const r = (lat * Math.PI) / 180;
  return ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** z;
};
const xToLon = (x: number, z: number) => (x / 2 ** z) * 360 - 180;
const yToLat = (y: number, z: number) => (Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / 2 ** z))) * 180) / Math.PI;

export class Basemap {
  private readonly cache = new Map<string, HTMLImageElement>();

  constructor(
    private readonly proj: Projection,
    /** called when a tile finishes loading (the map should redraw) */
    private readonly onLoad: () => void,
  ) {}

  private tile(z: number, x: number, y: number): HTMLImageElement | null {
    const key = `${z}/${x}/${y}`;
    let img = this.cache.get(key);
    if (!img) {
      if (this.cache.size > 400) this.cache.clear();
      img = new Image();
      img.crossOrigin = "anonymous";
      img.onload = this.onLoad;
      img.src = tileUrl(z, x, y);
      this.cache.set(key, img);
    }
    return img.complete && img.naturalWidth > 0 ? img : null;
  }

  /** Draw the tiles covering the view, in screen pixels (call with an identity transform scaled by dpr). */
  draw(ctx: CanvasRenderingContext2D, view: View, w: number, h: number, dark: boolean, alpha: number): void {
    const p = this.proj;
    // metres per CSS pixel → zoom level whose 256-px tiles match it
    const mpp = 1 / view.scale;
    const z = Math.max(1, Math.min(19, Math.round(Math.log2((156543.03 * Math.cos((p.lat0 * Math.PI) / 180)) / mpp))));
    const toLon = (x: number) => p.lon0 + x / p.kx;
    const toLat = (y: number) => p.lat0 + y / p.ky;
    const sx = (lon: number) => w / 2 + ((lon - p.lon0) * p.kx - view.cx) * view.scale;
    const sy = (lat: number) => h / 2 - ((lat - p.lat0) * p.ky - view.cy) * view.scale;
    const west = toLon(view.cx - w / 2 / view.scale);
    const east = toLon(view.cx + w / 2 / view.scale);
    const north = toLat(view.cy + h / 2 / view.scale);
    const south = toLat(view.cy - h / 2 / view.scale);
    const x0 = Math.floor(lonToX(west, z));
    const x1 = Math.floor(lonToX(east, z));
    const y0 = Math.floor(latToY(north, z));
    const y1 = Math.floor(latToY(south, z));
    if ((x1 - x0 + 1) * (y1 - y0 + 1) > 120) return;
    ctx.save();
    ctx.globalAlpha = alpha;
    // grey (and, in dark mode, inverted) so the map reads as background
    ctx.filter = dark ? "grayscale(1) invert(1) brightness(0.75) contrast(0.9)" : "grayscale(1) contrast(0.85)";
    ctx.imageSmoothingQuality = "high";
    for (let x = x0; x <= x1; x++) {
      for (let y = y0; y <= y1; y++) {
        const img = this.tile(z, x, y);
        if (!img) continue;
        const left = sx(xToLon(x, z));
        const right = sx(xToLon(x + 1, z));
        const top = sy(yToLat(y, z));
        const bottom = sy(yToLat(y + 1, z));
        // overlap by half a pixel to hide seams between tiles
        ctx.drawImage(img, left - 0.25, top - 0.25, right - left + 0.5, bottom - top + 0.5);
      }
    }
    ctx.restore();
  }
}

export function projectionOf(meta: unknown): Projection | null {
  const p = (meta as { projection?: Partial<Projection> } | undefined)?.projection;
  return p && [p.lat0, p.lon0, p.kx, p.ky].every((v) => typeof v === "number") ? (p as Projection) : null;
}
