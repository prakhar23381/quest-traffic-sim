/**
 * HTTP API. Every scenario is validated by the engine (prepareScenario) before it is stored
 * or run, so the server and the browser agree on what a scenario means.
 *
 *   GET  /api/health
 *   GET  /api/networks              list of networks
 *   GET  /api/networks/:id          network, demand and toggles
 *   POST /api/scenarios             { scenario } → { id }
 *   GET  /api/scenarios/:id         → { id, scenario }
 *   POST /api/runs                  { scenario } or { scenarioId } → { id, status }
 *   GET  /api/runs/:id              → { id, status, progress, result?, error? }
 */
import Fastify, { type FastifyInstance } from "fastify";
import rateLimit from "@fastify/rate-limit";
import fastifyStatic from "@fastify/static";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { CATALOG, catalogEntry, ENGINE_VERSION, LIMITS, prepareScenario, ScenarioError } from "@traffic/engine";
import { Store } from "./db";
import { Runner } from "./runner";

export interface AppOptions {
  dbPath?: string;
  concurrency?: number;
  maxQueue?: number;
  runTimeoutMs?: number;
  /** requests per minute per IP for POST /api/runs */
  runRateLimit?: number;
  logger?: boolean;
  /** directory of the built web app to serve at / (production: one container, one URL) */
  staticDir?: string;
  /**
   * Number of proxy hops in front of the server whose X-Forwarded-For entries are trusted.
   * A count, not `true`: trusting everything would let a client forge its address and dodge
   * the per-client rate limits.
   */
  trustProxy?: number;
  /** requests per minute per client for POST /api/scenarios */
  saveRateLimit?: number;
}

export async function buildApp(opts: AppOptions = {}): Promise<{ app: FastifyInstance; store: Store; runner: Runner }> {
  const app = Fastify({ logger: opts.logger ?? false, bodyLimit: 256 * 1024, trustProxy: opts.trustProxy ? (_addr: string, hop: number) => hop < opts.trustProxy! : false });
  const store = new Store(opts.dbPath ?? ":memory:");
  const runner = new Runner(store, {
    concurrency: opts.concurrency ?? 2,
    maxQueue: opts.maxQueue ?? 20,
    timeoutMs: opts.runTimeoutMs ?? 120_000,
    onError: (error, what) => app.log.error({ err: error, what }, "database write failed"),
  });
  if (opts.staticDir && !existsSync(opts.staticDir)) {
    throw new Error(`STATIC_DIR "${opts.staticDir}" does not exist (build the web app first, or leave STATIC_DIR unset to serve the API only)`);
  }

  // Never send internals to clients: a full disk is "unavailable", anything else a plain 500.
  app.setErrorHandler((error: Error & { statusCode?: number; code?: string }, req, reply) => {
    const status = error.statusCode ?? 500;
    if (status < 500) return reply.send(error); // Fastify's own 4xx (bad JSON, 413, 429 ...)
    req.log.error({ err: error }, "request failed");
    if (error.code === "SQLITE_FULL") return reply.code(503).send({ error: "storage is full, try again later" });
    return reply.code(500).send({ error: "internal error" });
  });
  await app.register(rateLimit, { global: true, max: 300, timeWindow: "1 minute" });

  const bad = (issues: string[]) => ({ error: "invalid scenario", issues });

  app.get("/api/health", async () => ({ ok: true, engine: ENGINE_VERSION, pendingRuns: runner.pending, simRate: runner.simRate, limits: LIMITS }));

  app.get("/api/networks", async () =>
    CATALOG.map((e) => ({
      id: e.id, name: e.name, description: e.description, osm: e.osm,
      nodes: e.network.nodes.length, links: e.network.links.length,
      demandVph: e.demand.reduce((s, d) => s + d.rate, 0),
      toggles: e.toggles,
    })),
  );

  app.get<{ Params: { id: string } }>("/api/networks/:id", async (req, reply) => {
    const e = catalogEntry(req.params.id);
    if (!e) return reply.code(404).send({ error: "unknown network" });
    return { id: e.id, name: e.name, description: e.description, osm: e.osm, network: e.network, demand: e.demand, toggles: e.toggles };
  });

  app.post<{ Body: { scenario?: unknown } }>("/api/scenarios", { config: { rateLimit: { max: opts.saveRateLimit ?? 30, timeWindow: "1 minute" } } }, async (req, reply) => {
    try {
      const prep = prepareScenario(req.body?.scenario);
      const id = store.saveScenario(JSON.stringify(prep.scenario));
      return reply.code(201).send({ id });
    } catch (e) {
      if (e instanceof ScenarioError) return reply.code(400).send(bad(e.issues));
      throw e;
    }
  });

  app.get<{ Params: { id: string } }>("/api/scenarios/:id", async (req, reply) => {
    const json = store.getScenario(req.params.id);
    if (!json) return reply.code(404).send({ error: "unknown scenario" });
    return { id: req.params.id, scenario: JSON.parse(json) };
  });

  app.post<{ Body: { scenario?: unknown; scenarioId?: unknown } }>(
    "/api/runs",
    { config: { rateLimit: { max: opts.runRateLimit ?? 20, timeWindow: "1 minute" } } },
    async (req, reply) => {
      let input = req.body?.scenario;
      const scenarioId = req.body?.scenarioId ?? null;
      if (scenarioId !== null && (typeof scenarioId !== "string" || scenarioId.length > 64)) {
        return reply.code(400).send({ error: "invalid request", issues: ["scenarioId: expected a string of at most 64 characters"] });
      }
      if (scenarioId) {
        const json = store.getScenario(scenarioId);
        if (!json) return reply.code(404).send({ error: "unknown scenario" });
        input = JSON.parse(json);
      }
      let scenario;
      try {
        scenario = prepareScenario(input).scenario;
      } catch (e) {
        if (e instanceof ScenarioError) return reply.code(400).send(bad(e.issues));
        throw e;
      }
      const id = store.createRun(JSON.stringify(scenario), scenarioId as string | null);
      if (!runner.submit(id, scenario)) {
        store.finishRun(id, "failed", null, "server busy");
        return reply.code(503).send({ error: "server busy, try again shortly" });
      }
      return reply.code(202).send({ id, status: "queued" });
    },
  );

  app.get<{ Params: { id: string } }>("/api/runs/:id", async (req, reply) => {
    const r = store.getRun(req.params.id);
    if (!r) return reply.code(404).send({ error: "unknown run" });
    return {
      id: r.id, scenarioId: r.scenario_id, status: r.status, progress: r.progress,
      createdAt: r.created_at, finishedAt: r.finished_at,
      result: r.result ? JSON.parse(r.result) : undefined,
      error: r.error ?? undefined,
    };
  });

  if (opts.staticDir) {
    const root = resolve(opts.staticDir);
    await app.register(fastifyStatic, {
      root,
      // hashed asset names can be cached forever; index.html must always be revalidated
      cacheControl: false,
      setHeaders: (res, path) => void res.header("cache-control", path.includes("/assets/") ? "public, max-age=31536000, immutable" : "no-cache"),
    });
    app.addHook("onSend", async (_req, reply, payload) => {
      reply.header("x-content-type-options", "nosniff");
      reply.header("referrer-policy", "strict-origin-when-cross-origin");
      return payload;
    });
  }
  app.setNotFoundHandler((req, reply) => {
    if (req.url.startsWith("/api/") || !opts.staticDir || req.method !== "GET") return reply.code(404).send({ error: "not found" });
    return reply.sendFile("index.html");
  });

  return { app, store, runner };
}
