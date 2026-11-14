import { catalogEntry, type Sample } from "@traffic/engine";
import { clock, int, num } from "../lib/format";
import { kpiRows, SERIES, type RunRecord } from "./Results";
import { LineChart } from "./LineChart";

interface Props {
  runs: RunRecord[];
  a: number | null;
  b: number | null;
  onPick: (which: "a" | "b", key: number) => void;
}

/** What differs between two scenarios, in words (so the reader knows what is being compared). */
function differences(x: RunRecord, y: RunRecord): string[] {
  const s = x.result.scenario;
  const t = y.result.scenario;
  if (s.networkId !== t.networkId) return ["different networks"];
  const out: string[] = [];
  if (s.demandScale !== t.demandScale) out.push(`demand ${s.demandScale}× → ${t.demandScale}×`);
  const off = (z: typeof s) => new Set(z.togglesOff);
  for (const id of new Set([...s.togglesOff, ...t.togglesOff])) if (off(s).has(id) !== off(t).has(id)) out.push(`${catalogEntry(s.networkId)?.toggles.find((x) => x.id === id)?.label ?? id} ${off(t).has(id) ? "closed" : "opened"}`);
  const cl = (z: typeof s) => new Set(z.closedLinks);
  const dc = [...new Set([...s.closedLinks, ...t.closedLinks])].filter((id) => cl(s).has(id) !== cl(t).has(id)).length;
  if (dc) out.push(`${dc} road closure${dc > 1 ? "s" : ""} changed`);
  if (JSON.stringify(s.linkEdits) !== JSON.stringify(t.linkEdits)) out.push("road edits differ");
  if (JSON.stringify(s.signalGreens) !== JSON.stringify(t.signalGreens) || s.retimeSignals !== t.retimeSignals) out.push("signal timing differs");
  if (s.seed !== t.seed) out.push(`seed ${s.seed} → ${t.seed}`);
  if (s.durationS !== t.durationS) out.push(`duration ${clock(s.durationS)} → ${clock(t.durationS)}`);
  return out.length ? out : ["identical scenarios"];
}

export function Compare({ runs, a, b, onPick }: Props) {
  const A = runs.find((r) => r.key === a);
  const B = runs.find((r) => r.key === b);
  const picker = (which: "a" | "b", value: number | null, color: string) => (
    <label className="field pick">
      <span>
        <i style={{ background: color }} /> {which === "a" ? "Baseline" : "Alternative"}
      </span>
      <select value={value ?? ""} onChange={(e) => onPick(which, Number(e.target.value))}>
        <option value="" disabled>
          choose a run
        </option>
        {runs.map((r) => (
          <option key={r.key} value={r.key}>
            {r.label}
          </option>
        ))}
      </select>
    </label>
  );

  if (runs.length < 2)
    return (
      <div className="empty">
        <h2>Compare two scenarios</h2>
        <p>
          Run at least two scenarios first. A typical study: run the baseline, change one thing (close the flyover, add a lane, raise demand), run again,
          then compare them here.
        </p>
      </div>
    );

  const rowsA = A ? kpiRows(A.result) : [];
  const rowsB = B ? kpiRows(B.result) : [];
  const both = A && B;

  return (
    <div className="compare">
      <div className="row">
        {picker("a", a, SERIES[0]!)}
        {picker("b", b, SERIES[1]!)}
      </div>
      {both && (
        <>
          <p className="hint">Changes from baseline to alternative: {differences(A, B).join(" · ")}</p>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Measure</th>
                  <th className="num">Baseline</th>
                  <th className="num">Alternative</th>
                  <th className="num">Change</th>
                </tr>
              </thead>
              <tbody>
                {rowsA.map((ra, i) => {
                  const rb = rowsB[i]!;
                  const d = rb.raw - ra.raw;
                  const pct = ra.raw ? (d / Math.abs(ra.raw)) * 100 : null;
                  const good = ra.better && Math.abs(d) > 1e-9 ? (ra.better === "up" ? d > 0 : d < 0) : null;
                  return (
                    <tr key={ra.label}>
                      <td title={ra.hint}>{ra.label}</td>
                      <td className="num">{ra.value}</td>
                      <td className="num">{rb.value}</td>
                      <td className={`num ${good === null ? "" : good ? "good" : "bad"}`}>
                        {Math.abs(d) < 1e-9 ? "same" : pct === null || !Number.isFinite(pct) ? `${d > 0 ? "+" : ""}${num(d, 0)}` : `${d > 0 ? "+" : ""}${num(pct, 0)}%`}
                        {good !== null && <span className="sr"> ({good ? "better" : "worse"})</span>}
                        {good !== null && <span aria-hidden="true">{good ? " ▲" : " ▼"}</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="hint">▲ better, ▼ worse. One seed per run: differences of a few percent can be noise, so try another seed before concluding.</p>
          <div className="charts">
            {(
              [
                ["Vehicles in the network", (s: Sample) => s.inNetwork, int],
                ["Vehicles waiting to enter", (s: Sample) => s.waiting, int],
                ["Mean speed, km/h", (s: Sample) => s.meanSpeed * 3.6, (x: number) => num(x, 0)],
                ["Trips completed per hour", (s: Sample) => s.throughput, int],
              ] as const
            ).map(([title, f, fmt]) => (
              <LineChart
                key={title}
                title={title}
                fmt={fmt}
                fmtX={clock}
                minStep={fmt === int ? 1 : 0}
                series={[
                  { label: "Baseline", color: SERIES[0]!, points: A.result.timeseries.map((s) => [s.t, f(s)]) },
                  { label: "Alternative", color: SERIES[1]!, points: B.result.timeseries.map((s) => [s.t, f(s)]) },
                ]}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
