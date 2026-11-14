import { afterEach, describe, expect, it } from "vitest";
import { defaultScenario, runScenario } from "@traffic/engine";
import { buildApp, type AppOptions } from "../src/app";

const apps: { close: () => Promise<unknown> }[] = [];
async function make(opts: AppOptions = {}) {
  const built = await buildApp(opts);
  apps.push(built.app);
  return built;
}
afterEach(async () => {
  while (apps.length) await apps.pop()!.close();
});

const short = (over: Record<string, unknown> = {}) => ({ ...defaultScenario("corridor"), durationS: 300, ...over });

async function waitForRun(app: Awaited<ReturnType<typeof make>>["app"], id: string, timeoutMs = 60_000) {
  const t0 = Date.now();
  for (;;) {
    const r = (await app.inject({ method: "GET", url: `/api/runs/${id}` })).json();
    if (r.status === "done" || r.status === "failed") return r;
    if (Date.now() - t0 > timeoutMs) throw new Error(`run ${id} did not finish: ${JSON.stringify(r)}`);
    await new Promise((res) => setTimeout(res, 50));
  }
}

describe("read-only endpoints", () => {
  it("health and the network list", async () => {
    const { app } = await make();
    expect((await app.inject("/api/health")).json().ok).toBe(true);
    const list = (await app.inject("/api/networks")).json();
    expect(list.map((n: { id: string }) => n.id)).toContain("silk-board");
    const sb = (await app.inject("/api/networks/silk-board")).json();
    expect(sb.osm).toBe(true);
    expect(sb.network.links.length).toBeGreaterThan(50);
    expect((await app.inject("/api/networks/atlantis")).statusCode).toBe(404);
  });
});

describe("scenarios", () => {
  it("rejects invalid scenarios with the engine's messages", async () => {
    const { app } = await make();
    const r = await app.inject({ method: "POST", url: "/api/scenarios", payload: { scenario: short({ closedLinks: ["nope"] }) } });
    expect(r.statusCode).toBe(400);
    expect(r.json().issues.join()).toMatch(/unknown link "nope"/);
    expect((await app.inject({ method: "POST", url: "/api/scenarios", payload: {} })).statusCode).toBe(400);
  });

  it("stores a valid scenario (normalised, defaults filled) and returns it by id", async () => {
    const { app } = await make();
    const input = { version: 1, name: "Mine", networkId: "corridor", seed: 4, durationS: 600, demandScale: 1.2 };
    const r = await app.inject({ method: "POST", url: "/api/scenarios", payload: { scenario: input } });
    expect(r.statusCode).toBe(201);
    const got = (await app.inject(`/api/scenarios/${r.json().id}`)).json();
    expect(got.scenario).toMatchObject({ ...input, closedLinks: [], togglesOff: [], retimeSignals: false });
    expect((await app.inject("/api/scenarios/does-not-exist")).statusCode).toBe(404);
  });

  it("rejects oversized bodies", async () => {
    const { app } = await make();
    const big = { scenario: short({ name: "x".repeat(300_000) }) };
    expect((await app.inject({ method: "POST", url: "/api/scenarios", payload: big })).statusCode).toBe(413);
  });
});

describe("runs", () => {
  it("runs a scenario in a worker thread with a result identical to the engine's", async () => {
    const { app } = await make();
    const scenario = short({ seed: 9 });
    const r = await app.inject({ method: "POST", url: "/api/runs", payload: { scenario } });
    expect(r.statusCode).toBe(202);
    const done = await waitForRun(app, r.json().id);
    expect(done.status).toBe("done");
    expect(done.progress).toBe(1);
    expect(done.result.kpis.completed).toBeGreaterThan(0);
    // Browser/server parity: the same scenario run directly gives a bit-identical state.
    expect(done.result.stateHash).toBe(runScenario(scenario).stateHash);
  });

  it("runs a stored scenario by id", async () => {
    const { app } = await make();
    const sid = (await app.inject({ method: "POST", url: "/api/scenarios", payload: { scenario: short() } })).json().id;
    const r = await app.inject({ method: "POST", url: "/api/runs", payload: { scenarioId: sid } });
    expect(r.statusCode).toBe(202);
    const done = await waitForRun(app, r.json().id);
    expect(done.status).toBe("done");
    expect(done.scenarioId).toBe(sid);
    expect((await app.inject({ method: "POST", url: "/api/runs", payload: { scenarioId: "nope" } })).statusCode).toBe(404);
  });

  it("refuses work when the queue is full", async () => {
    const { app } = await make({ concurrency: 1, maxQueue: 1 });
    const post = () => app.inject({ method: "POST", url: "/api/runs", payload: { scenario: short({ durationS: 3600 }) } });
    const codes = [(await post()).statusCode, (await post()).statusCode, (await post()).statusCode];
    expect(codes).toEqual([202, 202, 503]);
  });

  it("fails a run that exceeds the wall-clock limit", async () => {
    const { app } = await make({ runTimeoutMs: 300 });
    const r = await app.inject({ method: "POST", url: "/api/runs", payload: { scenario: { ...defaultScenario("silk-board"), durationS: 7200 } } });
    const done = await waitForRun(app, r.json().id);
    expect(done.status).toBe("failed");
    expect(done.error).toMatch(/timed out/);
  });

  it("rate-limits run submissions per client", async () => {
    const { app } = await make({ runRateLimit: 2 });
    const post = () => app.inject({ method: "POST", url: "/api/runs", payload: { scenario: short() } });
    const codes = [(await post()).statusCode, (await post()).statusCode, (await post()).statusCode];
    expect(codes).toEqual([202, 202, 429]);
  });
});

describe("static web app", () => {
  it("serves the built app at / and falls back to index.html, but never for /api", async () => {
    const { mkdtempSync, writeFileSync, mkdirSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const dir = mkdtempSync(join(tmpdir(), "web-"));
    writeFileSync(join(dir, "index.html"), "<!doctype html><title>app</title>");
    mkdirSync(join(dir, "assets"));
    writeFileSync(join(dir, "assets", "a.js"), "1");
    const { app } = await make({ staticDir: dir });
    const home = await app.inject("/");
    expect(home.statusCode).toBe(200);
    expect(home.body).toContain("<title>app</title>");
    expect(home.headers["cache-control"]).toBe("no-cache");
    expect((await app.inject("/assets/a.js")).headers["cache-control"]).toContain("immutable");
    expect((await app.inject("/some/page?id=x")).body).toContain("<title>app</title>");
    expect((await app.inject("/api/nope")).statusCode).toBe(404);
    expect((await app.inject("/api/nope")).json().error).toBe("not found");
  });
});

describe("speed report", () => {
  it("health reports the measured simulation speed after a run", async () => {
    const { app } = await make();
    expect((await app.inject("/api/health")).json().simRate).toBeNull();
    const r = await app.inject({ method: "POST", url: "/api/runs", payload: { scenario: short() } });
    await waitForRun(app, r.json().id);
    expect((await app.inject("/api/health")).json().simRate).toBeGreaterThan(1);
  });
});
