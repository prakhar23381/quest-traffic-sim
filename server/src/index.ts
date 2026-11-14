import { defaultScenario } from "@traffic/engine";
import { buildApp } from "./app";

const port = Number(process.env.PORT ?? 8080);
const { app, store, runner } = await buildApp({
  dbPath: process.env.DB_PATH ?? "traffic.db",
  staticDir: process.env.STATIC_DIR,
  trustProxy: process.env.TRUST_PROXY === "1",
  concurrency: Number(process.env.RUN_CONCURRENCY ?? 2),
  maxQueue: Number(process.env.RUN_MAX_QUEUE ?? 20),
  runTimeoutMs: Number(process.env.RUN_TIMEOUT_MS ?? 120_000),
  logger: true,
});
await app.listen({ port, host: "0.0.0.0" });

// Measure how fast this machine simulates (reported by /api/health), so the web app can
// decide whether a run is quicker here or in the visitor's browser.
const bench = { ...defaultScenario("silk-board", "startup benchmark"), durationS: 300 };
runner.submit(store.createRun(JSON.stringify(bench), null), bench);
