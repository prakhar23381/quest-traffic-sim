/**
 * Attach synthetic demand to an OSM-derived network and validate it with a run.
 *
 *   npx tsx scripts/osm-demand.ts <in.network.json> <out.json> [perLaneVph] [--sweep]
 *
 * Demand model (synthetic, NOT calibrated against counts):
 *   - every boundary node with outgoing links is an origin; total flow = its outgoing
 *     lanes × perLaneVph
 *   - split over every reachable boundary destination in proportion to the
 *     destination's incoming lanes (a simple gravity-by-capacity rule)
 *   - origin/destination pairs within U_TURN_DIST of each other are skipped (they are
 *     the two carriageways of the same road; U-turns are not modelled)
 */
import { readFileSync, writeFileSync } from "node:fs";
import { designForDemand, NetworkSim, retimeSignals, type DemandSpec, type NetworkSpec } from "../src/index";
import { makeDemand } from "./osm-demand-lib";

const [inPath, outPath, perLaneArg, ...flags] = process.argv.slice(2);
if (!inPath || !outPath) throw new Error("usage: osm-demand.ts <in.network.json> <out.json> [perLaneVph] [--sweep]");
const spec: NetworkSpec = JSON.parse(readFileSync(inPath, "utf8"));

const mode = flags.includes("--default-signals") ? "default" : flags.includes("--retime-only") ? "retime" : "design";

function evaluate(spec0: NetworkSpec, demand: DemandSpec[], seconds: number, seed = 1) {
  const spec = mode === "design" ? designForDemand(spec0, demand).spec : mode === "retime" ? retimeSignals(spec0, demand).spec : spec0;
  const sim = new NetworkSim({ network: spec, demand, seed });
  let errs: string[] = [];
  const n = seconds / sim.dt;
  for (let i = 0; i < n; i++) {
    sim.step();
    if (!errs.length && i % 4 === 0) errs = sim.checkInvariants();
  }
  const tt = sim.travelTimes;
  const meanTT = tt.reduce((a, b) => a + b, 0) / (tt.length || 1);
  const totalDemand = demand.reduce((s, d) => s + d.rate, 0);
  return { sim, errs, meanTT, totalDemand };
}

if (flags.includes("--sweep")) {
  const seeds = (process.env.SEEDS ?? "1").split(",").map(Number);
  console.log("perLane  demand  completed  waiting  inNet  meanTT(s)  stuck  gridlockAt  dropLane  dropGrid  rerouted  hardestBrake  errors   [per seed]");
  for (const pl of (process.env.LEVELS ?? "150,250,350,450,600").split(",").map(Number)) {
    const demand = makeDemand(spec, pl);
    for (const seed of seeds) {
      const r = evaluate(spec, demand, 3600, seed);
      const last = r.sim.samples.at(-1)!;
      console.log([pl, r.totalDemand, r.sim.exited, r.sim.waiting, r.sim.inNetwork, r.meanTT.toFixed(0), last.stuck, r.sim.gridlockAt ?? "-", r.sim.droppedWrongLane, r.sim.droppedGridlock, r.sim.rerouted, r.sim.hardestBrake.toFixed(1), r.errs.length ? r.errs.slice(0, 2).join(" | ") : "ok", `seed ${seed}`].join("\t"));
    }
  }
} else {
  const perLane = Number(perLaneArg ?? 120);
  const demand = makeDemand(spec, perLane);
  // Bake demand-based lane use and Webster signal timings into the scenario network.
  const { spec: designed, reports } = designForDemand(spec, demand);
  const out = {
    network: designed,
    demand,
    meta: {
      demand: `synthetic: ${perLane} veh/h per entry lane, split over reachable exits in proportion to lanes × distance²; NOT calibrated against traffic counts`,
      design: "lane use by movement and signal timings (Webster, critical lane) designed for this demand by designForDemand()",
      signals: reports,
    },
  };
  writeFileSync(outPath, JSON.stringify(out));
  console.log(`wrote ${outPath}: ${demand.length} OD pairs, ${demand.reduce((s, d) => s + d.rate, 0)} veh/h total`);
  for (const r of reports) console.log(`  signal ${r.node}: cycle ${r.cycle} s, Y ${r.Y}, greens ${r.phases.map((p) => p.green).join("/")}`);
}
