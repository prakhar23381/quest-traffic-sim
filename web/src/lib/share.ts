/**
 * Scenarios travel in the URL (#s=<base64url JSON>) so a link always works, even though
 * the free host's disk is wiped on restart. When the server is up, a short link
 * (?id=...) is offered as well.
 */
import { prepareScenario, type Scenario } from "@traffic/engine";

function toB64Url(s: string): string {
  const bytes = new TextEncoder().encode(s);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromB64Url(s: string): string {
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/"));
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
}

/** Drop empty defaults so links stay short. */
function compact(s: Scenario): Partial<Scenario> {
  const out: Record<string, unknown> = { ...s };
  for (const k of ["closedLinks", "togglesOff"] as const) if (!s[k].length) delete out[k];
  for (const k of ["linkEdits", "signalGreens"] as const) if (!Object.keys(s[k]).length) delete out[k];
  if (!s.retimeSignals) delete out.retimeSignals;
  return out as Partial<Scenario>;
}

export function scenarioHash(s: Scenario): string {
  return "#s=" + toB64Url(JSON.stringify(compact(s)));
}

/** The scenario in the current URL hash, validated; null if absent or invalid. */
export function scenarioFromHash(hash: string): Scenario | null {
  const m = /[#&]s=([A-Za-z0-9_-]+)/.exec(hash);
  if (!m) return null;
  try {
    return prepareScenario(JSON.parse(fromB64Url(m[1]!))).scenario;
  } catch {
    return null;
  }
}

export async function loadStoredScenario(id: string): Promise<Scenario | null> {
  try {
    const r = await fetch(`/api/scenarios/${encodeURIComponent(id)}`);
    if (!r.ok) return null;
    return prepareScenario((await r.json()).scenario).scenario;
  } catch {
    return null;
  }
}

/** Short link via the server, or null if the server is unavailable. */
export async function saveScenario(s: Scenario): Promise<string | null> {
  try {
    const r = await fetch("/api/scenarios", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ scenario: s }) });
    if (r.status !== 201) return null;
    const { id } = (await r.json()) as { id: string };
    return `${location.origin}${location.pathname}?id=${id}`;
  } catch {
    return null;
  }
}
