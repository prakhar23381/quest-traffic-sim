import { buildApp } from "./app";

const port = Number(process.env.PORT ?? 8080);
const { app } = await buildApp({
  dbPath: process.env.DB_PATH ?? "traffic.db",
  staticDir: process.env.STATIC_DIR,
  trustProxy: process.env.TRUST_PROXY === "1",
  concurrency: Number(process.env.RUN_CONCURRENCY ?? 2),
  logger: true,
});
await app.listen({ port, host: "0.0.0.0" });
