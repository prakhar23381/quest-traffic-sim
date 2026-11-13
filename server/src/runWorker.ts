/** Runs one scenario off the main thread and reports progress. */
import { parentPort, workerData } from "node:worker_threads";
import { runScenario } from "@traffic/engine";

const result = runScenario(workerData.scenario, {
  onProgress: (f) => parentPort!.postMessage({ type: "progress", progress: f }),
});
parentPort!.postMessage({ type: "result", result });
