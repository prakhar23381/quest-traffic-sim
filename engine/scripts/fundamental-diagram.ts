/**
 * Regenerates docs/validation/fundamental-diagram.{csv,svg}:
 * IDM equilibrium flow-density curve vs. simulated ring-road flow.
 *
 *   npx tsx scripts/fundamental-diagram.ts
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { CITY_IDM, equilibriumFlow, RoadSim } from "../src/index";

const LEN = 4.5;
const L = 2000;
const WARMUP = 1800;
const MEASURE = 7200;
const out = resolve(dirname(fileURLToPath(import.meta.url)), "../../docs/validation");
mkdirSync(out, { recursive: true });

// Theory curve.
const theory: [number, number][] = [];
for (let k = 1; k <= 1000 / (CITY_IDM.s0 + LEN); k += 0.5) {
  theory.push([k, equilibriumFlow(CITY_IDM, k / 1000, LEN) * 3600]);
}

// Simulation points.
type Row = { rho: number; qEq: number; qEdie: number; qLoop: number; vMin: number; minGap: number };
const rows: Row[] = [];
for (let rho = 5; rho <= 150; rho += 5) {
  const n = Math.round((rho * L) / 1000);
  const sim = new RoadSim({ length: L, ring: true, ringVehicles: n, ringPerturbation: 1, detectors: [L / 2] });
  sim.run(WARMUP);
  sim.detectors[0]!.count = 0;
  let vSum = 0;
  let vMin = Infinity;
  const steps = MEASURE / sim.dt;
  for (let i = 0; i < steps; i++) {
    sim.step();
    vSum += sim.meanSpeed();
    for (const v of sim.lane.vehicles) vMin = Math.min(vMin, v.v);
  }
  rows.push({
    rho,
    qEq: equilibriumFlow(CITY_IDM, n / L, LEN) * 3600,
    qEdie: (n / L) * (vSum / steps) * 3600,
    qLoop: (sim.detectors[0]!.count / MEASURE) * 3600,
    vMin,
    minGap: sim.minGapSeen,
  });
}

writeFileSync(
  `${out}/fundamental-diagram.csv`,
  "density_veh_per_km,q_equilibrium_vph,q_sim_edie_vph,q_sim_loop_vph,v_min_ms,min_gap_m\n" +
    rows.map((r) => [r.rho, r.qEq, r.qEdie, r.qLoop, r.vMin, r.minGap].map((x) => +x.toFixed(3)).join(",")).join("\n") +
    "\n",
);

// Minimal hand-rolled SVG (no plotting dependency).
const W = 720, H = 440, m = { l: 64, r: 20, t: 36, b: 52 };
const xMax = 160, yMax = 2200;
const X = (k: number) => m.l + (k / xMax) * (W - m.l - m.r);
const Y = (q: number) => H - m.b - (q / yMax) * (H - m.t - m.b);
const path = theory.map(([k, q], i) => `${i ? "L" : "M"}${X(k).toFixed(1)},${Y(q).toFixed(1)}`).join("");
const grid: string[] = [];
for (let q = 0; q <= yMax; q += 500) grid.push(`<line x1="${m.l}" x2="${W - m.r}" y1="${Y(q)}" y2="${Y(q)}" stroke="#ddd"/><text x="${m.l - 8}" y="${Y(q) + 4}" text-anchor="end">${q}</text>`);
for (let k = 0; k <= xMax; k += 20) grid.push(`<text x="${X(k)}" y="${H - m.b + 18}" text-anchor="middle">${k}</text>`);
const dots = rows
  .map((r) => {
    const stable = r.vMin > 0.5;
    return `<circle cx="${X(r.rho).toFixed(1)}" cy="${Y(r.qEdie).toFixed(1)}" r="4.5" fill="${stable ? "#2563eb" : "#dc2626"}"/>`;
  })
  .join("");
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" font-family="system-ui,sans-serif" font-size="12" fill="#222">
<rect width="100%" height="100%" fill="#fff"/>
<text x="${m.l}" y="22" font-size="15" font-weight="600">Ring road (${L} m, single lane): IDM equilibrium vs simulated flow</text>
${grid.join("")}
<path d="${path}" fill="none" stroke="#111" stroke-width="2"/>
${dots}
<text x="${(W + m.l) / 2}" y="${H - 12}" text-anchor="middle">density (veh/km)</text>
<text transform="translate(16 ${(H - m.b + m.t) / 2}) rotate(-90)" text-anchor="middle">flow (veh/h)</text>
<g transform="translate(${W - 250} ${m.t + 10})">
<line x1="0" x2="24" y1="0" y2="0" stroke="#111" stroke-width="2"/><text x="32" y="4">IDM equilibrium (theory)</text>
<circle cx="12" cy="20" r="4.5" fill="#2563eb"/><text x="32" y="24">simulated, homogeneous flow</text>
<circle cx="12" cy="40" r="4.5" fill="#dc2626"/><text x="32" y="44">simulated, stop-and-go waves</text>
</g>
</svg>
`;
writeFileSync(`${out}/fundamental-diagram.svg`, svg);

console.log("rho  qEq   qEdie  qLoop  vMin  minGap");
for (const r of rows) console.log([r.rho, r.qEq.toFixed(0), r.qEdie.toFixed(0), r.qLoop.toFixed(0), r.vMin.toFixed(2), r.minGap.toFixed(2)].join("\t"));
console.log(`wrote ${out}/fundamental-diagram.{csv,svg}`);
