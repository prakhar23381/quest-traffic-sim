import { CITY_IDM, LIMITS, laneWidthFactor } from "@traffic/engine";
import { num } from "../lib/format";

interface Props {
  lanes: number;
  laneWidth: number;
  layer: number;
  closed: boolean;
  onLanes: (n: number) => void;
  onWidth: (w: number) => void;
}

/** px per metre, fixed so that width changes are visible (6 lanes × 4 m fill the panel) */
const S = 11;
const W = 290;
const CAR_W = 1.8;
const CAR_H = 1.45;

/**
 * Cross-section of the selected road, drawn to scale and looking along the direction of
 * travel: lanes at their real width with a car in each, on a deck and pillar if elevated.
 */
export function CrossSection({ lanes, laneWidth, layer, closed, onLanes, onWidth }: Props) {
  const total = lanes * laneWidth;
  const x0 = (W - total * S) / 2;
  const surface = 50;
  const H = layer > 0 ? 86 : 64;
  const f = laneWidthFactor(laneWidth);
  const gap = CITY_IDM.T * (2 - f);

  return (
    <div className="xsec">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Cross-section: ${lanes} lanes of ${laneWidth} m, ${num(total, 1)} m in total`}>
        {/* overall width */}
        <text x={W / 2} y={11} className="xs-label" textAnchor="middle">
          {num(total, 2).replace(/0$/, "")} m = {lanes} × {laneWidth} m
        </text>
        <line x1={x0} x2={x0 + total * S} y1={19} y2={19} className="xs-dim" />
        <line x1={x0} x2={x0} y1={15} y2={23} className="xs-dim" />
        <line x1={x0 + total * S} x2={x0 + total * S} y1={15} y2={23} className="xs-dim" />
        {layer > 0 ? (
          <>
            <rect x={W / 2 - 9} y={surface + 6} width={18} height={H - surface - 6} className="xs-pillar" />
            <rect x={x0 - 6} y={surface} width={total * S + 12} height={7} className="xs-deck" />
            <rect x={x0 - 6} y={surface - 7} width={4} height={7} className="xs-deck" />
            <rect x={x0 + total * S + 2} y={surface - 7} width={4} height={7} className="xs-deck" />
          </>
        ) : (
          <>
            <rect x={0} y={surface} width={W} height={H - surface} className="xs-ground" />
            <rect x={x0 - 18} y={surface - 3} width={18} height={3} className="xs-kerb" />
            <rect x={x0 + total * S} y={surface - 3} width={18} height={3} className="xs-kerb" />
          </>
        )}
        <rect x={x0} y={surface} width={total * S} height={4} className={closed ? "xs-road closed" : "xs-road"} />
        {Array.from({ length: lanes }, (_, i) => {
          const cx = x0 + (i + 0.5) * laneWidth * S;
          return (
            <g key={i}>
              {i > 0 && <line x1={x0 + i * laneWidth * S} x2={x0 + i * laneWidth * S} y1={surface} y2={surface + 4} className="xs-mark" />}
              {!closed && <rect x={cx - (CAR_W * S) / 2} y={surface - CAR_H * S} width={CAR_W * S} height={CAR_H * S} rx={4} className="xs-car" />}
            </g>
          );
        })}
      </svg>
      <div className="xsec-controls">
        <div className="stepper" role="group" aria-label="Lanes">
          <span>Lanes</span>
          <button type="button" onClick={() => onLanes(lanes - 1)} disabled={lanes <= 1} aria-label="Remove a lane">
            −
          </button>
          <b>{lanes}</b>
          <button type="button" onClick={() => onLanes(lanes + 1)} disabled={lanes >= LIMITS.maxLanes} aria-label="Add a lane">
            +
          </button>
        </div>
        <label className="field">
          <span>
            Lane width <output>{laneWidth} m</output>
          </span>
          <input type="range" min={2.5} max={4} step={0.25} value={laneWidth} onChange={(e) => onWidth(Number(e.target.value))} />
        </label>
      </div>
      <p className="hint">
        Drivers here aim for {Math.round(f * 100)}% of the speed limit and keep a {num(gap, 1)} s gap
        {f < 1 ? " (narrow lanes are driven more cautiously)" : ""}. A car is 1.8 m wide, drawn to scale.
      </p>
    </div>
  );
}
