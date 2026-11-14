/** Runs one scenario headless (same engine call as the server) and reports progress. */
import { runScenario, ScenarioError } from "@traffic/engine";
import type { RunIn, RunOut } from "./protocol";

const post = (m: RunOut) => (self as unknown as Worker).postMessage(m);

self.onmessage = (ev: MessageEvent<RunIn>) => {
  try {
    const result = runScenario(ev.data.scenario, { onProgress: (fraction) => post({ type: "progress", fraction }) });
    post({ type: "done", result });
  } catch (e) {
    post({ type: "error", issues: e instanceof ScenarioError ? e.issues : [String(e)] });
  }
};
