import { useEffect, useMemo, useRef, useState } from "react";
import { buildNetwork, catalogEntry, defaultScenario, prepareScenario, ScenarioError, type Scenario } from "@traffic/engine";
import { About } from "./components/About";
import { Compare } from "./components/Compare";
import { Editor } from "./components/Editor";
import { MapView } from "./components/MapView";
import { Results, type RunRecord } from "./components/Results";
import { SpeedLegend } from "./components/SpeedLegend";
import { clock, int, num } from "./lib/format";
import { layerName, linkLabel } from "./lib/labels";
import { RunError, startRun, type RunHandle, type RunMode, type RunSource } from "./lib/runs";
import { loadStoredScenario, saveScenario, scenarioFromHash, scenarioHash } from "./lib/share";
import { useLiveSim } from "./lib/useLiveSim";

type Tab = "live" | "results" | "compare" | "about";
const SPEEDS = [1, 4, 8, 20, 60, 0];

function initialScenario(): Scenario {
  return scenarioFromHash(location.hash) ?? defaultScenario("silk-board");
}

/** Short description of what a scenario changes from its network's defaults. */
function describe(s: Scenario): string {
  const bits: string[] = [];
  if (s.demandScale !== 1) bits.push(`${num(s.demandScale, 2)}× demand`);
  for (const t of s.togglesOff) bits.push(`${catalogEntry(s.networkId)?.toggles.find((x) => x.id === t)?.label ?? t} closed`);
  if (s.closedLinks.length) bits.push(`${s.closedLinks.length} road${s.closedLinks.length > 1 ? "s" : ""} closed`);
  if (Object.keys(s.linkEdits).length) bits.push(`${Object.keys(s.linkEdits).length} road edit${Object.keys(s.linkEdits).length > 1 ? "s" : ""}`);
  if (s.retimeSignals) bits.push("signals retimed");
  else if (Object.keys(s.signalGreens).length) bits.push("signal greens edited");
  if (s.seed !== 1) bits.push(`seed ${s.seed}`);
  return bits.join(", ") || "baseline";
}

export default function App() {
  const [scenario, setScenario] = useState<Scenario>(initialScenario);
  const [tab, setTab] = useState<Tab>("live");
  const [selected, setSelected] = useState<string | null>(null);
  const [runs, setRuns] = useState<RunRecord[]>([]);
  const [shown, setShown] = useState<number | null>(null);
  const [pair, setPair] = useState<{ a: number | null; b: number | null }>({ a: null, b: null });
  const [active, setActive] = useState<{ progress: number; source: RunSource; handle: RunHandle; started: boolean } | null>(null);
  const [runError, setRunError] = useState<string | null>(null);
  const [shareMsg, setShareMsg] = useState<string | null>(null);
  const [panelOpen, setPanelOpen] = useState(false);
  const [runMode, setRunMode] = useState<RunMode>("auto");
  const runKey = useRef(1);

  // ?id=... loads a stored scenario from the server
  useEffect(() => {
    const id = new URLSearchParams(location.search).get("id");
    if (id) void loadStoredScenario(id).then((s) => s && setScenario(s));
  }, []);
  // keep the URL in sync so any state can be bookmarked or shared
  useEffect(() => {
    history.replaceState(null, "", `${location.pathname}${scenarioHash(scenario)}`);
  }, [scenario]);

  const prepared = useMemo(() => {
    try {
      return { ok: true as const, prep: prepareScenario(scenario) };
    } catch (e) {
      return { ok: false as const, issues: e instanceof ScenarioError ? e.issues : [String(e)] };
    }
  }, [scenario]);
  const entry = catalogEntry(scenario.networkId)!;
  const net = useMemo(() => (prepared.ok ? buildNetwork(prepared.prep.network, { closedLinks: prepared.prep.config.closedLinks }) : buildNetwork(entry.network)), [prepared, entry]);
  const closed = useMemo(() => new Set(prepared.ok ? prepared.prep.config.closedLinks : []), [prepared]);
  const live = useLiveSim(prepared.ok ? prepared.prep.scenario : null);

  const run = () => {
    if (!prepared.ok || active) return;
    setRunError(null);
    const s = prepared.prep.scenario;
    const handle = startRun(s, (progress, source) => setActive((a) => (a ? { ...a, progress, source, started: true } : a)), runMode);
    setActive({ progress: 0, source: runMode === "browser" ? "browser" : "server", handle, started: false });
    handle.promise
      .then(({ result, source, note }) => {
        const key = runKey.current++;
        const rec: RunRecord = { key, label: `Run ${key}: ${describe(s)}`, result, source, note };
        setRuns((rs) => [...rs, rec]);
        setShown(key);
        // the first run stays the baseline; the newest run is the alternative
        setPair((p) => ({ a: p.a ?? key, b: p.a === null ? null : key }));
        setTab("results");
      })
      .catch((e) => {
        const msg = e instanceof RunError ? e.issues.join("; ") : String(e);
        if (msg !== "cancelled") setRunError(msg);
      })
      .finally(() => setActive(null));
  };

  const share = async () => {
    setShareMsg("Saving…");
    const short = await saveScenario(scenario);
    const url = short ?? location.href;
    try {
      await navigator.clipboard.writeText(url);
      setShareMsg(short ? "Short link copied" : "Link copied (scenario is in the URL)");
    } catch {
      setShareMsg(url);
    }
    setTimeout(() => setShareMsg(null), 4000);
  };

  const st = live.stats;
  const shownRun = runs.find((r) => r.key === shown) ?? runs[runs.length - 1];
  const tabs: [Tab, string][] = [
    ["live", "Live"],
    ["results", `Results${runs.length ? ` (${runs.length})` : ""}`],
    ["compare", "Compare"],
    ["about", "About the model"],
  ];

  return (
    <div className="app">
      <header className="top">
        <div className="brand">
          <h1>Junction Lab</h1>
          <span>agent-based traffic simulation</span>
        </div>
        <nav className="tabs" role="tablist">
          {tabs.map(([id, label]) => (
            <button key={id} role="tab" type="button" aria-selected={tab === id} className={tab === id ? "on" : ""} onClick={() => setTab(id)}>
              {label}
            </button>
          ))}
        </nav>
        <div className="top-actions">
          {shareMsg && (
            <span className="toast" role="status">
              {shareMsg}
            </span>
          )}
          <button type="button" onClick={share}>
            Share
          </button>
          <button type="button" className="mobile-only" onClick={() => setPanelOpen((o) => !o)} aria-expanded={panelOpen}>
            {panelOpen ? "Close editor" : "Edit scenario"}
          </button>
        </div>
      </header>

      <aside className={`side ${panelOpen ? "open" : ""}`} aria-label="Scenario editor">
        <Editor scenario={scenario} onChange={setScenario} entry={entry} net={net} selected={selected} onSelect={setSelected} />
        <div className="run-box">
          {!prepared.ok && (
            <div className="notice error" role="alert">
              {prepared.issues.map((i) => (
                <p key={i}>{i}</p>
              ))}
            </div>
          )}
          {active ? (
            <div className="progress">
              <div className="bar">
                <div style={{ width: `${Math.round(active.progress * 100)}%` }} />
              </div>
              <span>
                {active.started ? `Running ${active.source === "server" ? "on the server" : "in your browser"}… ${Math.round(active.progress * 100)}%` : "Starting…"}
              </span>
              <button type="button" className="link" onClick={() => active.handle.cancel()}>
                Cancel
              </button>
            </div>
          ) : (
            <button type="button" className="primary" disabled={!prepared.ok} onClick={run}>
              Run full simulation ({clock(scenario.durationS)})
            </button>
          )}
          {runError && (
            <p className="notice error" role="alert">
              Run failed: {runError}
            </p>
          )}
          <label className="field run-where">
            <span>Run on</span>
            <select value={runMode} onChange={(e) => setRunMode(e.target.value as RunMode)} disabled={!!active}>
              <option value="auto">Auto (fastest)</option>
              <option value="browser">This browser</option>
              <option value="server">The server</option>
            </select>
          </label>
          <p className="hint">Runs the whole period without drawing and adds it to Results, where you can compare it with other runs. Auto uses the server when it would be quick, otherwise your browser; both give identical results.</p>
        </div>
      </aside>

      <main className="main">
        {tab === "live" && (
          <MapView
            net={net}
            closed={closed}
            frameRef={live.frameRef}
            selected={selected}
            onSelect={(id) => {
              setSelected(id);
              if (id) setPanelOpen(true);
            }}
            hoverLabel={(id) => {
              const l = net.linkById.get(id)!;
              return `${linkLabel(l)} · ${layerName(l.layer)} · ${l.lanes.length} lane${l.lanes.length > 1 ? "s" : ""}${closed.has(id) ? " · closed" : ""}`;
            }}
            ariaLabel={`Live simulation of ${entry.name}`}
            fitTop={90}
          >
            <div className="hud">
              <div className="controls">
                {live.playing ? (
                  <button type="button" className="primary" onClick={live.pause}>
                    Pause
                  </button>
                ) : (
                  <button type="button" className="primary" onClick={live.play} disabled={!prepared.ok || (st !== null && st.t >= st.durationS)}>
                    Play
                  </button>
                )}
                <button type="button" onClick={() => live.step(10)} disabled={live.playing || !prepared.ok} title="Advance 10 simulated seconds">
                  +10 s
                </button>
                <button type="button" onClick={live.restart} disabled={!prepared.ok}>
                  Restart
                </button>
                <label className="speed">
                  <span>Speed</span>
                  <select value={live.speed} onChange={(e) => live.setSpeed(Number(e.target.value))}>
                    {SPEEDS.map((x) => (
                      <option key={x} value={x}>
                        {x === 0 ? "max" : `${x}×`}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              {st && (
                <dl className="hud-stats">
                  <div>
                    <dt>Time</dt>
                    <dd>
                      {clock(st.t)} <small>/ {clock(st.durationS)}</small>
                    </dd>
                  </div>
                  <div>
                    <dt>On the roads</dt>
                    <dd>{int(st.inNetwork)}</dd>
                  </div>
                  <div>
                    <dt>Waiting to enter</dt>
                    <dd>{int(st.waiting)}</dd>
                  </div>
                  <div>
                    <dt>Trips done</dt>
                    <dd>{int(st.completed)}</dd>
                  </div>
                  <div>
                    <dt>Mean speed</dt>
                    <dd>{num(st.meanSpeedKmh, 0)} km/h</dd>
                  </div>
                  {live.playing && (
                    <div>
                      <dt>Sim rate</dt>
                      <dd>{num(st.rate, 0)}×</dd>
                    </div>
                  )}
                </dl>
              )}
            </div>
            <SpeedLegend title="Vehicle speed" />
            {live.error && (
              <div className="notice error map-error" role="alert">
                {live.error.map((i) => (
                  <p key={i}>{i}</p>
                ))}
              </div>
            )}
            {entry.osm && <div className="attrib">© OpenStreetMap contributors</div>}
          </MapView>
        )}
        {tab === "results" &&
          (shownRun ? (
            <div className="results-wrap">
              {runs.length > 1 && (
                <label className="field run-pick">
                  <span>Showing</span>
                  <select value={shownRun.key} onChange={(e) => setShown(Number(e.target.value))}>
                    {runs.map((r) => (
                      <option key={r.key} value={r.key}>
                        {r.label}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <Results key={shownRun.key} run={shownRun} />
            </div>
          ) : (
            <div className="empty">
              <h2>No runs yet</h2>
              <p>Set up a scenario on the left and press "Run full simulation". The result (travel times, queues, speed on every road) appears here.</p>
            </div>
          ))}
        {tab === "compare" && <Compare runs={runs} a={pair.a} b={pair.b} onPick={(w, k) => setPair((p) => ({ ...p, [w]: k }))} />}
        {tab === "about" && <About />}
      </main>
    </div>
  );
}
