# Agent-Based Traffic Simulation — QUEST Lab Project 2

An agent-based traffic model on road networks with junctions, flyovers, and roads of different widths
and capacities, deployed as a web app where users set up scenarios and compare results.

**Status:** in development. See [PLAN.md](PLAN.md) for the phased plan and status log.

> **Date correction:** the first prompt of the development session reads "13 November 2027".
> That is a typo; the session started on **13 November 2026**.


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
