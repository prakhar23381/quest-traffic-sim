# Video walkthrough script (about 2 min 50 s)

Live app: https://junction-lab.onrender.com · Repo: https://github.com/prakhar23381/quest-traffic-sim

## Before recording
- Open the live app a minute earlier (the free server sleeps when idle and takes about a minute to wake).
- 1440×900 browser window, dark theme.
- Keep seed 1, duration 1 h, demand 1.00× so the numbers below match (they are deterministic).
- Leave "Run on" at Auto or "This browser" (runs take about 2 s).
- Do the scenes in order: the comparison needs the baseline run to exist first.

## 0:00–0:25 · The live view
**On screen:** the Live tab, speed 20×, press Play. Let it run, then hover the legend.

> "This is Junction Lab, an agent-based traffic simulator. What you're seeing is the Silk Board junction in Bengaluru, built from OpenStreetMap: the Hosur Road flyover and the double-decker run over a signalised junction. Every dot is one car, coloured by speed, and red means stopped. The flyovers are real separate levels, so traffic on top never conflicts with the junction below."

## 0:25–0:55 · Set up and run the baseline
**On screen:** hover an ⓘ in the sidebar (for example Demand), then press Run simulation; the Results tab opens.

> "The demand is synthetic, and I'll come back to why that matters. On the left I set up a scenario. I'll run the baseline hour. 2,177 trips completed, average speed about 30 kilometres an hour, and nobody is left queueing. The map shows each road's average speed."

## 0:55–1:45 · The what-if: close the flyover
**On screen:** back to Live, untick Silk Board Flyover, press Run simulation, open the Compare tab, scroll to "Where it changed".

> "Now the question this tool exists for: what if the flyover is closed? Same seed, same demand, one change. Trips completed drop 27 percent, the average speed halves, 222 vehicles are still queued, and 312 trips have no route at all, because in the map data southbound through traffic has no ground-level road. The 'where it changed' map shows it: red is slower and blue is faster. Hosur Road under the flyover takes the hit."

## 1:45–2:05 · Edit any road
**On screen:** back to Live, click a road, press + on the lane stepper, drag the lane-width slider, hover the ⓘ next to Lane width.

> "I can also click any road: add a lane, narrow the lanes, drawn to scale. Narrow lanes make drivers slower and more cautious. I can change speed limits and signal timings, or let the tool re-time the signals for a given demand."

## 2:05–2:40 · Why you can trust it
**On screen:** the About the model tab, scrolling slowly past the table of checks.

> "How do I know it's right? I checked the model against textbook numbers: saturation flow of 1,935 vehicles an hour per lane against 1,900 in the Highway Capacity Manual, signal capacity within 3 percent, Webster's delay formula, and Braess's paradox. The engine checks on every step that no two cars overlap, and I fuzzed it with 64,000 hostile inputs. Before submitting I ran a release audit that found a real crash, where the server died when its disk filled up. I fixed it and re-tested. The limits are on this page too: the demand is synthetic and cars only, so read the results as comparisons, not forecasts."

## 2:40–2:55 · Close
**On screen:** the repo page, or the app with the URL visible.

> "It was built end to end in one Claude Code session over about a day and a half. The code, the plan, the validation report and the full session log are in the repository. Thank you."

## Numbers used (verified)
- Baseline: 2,177 trips, mean speed 29.6 km/h, 0 waiting.
- Flyover closed: 1,598 trips (−27 %), 14.8 km/h (−50 %), 222 waiting, 312 trips with no route.
- Saturation flow 1,935 vs 1,900 veh/h per lane (HCM); signal capacity −3.3 % vs prediction.
- 64,000 fuzz inputs (`engine/test/fuzz.test.ts`, `FUZZ_SCALE=8`); the disk-full crash was the High finding in `RELEASE_READINESS.md`.

## If something goes wrong
- Numbers differ from the script: a setting changed. Reset seed 1, demand 1.00×, 1 h, and say what you see.
- The page is slow to load: wait a minute and reload; the server is waking up.
- A run seems stuck on "Running on the server": press Cancel and pick "This browser" under "Run on".
