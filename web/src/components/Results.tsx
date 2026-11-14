import { useMemo, useState } from "react";
import { buildNetwork, prepareScenario, type RunResult } from "@traffic/engine";
import { clock, int, num } from "../lib/format";
import { layerName } from "../lib/labels";
import { DARK, LIGHT, SPEED_BINS } from "../lib/scene";
import { useDarkMode } from "../lib/useDarkMode";
import { LineChart } from "./LineChart";
import { MapView } from "./MapView";
import { SpeedLegend } from "./SpeedLegend";

export interface RunRecord {
  key: number;
  label: string;
  result: RunResult;
  source: "server" | "browser";
}

export const SERIES = ["var(--series-1)", "var(--series-2)"];

export function kpiRows(r: RunResult) {
  const k = r.kpis;
  return [
    { label: "Trips completed", value: int(k.completed), raw: k.completed, better: "up" as const, hint: `of ${int(k.entered)} that entered` },
    { label: "Throughput", value: `${int(k.throughputVph)} veh/h`, raw: k.throughputVph, better: "up" as const },
    { label: "Mean travel time", value: clock(k.meanTravelTime), raw: k.meanTravelTime, better: "down" as const, hint: "completed trips, incl. waiting to enter" },
    { label: "90th percentile travel time", value: clock(k.p90TravelTime), raw: k.p90TravelTime, better: "down" as const },
    { label: "Mean delay", value: clock(k.meanDelay), raw: k.meanDelay, better: "down" as const, hint: "vs free-flow travel time" },
    { label: "Mean speed", value: `${num(k.meanSpeedKmh)} km/h`, raw: k.meanSpeedKmh, better: "up" as const },
    { label: "Still waiting to enter", value: int(k.waiting), raw: k.waiting, better: "down" as const, hint: "queued at the network edge at the end" },
    { label: "Trips with no route", value: int(k.unserved), raw: k.unserved, better: "down" as const, hint: "destination unreachable (closures)" },
    { label: "Vehicle-km travelled", value: int(k.vkt), raw: k.vkt, better: null },
    { label: "Removed (gridlock / wrong lane)", value: `${int(k.droppedGridlock)} / ${int(k.droppedWrongLane)}`, raw: k.droppedGridlock + k.droppedWrongLane, better: "down" as const, hint: "safety valves; should be near zero" },
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
          <h2>{run.label}</h2>
          <p className="hint">
            {r.networkName} · {clock(r.durationS)} simulated in {num(r.wallMs / 1000, 1)} s ({run.source === "server" ? "on the server" : "in your browser"})
          </p>
        </header>
        <dl className="kpis">
          {kpiRows(r).map((k) => (
            <div key={k.label} title={k.hint}>
              <dt>{k.label}</dt>
              <dd>{k.value}</dd>
            </div>
          ))}
        </dl>
        {(r.kpis.gridlockAt !== null || r.warnings.length > 0) && (
          <div className="notice">
            {r.kpis.gridlockAt !== null && <p>Part of the network locked up at {clock(r.kpis.gridlockAt)} (20+ vehicles stopped for over a minute).</p>}
            {r.warnings.slice(0, 4).map((w) => (
              <p key={w}>{w}</p>
            ))}
          </div>
        )}
        <div className="charts">
          <LineChart title="Vehicles in the network" series={[{ label: "In network", color: SERIES[0]!, points: ts.map((s) => [s.t, s.inNetwork]) }]} fmt={int} fmtX={clock} minStep={1} />
          <LineChart title="Vehicles waiting to enter" series={[{ label: "Waiting", color: SERIES[0]!, points: ts.map((s) => [s.t, s.waiting]) }]} fmt={int} fmtX={clock} minStep={1} />
          <LineChart title="Mean speed in the network, km/h" series={[{ label: "Speed", color: SERIES[0]!, points: ts.map((s) => [s.t, s.meanSpeed * 3.6]) }]} fmt={(x) => num(x, 0)} fmtX={clock} />
          <LineChart title="Trips completed per hour" series={[{ label: "Throughput", color: SERIES[0]!, points: ts.map((s) => [s.t, s.throughput]) }]} fmt={int} fmtX={clock} minStep={1} />
        </div>
        <h3>Longest queues</h3>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Road</th>
                <th>Level</th>
                <th className="num">Lanes</th>
                <th className="num">Vehicles</th>
                <th className="num">Mean speed</th>
                <th className="num">Max queue</th>
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
