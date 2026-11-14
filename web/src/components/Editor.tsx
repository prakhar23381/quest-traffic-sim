import { useEffect, useRef } from "react";
import { CATALOG, LIMITS, defaultScenario, type CatalogEntry, type Network, type Scenario } from "@traffic/engine";
import { int, num } from "../lib/format";
import { layerName, linkLabel, nodeLabel, phaseLabel } from "../lib/labels";

interface Props {
  scenario: Scenario;
  onChange: (s: Scenario) => void;
  entry: CatalogEntry;
  net: Network;
  selected: string | null;
  onSelect: (id: string | null) => void;
}

const DURATIONS = [600, 1800, 3600, 7200];

export function Editor({ scenario: s, onChange, entry, net, selected, onSelect }: Props) {
  const set = (patch: Partial<Scenario>) => onChange({ ...s, ...patch });
  const baseVph = entry.demand.reduce((a, d) => a + d.rate, 0);
  const link = selected ? net.linkById.get(selected) : undefined;
  const baseLink = selected ? entry.network.links.find((l) => l.id === selected) : undefined;
  const closed = new Set(s.closedLinks);
  const signals = net.nodes.filter((n) => n.signal);

  const editLink = (id: string, patch: { lanes?: number; speedLimitKmh?: number; laneWidth?: number }) => {
    const base = entry.network.links.find((l) => l.id === id)!;
    const cur = { ...s.linkEdits[id], ...patch };
    // drop values equal to the original so the scenario stays minimal
    for (const k of ["lanes", "speedLimitKmh", "laneWidth"] as const) if (cur[k] === (base[k] ?? (k === "laneWidth" ? 3.5 : undefined))) delete cur[k];
    const linkEdits = { ...s.linkEdits };
    if (Object.keys(cur).length) linkEdits[id] = cur;
    else delete linkEdits[id];
    set({ linkEdits });
  };
  const toggleClosed = (id: string) => set({ closedLinks: closed.has(id) ? s.closedLinks.filter((x) => x !== id) : [...s.closedLinks, id] });

  const setGreen = (nodeId: string, i: number, value: number) => {
    const node = net.nodeById.get(nodeId)!;
    const greens = s.signalGreens[nodeId] ?? node.signal!.phases.map((p) => p.greenEnd - p.start);
    const next = greens.map((g, k) => (k === i ? Math.round(Math.min(LIMITS.maxGreen, Math.max(LIMITS.minGreen, value))) : g));
    set({ signalGreens: { ...s.signalGreens, [nodeId]: next } });
  };
  const resetGreens = (nodeId: string) => {
    const signalGreens = { ...s.signalGreens };
    delete signalGreens[nodeId];
    set({ signalGreens });
  };

  const editedLinks = Object.keys(s.linkEdits);
  const roadRef = useRef<HTMLElement>(null);
  useEffect(() => {
    if (selected) roadRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [selected]);

  return (
    <div className="editor">
      <section>
        <h2>Network</h2>
        <label className="field">
          <span>Road network</span>
          <select
            value={s.networkId}
            onChange={(e) => {
              onSelect(null);
              onChange({ ...defaultScenario(e.target.value, s.name), seed: s.seed, durationS: s.durationS });
            }}
          >
            {CATALOG.map((e) => (
              <option key={e.id} value={e.id}>
                {e.name}
              </option>
            ))}
          </select>
        </label>
        <p className="hint">{entry.description}</p>
      </section>

      {entry.toggles.length > 0 && (
        <section>
          <h2>Infrastructure</h2>
          {entry.toggles.map((t) => {
            const on = !s.togglesOff.includes(t.id);
            return (
              <label key={t.id} className="switch">
                <input type="checkbox" checked={on} onChange={() => set({ togglesOff: on ? [...s.togglesOff, t.id] : s.togglesOff.filter((x) => x !== t.id) })} />
                <span>
                  <b>{t.label}</b> {on ? "open" : "closed"}
                  {t.description && <small>{t.description}</small>}
                </span>
              </label>
            );
          })}
        </section>
      )}

      <section>
        <h2>Traffic demand</h2>
        <label className="field">
          <span>
            Demand <output>{num(s.demandScale, 2)}× · {int(baseVph * s.demandScale)} veh/h</output>
          </span>
          <input type="range" min={0} max={LIMITS.maxDemandScale} step={0.05} value={s.demandScale} onChange={(e) => set({ demandScale: Number(e.target.value) })} />
        </label>
        <div className="row">
          <label className="field">
            <span>Duration</span>
            <select value={s.durationS} onChange={(e) => set({ durationS: Number(e.target.value) })}>
              {[...new Set([...DURATIONS, s.durationS])].sort((a, b) => a - b).map((d) => (
                <option key={d} value={d}>
                  {d >= 3600 ? `${d / 3600} h` : `${d / 60} min`}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Random seed</span>
            <input type="number" min={0} step={1} value={s.seed} onChange={(e) => set({ seed: Math.max(0, Math.floor(Number(e.target.value) || 0)) })} />
          </label>
        </div>
        <p className="hint">Trips are random (Poisson arrivals); the seed makes a run repeatable.</p>
      </section>

      <section ref={roadRef}>
        <h2>Selected road</h2>
        {!link || !baseLink ? (
          <p className="hint">Click a road on the map to change its lanes, speed limit or lane width, or to close it.</p>
        ) : (
          <div className="road">
            <div className="road-head">
              <b>{linkLabel(link)}</b>
              <button type="button" className="link" onClick={() => onSelect(null)} aria-label="Deselect road">
                ✕
              </button>
            </div>
            <p className="hint">
              {layerName(link.layer)} · {int(link.length)} m · id {link.id}
            </p>
            <div className="row">
              <label className="field">
                <span>Lanes</span>
                <input type="number" min={1} max={LIMITS.maxLanes} value={s.linkEdits[link.id]?.lanes ?? baseLink.lanes} onChange={(e) => editLink(link.id, { lanes: Math.min(LIMITS.maxLanes, Math.max(1, Math.round(Number(e.target.value) || 1))) })} />
              </label>
              <label className="field">
                <span>Speed limit, km/h</span>
                <input type="number" min={10} max={120} step={5} value={s.linkEdits[link.id]?.speedLimitKmh ?? baseLink.speedLimitKmh} onChange={(e) => editLink(link.id, { speedLimitKmh: Math.min(120, Math.max(10, Number(e.target.value) || 10)) })} />
              </label>
              <label className="field">
                <span>Lane width</span>
                <select value={s.linkEdits[link.id]?.laneWidth ?? baseLink.laneWidth ?? 3.5} onChange={(e) => editLink(link.id, { laneWidth: Number(e.target.value) })}>
                  {[2.5, 2.75, 3, 3.25, 3.5, 3.75, 4].map((w) => (
                    <option key={w} value={w}>
                      {w} m
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <label className="switch">
              <input type="checkbox" checked={!closed.has(link.id)} onChange={() => toggleClosed(link.id)} />
              <span>
                <b>Road</b> {closed.has(link.id) ? "closed" : "open"}
              </span>
            </label>
            <p className="hint">Narrow lanes are driven more slowly with longer headways (factor 0.7 at 2.5 m to 1.0 at 3.5 m).</p>
          </div>
        )}
        {(editedLinks.length > 0 || s.closedLinks.length > 0) && (
          <ul className="edits">
            {[...new Set([...editedLinks, ...s.closedLinks])].map((id) => {
              const l = net.linkById.get(id);
              const e = s.linkEdits[id];
              const what = [closed.has(id) && "closed", e?.lanes && `${e.lanes} lanes`, e?.speedLimitKmh && `${e.speedLimitKmh} km/h`, e?.laneWidth && `${e.laneWidth} m lanes`].filter(Boolean).join(", ");
              return (
                <li key={id}>
                  <button type="button" className="link" onClick={() => onSelect(id)}>
                    {l ? linkLabel(l) : id}
                  </button>
                  <span>{what}</span>
                  <button
                    type="button"
                    className="link"
                    aria-label={`Undo changes to ${l ? linkLabel(l) : id}`}
                    onClick={() => {
                      const linkEdits = { ...s.linkEdits };
                      delete linkEdits[id];
                      set({ linkEdits, closedLinks: s.closedLinks.filter((x) => x !== id) });
                    }}
                  >
                    undo
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section>
        <h2>Signals</h2>
        {signals.length === 0 ? (
          <p className="hint">This network has no signalised junctions.</p>
        ) : (
          <>
            <label className="switch">
              <input type="checkbox" checked={s.retimeSignals} onChange={() => set({ retimeSignals: !s.retimeSignals })} />
              <span>
                <b>Retime for this demand</b>
                <small>Webster's method on the busiest lane of each phase, recomputed for the demand above.</small>
              </span>
            </label>
            {signals.map((n) => {
              const sig = n.signal!;
              return (
                <details key={n.id} className="signal" open={signals.length <= 2}>
                  <summary>
                    {nodeLabel(n)} <small>cycle {Math.round(sig.cycle)} s</small>
                  </summary>
                  {sig.phases.map((p, i) => (
                    <label key={i} className="phase">
                      <span title={phaseLabel(net, p.movements)}>
                        Phase {i + 1}: <small>{phaseLabel(net, p.movements)}</small>
                      </span>
                      <input
                        type="number"
                        min={LIMITS.minGreen}
                        max={LIMITS.maxGreen}
                        disabled={s.retimeSignals}
                        value={Math.round(p.greenEnd - p.start)}
                        onChange={(e) => setGreen(n.id, i, Number(e.target.value))}
                        aria-label={`Green time, phase ${i + 1}, seconds`}
                      />
                      <small>s</small>
                    </label>
                  ))}
                  {s.signalGreens[n.id] && !s.retimeSignals && (
                    <button type="button" className="link" onClick={() => resetGreens(n.id)}>
                      Reset to the original plan
                    </button>
                  )}
                </details>
              );
            })}
          </>
        )}
      </section>
    </div>
  );
}
