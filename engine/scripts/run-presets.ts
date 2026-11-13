// Run every preset for one simulated hour, checking all invariants each step, and print KPIs.
//   npx tsx scripts/run-presets.ts [name]
import { braess, corridor, signalCross, flyoverJunction, grid, NetworkSim, type Preset } from "../src/index";
const presets: Record<string, Preset> = { corridor: corridor(), cross: signalCross(), flyover: flyoverJunction(), grid: grid(), braess: braess() };
const only = process.argv[2];
for (const [name, p] of Object.entries(presets)) {
  if (only && name !== only) continue;
  const t0 = performance.now();
  const sim = new NetworkSim({ network: p.network, demand: p.demand, seed: 1 });
  if (sim.warnings.length) console.log(`[${name}] warnings:`, sim.warnings);
  let firstErr: string[] = [];
  let maxVeh = 0;
  for (let i = 0; i < 3600 / sim.dt; i++) {
    sim.step();
    maxVeh = Math.max(maxVeh, sim.inNetwork);
    if (!firstErr.length) { const e = sim.checkInvariants(); if (e.length) firstErr = [`t=${sim.time}`, ...e.slice(0, 5)]; }
  }
  const ms = performance.now() - t0;
  const tt = sim.travelTimes; const mean = tt.reduce((a, b) => a + b, 0) / (tt.length || 1);
  console.log(`[${name}] 1h in ${ms.toFixed(0)} ms | gen ${sim.generated} entered ${sim.entered} exited ${sim.exited} inNet ${sim.inNetwork} waiting ${sim.waiting} dropped ${sim.dropped} unserved ${sim.unserved} rerouted ${sim.rerouted}`);
  console.log(`   meanTT ${mean.toFixed(1)} s | maxVeh ${maxVeh} | stopLineViol ${sim.stopLineViolations} | maxRedLate ${sim.maxRedEntryLateness.toFixed(2)} s | gridlock ${sim.gridlockAt} | stuck(last) ${sim.samples.at(-1)?.stuck}`);
  for (const s of sim.odStreams) { const st = s.stats; if (st.completed) console.log(`   ${st.origin}->${st.destination}: done ${st.completed}/${st.generated}, tt ${(st.ttSum/st.completed).toFixed(0)} s, delay ${(st.delaySum/st.completed).toFixed(0)} s, route ${s.route?.map(l=>l.id).join(" ")}`); }
  if (firstErr.length) console.log("   FIRST INVARIANT VIOLATION:", firstErr);
}
