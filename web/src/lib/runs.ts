/**
 * Full runs. The server is tried first (it stores runs and keeps the browser free);
 * if it is unreachable, busy or rate-limiting, the same engine runs in a browser worker.
 * Both give bit-identical results (tested on the server side via stateHash).
 */
import type { RunResult, Scenario } from "@traffic/engine";
import type { RunIn, RunOut } from "../workers/protocol";

export type RunSource = "server" | "browser";

export interface RunHandle {
  promise: Promise<{ result: RunResult; source: RunSource }>;
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

async function runOnServer(scenario: Scenario, onProgress: (f: number) => void, cancelled: () => boolean): Promise<RunResult> {
  let res: Response;
  try {
    res = await fetch("/api/runs", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ scenario }) });
  } catch {
    throw new Unavailable("server unreachable");
  }
  if (res.status === 400) throw new RunError((await res.json()).issues ?? ["invalid scenario"]);
  if (res.status !== 202) throw new Unavailable(`server answered ${res.status}`);
  const { id } = (await res.json()) as { id: string };
  for (;;) {
    if (cancelled()) throw new RunError(["cancelled"]);
    await sleep(400);
    let r: Response;
    try {
      r = await fetch(`/api/runs/${id}`);
    } catch {
      throw new Unavailable("lost the server");
    }
    if (!r.ok) throw new Unavailable(`server answered ${r.status}`);
    const run = (await r.json()) as { status: string; progress: number; result?: RunResult; error?: string };
    onProgress(run.progress ?? 0);
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

export function startRun(scenario: Scenario, onProgress: (f: number, source: RunSource) => void, preferServer = true): RunHandle {
  let cancelled = false;
  let stopWorker: (() => void) | null = null;
  const promise = (async () => {
    if (preferServer) {
      try {
        const result = await runOnServer(scenario, (f) => onProgress(f, "server"), () => cancelled);
        return { result, source: "server" as const };
      } catch (e) {
        if (!(e instanceof Unavailable)) throw e;
      }
    }
    if (cancelled) throw new RunError(["cancelled"]);
    const result = await runInBrowser(scenario, (f) => onProgress(f, "browser"), (stop) => (stopWorker = stop));
    return { result, source: "browser" as const };
  })();
  return {
    promise,
    cancel: () => {
      cancelled = true;
      (stopWorker as (() => void) | null)?.();
    },
  };
}
