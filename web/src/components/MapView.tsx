import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { buildScene, DARK, drawScene, fitView, LIGHT, pickLink, toWorld, type Scene, type View } from "../lib/scene";
import type { Network } from "@traffic/engine";
import { useDarkMode } from "../lib/useDarkMode";
import { Basemap, BASEMAP_ATTRIBUTION, projectionOf } from "../lib/basemap";

export interface FrameData {
  buf: Float32Array;
  n: number;
  t: number;
}

interface Props {
  net: Network;
  closed: Set<string>;
  /** latest frame; read on every animation tick, no React re-render needed */
  frameRef?: { current: FrameData | null };
  /** fixed time (for signal colours) when there is no live frame */
  time?: number;
  heat?: Map<string, string> | null;
  selected?: string | null;
  onSelect?: (linkId: string | null) => void;
  hoverLabel?: (linkId: string) => string;
  children?: ReactNode;
  ariaLabel: string;
  /** screen space kept clear at the top when fitting (for overlays) */
  fitTop?: number;
}

export function MapView({ net, closed, frameRef, time = 0, heat, selected, onSelect, hoverLabel, children, ariaLabel, fitTop = 24 }: Props) {
  const wrap = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [scene, setScene] = useState<Scene | null>(null);
  const view = useRef<View | null>(null);
  const size = useRef({ w: 0, h: 0 });
  const dirty = useRef(true);
  const lastFrame = useRef<FrameData | null>(null);
  const [hover, setHover] = useState<{ id: string; x: number; y: number } | null>(null);
  const dark = useDarkMode();
  const [showMap, setShowMap] = useState(true);
  const basemap = useMemo(() => {
    const proj = projectionOf(net.spec.meta);
    return proj ? new Basemap(proj, () => (dirty.current = true)) : null;
  }, [net]);
  const fitTopRef = useRef(fitTop);
  fitTopRef.current = fitTop;
  const mapOn = showMap && basemap ? basemap : null;
  const props = useRef({ closed, heat, selected, time, hover: hover?.id ?? null, dark, mapOn });
  props.current = { closed, heat, selected, time, hover: hover?.id ?? null, dark, mapOn };
  dirty.current = true;

  useEffect(() => {
    const sc = buildScene(net);
    setScene(sc);
    view.current = size.current.w ? fitView(sc, size.current.w, size.current.h, fitTopRef.current) : null;
    dirty.current = true;
  }, [net]);

  // canvas size follows the container
  useEffect(() => {
    const el = wrap.current;
    const cv = canvas.current;
    if (!el || !cv) return;
    const ro = new ResizeObserver(() => {
      const r = el.getBoundingClientRect();
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      size.current = { w: r.width, h: r.height };
      cv.width = Math.max(1, Math.round(r.width * dpr));
      cv.height = Math.max(1, Math.round(r.height * dpr));
      cv.style.width = `${r.width}px`;
      cv.style.height = `${r.height}px`;
      if (scene && !view.current) view.current = fitView(scene, r.width, r.height, fitTopRef.current);
      dirty.current = true;
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [scene]);

  // draw loop
  useEffect(() => {
    if (!scene) return;
    let raf = 0;
    const loop = () => {
      raf = requestAnimationFrame(loop);
      const f = frameRef?.current ?? null;
      if (f !== lastFrame.current) {
        lastFrame.current = f;
        dirty.current = true;
      }
      const cv = canvas.current;
      const { w, h } = size.current;
      if (!dirty.current || !cv || !w) return;
      if (!view.current) view.current = fitView(scene, w, h, fitTopRef.current);
      const ctx = cv.getContext("2d");
      if (!ctx) return;
      dirty.current = false;
      const p = props.current;
      drawScene(ctx, scene, view.current, w, h, {
        palette: p.dark ? DARK : LIGHT,
        closed: p.closed,
        time: f?.t ?? p.time,
        vehicles: f,
        heat: p.heat,
        selected: p.selected,
        hovered: p.hover,
        basemap: p.mapOn,
        dark: p.dark,
      });
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [scene, frameRef]);

  // pan, zoom, pick
  const drag = useRef<{ x: number; y: number; moved: boolean; pointers: Map<number, { x: number; y: number }>; pinch: number } | null>(null);
  const local = (e: { clientX: number; clientY: number }) => {
    const r = canvas.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  const zoomAt = (sx: number, sy: number, factor: number) => {
    const v = view.current;
    if (!v) return;
    const { w, h } = size.current;
    const before = toWorld(v, w, h, sx, sy);
    v.scale = Math.min(40, Math.max(0.05, v.scale * factor));
    const after = toWorld(v, w, h, sx, sy);
    v.cx += before.x - after.x;
    v.cy += before.y - after.y;
    dirty.current = true;
  };

  useEffect(() => {
    const cv = canvas.current;
    if (!cv) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const p = local(e);
      zoomAt(p.x, p.y, Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015)));
    };
    cv.addEventListener("wheel", onWheel, { passive: false });
    return () => cv.removeEventListener("wheel", onWheel);
  }, []);

  const onPointerDown = (e: React.PointerEvent) => {
    canvas.current!.setPointerCapture(e.pointerId);
    const p = local(e);
    if (!drag.current) drag.current = { ...p, moved: false, pointers: new Map(), pinch: 0 };
    drag.current.pointers.set(e.pointerId, p);
    if (drag.current.pointers.size === 2) {
      const [a, b] = [...drag.current.pointers.values()] as [{ x: number; y: number }, { x: number; y: number }];
      drag.current.pinch = Math.hypot(a.x - b.x, a.y - b.y);
      drag.current.moved = true;
    }
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const p = local(e);
    const d = drag.current;
    const v = view.current;
    if (d && v && d.pointers.has(e.pointerId)) {
      const prev = d.pointers.get(e.pointerId)!;
      d.pointers.set(e.pointerId, p);
      if (d.pointers.size === 2) {
        const [a, b] = [...d.pointers.values()] as [{ x: number; y: number }, { x: number; y: number }];
        const dist = Math.hypot(a.x - b.x, a.y - b.y);
        if (d.pinch > 0) zoomAt((a.x + b.x) / 2, (a.y + b.y) / 2, dist / d.pinch);
        d.pinch = dist;
        return;
      }
      if (Math.abs(p.x - d.x) + Math.abs(p.y - d.y) > 4) d.moved = true;
      if (d.moved) {
        v.cx -= (p.x - prev.x) / v.scale;
        v.cy += (p.y - prev.y) / v.scale;
        dirty.current = true;
      }
      return;
    }
    if (!scene || !v || !hoverLabel) return;
    const wpt = toWorld(v, size.current.w, size.current.h, p.x, p.y);
    const l = pickLink(scene, wpt.x, wpt.y, 4 / v.scale);
    setHover(l ? { id: l.id, x: p.x, y: p.y } : null);
  };
  const onPointerUp = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    d.pointers.delete(e.pointerId);
    if (d.pointers.size) return;
    drag.current = null;
    if (d.moved || !scene || !view.current || !onSelect) return;
    const p = local(e);
    const wpt = toWorld(view.current, size.current.w, size.current.h, p.x, p.y);
    const l = pickLink(scene, wpt.x, wpt.y, 6 / view.current.scale);
    onSelect(l?.id ?? null);
  };

  const fit = () => {
    if (scene && size.current.w) {
      view.current = fitView(scene, size.current.w, size.current.h, fitTopRef.current);
      dirty.current = true;
    }
  };

  return (
    <div className="map" ref={wrap}>
      <canvas
        ref={canvas}
        role="img"
        aria-label={ariaLabel}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onPointerLeave={() => setHover(null)}
        style={{ cursor: hover && onSelect ? "pointer" : "grab", touchAction: "none" }}
      />
      {hover && hoverLabel && (
        <div className="map-tip" style={{ left: hover.x + 12, top: hover.y + 12 }}>
          {hoverLabel(hover.id)}
        </div>
      )}
      <div className="map-zoom">
        <button type="button" onClick={() => zoomAt(size.current.w / 2, size.current.h / 2, 1.4)} aria-label="Zoom in" data-tip="Zoom in">+</button>
        <button type="button" onClick={() => zoomAt(size.current.w / 2, size.current.h / 2, 1 / 1.4)} aria-label="Zoom out" data-tip="Zoom out">−</button>
        <button type="button" onClick={fit} aria-label="Fit network to view" data-tip="Fit the network">⤢</button>
        {basemap && (
          <button type="button" className={showMap ? "on" : ""} onClick={() => setShowMap((v) => !v)} aria-pressed={showMap} data-tip={showMap ? "Hide the street map" : "Show the street map"}>
            Map
          </button>
        )}
      </div>
      {basemap && <div className="attrib">{mapOn ? BASEMAP_ATTRIBUTION : "© OpenStreetMap contributors"}</div>}
      {children}
    </div>
  );
}
