# Agent-Based Traffic Simulation — QUEST Lab Project 2

An agent-based traffic model on road networks with junctions, flyovers, and roads of different widths
and capacities, deployed as a web app where users set up scenarios and compare results.

**Status:** in development. See [PLAN.md](PLAN.md) for the phased plan and status log.

> **Date correction:** the first prompt of the development session reads "13 November 2027".
> That is a typo; the session started on **13 November 2026**.

## Layout
- `engine/` — simulation core (TypeScript, runs in browser Web Worker and in Node)
- `server/` — Fastify API + SQLite
- `web/` — React + Vite frontend
- `data/` — Python scripts that build road networks from OpenStreetMap
- `networks/` — committed network JSON
- `docs/` — model description and validation report

## Develop
```bash
npm install
npm test
npm run dev
```
