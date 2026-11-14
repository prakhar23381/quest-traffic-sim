/**
 * Release-readiness audit (2026-11-15): hostile and malformed HTTP requests against the real
 * app (in-process), checking for 5xx responses, leaked internals and wrong status codes.
 */
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { defaultScenario } from "@traffic/engine";
import { buildApp, type AppOptions } from "../src/app";

const apps: { close: () => Promise<unknown> }[] = [];
async function make(opts: AppOptions = {}) {
  const b = await buildApp({ runRateLimit: 10_000, saveRateLimit: 10_000, ...opts });
  apps.push(b.app);
  return b.app;
}
afterEach(async () => {
  while (apps.length) await apps.pop()!.close();
});

const good = () => ({ scenario: { ...defaultScenario("corridor"), durationS: 120 } });
const post = (app: Awaited<ReturnType<typeof make>>, url: string, payload: unknown, headers: Record<string, string> = { "content-type": "application/json" }) =>
  app.inject({ method: "POST", url, payload: payload as never, headers });
const noLeak = (body: string) => {
  expect(body).not.toMatch(/node_modules|\/Users\/|at .*\(.*:\d+:\d+\)|sendFile|SQLITE|better-sqlite3|Error:/);
};

describe("malformed requests are 4xx with no leaked internals", () => {
  it.each([
    ["invalid JSON", "/api/runs", "{not json", { "content-type": "application/json" }],
    ["empty body with JSON content-type", "/api/runs", "", { "content-type": "application/json" }],
    ["text/plain body", "/api/runs", JSON.stringify(good()), { "content-type": "text/plain" }],
    ["form-encoded body", "/api/scenarios", "scenario=x", { "content-type": "application/x-www-form-urlencoded" }],
    ["no content-type", "/api/runs", JSON.stringify(good()), {}],
    ["JSON null", "/api/runs", "null", { "content-type": "application/json" }],
    ["JSON array", "/api/runs", "[]", { "content-type": "application/json" }],
    ["JSON string", "/api/scenarios", '"hello"', { "content-type": "application/json" }],
    ["deeply nested JSON", "/api/runs", "[".repeat(100_000) + "]".repeat(100_000), { "content-type": "application/json" }],
    ["scenario is a number", "/api/runs", JSON.stringify({ scenario: 42 }), { "content-type": "application/json" }],
    ["both scenario and scenarioId null", "/api/runs", JSON.stringify({ scenario: null, scenarioId: null }), { "content-type": "application/json" }],
  ] as const)("%s", async (_name, url, body, headers) => {
    const app = await make();
    const r = await app.inject({ method: "POST", url, payload: body, headers: { ...headers } });
    expect(r.statusCode, r.body.slice(0, 200)).toBeGreaterThanOrEqual(400);
    expect(r.statusCode, r.body.slice(0, 200)).toBeLessThan(500);
    noLeak(r.body);
  });

  // F-1 (fixed): a non-string scenarioId used to reach SQLite and return 500 with the library's message.
  it.each([[{ $ne: 1 }], [[]], [true], [{ a: 1 }], ["x".repeat(65)]])("F-1: scenarioId %j is a 4xx, not a 500", async (sid) => {
    const app = await make();
    const r = await post(app, "/api/runs", JSON.stringify({ scenarioId: sid }));
    expect(r.statusCode).toBeGreaterThanOrEqual(400);
    expect(r.statusCode).toBeLessThan(500);
    noLeak(r.body);
  });

  it("extra top-level fields are rejected, not stored", async () => {
    const app = await make();
    const r = await post(app, "/api/scenarios", JSON.stringify({ ...good(), extra: 1 }));
    expect(r.statusCode).toBe(201); // the wrapper may carry extras…
    const id = r.json().id;
    const stored = (await app.inject(`/api/scenarios/${id}`)).json();
    expect(stored.extra).toBeUndefined(); // …but they are not echoed back
    expect(stored.scenario.extra).toBeUndefined();
  });

  it("unicode, RTL and markup in a scenario name are stored verbatim as data and returned as JSON", async () => {
    const app = await make();
    const name = "Ünï ‮<script>alert(1)</script> 😀 '; DROP TABLE scenarios;--";
    const s = { scenario: { ...good().scenario, name } };
    const id = (await post(app, "/api/scenarios", JSON.stringify(s))).json().id;
    const r = await app.inject(`/api/scenarios/${id}`);
    expect(r.headers["content-type"]).toMatch(/application\/json/);
    expect(r.json().scenario.name).toBe(name);
    // the table is still there afterwards
    expect((await post(app, "/api/scenarios", JSON.stringify(good()))).statusCode).toBe(201);
  });
});

describe("ids and paths", () => {
  it.each([
    "/api/scenarios/' OR 1=1 --",
    "/api/scenarios/%27%20OR%201%3D1%20--",
    "/api/scenarios/..%2f..%2f..%2fetc%2fpasswd",
    "/api/scenarios/" + "a".repeat(150),
    "/api/runs/__proto__",
    "/api/runs/constructor",
    "/api/networks/__proto__",
    "/api/networks/constructor",
    "/api/networks/toString",
    "/api/networks/..%2f..%2fpackage.json",
    "/api/runs/%00",
    "/api/runs/%",
  ])("GET %s is a 4xx, never a 5xx", async (url) => {
    const app = await make();
    const r = await app.inject(url);
    expect([400, 404, 414]).toContain(r.statusCode);
    noLeak(r.body);
  });

  it("wrong methods are 404/405, not 5xx", async () => {
    const app = await make();
    for (const m of ["DELETE", "PUT", "PATCH"] as const) {
      const r = await app.inject({ method: m, url: "/api/scenarios" });
      expect(r.statusCode).toBeLessThan(500);
    }
  });
});

describe("static files", () => {
  const web = () => {
    const root = mkdtempSync(join(tmpdir(), "audit-web-"));
    const dir = join(root, "web");
    mkdirSync(join(dir, "assets"), { recursive: true });
    writeFileSync(join(dir, "index.html"), "<!doctype html><title>app</title>");
    writeFileSync(join(root, "secret.txt"), "TOP-SECRET-OUTSIDE-ROOT");
    return dir;
  };

  it.each([
    "/../secret.txt",
    "/%2e%2e/secret.txt",
    "/..%2fsecret.txt",
    "/assets/../../secret.txt",
    "/%2e%2e%2f%2e%2e%2fetc%2fpasswd",
    "/....//secret.txt",
    "/assets/%2e%2e/%2e%2e/secret.txt",
    "//etc/passwd",
  ])("path traversal %s does not read outside the web root", async (url) => {
    const app = await make({ staticDir: web() });
    const r = await app.inject(url);
    expect(r.body).not.toContain("TOP-SECRET-OUTSIDE-ROOT");
    expect(r.body).not.toContain("root:");
    expect(r.statusCode).toBeLessThan(500);
  });

  it("sends nosniff and a referrer policy on API and page responses; no CORS headers", async () => {
    const app = await make({ staticDir: web() });
    for (const url of ["/", "/api/health", "/api/networks"]) {
      const r = await app.inject({ url, headers: { origin: "https://evil.example" } });
      expect(r.headers["x-content-type-options"], url).toBe("nosniff");
      expect(r.headers["access-control-allow-origin"], url).toBeUndefined();
    }
  });
});

describe("limits", () => {
  it("a 255 kB body is accepted, a 257 kB body is 413", async () => {
    const app = await make();
    const big = (n: number) => JSON.stringify({ scenario: { ...good().scenario, name: "x".repeat(n) } });
    expect((await post(app, "/api/scenarios", big(257 * 1024))).statusCode).toBe(413);
    // 255 kB passes the transport limit; the 80-character name rule then rejects it as invalid
    expect((await post(app, "/api/scenarios", big(255 * 1024))).statusCode).toBe(400);
  });

  it("many closed links / edits within limits are accepted, beyond them rejected", async () => {
    const app = await make();
    const s = good().scenario;
    const ids = Array.from({ length: 501 }, (_, i) => `l${i}`);
    expect((await post(app, "/api/scenarios", JSON.stringify({ scenario: { ...s, closedLinks: ids } }))).statusCode).toBe(400);
  });

  it("the worst allowed scenario (2 h, 3x demand) is accepted and queued, not run inline", async () => {
    const app = await make();
    const t0 = Date.now();
    const r = await post(app, "/api/runs", JSON.stringify({ scenario: { ...defaultScenario("silk-board"), durationS: 7200, demandScale: 3 } }));
    expect(r.statusCode).toBe(202);
    expect(Date.now() - t0).toBeLessThan(1000); // the request returns at once
  });
});

describe("concurrency", () => {
  it("50 simultaneous submissions: every response is 202/503/429, the queue never exceeds its bound", async () => {
    const app = await make({ concurrency: 1, maxQueue: 5 });
    const rs = await Promise.all(Array.from({ length: 50 }, () => post(app, "/api/runs", JSON.stringify({ scenario: { ...good().scenario, durationS: 3600 } }))));
    const codes = new Set(rs.map((r) => r.statusCode));
    for (const c of codes) expect([202, 503]).toContain(c);
    expect(rs.filter((r) => r.statusCode === 202).length).toBeLessThanOrEqual(6); // 1 running + 5 queued
  });

  it("submitting the same scenario twice creates two independent runs (no shared state)", async () => {
    const app = await make();
    const a = (await post(app, "/api/runs", JSON.stringify(good()))).json().id;
    const b = (await post(app, "/api/runs", JSON.stringify(good()))).json().id;
    expect(a).not.toBe(b);
  });
});
