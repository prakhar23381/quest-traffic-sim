import { defaultScenario } from "@traffic/engine";
import { buildApp } from "./app";
import { ConfigError, loadConfig } from "./config";
import { createShutdown } from "./shutdown";

let cfg;
try {
  cfg = loadConfig(process.env);
} catch (e) {
  if (e instanceof ConfigError) {
    console.error("Invalid configuration:\n" + e.problems.map((p) => "  - " + p).join("\n"));
    process.exit(2);
  }
  throw e;
}

const { app, store, runner } = await buildApp({
  dbPath: cfg.dbPath,
  staticDir: cfg.staticDir,
  trustProxy: cfg.trustProxy || undefined,
  concurrency: cfg.concurrency,
  maxQueue: cfg.maxQueue,
  runTimeoutMs: cfg.runTimeoutMs,
  logger: true,
});
await app.listen({ port: cfg.port, host: "0.0.0.0" });

const shutdown = createShutdown({
  close: () => app.close(),
  failUnfinished: (reason) => store.failUnfinished(reason),
  exit: (code) => process.exit(code),
  log: (m) => app.log.info(m),
});
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));

// Measure how fast this machine simulates (reported by /api/health), so the web app can
// decide whether a run is quicker here or in the visitor's browser.
const bench = { ...defaultScenario("silk-board", "startup benchmark"), durationS: 300 };
runner.submit(store.createRun(JSON.stringify(bench), null), bench);
