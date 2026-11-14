/**
 * Background runs in worker threads: a bounded queue, a concurrency cap and a wall-clock
 * timeout, so one heavy scenario cannot take the server down.
 */
import { Worker } from "node:worker_threads";
import type { Store } from "./db";

export interface RunnerOptions {
  concurrency: number;
  maxQueue: number;
  timeoutMs: number;
}

interface Job {
  id: string;
  scenario: unknown;
}

export class Runner {
  private readonly queue: Job[] = [];
  private active = 0;
  private readonly dev: boolean;
  /** simulated seconds per wall-clock second on this machine (moving average of finished runs) */
  simRate: number | null = null;

  constructor(private readonly store: Store, private readonly opts: RunnerOptions) {
    // In development the sources are TypeScript; the bundled build ships runWorker.js.
    this.dev = import.meta.url.endsWith(".ts");
  }

  private spawn(workerData: unknown): Worker {
    if (!this.dev) return new Worker(new URL("./runWorker.js", import.meta.url), { workerData });
    // Development: register tsx's ESM loader inside the worker, then load the TypeScript
    // worker. (Passing "--import tsx" via execArgv did not apply to the worker entry.)
    const target = new URL("./runWorker.ts", import.meta.url).href;
    const boot = `import("tsx/esm/api").then(({ register }) => { register(); return import(${JSON.stringify(target)}); })`;
    return new Worker(boot, { eval: true, workerData });
  }

  get pending(): number {
    return this.queue.length + this.active;
  }

  /** Returns false if the queue is full. */
  submit(id: string, scenario: unknown): boolean {
    if (this.queue.length >= this.opts.maxQueue) return false;
    this.queue.push({ id, scenario });
    this.pump();
    return true;
  }

  private pump(): void {
    while (this.active < this.opts.concurrency && this.queue.length > 0) {
      const job = this.queue.shift()!;
      this.active++;
      this.start(job);
    }
  }

  private start(job: Job): void {
    const w = this.spawn({ scenario: job.scenario });
    let settled = false;
    const finish = (status: "done" | "failed", result: string | null, error: string | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      this.store.finishRun(job.id, status, result, error);
      this.active--;
      void w.terminate();
      this.pump();
    };
    const timer = setTimeout(() => finish("failed", null, `timed out after ${this.opts.timeoutMs / 1000} s`), this.opts.timeoutMs);
    this.store.setProgress(job.id, 0);
    w.on("message", (m: { type: string; progress?: number; result?: unknown }) => {
      if (m.type === "progress") this.store.setProgress(job.id, m.progress!);
      else if (m.type === "result") {
        const r = m.result as { durationS: number; wallMs: number };
        if (r.wallMs > 0) {
          const rate = r.durationS / (r.wallMs / 1000);
          this.simRate = this.simRate === null ? rate : 0.7 * this.simRate + 0.3 * rate;
        }
        finish("done", JSON.stringify(m.result), null);
      }
    });
    w.on("error", (e: Error) => finish("failed", null, e.message));
    w.on("exit", (code) => finish("failed", null, `worker exited with code ${code}`));
  }
}
