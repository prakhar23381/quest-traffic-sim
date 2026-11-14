/**
 * One tooltip for the whole app. Any element with `data-tip="…"` shows it on hover or
 * keyboard focus (and on tap, for touch). It is a fixed-position layer placed from the
 * element's bounding box, so scrolling containers (the sidebar) never clip it, and it is
 * clamped to the viewport. The same text is exposed to screen readers via aria-description
 * (set here) or, for icon-only controls, via their own aria-label.
 */
import { useEffect, useRef, useState } from "react";

interface Tip {
  text: string;
  x: number;
  y: number;
  above: boolean;
}

const MAX_W = 260;
const GAP = 8;

export function TooltipLayer() {
  const [tip, setTip] = useState<Tip | null>(null);
  const current = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const show = (el: HTMLElement) => {
      const text = el.dataset.tip;
      if (!text) return;
      if (!el.hasAttribute("aria-description") && !el.hasAttribute("aria-label")) el.setAttribute("aria-description", text);
      current.current = el;
      const r = el.getBoundingClientRect();
      const above = r.bottom + 80 > window.innerHeight;
      const x = Math.min(window.innerWidth - MAX_W / 2 - 8, Math.max(MAX_W / 2 + 8, r.left + r.width / 2));
      setTip({ text, x, y: above ? r.top - GAP : r.bottom + GAP, above });
    };
    const hide = () => {
      current.current = null;
      setTip(null);
    };
    const target = (e: Event) => (e.target instanceof Element ? (e.target.closest("[data-tip]") as HTMLElement | null) : null);
    const over = (e: Event) => {
      const el = target(e);
      if (el && el !== current.current) show(el);
      else if (!el && current.current) hide();
    };
    const key = (e: KeyboardEvent) => e.key === "Escape" && hide();
    // a click changes what a control does (e.g. the theme toggle): close the stale tip
    document.addEventListener("pointerdown", hide);
    document.addEventListener("pointerover", over);
    document.addEventListener("focusin", over);
    document.addEventListener("focusout", hide);
    document.addEventListener("scroll", hide, true);
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("pointerdown", hide);
      document.removeEventListener("pointerover", over);
      document.removeEventListener("focusin", over);
      document.removeEventListener("focusout", hide);
      document.removeEventListener("scroll", hide, true);
      document.removeEventListener("keydown", key);
    };
  }, []);

  if (!tip) return null;
  return (
    <div className={`tooltip ${tip.above ? "above" : ""}`} role="tooltip" style={{ left: tip.x, top: tip.y, maxWidth: MAX_W }}>
      {tip.text}
    </div>
  );
}

/** A small ⓘ marker that explains the label beside it. */
export function Info({ tip }: { tip: string }) {
  return (
    <button
      type="button"
      className="info"
      data-tip={tip}
      aria-label={tip}
      onClick={(e) => {
        // inside a <label> a click would also toggle its control; just show the tip
        e.preventDefault();
        e.currentTarget.focus();
      }}
    >
      i
    </button>
  );
}
