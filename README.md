# Agent-Based Traffic Simulation — QUEST Lab Project 2

An agent-based traffic model on road networks with junctions, flyovers, and roads of different widths
and capacities, deployed as a web app where users set up scenarios and compare results.

**Status:** in development. See [PLAN.md](PLAN.md) for the phased plan and status log.

> **Date correction:** the first prompt of the development session reads "13 November 2027".
> That is a typo; the session started on **13 November 2026**.

## What works so far
- **Engine** (`engine/`): agent-based simulation of cars on multi-lane roads with signalised and
  give-way junctions, flyovers, merging, lane changes and congestion-aware routing. Validated against
  traffic-flow theory, Webster's signal-delay formula and HCM capacities: see
  [docs/VALIDATION.md](docs/VALIDATION.md) and [docs/MODEL.md](docs/MODEL.md). 70 automated tests.
- **Real network**: the Silk Board junction in Bengaluru, built from OpenStreetMap, including the
  Silk Board Flyover and the double-decker flyover ramps ([data/README.md](data/README.md)).
  Its traffic demand is **synthetic**, not calibrated against counts.

## Layout
- `engine/` — simulation core (TypeScript, runs in browser Web Worker and in Node)
- `server/` — Fastify API + SQLite
- `web/` — React + Vite frontend
- `data/` — OpenStreetMap extract and the Python scripts that turn it into a network
- `networks/` — committed network JSON
- `docs/` — model description and validation report

## Develop
```bash
npm install
npm test
npm run dev
```

## Data and licence

Map data © [OpenStreetMap contributors](https://www.openstreetmap.org/copyright), available under the
Open Database License (ODbL) 1.0. This applies to `data/raw/` and the networks in `networks/`
derived from it.
