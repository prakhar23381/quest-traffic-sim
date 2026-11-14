import { useMemo, useState } from "react";
import { buildNetwork, prepareScenario, type RunResult } from "@traffic/engine";
import { clock, int, num } from "../lib/format";
import { layerName } from "../lib/labels";
import { DARK, LIGHT, SPEED_BINS } from "../lib/scene";
import { useDarkMode } from "../lib/useDarkMode";
import { LineChart } from "./LineChart";
import { MapView } from "./MapView";
import { SpeedLegend } from "./SpeedLegend";
import { Info } from "./Tooltip";

export interface RunRecord {
  key: number;
  label: string;
  result: RunResult;
  source: "server" | "browser";
  /** why it ran where it did, if not where asked */
  note?: string | null;
}

export const SERIES = ["var(--series-1)", "var(--series-2)"];

/** Headline measures. `value` is the full text (tables); `big` + `unit` are for tiles. */
export function kpiRows(r: RunResult) {
  const k = r.kpis;
  const row = (label: string, big: string, unit: string, raw: number, better: "up" | "down" | null, hint: string) => ({
    label,
    big,
    unit,
    value: unit ? `${big} ${unit}` : big,
    raw,
    better,
    hint,
  });
  return [
    row("Trips done", int(k.completed), "", k.completed, "up", `Vehicles that reached their destination, of ${int(k.entered)} that entered.`),
    row("Throughput", int(k.throughputVph), "veh/h", k.throughputVph, "up", "Completed trips per hour."),
    row("Travel time", clock(k.meanTravelTime), "avg", k.meanTravelTime, "down", "Mean door-to-door time of completed trips, including waiting to enter."),
    row("Slowest 10%", clock(k.p90TravelTime), "", k.p90TravelTime, "down", "90th percentile travel time: 1 trip in 10 took at least this long."),
    row("Delay", clock(k.meanDelay), "avg", k.meanDelay, "down", "Mean extra time compared with driving the same route on empty roads."),
    row("Speed", num(k.meanSpeedKmh), "km/h", k.meanSpeedKmh, "up", "Mean speed of all vehicles over the run."),
    row("Waiting", int(k.waiting), "", k.waiting, "down", "Vehicles still queued at the edge of the network when the run ended."),
    row("No route", int(k.unserved), "", k.unserved, "down", "Trips that could not start because closures left no way to their destination."),
    row("Distance", int(k.vkt), "veh-km", k.vkt, null, "Total vehicle-kilometres driven."),
    row("Removed", int(k.droppedGridlock + k.droppedWrongLane), "", k.droppedGridlock + k.droppedWrongLane, "down", `Safety valves, should be near zero: ${int(k.droppedGridlock)} removed after 5 min stuck in gridlock, ${int(k.droppedWrongLane)} stuck in a lane that could not make their turn.`),
  ];
}

export function speedColor(kmh: number | null, dark: boolean): string | null {
  if (kmh === null) return null;
  let i = 0;
  while (kmh >= SPEED_BINS[i]!) i++;
  return (dark ? DARK : LIGHT).speeds[i]!;
}

export function Results({ run }: { run: RunRecord }) {
  const r = run.result;
  const dark = useDarkMode();
  const [selected, setSelected] = useState<string | null>(null);
  const prep = useMemo(() => prepareScenario(r.scenario), [r.scenario]);
  const net = useMemo(() => buildNetwork(prep.network, { closedLinks: prep.config.closedLinks }), [prep]);
  const closed = useMemo(() => new Set(prep.config.closedLinks), [prep]);
  const heat = useMemo(() => new Map(r.links.flatMap((l) => (speedColor(l.meanSpeedKmh, dark) ? [[l.id, speedColor(l.meanSpeedKmh, dark)!] as [string, string]] : []))), [r, dark]);
  const byId = useMemo(() => new Map(r.links.map((l) => [l.id, l])), [r]);
  const worst = useMemo(() => [...r.links].filter((l) => l.entered > 0).sort((a, b) => b.maxQueue - a.maxQueue).slice(0, 8), [r]);
  const ts = r.timeseries;
  const sel = selected ? byId.get(selected) : undefined;

  return (
    <div className="results">
      <div className="results-main">
        <header className="results-head">
          <h2 className="display">{run.label}</h2>
          <p className="hint">
            <span className="badge" data-tip={`${r.networkName}${run.note ? ` · ${run.note}` : ""}`}>
              {run.source === "server" ? "Server" : "Browser"}
            </span>
            <span>
              {clock(r.durationS)} simulated in {num(r.wallMs / 1000, 1)} s
            </span>
          </p>
        </header>
        <dl className="kpis">
          {kpiRows(r).map((k) => (
            <div key={k.label}>
              <dt>
                {k.label} <Info tip={k.hint} />
              </dt>
              <dd>
                {k.big} {k.unit && <small>{k.unit}</small>}
              </dd>
            </div>
          ))}
        </dl>
        {(r.kpis.gridlockAt !== null || r.warnings.length > 0) && (
          <div className="notice">
            {r.kpis.gridlockAt !== null && (
              <p>
                Gridlock from {clock(r.kpis.gridlockAt)} <Info tip="20 or more vehicles stopped for over a minute somewhere in the network." />
              </p>
            )}
            {r.warnings.length > 0 && (
              <p>
                {r.warnings.length === 1 ? r.warnings[0] : `${r.warnings.length} warnings`}{" "}
                {r.warnings.length > 1 && <Info tip={r.warnings.slice(0, 12).join(" · ") + (r.warnings.length > 12 ? " …" : "")} />}
              </p>
            )}
          </div>
        )}
        <div className="charts">
          <LineChart title="Vehicles in the network" series={[{ label: "In network", color: SERIES[0]!, points: ts.map((s) => [s.t, s.inNetwork]) }]} fmt={int} fmtX={clock} minStep={1} />
          <LineChart title="Vehicles waiting to enter" series={[{ label: "Waiting", color: SERIES[0]!, points: ts.map((s) => [s.t, s.waiting]) }]} fmt={int} fmtX={clock} minStep={1} />
          <LineChart title="Mean speed in the network, km/h" series={[{ label: "Speed", color: SERIES[0]!, points: ts.map((s) => [s.t, s.meanSpeed * 3.6]) }]} fmt={(x) => num(x, 0)} fmtX={clock} />
          <LineChart title="Trips completed per hour" series={[{ label: "Throughput", color: SERIES[0]!, points: ts.map((s) => [s.t, s.throughput]) }]} fmt={int} fmtX={clock} minStep={1} />
        </div>
        <h3>
          Longest queues <Info tip="Roads where the most vehicles were crawling (under 7 km/h) at once. Click a row to find it on the map." />
        </h3>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Road</th>
                <th>Level</th>
                <th className="num">Lanes</th>
                <th className="num" data-tip="Vehicles that used this road">Vehicles</th>
                <th className="num">Mean speed</th>
                <th className="num" data-tip="Most vehicles crawling on this road at any moment">Max queue</th>
              </tr>
            </thead>
            <tbody>
              {worst.map((l) => (
                <tr key={l.id} className={l.id === selected ? "sel" : ""} onClick={() => setSelected(l.id)}>
                  <td>{l.name ?? l.id}</td>
                  <td>{layerName(l.layer)}</td>
                  <td className="num">{l.lanes}</td>
                  <td className="num">{int(l.entered)}</td>
                  <td className="num">{l.meanSpeedKmh === null ? "–" : `${num(l.meanSpeedKmh, 0)} km/h`}</td>
                  <td className="num">{int(l.maxQueue)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <div className="results-map">
        <MapView
          net={net}
          closed={closed}
          heat={heat}
          selected={selected}
          onSelect={setSelected}
          hoverLabel={(id) => {
            const l = byId.get(id);
            return l ? `${l.name ?? id}: ${l.meanSpeedKmh === null ? "unused" : `${num(l.meanSpeedKmh, 0)} km/h`}, max queue ${l.maxQueue}` : id;
          }}
          ariaLabel="Map of mean speed on each road over the run"
        >
          <SpeedLegend title="Mean speed on each road" />
          {sel && (
            <div className="map-card">
              <b>{sel.name ?? sel.id}</b>
              <span>
                {layerName(sel.layer)} · {sel.lanes} lanes{sel.closed ? " · closed" : ""}
              </span>
              <span>
                {int(sel.entered)} vehicles · {sel.meanSpeedKmh === null ? "unused" : `${num(sel.meanSpeedKmh, 0)} km/h mean`} · queue up to {sel.maxQueue}
              </span>
            </div>
          )}
        </MapView>
      </div>
    </div>
  );
}
