# PLAN — Agent-Based Traffic Simulation (QUEST Lab, Project 2)

Applicant: Prakhar Saxena · Session started: 13 November 2026

> **Date correction for the log:** the first prompt of this session says "13 November **2027**".
> That is a typo; the correct date is **13 November 2026**. It is noted here and in the README so the
> session log and the repo agree.

---

## 0. Brief, constraints and what "done" means

**Brief (from ASSIGNMENT.md):** build and run an agent-based model of traffic on a road network with
**junctions, flyovers, and roads of different widths and capacities**. Deploy it as an application
where users **set up scenarios and see results**.

**Hard rules**
| Rule | How this plan handles it |
|---|---|
| One single Claude Code session; nothing built outside it | All code, data processing, tests, deploys and git commands run from this session. No other editors or terminals are used to write code. |
| 72 h max, first prompt → final commit | Starts 13 Nov 2026. The **application deadline of 15 Nov 2026 comes first**, so the real budget is **about 48 h**. Code freeze is the morning of 15 Nov. |
| First-prompt line | Done (date typo noted above). |
| Commit from inside the session | Commit at the end of every phase and at each meaningful sub-step, with descriptive messages. |
| Submit: raw `.jsonl` log, public repo, live app, short video | See the Phase 8 checklist. |

**Machine:** Apple M1, 16 GB RAM, **only about 20 GB of disk free**, Node 22, Python 3.12, Docker. `gh` 2.103 is
installed at `~/.local/bin/gh` (not on the default PATH, so call it by full path) and is logged in.

**Definition of done**
1. A public URL where a user can pick a road network (including a real Bengaluru network with a
   flyover), edit a scenario (demand, signal timings, lane counts, road closures, flyover on/off), run
   it, watch the vehicles move, and get quantitative results (travel time, delay, throughput, queues).
   They can also **compare two scenarios side by side**.
2. The engine is **validated**: no collisions, vehicles are conserved, runs are reproducible from a seed,
   and the fundamental diagram and junction capacity match theory. This is backed by automated tests and a
   short validation report in the repo.
3. A README with architecture, modelling assumptions, known limitations, a live link, and how to run it locally.
4. A video walkthrough and the session log.

---

## 1. Key decisions (made up front, revisit only with evidence)

| # | Decision | Choice | Why / alternative rejected |
|---|---|---|---|
| D1 | Language for the simulation engine | **TypeScript**, as a pure package with no DOM dependency | The same engine runs **in the browser (Web Worker)** for live animation and **in Node** for headless batch runs and tests. One codebase and one test suite. A Python backend streaming frames over WebSockets would add latency and hosting cost, and would split the logic in two. |
| D2 | Vehicle model | **IDM** (Intelligent Driver Model) for car-following, plus a **simplified MOBIL** for lane changes | Standard, well documented, and easy to validate against known results. Cellular automata (e.g. Nagel–Schreckenberg) were rejected because they cannot represent lane widths or speeds smoothly. |
| D3 | Network representation | Directed graph. **Nodes** = junctions, with movements and conflict sets. **Links** = road segments with `lanes`, `laneWidth`, `speedLimit`, `capacity`, `layer`, and a polyline geometry. **Flyover** = links with `layer ≥ 1` that cross other links **without** sharing a node, connected by ramps. | Grade separation becomes a graph property instead of a rendering trick. Ramps give merge and diverge behaviour for free. |
| D4 | Real-world data | **OpenStreetMap** extract of the **Silk Board junction, Bengaluru** (Hosur Road flyover over the signalised Outer Ring Road junction). Chosen over Hebbal because it is the exact "flyover over a signalised junction" pattern the synthetic preset tests, and a small bbox keeps the OSM cleaning manageable. Hebbal's multi-loop interchange is too messy for a 48 h build. Fetched once with a Python script (`osmnx`/Overpass), cleaned, and committed as compact JSON. | This satisfies "from data to app". OSM tags give `lanes`, `maxspeed`, `bridge`, `layer` and `highway`. Hand-built synthetic presets (grid, ring road, a Braess network, a flyover junction) cover the controlled tests. |
| D5 | Time stepping | Fixed `dt = 0.25 s` with a seeded PRNG | Results are deterministic and reproducible. Rendering interpolates between steps. |
| D6 | Backend | **Node (Fastify) + SQLite** for scenario CRUD, saved results, headless batch runs and shareable scenario links | Keeps it a real full-stack app without moving the simulation onto the server. |
| D7 | Frontend | **React + Vite + TypeScript**, **Canvas 2D** (PixiJS only if Canvas can't reach the target FPS), and a small chart library for results | Canvas with typed arrays is enough for a few thousand vehicles. |
| D8 | Deployment | **One Docker image**: Fastify serves the API and the built static frontend. Host on **Hugging Face Spaces (Docker SDK, free CPU tier)** | One URL, one deploy and no CORS problems. Render's free tier is used up. Fly.io no longer has a free allowance and needs a card. HF Spaces is free with no card (2 vCPU, 16 GB RAM). Its downsides: the disk is **ephemeral** (SQLite is wiped on restart, so shared scenarios are also encoded in the URL) and the Space sleeps when idle (cold start of about 30 s, said in the README). The simulation runs client-side, so neither hurts the demo. |
| D9 | Monorepo tooling | npm workspaces: `engine`, `server`, `web`; Python only in `data/` | Minimal tooling and fast setup. |

---

## 2. Architecture

```
                ┌──────────────────────────── browser ────────────────────────────┐
 OSM (Overpass) │  React UI ── scenario editor ── results/compare dashboards       │
      │         │      │  postMessage (typed arrays)                               │
      ▼         │  Web Worker: @traffic/engine  (step, metrics, snapshots)         │
 data/fetch_osm.py   └──────────────────────────────▲───────────────────────────────┘
      │                                             │ REST (JSON)
      ▼                                             │
 networks/*.json ──────►  Fastify server ── SQLite (scenarios, runs, results)
 (committed)               └─ worker_threads: @traffic/engine headless batch runs
```

**Repo layout**
```
/engine      core sim: network, vehicles, IDM, MOBIL, junctions, signals, routing, metrics (+ vitest)
/server      Fastify API, SQLite, batch runner, static hosting
/web         React app: map/canvas, editor, run controls, results, compare
/data        Python: OSM fetch + cleaning → networks/*.json; validation plots
/networks    committed network JSON (synthetic presets + Bengaluru extract)
/docs        VALIDATION.md, MODEL.md (assumptions), architecture diagram
Dockerfile, README.md, PLAN.md
```

**Core engine data model (sketch)**
- `Link { id, from, to, lanes, laneWidth, speedLimit, capacityVph, layer, geometry[], length }`
- `Node { id, type: 'signal'|'priority'|'merge'|'diverge'|'source'|'sink', movements[], conflicts[][], signalPlan? }`
- `Movement { id, inLink, inLanes[], outLink, outLanes[], path(geometry through the junction) }`
- `Vehicle { id, type: car|bike|bus, route[], linkIdx, lane, pos, v, a, params(IDM: v0,T,a,b,s0,len), tSpawn }`
- `Scenario { networkId, durationS, seed, demand: OD[] | sourceRates, signalPlans, edits: {closeLink, setLanes, setSpeed, toggleFlyover}, vehicleMix }`
- `Results { perLink: flow, meanSpeed, density, maxQueue; perOD: travelTimes[], delay; network: VKT, VHT, throughput, completed, gridlockFlag; timeseries }`

**Lane width → behaviour:** the number of lanes sets capacity. Lane width scales the desired speed
`v0`, and the time headway `T` grows on narrow lanes (< 3.0 m). This is documented as a modelling
assumption in `docs/MODEL.md`, with literature-style parameter values, and it can be changed in the UI.

---

## 3. Phases

Times are planning targets (elapsed hours since the session started). Each phase ends with a **commit**
and an **exit check** that must pass before moving on.

### Phase 0 — Setup and scaffolding (0 → 2 h)
- `git init`, `.gitignore` (node_modules, dist, *.db, data caches), npm workspaces, TypeScript configs, vitest, ESLint/Prettier (minimal).
- Create the public GitHub repo with `~/.local/bin/gh repo create` and push the scaffold.
- Add `README.md` stub with the date-correction note.
- **Exit:** `npm test` runs (0 tests), `npm run dev` serves a blank page. Commit: `chore: scaffold monorepo`.

### Phase 1 — Engine core on a single road (2 → 7 h)
- Link geometry (arc-length parametrisation), vehicle storage (structure-of-arrays, typed arrays), seeded PRNG.
- IDM longitudinal update with a stable integration scheme (ballistic update, clamp `v ≥ 0`).
- Sources (Poisson arrivals, capped by entry space) and sinks.
- **Validation tests (must pass):**
  - No overlap: gap ≥ 0 between every leader and follower at every step.
  - Conservation: spawned = exited + in network.
  - Determinism: same seed gives an identical result hash.
  - **Ring road fundamental diagram:** sweep density, measure flow, and compare with the IDM equilibrium curve. Capacity should be around 1,800–2,200 veh/h/lane with the default parameters.
  - Free-flow speed is about `v0` at low density; a stop-and-go wave appears above critical density (a qualitative check, plotted).
- **Exit:** the tests above are green and the FD plot is saved in `docs/`. Commit.

### Phase 2 — Network: multi-lane links, junctions, signals, flyovers, routing (7 → 15 h)
- Multi-lane links and simplified MOBIL lane changes, plus mandatory lane changes so vehicles reach the lane their next turn needs.
- Junction movements: vehicles traverse a movement path. A **conflict-set rule** lets a vehicle enter only if no conflicting movement is occupied or has priority. A box-blocking rule prevents entry when the exit link has no space.
- Fixed-time **signal plans** (phases, green/amber/all-red). Priority junctions use a gap-acceptance rule.
- **Merge and diverge nodes** for flyover ramps. **Layered links** cross other links with no interaction.
- Routing: Dijkstra on free-flow travel time when a vehicle spawns. *Stretch:* periodic re-routing on current link travel times.
- Gridlock detection: no vehicle has moved for N seconds while vehicles are present. Raise a flag, don't hang.
- **Validation tests:**
  - Signalised throughput ≈ saturation flow × (effective green / cycle), within tolerance.
  - A flyover link and the road it crosses do not interact: vehicles on one never brake for vehicles on the other.
  - Closing a link re-routes demand; an unreachable OD pair is reported, not silently dropped.
  - **Braess network** preset: adding the shortcut link raises mean travel time under the expected demand. This is a good showcase and a good correctness check.
- **Exit:** a synthetic "flyover over a signalised junction" preset runs for 1 simulated hour headless with no invariant violations. Commit per sub-feature.

### Phase 3 — Real data: Bengaluru OSM network (15 → 19 h)
- `data/fetch_osm.py`: pull a bounding box around the chosen flyover corridor. Keep the `highway` classes primary through tertiary plus `*_link`. Read `lanes`, `maxspeed`, `oneway`, `bridge` and `layer`.
- Cleaning: merge degree-2 nodes, impute missing `lanes` and `maxspeed` by highway class (document the rule), project to metres, and generate junction movements and default signal plans for large junctions.
- **Check by eye:** render the network, compare it with the OSM map, and confirm that the flyover is grade-separated (does *not* create a junction where it crosses). Fix by hand in a small overrides file if needed, and record what was fixed.
- Default demand: entry/exit rates at the boundary nodes, scaled to reach plausible peak-hour congestion. This is clearly labelled as **synthetic demand, not calibrated**.
- **Exit:** the Bengaluru network runs headless for 1 h of simulated time without gridlock at default demand, and it gridlocks or queues heavily at about 2× demand. Commit the network JSON (keep it under about 1 MB).

### Phase 4 — Backend (19 → 23 h)
- Fastify endpoints:
  - `GET /api/networks`, `GET /api/networks/:id`
  - `POST /api/scenarios`, `GET /api/scenarios/:id` (shareable link)
  - `POST /api/runs` → headless batch run in `worker_threads` (limits: duration ≤ 2 h simulated, vehicles ≤ N, wall-clock timeout)
  - `GET /api/runs/:id` → status and results
  - `GET /api/health`
- Validate input with a shared zod schema (the same schema used in `web`). Apply rate limiting, cap request sizes, and use SQLite via `better-sqlite3`.
- **Tests:** API tests with `fastify.inject`, and a check that a headless result matches a browser-engine result for the same seed.
- **Exit:** a scenario can be created, run headless and fetched. Commit.

### Phase 5 — Frontend (23 → 34 h)
- **Live view:** Canvas map with pan and zoom. Links are drawn by lane count and width, and flyovers are drawn on top with a drop shadow. Vehicles are coloured by speed, and signals show their state. Controls: play/pause/step, speed ×1–×50, time display.
- **Scenario editor (the "set up scenarios" requirement):**
  - Choose a network preset (Bengaluru, signalised flyover junction, grid, ring, Braess).
  - Demand sliders per entry and a global demand multiplier; vehicle mix (car / two-wheeler / bus).
  - Click a link to change lanes, lane width or speed limit, or to close it.
  - Click a junction to edit signal phase durations.
  - Flyover toggle: remove it so its traffic must use the junction below (the key "what-if").
  - Seed and duration.
- **Results (the "see results" requirement):**
  - KPIs: mean travel time, mean delay, throughput, vehicles completed, VHT/VKT, gridlock flag.
  - Time series (flow, mean speed, vehicles in network), a per-link heatmap (speed or queue), a travel-time histogram, and a **time-space diagram** for a chosen link.
  - **Compare mode:** baseline vs variant run headless with the same seed, showing a KPI deltas table and difference charts.
- An "About the model" panel covering IDM/MOBIL, the assumptions, what is *not* modelled, and that demand is synthetic.
- **Performance target:** more than 2,000 vehicles at 60 fps render with the simulation in the Web Worker. Measure it, don't assume it.
- **Exit:** a full user journey works locally, from preset to edit to run to results to compare to share link. Commit.

### Phase 6 — Deploy (34 → 38 h)
- Multi-stage Dockerfile (build `web` and `server`, slim runtime). SQLite lives on a volume, or is ephemeral with a clear note.
- Deploy to a Hugging Face Space (Docker SDK, `app_port` set in the Space README front-matter; push to the Space git remote or sync from GitHub). Needs a Hugging Face account and write token from the user. Then smoke test **against the live URL**: health check, load the Bengaluru network, run a short scenario, and fetch the results.
- **Exit:** the live link is in the README and has been opened and used end to end. Commit.

### Phase 7 — Hardening, docs and polish (38 → 44 h)
- Edge cases: empty demand, every link closed, extreme demand (gridlock must surface clearly), invalid shared links, mobile layout.
- `docs/VALIDATION.md`: each test with its plot and result. `docs/MODEL.md`: equations, parameters, assumptions, limitations.
- README: what it is, a screenshot or GIF, live link, architecture, how to run, test commands, limitations, next steps.
- **Exit:** clean `npm test` and build. The live app is redeployed. Commit.

### Phase 8 — Submission (44 → 48 h, before the 15 Nov deadline)
- Final commit and push, then confirm the public repo shows the full history.
- Record a **3–5 minute video walkthrough**: the problem, a live demo (Bengaluru flyover on/off compare, a signal-timing change, the Braess demo), the validation evidence, and the architecture. Recording the video is not development, so it can happen outside the session.
- Find the session log: `~/.claude/projects/-Users-PrakharSaxena-Documents-Code-IISc-Bangalore/<session-id>.jsonl`. Submit it **raw and unedited**.
- **Checklist:** ☐ `.jsonl` log ☐ public repo URL ☐ live app URL ☐ video URL ☐ form submitted before the deadline.

---

## 4. Judgement checkpoints (where the AI is likely to be wrong — verify explicitly)

1. **IDM integration:** naive Euler can produce negative speeds or vehicles passing through each other at large `dt`. The no-overlap test enforces this.
2. **Units:** km/h vs m/s, and veh/h vs veh/s. Assert units at the module boundaries, and sanity-check capacity numbers against the ~2,000 veh/h/lane rule of thumb.
3. **Flyover semantics:** OSM `bridge`/`layer` tags must not produce a junction node at the crossing. Check by eye in Phase 3.
4. **Junction deadlock:** conflict rules can deadlock. Test box-blocking and gridlock detection rather than hoping.
5. **Fake realism:** demand is synthetic and nothing is calibrated against observed counts. The UI and README must say so, and must not claim predictive accuracy.
6. **Performance claims:** measure FPS and steps/s on this M1 and report the numbers. Don't quote guesses.
7. **Browser vs headless parity:** the same seed must give identical results in both. A test enforces this.
8. **Scope creep:** check every addition against the cut list below before starting it.

---

## 5. Scope control

**Must have (MVP):** IDM + multi-lane links, signalised and priority junctions, flyover with ramps, synthetic presets, the
Bengaluru OSM network, scenario editor (demand, lanes, closures, signals, flyover toggle), KPIs and charts,
compare mode, deployed and validated.

**Cut in this order if behind schedule:**
1. Dynamic re-routing → static shortest path only
2. Vehicle mix (bikes and buses) → cars only
3. Time-space diagram → keep the time series and heatmap
4. Server-side batch runs → compare mode runs both scenarios in the browser
5. SQLite persistence → scenarios encoded in the URL

**Stretch (only after Phase 7 is green):** roundabouts, actuated signals, OD-matrix editor, an import box for arbitrary OSM areas, CSV export of results.

---

## 6. Risks

| Risk | Impact | Mitigation |
|---|---|---|
| Junction logic takes longer than planned | Delays Phases 3–5 | Get the conflict-set rule working on synthetic junctions first; Bengaluru only after that. Time-box: if it isn't done by 17 h, simplify the junction model. |
| OSM data is messy (missing lanes, odd geometry) | Gridlock or visual bugs | Keep the bbox small, impute by highway class, keep a hand-fix overrides file, and keep the synthetic presets as the reliable fallback. |
| Free hosting cold starts or memory limits | Slow or broken demo | The simulation runs client-side, so the server stays light. Smoke test after every deploy. |
| Deadline (15 Nov) | Hard stop | Code freeze on the morning of 15 Nov. Phases 7–8 hold the buffer. |
| Low disk (20 GB free) | Docker builds fail | Prune Docker images and caches; the OSM data is tiny. |
| Context compaction in a long session | Lost context | This PLAN.md plus frequent commits are the source of truth. Update the status section below after each phase. |

---

## 7. Status log (update at the end of each phase)

| Phase | Status | Commit | Notes |
|---|---|---|---|
| 0 Setup | ✅ | c7ad3f4 | Repo: github.com/prakhar23381/quest-traffic-sim |
| 1 Engine core | ✅ | dd4d2d7 | 25 tests green. Capacity 2,012 veh/h/lane. Fixed an entrance-capacity bug (1,187 → 2,009 veh/h); see docs/VALIDATION.md §3. Deviation: vehicles are plain objects, not structure-of-arrays (simpler); revisit only if the Phase 5 FPS target fails. |
| 2 Network | ✅ | 472f2a4 | 63 tests green. Multi-lane links, lane changing, signalised and priority junctions, flyovers, zipper merging, reactive routing, 5 presets. Validated against Webster (signal delay), HCM (saturation flow, gap acceptance) and Braess. A hardest-braking metric exposed several lane-change and stop-line collision bugs that the collision check had missed; all fixed (docs/VALIDATION.md §8). Known limitations listed there. |
| 3 OSM data | ✅ | 32c1ab1 | Silk Board from OSM (main API; Overpass unreachable). Default demand 120 veh/h/entry lane: ~95 % of trips done in 1 h, no gridlock, 5 seeds; 2× overloads. Real geometry exposed ~20 engine and data bugs, all fixed and listed in docs/VALIDATION.md §8. Scope decision: tertiary streets left out except service-road chains. Finding: with the flyover closed, southbound through traffic has no ground route in OSM. |
| 4 Backend | ✅ | d8bf3fe | Scenario format, validation and edits live in the engine (`scenario.ts`, `catalog.ts`, `results.ts`), so browser and server share them. Fastify + better-sqlite3, worker-thread runs with queue/concurrency/timeout/rate limits. 9 API tests incl. bit-identical browser/server parity; 17 scenario tests. Built bundle smoke-tested over HTTP (Silk Board 10 min in 0.4 s). |
| 5 Frontend | ✅ | (this commit) | "Junction Lab": React + Vite, Canvas map (decks drawn over the roads below, with shadows), live sim in a Web Worker, editor (network, flyover toggles, demand, seed, duration, click-a-road lanes/speed/width/close, signal greens or Webster retiming), full runs on the server with automatic fallback to a browser worker, results (KPIs, 4 time series, per-road speed heatmap, longest queues), compare (KPI deltas + overlaid series), About panel with limits and OSM attribution, share via URL hash or server short link. Checked in headless Chromium: whole journey, server-down fallback, dark mode, 390 px phone (no horizontal scroll), 0 console errors. Measured: 64–70 fps with 1,000–1,500 vehicles on screen while simulating at 200–300× real time, no long tasks; the networks never hold 2,000 vehicles at once (entry capacity limits them), so that figure is untested. Cut: vehicle mix (engine is cars only), per-entry demand sliders, travel-time histogram, time-space diagram; signals are edited from a list, not by clicking the junction. |
| 6 Deploy | ✅ | (this commit) | Live: https://junction-lab.onrender.com (Render free, Docker, from render.yaml). HF Spaces refused (402: Docker Spaces need PRO). Under free-tier limits (0.1 CPU) the server is ~40× slower than a browser, so runs go to the server only when it would finish in ~12 s (it benchmarks itself); otherwise the browser. Verified against the live URL in headless Chromium: Auto and Server runs, baseline vs flyover-closed compare (same numbers as local: deterministic across machines), road edit, short link round trip, phone width, 0 console errors. |
| 7 Hardening | ✅ | (this commit) | Edge cases run through the real code path (zero demand, all roads closed, both flyovers closed, 3× for 2 h, minimum greens, 1-lane and 6-lane networks, every network at 3×): none crash, each failure is reported (docs/VALIDATION.md §10). New finding, documented not fixed: hardest braking 12.7 m/s² under 3× overload. Broken share links now say so instead of silently loading the default. Security review: forged X-Forwarded-For could dodge rate limits (trustProxy: true) → trust a fixed hop count, with a test; finished runs pruned after 24 h; saving scenarios rate-limited. |
| 7b UI polish | ✅ | (this commit) | Borrowed interaction patterns (not looks) from A/B Street, Streetmix, Windy and Google Maps. Done: faint OSM basemap aligned with the network's own projection (CARTO tried first: now needs an API key); compare map coloured by change in road speed (diverging red/grey/blue; closed roads made neutral so they never read as 'slower'); road editor as a to-scale cross-section (lanes ±, lane-width slider, car for scale, deck and pillar if elevated, the driver effect stated). Skipped for time: timeline bar, 'who uses this road'. |
| 7c Release audit | ✅ | 5b42634 | RELEASE_READINESS.md: build, 192 tests, fuzzing (64k inputs), scans (npm audit, gitleaks, semgrep, trivy), config/resilience/load/soak, axe. 1 High + 7 Medium found; the High (disk-full crash), scenarioId 500, bad settings, missing STATIC_DIR, SIGTERM and 3 accessibility bugs fixed and re-verified on the Docker image and on the live site. Open: no CI (F-6), base-image CVEs with Alpine option tested but not applied (F-7/F-8), web has no tests (F-10). |
| 5 Frontend | ☐ | | |
| 6 Deploy | ☐ | | |
| 7 Hardening | ☐ | | |
| 8 Submission | ☐ | | |
