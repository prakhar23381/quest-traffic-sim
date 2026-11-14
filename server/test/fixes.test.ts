/** Regression tests for the release-readiness findings F-3, F-4, F-5, F-2, F-13. */
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { defaultScenario } from "@traffic/engine";
import { buildApp } from "../src/app";
import { ConfigError, loadConfig } from "../src/config";
import { MAX_RUNS, MAX_SCENARIOS, SCENARIO_RETENTION_MS, Store } from "../src/db";
import { Runner } from "../src/runner";
import { createShutdown } from "../src/shutdown";

const apps: { close: () => Promise<unknown> }[] = [];
afterEach(async () => {
  while (apps.length) await apps.pop()!.close();
});
const json = { "content-type": "application/json" };
const short = () => ({ ...defaultScenario("corridor"), durationS: 120 });
const sqliteFull = () => Object.assign(new Error("database or disk is full"), { code: "SQLITE_FULL" });

describe("F-3: a full or failing database never takes the process down", () => {
  it("runner: failing store writes are reported and the job slot is released", async () => {
    const store = new Store(":memory:");
    const onError = vi.fn();
    const runner = new Runner(store, { concurrency: 1, maxQueue: 5, timeoutMs: 60_000, onError });
    store.setProgress = () => {
      throw sqliteFull();
    };
    store.finishRun = () => {
      throw sqliteFull();
    };
    const id = store.createRun(JSON.stringify(short()), null);
    expect(runner.submit(id, short())).toBe(true);
    const t0 = Date.now();
    while (runner.pending > 0 && Date.now() - t0 < 30_000) await new Promise((r) => setTimeout(r, 50));
    expect(runner.pending).toBe(0); // the slot came back, so later runs still work
    expect(onError.mock.calls.some(([, what]) => what === "finishRun")).toBe(true);
    // reaching this line at all proves there was no uncaught exception (vitest fails the file on one)
  }, 60_000);

  it("API: SQLITE_FULL on a write is a 503 with no internals, not a crash or a 500", async () => {
    const { app, store } = await buildApp();
    apps.push(app);
    store.saveScenario = () => {
      throw sqliteFull();
    };
    const r = await app.inject({ method: "POST", url: "/api/scenarios", headers: json, payload: JSON.stringify({ scenario: short() }) });
    expect(r.statusCode).toBe(503);
    expect(r.body).not.toMatch(/SQLITE|database|disk is full\b.*Error/);
    expect(r.json().error).toMatch(/storage is full/);
    // and the app is still serving
    expect((await app.inject("/api/health")).statusCode).toBe(200);
  });

  it("API: any other unexpected error is a plain 500 'internal error'", async () => {
    const { app, store } = await buildApp();
    apps.push(app);
    store.saveScenario = () => {
      throw new Error("boom at /Users/x/secret.ts:12");
    };
    const r = await app.inject({ method: "POST", url: "/api/scenarios", headers: json, payload: JSON.stringify({ scenario: short() }) });
    expect(r.statusCode).toBe(500);
    expect(r.json()).toEqual({ error: "internal error" });
  });

  it("store: scenarios older than the retention window are deleted", () => {
    const store = new Store(":memory:");
    const now = Date.now();
    store.db.prepare("INSERT INTO scenarios (id, created_at, json) VALUES ('old', ?, '{}')").run(now - SCENARIO_RETENTION_MS - 1000);
    store.db.prepare("INSERT INTO scenarios (id, created_at, json) VALUES ('new', ?, '{}')").run(now);
    store.prune(now);
    expect(store.getScenario("old")).toBeNull();
    expect(store.getScenario("new")).toBe("{}");
  });

  it("store: the number of saved scenarios and finished runs is capped, oldest first", () => {
    const store = new Store(":memory:");
    const now = Date.now();
    const insS = store.db.prepare("INSERT INTO scenarios (id, created_at, json) VALUES (?, ?, '{}')");
    const insR = store.db.prepare("INSERT INTO runs (id, scenario_json, status, created_at, finished_at, progress) VALUES (?, '{}', 'done', ?, ?, 1)");
    store.db.transaction(() => {
      for (let i = 0; i < MAX_SCENARIOS + 50; i++) insS.run(`s${i}`, now - 1000 + i);
      for (let i = 0; i < MAX_RUNS + 50; i++) insR.run(`r${i}`, now - 1000 + i, now - 1000 + i);
    })();
    store.prune(now);
    const count = (t: string) => (store.db.prepare(`SELECT COUNT(*) c FROM ${t}`).get() as { c: number }).c;
    expect(count("scenarios")).toBe(MAX_SCENARIOS - 1); // room for the row about to be inserted
    expect(count("runs")).toBe(MAX_RUNS - 1);
    expect(store.getScenario("s0")).toBeNull(); // oldest gone
    expect(store.getScenario(`s${MAX_SCENARIOS + 49}`)).toBe("{}"); // newest kept
  });

  it("store: unfinished runs can be failed in one call (used on shutdown)", () => {
    const store = new Store(":memory:");
    const a = store.createRun("{}", null);
    const b = store.createRun("{}", null);
    store.setProgress(b, 0.4);
    store.failUnfinished("server shut down");
    expect(store.getRun(a)).toMatchObject({ status: "failed", error: "server shut down" });
    expect(store.getRun(b)).toMatchObject({ status: "failed", error: "server shut down" });
  });
});

describe("F-4 / F-13: configuration is validated at startup", () => {
  const ok = (env: Record<string, string>) => loadConfig(env);
  const bad = (env: Record<string, string>) => {
    try {
      loadConfig(env);
    } catch (e) {
      if (e instanceof ConfigError) return e.problems.join(" | ");
      throw e;
    }
    throw new Error("expected a ConfigError for " + JSON.stringify(env));
  };

  it("defaults when nothing is set, and empty counts as unset", () => {
    expect(ok({})).toMatchObject({ port: 8080, dbPath: "traffic.db", trustProxy: 0, concurrency: 2, maxQueue: 20, runTimeoutMs: 120_000 });
    expect(ok({ PORT: "", RUN_CONCURRENCY: " ", DB_PATH: "" })).toMatchObject({ port: 8080, concurrency: 2, dbPath: "traffic.db" });
  });

  it("accepts the values render.yaml and the Dockerfile use", () => {
    expect(ok({ PORT: "7860", TRUST_PROXY: "1", RUN_CONCURRENCY: "1", RUN_MAX_QUEUE: "5", RUN_TIMEOUT_MS: "90000" })).toMatchObject({
      port: 7860, trustProxy: 1, concurrency: 1, maxQueue: 5, runTimeoutMs: 90_000,
    });
  });

  it.each([
    ["PORT", "abc"], ["PORT", "-5"], ["PORT", "0"], ["PORT", "99999"], ["PORT", "80.5"], ["PORT", "1e3"],
    ["RUN_CONCURRENCY", "abc"], ["RUN_CONCURRENCY", "0"], ["RUN_CONCURRENCY", "-1"], ["RUN_CONCURRENCY", "999"],
    ["RUN_MAX_QUEUE", "abc"], ["RUN_MAX_QUEUE", "0"],
    ["RUN_TIMEOUT_MS", "abc"], ["RUN_TIMEOUT_MS", "0"], ["RUN_TIMEOUT_MS", "10"],
    ["TRUST_PROXY", "abc"], ["TRUST_PROXY", "-1"], ["TRUST_PROXY", "9"],
  ])("%s=%s is rejected with a message naming it", (k, v) => {
    expect(bad({ [k]: v })).toContain(`${k}="${v}"`);
  });

  it("reports every problem at once", () => {
    const msg = bad({ PORT: "abc", RUN_CONCURRENCY: "0", RUN_TIMEOUT_MS: "x" });
    expect(msg).toMatch(/PORT.*RUN_CONCURRENCY.*RUN_TIMEOUT_MS/);
  });

  it("F-5: STATIC_DIR must be an existing directory", () => {
    expect(bad({ STATIC_DIR: "/nonexistent/web" })).toContain("STATIC_DIR");
    const dir = mkdtempSync(join(tmpdir(), "cfg-"));
    const file = join(dir, "f.txt");
    writeFileSync(file, "x");
    expect(bad({ STATIC_DIR: file })).toContain("STATIC_DIR"); // a file is not a directory
    expect(ok({ STATIC_DIR: dir }).staticDir).toBe(dir);
  });

  it("F-5: buildApp itself refuses a missing staticDir instead of answering every page with a 500", async () => {
    await expect(buildApp({ staticDir: "/nonexistent/web" })).rejects.toThrow(/STATIC_DIR/);
  });
});

describe("F-2: graceful shutdown", () => {
  const deps = () => ({ close: vi.fn(async () => {}), failUnfinished: vi.fn(), exit: vi.fn() });

  it("closes the server, fails unfinished runs, then exits 0", async () => {
    const d = deps();
    await createShutdown(d)("SIGTERM");
    expect(d.close).toHaveBeenCalledOnce();
    expect(d.failUnfinished).toHaveBeenCalledWith("server shut down");
    expect(d.exit).toHaveBeenCalledWith(0);
    expect(d.close.mock.invocationCallOrder[0]).toBeLessThan(d.exit.mock.invocationCallOrder[0]!);
  });

  it("a second signal does nothing while the first is handled", async () => {
    const d = deps();
    const sd = createShutdown(d);
    await Promise.all([sd("SIGTERM"), sd("SIGINT")]);
    expect(d.close).toHaveBeenCalledOnce();
    expect(d.exit).toHaveBeenCalledOnce();
  });

  it("still exits if closing fails or the database is unavailable", async () => {
    const d = { ...deps(), close: vi.fn(async () => { throw new Error("x"); }), failUnfinished: vi.fn(() => { throw sqliteFull(); }) };
    await createShutdown(d)("SIGTERM");
    expect(d.exit).toHaveBeenCalledWith(1);
  });

  it("gives up waiting after the grace period", async () => {
    vi.useFakeTimers();
    const d = { ...deps(), close: vi.fn(() => new Promise<void>(() => {})), graceMs: 1000 };
    void createShutdown(d)("SIGTERM");
    await vi.advanceTimersByTimeAsync(1100);
    expect(d.exit).toHaveBeenCalledWith(1);
    vi.useRealTimers();
  });
});
