# Release readiness: Junction Lab

Audited 15 Nov 2026, from 00:04 IST, commit `2502056` (HEAD of `main`), by a Claude session.
Branch: `release-readiness/2026-11-15` (new tests and manifests only; **no application source was changed**).

**Target:** one Docker image on Render's free tier (`render.yaml`, auto-deploy on push to `main`).
**Criticality:** public demo for a job application. No accounts, money or personal data; the server stores scenario JSON and run results.
**Constraints:** no production contact (all tests ran on local builds and containers), about a 1-hour budget, deadline 15 Nov.

## 1. Verdict: GO-WITH-CONDITIONS

- No blocker under the stated rules: the clean-room build, type checks and all 99 existing tests (87 engine, 12 server) pass; `npm audit` reports 0 vulnerabilities; no secrets in the tree or in 15 commits of history; no reachable exploit found; a deploy → rollback rehearsal over one database kept data readable in both directions.
- One **High** and seven **Medium** findings remain. The High (F-3) lets a single unauthenticated client crash the server by filling its disk; on Render the crash is self-healing (restart, ephemeral disk), so the impact is downtime, not data loss.
- Conditions before relying on it for real traffic: fix F-3, F-1 and F-4 (each a few lines); the rest are recommended. Whether to fix them before the application deadline is the owner's call.

## 1b. Update: fixes applied (branch `fix/audit-findings`)

The recommended findings were fixed after the audit and each fix was re-verified against the **built Docker image**, not only in unit tests. Where the new tests guard a fix, they were also run against the old code and fail there.

| Finding | Status | Re-verification |
|---|---|---|
| F-3 disk full crashes the server | **Fixed** | tmpfs 300 kB, 8 runs submitted: container stays up, writes answer `503 storage is full`, health stays ok, 30 write failures logged. Scenarios and runs are now pruned and capped. Old runner code fails the new test. |
| F-1 non-string `scenarioId` → 500 | **Fixed** | `{"a":1}`, `[]`, `true` → `400` with a clear message; 5 tests (they failed against the old code). Unexpected errors now return a plain `{"error":"internal error"}`. |
| F-4 bad run-limit settings | **Fixed** | 18 malformed values rejected by unit tests; in the image, `RUN_CONCURRENCY=abc/0`, `RUN_TIMEOUT_MS=abc`, `RUN_MAX_QUEUE=abc`, `PORT=abc` exit with code 2 and a message naming the setting. |
| F-13 empty `PORT` | **Fixed** | empty means unset (default), not a random port |
| F-5 missing `STATIC_DIR` | **Fixed** | the image exits 2 at startup; `buildApp` also refuses it |
| F-2 SIGTERM ignored | **Fixed** | `docker stop` with a run in flight: 195 ms, exit 0 (was 10 s, 137); the run is recorded as `failed: server shut down` |
| F-9 accessibility (3 violations + 1 false positive) | **Fixed** | axe on 5 views × 2 themes + phone: **0 violations**, 0 console errors; button label contrast unchanged at 5.74:1 |
| F-6 no CI, auto-deploy untested | Open | needs a workflow and a Render setting (deploy only after checks pass) |
| F-7 / F-8 base-image CVEs, unpinned tag | Open | Alpine variant tested (0 HIGH/CRITICAL, 286 MB, identical results) but not applied: it changes the production image |
| F-10 web has no tests, 8 lint warnings | Open | unchanged |
| F-11 / F-12 headers, logging, runbook | Open (info) | unchanged |

**New residual risk found while fixing F-3:** when the disk is full, a run already in flight cannot store its result, so it shows `running` until the next restart. The server stays up and new writes fail cleanly; the web app's Auto mode abandons a stalled server run after 15 s and reruns it in the browser, but "Run on: The server" waits indefinitely.

**Updated verdict: GO.** The three conditions in section 1 (F-3, F-1, F-4) are met; the open items are recommendations. Tests after the fixes: engine 92, server 90 (all pass); types, build and lint (8 pre-existing warnings, 0 errors) unchanged.

## 2. Summary

| Phase | Status | Key evidence |
|---|---|---|
| 0 Discovery | PASS | repo map and plan agreed before heavy phases |
| 1 Clean-room build | PASS | fresh clone, `npm ci` 3 s from lockfile, 3 workspaces build, image builds from the clone (397 MB) |
| 2 Static analysis | PARTIAL | type checks pass (engine, server, web); oxlint: 0 errors, 8 warnings (F-10); TODO/FIXME: 0. **SKIPPED:** unused-dependency and circular-import tools |
| 3 Automated tests | PASS | 3 normal + 2 shuffled (two seeds) runs of each suite, identical, **0 flaky**; engine 98 % lines / 92 % branches, server 91 % / 76 %; 64,000 fuzz inputs and 480 random simulations, 0 failures. **SKIPPED:** mutation testing |
| 4 Behavioural | PASS (1 finding) | 43 hostile-HTTP tests, deploy-image smoke (health, page, run), cross-platform determinism; F-1 |
| 5 Security | PASS (findings F-7, F-8, F-11) | npm audit 0; gitleaks 0 (tree + history); semgrep 0 (canary proved rules load); trivy: 39 base-OS and 10 npm-internal HIGH/CRITICAL, none fixable by us; 82-component SBOM, licences MIT/ISC/BSD/BlueOak |
| 6 Data & migrations | N/A, adapted | no migrations exist; schema unchanged across versions; old↔new image rehearsal passed; read-only/missing DB path fails fast |
| 7 Config | FAIL (F-4, F-5, F-13) | 4 of 10 malformed settings leave the server up but broken |
| 8 Resilience | FAIL (F-2, F-3) | SIGTERM ignored; disk-full crashes the process; kill -9 recovery works |
| 9 Performance | PASS (limited) | local: 2,900–7,700 req/s; at free-tier CPU 14–46 req/s, 0 errors; 200 s soak, flat threads/handles, memory 115→164 MiB then plateau |
| 10 Deployment | PARTIAL | production image run with its health check; rollback rehearsal local. **SKIPPED:** Render rollback, CI dry-run (none exists, F-6) |
| 11 Observability | PARTIAL | structured JSON logs with request IDs, no secrets; no metrics/alerts (F-12) |
| 12 Frontend | PARTIAL (F-9) | axe on 5 views × 2 themes + phone: 3 real violations, 1 false positive; 0 console errors; 0 failed requests; no horizontal overflow at 390 px. Chromium only |

## 3. Findings

### F-3 · High · Disk full crashes the whole server
`Store.setProgress` / `finishRun` run inside the worker `message` handler with no error handling, so `SQLITE_FULL` is an uncaught exception and Node exits (`server/src/runner.ts:67,73,75`). Saved scenarios are never pruned (only runs are, after 24 h, `server/src/db.ts`), so disk use can grow without bound: at the 30/min per-client limit and up to ~10 kB per scenario (500 duplicate link ids pass validation; *estimate, not load-tested*), one client writes about 0.3 MB/min (roughly 400 MB/day).
**Reproduce:** `docker run --tmpfs /tmp:size=300k -p 7871:7860 junction-lab:audit`, then POST three 30-minute Silk Board runs to `/api/runs`.
**Evidence:** container `exited`; log `SqliteError: database or disk is full … at Store.setProgress`.
**Fix:** wrap the three store calls in try/catch (fail the run, log), add a `process.on("uncaughtException")` guard, prune scenarios too, and cap total stored bytes.

### F-1 · Medium · Non-string `scenarioId` returns 500 and leaks a library message
`POST /api/runs` passes `req.body.scenarioId` straight to SQLite (`server/src/app.ts:93-95`).
**Reproduce:** `curl -X POST :PORT/api/runs -H 'content-type: application/json' -d '{"scenarioId":{"a":1}}'` (also `[]` and `true`).
**Evidence:** `500 {"message":"Too few parameter values were provided"}`. Queries are parameterised (`{"$ne":1}` is not interpreted), so no injection or data exposure.
**Fix:** validate the body with zod (`scenarioId: z.string().max(64).optional()`) → 400. Test already in `server/test/audit.test.ts` as `it.fails`.

### F-4 · Medium · Invalid run-limit settings start a "healthy" server that cannot work
`Number()` of a bad value gives `NaN`/`0` (`server/src/index.ts:9-11`):
`RUN_CONCURRENCY=abc|0|""` → every run stays `queued` forever; `RUN_TIMEOUT_MS=abc|0` → every run fails with "timed out after NaN s"; `RUN_MAX_QUEUE=abc` → by code reading, the queue limit disappears (`NaN` comparisons are false; not observable over HTTP because the per-client rate limit hits first). `/api/health` reports ok in all cases.
**Reproduce:** `RUN_CONCURRENCY=abc node server/dist/index.js`, submit a run, poll it.
**Fix:** parse with zod/`Number.isInteger` and exit with a clear message. (`render.yaml` sets valid values, so this does not affect the current deployment.)

### F-2 · Medium · No graceful shutdown; SIGTERM is ignored
No signal handler (`server/src/index.ts`) and Node runs as PID 1 (`Dockerfile:36`), which ignores unhandled SIGTERM.
**Reproduce:** start the image, `time docker stop <name>`.
**Evidence:** 10 s, exit code 137 (killed). In-flight requests and runs are cut off; every deploy waits out the grace period.
**Fix:** handle SIGTERM/SIGINT (`app.close()`, then exit) or run with `--init`/tini.

### F-5 · Medium · Missing `STATIC_DIR` gives 500 on every page, with an internal message
When `STATIC_DIR` is set but absent the static plugin is not registered, yet the not-found handler still calls `reply.sendFile` (`server/src/app.ts:126,140`).
**Reproduce:** `STATIC_DIR=/nonexistent node server/dist/index.js; curl :PORT/`.
**Evidence:** `500 {"message":"reply.sendFile is not a function"}`. Should fail at startup.

### F-6 · Medium · No CI; every push to `main` deploys untested
No `.github/` and `autoDeploy: true` (`render.yaml`). A failing build or test would still go live.
**Fix:** a workflow running `npm ci && npm test && npm run build` on push and PR; set Render to deploy only after checks pass.

### F-7 · Medium · 39 HIGH/CRITICAL OS-package CVEs in the image, none fixable today
Trivy on the production image (Debian 12.15): 39 HIGH/CRITICAL (12 distinct CVEs; 1 CRITICAL, `CVE-2023-45853` in zlib's minizip zip-*writing* function), **0 with a fixed version**; plus 10 HIGH in npm's own bundled packages (`/usr/local/lib/node_modules/npm`, not in the app). Not reachable through the app's interfaces (it only runs `node server/index.js` as uid 1000 and unpacks no archives); this is judgement, not proof.
**Mitigation tested (scratch copy, not applied):** `node:22-alpine` + removing npm: 0 HIGH/CRITICAL, 286 MB, same health check, and the same simulation hash (`237b7885`) as the Debian image and the macOS host.

### F-9 · Medium · Accessibility: 3 real axe violations
(a) `<dl class="hud-stats">` directly contains the Live badge `<span role="status">` (`web/src/App.tsx:273`), *serious*. (b) On phones the Speed `<select>` loses its visible label (`.speed > span {display:none}`) and has no accessible name (`App.tsx:261-263`), *critical*. (c) The tooltip layer sits outside any landmark, *moderate*.
**Reproduce:** run axe-core 4.10 on the built app at 1440 px (a) and 390 px (b).
A fourth report (`color-contrast` on the "· 1:00:00" part of the Run button) is a **false positive**: rendered pixels measure 5.74:1 (AA needs 4.5).

### F-8 · Low · Base image tag not pinned
`FROM node:22-bookworm-slim` (`Dockerfile:5,20`) floats; builds are not reproducible. Pin by digest.

### F-10 · Low · Web app has no tests; 8 lint warnings
Zero tests under `web/`. oxlint: 4× refs read during render and 1× setState-in-effect (`web/src/components/MapView.tsx:43-54`), 3× non-component exports in `Results.tsx`. Behaviour was checked only through browser scripts.

### F-13 · Low · `PORT=""` listens on a random port
`Number("") === 0`. Render sets `PORT`, so not an issue there.

### F-11 · Info · Security headers
Responses carry `x-content-type-options: nosniff` and `referrer-policy`; no CSP or frame protection. No CORS headers are sent (so cross-origin pages cannot read the API). HSTS was not checked (it is applied by Render's proxy; production was out of scope).

### F-12 · Info · Operations
Logs are JSON with a request ID on every line; they include client IP addresses and no scenario content. `TRUST_PROXY=1` is correct only behind exactly one proxy (Render); a container exposed directly would let clients forge their address and dodge rate limits. `/api/health` is public and discloses limits and queue depth. No metrics or alerts exist. The README Deploy section covers setup but has no rollback or failure runbook.

## 4. Flaky tests, coverage gaps, untested areas
- **Flaky:** none (engine and server suites: 3 normal and 2 shuffled runs each, identical results). Engine tests are deterministic (seeded); the few timing-based server tests (300 ms timeout, rate limits) passed every run, but timing tests can still be sensitive on slow machines.
- **Coverage (v8):** engine 98.0 % lines / 91.7 % branches (weakest: `signalTiming.ts` 85 % / 64 %, `scenario.ts` 95 % lines); server 91 % lines / 76 % branches (`index.ts` 0 %: this is where F-4 lives; `runWorker.ts` 0 % because it runs in a worker thread that coverage cannot see). Web 0 %.
- **Coverage means lines executed, not behaviour verified.** Mutation testing was skipped, so how many of these tests would catch a real regression is unmeasured.
- **Untested:** failure paths of every store call (F-3), signal handling (F-2), env parsing (F-4), the browser worker fallback paths, share-link parsing (`web/src/lib/share.ts`), all UI behaviour.

## 5. Skipped, and the risk it leaves
| Skipped | Why | Residual risk |
|---|---|---|
| Mutation testing | needs a new tool and hours | test strength unmeasured |
| Render rollback and CI dry-run | needs the dashboard; no CI exists | the rollback itself is unproven on Render (the data-compatibility half is proven locally) |
| Long soak (hours) and memory-leak proof | time | only 200 s: handles and threads flat, memory plateaued after growing 115→164 MiB |
| Load at real free-tier network conditions | local container only | numbers are indicative; Render's shared CPU may differ |
| Browsers other than Chromium; slow-network and offline behaviour; i18n/RTL | only Chromium installed; app is English-only | Safari/Firefox rendering unchecked (canvas, `backdrop-filter`) |
| Python data scripts (`data/`) | not deployed | their dependencies were not scanned |
| Unused-dependency and circular-import tools | time | low |
| HSTS and TLS headers; Render-level controls | production out of scope | unverified |
| Authentication tests (token, IDOR, CSRF) | no accounts exist | N/A; scenario ids are 72-bit random, which was not brute-force tested |
| Time-zone, expiry, feature-flag and contract-diff tests | none of these exist in the app | N/A |

## 6. Pre-deploy checklist and rollback plan
**Before deploying:**
1. `npm ci && npm test && npm run build` on a clean clone (done: green).
2. Decide on F-3, F-1, F-4 (recommended fixes) and F-6 (add CI).
3. If changing the Dockerfile (F-7/F-8), rebuild, re-run `trivy image`, and compare the `stateHash` of a fixed scenario (`seed 7, 900 s, demand 1.3, Silk Board` → `237b7885`).
4. Confirm `render.yaml` values: `RUN_CONCURRENCY=1`, `RUN_MAX_QUEUE=5`, `RUN_TIMEOUT_MS=90000`.
5. After deploy: wake the service, open the page, run one scenario (the app's Auto mode will use the browser for long runs, so also force "The server" once).

**Rollback:** (a) Render dashboard → service → previous successful deploy → roll back (documented by Render, **not rehearsed here**); or (b) `git revert <commit> && git push` (Render rebuilds, ~1 minute). Data compatibility is proven in both directions between `b5cc64b` and `2502056` (local rehearsal: old image wrote → new image read and wrote → old image read both). The database is ephemeral (`/tmp`), so a restart or rollback loses saved short links (`?id=`) but never the `#s=` links.

## 7. What this audit could not prove
- That the code is correct beyond what the tests, fuzzing and the simulation's own invariants check; the traffic model's *realism* is a separate question (see `docs/VALIDATION.md`).
- That production behaves like the local containers (Render's network, CPU sharing, TLS, restarts).
- Absence of vulnerabilities: scanners found none that apply, but they cover known patterns and known CVEs only.
- Long-term stability (hours or days), or behaviour under many real users.
- Anything about other browsers or assistive technology beyond axe's automated rules (which catch roughly a third of real accessibility problems).
- The reproduction commands above were run once each on a macOS host with Docker; they have not been run in CI or by a second person.

## Appendix: what was added on this branch
`engine/test/fuzz.test.ts` (5 property tests, `FUZZ_SCALE=8` for a heavy run), `server/test/audit.test.ts` (43 hostile-HTTP tests; the F-1 tests started as expected-fail and became normal tests once fixed), `server/test/fixes.test.ts` (regression tests for F-2, F-3, F-4, F-5, F-13), `fast-check` and the V8 coverage plugin as engine dev-dependencies. Test totals on the branch: engine 92 passed; server 52 passed + 3 expected-fail.
