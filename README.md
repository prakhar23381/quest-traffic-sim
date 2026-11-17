# Agent-Based Traffic Simulation

An agent-based traffic model on road networks with junctions, flyovers, and roads of different widths
and capacities, deployed as a web app where users set up scenarios and compare results.

**Status:** in development. See [PLAN.md](PLAN.md) for the phased plan and status log.


**Live app: https://junction-lab.onrender.com**: free Render instance; it sleeps when idle, so
the first visit can take about a minute to wake.

## What works so far
- **Engine** (`engine/`): agent-based simulation of cars on multi-lane roads with signalised and
  give-way junctions, flyovers, merging, lane changes and congestion-aware routing. Validated against
  traffic-flow theory, Webster's signal-delay formula and HCM capacities: see
  [docs/VALIDATION.md](docs/VALIDATION.md) and [docs/MODEL.md](docs/MODEL.md). 87 engine tests, 9 API tests.
- **Real network**: the Silk Board junction in Bengaluru, built from OpenStreetMap, including the
  Silk Board Flyover and the double-decker flyover ramps ([data/README.md](data/README.md)).
  Its traffic demand is **synthetic**, not calibrated against counts.

- **API server** (`server/`): Fastify + SQLite. Stores scenarios, runs them in worker threads
  (queue, concurrency cap, time limit, rate limits) and returns the same results the browser
  computes. Endpoints are listed at the top of [server/src/app.ts](server/src/app.ts).

- **Web app** (`web/`, "Junction Lab"): watch the simulation live, edit the scenario (close the
  flyover, change lanes, speed limits and signal timings, raise demand), run the full period and
  compare runs side by side. Scenarios are shareable as links.

## Layout
- `engine/` — simulation core (TypeScript, runs in browser Web Worker and in Node)
- `server/` — Fastify API + SQLite
- `web/` — React + Vite frontend
- `data/` — OpenStreetMap extract and the Python scripts that turn it into a network
- `networks/` — committed network JSON
- `docs/` — model description and validation report

## Deploy
One Docker image serves the API and the web app on one port (`Dockerfile`). It is deployed on
Render's free tier from `render.yaml` (Dashboard → New → Blueprint), redeploying on every push.
Hugging Face Spaces was the first plan, but Docker Spaces now need a paid plan.

The free instance has about 0.1 CPU: a 1 h Silk Board run takes 70–90 s there against about 2 s
in a browser. The server therefore measures its own speed and reports it in `/api/health`, and
the app's "Run on: Auto" setting uses the server only when it would finish in about 12 s,
otherwise the visitor's browser (same engine, identical results). Saved short links (`?id=`)
are lost when the free instance restarts; links carrying the scenario in the URL (`#s=`)
always work.

### Configuration
The server reads these environment variables. All are optional (empty counts as unset); a value that is not valid
stops the server at startup with a message naming it (exit code 2), rather than starting in a broken state.

| Variable | Default | Allowed | Meaning |
|---|---|---|---|
| `PORT` | 8080 | 1–65535 | listening port (the Docker image sets 7860) |
| `DB_PATH` | `traffic.db` | a writable file path | SQLite file (the image uses `/tmp`, wiped on restart) |
| `STATIC_DIR` | unset | an existing directory | serve the built web app here; unset = API only |
| `TRUST_PROXY` | 0 | 0–5 | proxy hops whose `X-Forwarded-For` is trusted; set 1 only behind exactly one proxy (Render) |
| `RUN_CONCURRENCY` | 2 | 1–16 | simulations run at once |
| `RUN_MAX_QUEUE` | 20 | 1–1000 | queued runs before the server answers 503 |
| `RUN_TIMEOUT_MS` | 120000 | 1000–3600000 | wall-clock limit per run |

On `SIGTERM`/`SIGINT` the server stops accepting connections, marks unfinished runs `failed: server shut down`
and exits 0 (a `docker stop` takes well under a second). Saved scenarios are kept for 7 days and finished runs
for 24 hours, with hard caps (5000 scenarios, 500 runs). When the disk is full, writes answer 503 instead of
crashing the process.

## Develop
```bash
npm install
npm test                      # engine + server tests
npm run dev -w @traffic/server  # API on http://localhost:8080 (PORT=... to change)
npm run dev                   # web app on http://localhost:5173 (API_URL=... if the API is not on 8080)
```

## Data and licence

Map data © [OpenStreetMap contributors](https://www.openstreetmap.org/copyright), available under the
Open Database License (ODbL) 1.0. This applies to `data/raw/` and the networks in `networks/`
derived from it.
