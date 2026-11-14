import { useId, useMemo, useRef, useState } from "react";

export interface Series {
  label: string;
  /** CSS colour (a categorical slot token) */
  color: string;
  points: [number, number][];
}

interface Props {
  title: string;
  series: Series[];
  /** formats a y value for ticks and the tooltip */
  fmt: (y: number) => string;
  /** formats an x value (simulated seconds) */
  fmtX: (x: number) => string;
  height?: number;
  /** smallest tick step (1 for counts) */
  minStep?: number;
}

const W = 520;
const M = { l: 44, r: 26, t: 10, b: 24 };

function niceTicks(max: number, minStep: number, n = 4): number[] {
  if (max <= 0) return [0, minStep || 1];
  const raw = Math.max(minStep, max / n);
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((k) => k * mag).find((s) => s >= raw)!;
  const out: number[] = [];
  for (let v = 0; v <= max + 1e-9; v += step) out.push(v);
  if (out[out.length - 1]! < max) out.push(out[out.length - 1]! + step);
  return out;
}

/** Single-axis line chart with a crosshair tooltip. */
export function LineChart({ title, series, fmt, fmtX, height = 170, minStep = 0 }: Props) {
  const id = useId();
  const svg = useRef<SVGSVGElement>(null);
  const [hx, setHx] = useState<number | null>(null);
  const H = height;
  const { xMax, ticks, X, Y } = useMemo(() => {
    let xMax = 1;
    let yMax = 0;
    for (const s of series)
      for (const [x, y] of s.points) {
        xMax = Math.max(xMax, x);
        yMax = Math.max(yMax, y);
      }
    const ticks = niceTicks(yMax, minStep);
    const top = ticks[ticks.length - 1] || 1;
    return {
      xMax,
      ticks,
      X: (x: number) => M.l + (x / xMax) * (W - M.l - M.r),
      Y: (y: number) => H - M.b - (y / top) * (H - M.t - M.b),
    };
  }, [series, H, minStep]);
  const xTicks = useMemo(() => {
    const step = xMax > 5400 ? 1800 : xMax > 1800 ? 600 : xMax > 600 ? 300 : 60;
    const out: number[] = [];
    for (let x = 0; x <= xMax; x += step) out.push(x);
    return out;
  }, [xMax]);

  const onMove = (e: React.PointerEvent) => {
    const r = svg.current!.getBoundingClientRect();
    const x = ((e.clientX - r.left) / r.width) * W;
    const t = ((x - M.l) / (W - M.l - M.r)) * xMax;
    setHx(t < 0 || t > xMax ? null : t);
  };
  // nearest sample per series at the crosshair
  const at = hx === null ? [] : series.map((s) => s.points.reduce((b, p) => (Math.abs(p[0] - hx) < Math.abs(b[0] - hx) ? p : b), s.points[0] ?? [0, 0]));
  const tipX = at[0] ? X(at[0][0]) : 0;

  return (
    <figure className="chart">
      <figcaption id={id}>{title}</figcaption>
      {series.length > 1 && (
        <div className="legend">
          {series.map((s) => (
            <span key={s.label}>
              <i style={{ background: s.color }} />
              {s.label}
            </span>
          ))}
        </div>
      )}
      <div className="chart-plot">
        <svg ref={svg} viewBox={`0 0 ${W} ${H}`} aria-labelledby={id} role="img" onPointerMove={onMove} onPointerLeave={() => setHx(null)}>
          {ticks.map((t) => (
            <g key={t}>
              <line x1={M.l} x2={W - M.r} y1={Y(t)} y2={Y(t)} className="grid" />
              <text x={M.l - 6} y={Y(t)} className="tick" textAnchor="end" dominantBaseline="middle">
                {fmt(t)}
              </text>
            </g>
          ))}
          {xTicks.map((t) => (
            <text key={t} x={X(t)} y={H - 6} className="tick" textAnchor="middle">
              {fmtX(t)}
            </text>
          ))}
          {series.map((s) => (
            <polyline key={s.label} fill="none" stroke={s.color} strokeWidth={2} strokeLinejoin="round" points={s.points.map(([x, y]) => `${X(x).toFixed(1)},${Y(y).toFixed(1)}`).join(" ")} />
          ))}
          {hx !== null && at[0] && (
            <g pointerEvents="none">
              <line x1={tipX} x2={tipX} y1={M.t} y2={H - M.b} className="crosshair" />
              {at.map((p, i) => (
                <circle key={i} cx={X(p[0])} cy={Y(p[1])} r={4} fill={series[i]!.color} className="dot" />
              ))}
            </g>
          )}
        </svg>
        {hx !== null && at[0] && (
          <div className="chart-tip" style={{ left: `${(tipX / W) * 100}%` }}>
            <b>{fmtX(at[0][0])}</b>
            {at.map((p, i) => (
              <span key={i}>
                <i style={{ background: series[i]!.color }} />
                {series.length > 1 ? `${series[i]!.label}: ` : ""}
                {fmt(p[1])}
              </span>
            ))}
          </div>
        )}
      </div>
    </figure>
  );
}
