/**
 * Full runs. The server is tried first (it stores runs and keeps the browser free);
 * if it is unreachable, busy or rate-limiting, the same engine runs in a browser worker.
 * Both give bit-identical results (tested on the server side via stateHash).
 */
import type { RunResult, Scenario } from "@traffic/engine";
import type { RunIn, RunOut } from "../workers/protocol";

export type RunSource = "server" | "browser";

export type RunMode = "auto" | "browser" | "server";

export interface RunHandle {
  /** `note` says why a run did not go where the mode asked (e.g. the server was too slow) */
  promise: Promise<{ result: RunResult; source: RunSource; note: string | null }>;
  cancel: () => void;
}

export class RunError extends Error {
  constructor(readonly issues: string[]) {
    super(issues.join("; "));
  }
}

/** Errors that mean "the server can't do it right now", not "the scenario is wrong". */
class Unavailable extends Error {}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** A free host may be asleep (cold start ~1 min) or very slow; give up and run locally instead. */
const REQUEST_TIMEOUT_MS = 8_000;
/** abandon the server run if its progress does not move for this long */
const STALL_MS = 15_000;

async function runOnServer(scenario: Scenario, onProgress: (f: number) => void, cancelled: () => boolean, stallMs: number): Promise<RunResult> {
  let res: Response;
  try {
    res = await fetch("/api/runs", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ scenario }), signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  } catch {
    throw new Unavailable("server unreachable");
  }
  if (res.status === 400) throw new RunError((await res.json()).issues ?? ["invalid scenario"]);
  if (res.status !== 202) throw new Unavailable(`server answered ${res.status}`);
  const { id } = (await res.json()) as { id: string };
  let best = -1;
  let movedAt = Date.now();
  for (;;) {
    if (cancelled()) throw new RunError(["cancelled"]);
    await sleep(400);
    let r: Response;
    try {
      r = await fetch(`/api/runs/${id}`, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
    } catch {
      throw new Unavailable("lost the server");
    }
    if (!r.ok) throw new Unavailable(`server answered ${r.status}`);
    const run = (await r.json()) as { status: string; progress: number; result?: RunResult; error?: string };
    onProgress(run.progress ?? 0);
    if ((run.progress ?? 0) > best) {
      best = run.progress ?? 0;
      movedAt = Date.now();
    } else if (Date.now() - movedAt > stallMs) throw new Unavailable("server too slow");
    if (run.status === "done" && run.result) return run.result;
    if (run.status === "failed") throw new Unavailable(run.error ?? "run failed on the server");
  }
}

function runInBrowser(scenario: Scenario, onProgress: (f: number) => void, register: (stop: () => void) => void): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const w = new Worker(new URL("../workers/run.worker.ts", import.meta.url), { type: "module" });
    register(() => {
      w.terminate();
      reject(new RunError(["cancelled"]));
    });
    w.postMessage({ type: "run", scenario } satisfies RunIn);
    w.onmessage = (ev: MessageEvent<RunOut>) => {
      const m = ev.data;
      if (m.type === "progress") onProgress(m.fraction);
      else {
        w.terminate();
        if (m.type === "done") resolve(m.result);
        else reject(new RunError(m.issues));
      }
    };
    w.onerror = (e) => {
      w.terminate();
      reject(new RunError([e.message || "worker error"]));
    };
  });
}

/** in auto mode, use the server only if it should finish within this many seconds */
const AUTO_MAX_SERVER_S = 12;

/** Estimated server time for a run, or null if the server is unreachable or has not measured itself yet. */
async function serverEstimate(scenario: Scenario): Promise<{ seconds: number | null; reachable: boolean }> {
  try {
    const r = await fetch("/api/health", { signal: AbortSignal.timeout(4_000) });
    if (!r.ok) return { seconds: null, reachable: false };
    const h = (await r.json()) as { simRate: number | null; pendingRuns: number };
    if (!h.simRate) return { seconds: null, reachable: true };
    // queued runs ahead of this one are assumed to be the same size
    return { seconds: (scenario.durationS / h.simRate) * (1 + h.pendingRuns), reachable: true };
  } catch {
    return { seconds: null, reachable: false };
  }
}

export function startRun(scenario: Scenario, onProgress: (f: number, source: RunSource) => void, mode: RunMode = "auto"): RunHandle {
  let cancelled = false;
  let stopWorker: (() => void) | null = null;
  const promise = (async () => {
    let note: string | null = null;
    let useServer = mode === "server";
    if (mode === "auto") {
      const est = await serverEstimate(scenario);
      if (!est.reachable) note = "server unreachable";
      else if (est.seconds === null) note = "server speed not measured yet";
      else if (est.seconds > AUTO_MAX_SERVER_S) note = `the server would take about ${Math.round(est.seconds)} s`;
      else useServer = true;
    }
    if (useServer) {
      try {
        // asked for explicitly: wait (queued behind other runs, or slow) rather than give up
        const result = await runOnServer(scenario, (f) => onProgress(f, "server"), () => cancelled, mode === "server" ? Infinity : STALL_MS);
        return { result, source: "server" as const, note: null };
      } catch (e) {
        if (!(e instanceof Unavailable)) throw e;
        note = `${e.message}, so it ran here instead`;
      }
    }
    if (cancelled) throw new RunError(["cancelled"]);
    const result = await runInBrowser(scenario, (f) => onProgress(f, "browser"), (stop) => (stopWorker = stop));
    return { result, source: "browser" as const, note };
  })();
  return {
    promise,
    cancel: () => {
      cancelled = true;
      (stopWorker as (() => void) | null)?.();
    },
  };
}
