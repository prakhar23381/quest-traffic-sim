import { useMemo } from "react";
import { buildNetwork, prepareScenario, type RunResult } from "@traffic/engine";
import { num } from "../lib/format";
import { useDarkMode } from "../lib/useDarkMode";
import { DARK as DARK_MAP, LIGHT as LIGHT_MAP } from "../lib/scene";
import { MapView } from "./MapView";

/** change in mean speed (alternative − baseline), km/h: bin edges */
const EDGES = [-15, -5, 5, 15];
const LABELS = ["15+ slower", "5–15 slower", "within 5", "5–15 faster", "15+ faster"];
// diverging: red (slower) ↔ grey midpoint ↔ blue (faster)
const LIGHT = ["#d03b3b", "#ec9a96", "#c9c8c2", "#8fb6e8", "#2a78d6"];
const DARK = ["#e66767", "#9a4b4b", "#55554f", "#3d6aa3", "#5b9bea"];

const binOf = (d: number) => {
  let i = 0;
  while (i < EDGES.length && d >= EDGES[i]!) i++;
  return i;
};

/** Map of how each road's mean speed changed from the baseline run to the alternative. */
export function ChangeMap({ a, b }: { a: RunResult; b: RunResult }) {
  const dark = useDarkMode();
  const pal = dark ? DARK : LIGHT;
  const prep = useMemo(() => prepareScenario(b.scenario), [b.scenario]);
  const net = useMemo(() => buildNetwork(prep.network, { closedLinks: prep.config.closedLinks }), [prep]);
  const closed = useMemo(() => new Set(prep.config.closedLinks), [prep]);
  const rows = useMemo(() => {
    const byA = new Map(a.links.map((l) => [l.id, l]));
    return new Map(
      b.links.map((lb) => {
        const la = byA.get(lb.id);
        const d = la?.meanSpeedKmh != null && lb.meanSpeedKmh != null ? lb.meanSpeedKmh - la.meanSpeedKmh : null;
        return [lb.id, { name: lb.name ?? lb.id, a: la?.meanSpeedKmh ?? null, b: lb.meanSpeedKmh, d }];
      }),
    );
  }, [a, b]);
  const heat = useMemo(() => new Map([...rows].flatMap(([id, r]) => (r.d === null ? [] : [[id, pal[binOf(r.d)]!] as [string, string]]))), [rows, pal]);
  const fmt = (v: number | null) => (v === null ? "unused" : `${num(v, 0)} km/h`);

  return (
    <div className="change-map">
      <MapView
        net={net}
        closed={closed}
        heat={heat}
        hoverLabel={(id) => {
          const r = rows.get(id);
          if (!r) return id;
          return `${r.name}: ${fmt(r.a)} → ${fmt(r.b)}${r.d === null ? "" : ` (${r.d > 0 ? "+" : ""}${num(r.d, 0)})`}`;
        }}
        ariaLabel="Map of the change in mean speed on each road, baseline to alternative"
      >
        <div className="map-legend">
          <b>Mean speed on each road, alternative vs baseline</b>
          <div>
            {LABELS.map((l, i) => (
              <span key={l}>
                <i style={{ background: pal[i] }} />
                {l}
              </span>
            ))}
            <span className="unit">km/h</span>
          </div>
          <div>
            <span>
              <i style={{ background: (dark ? DARK_MAP : LIGHT_MAP).closed }} />
              closed in the alternative
            </span>
            <span>plain grey: unused in one of the runs</span>
          </div>
        </div>
      </MapView>
    </div>
  );
}
