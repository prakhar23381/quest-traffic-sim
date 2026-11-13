# Model description

What the simulator models, the equations and parameters it uses, and which choices are assumptions
rather than calibrated facts. Evidence for each behaviour is in [VALIDATION.md](VALIDATION.md).

## Network

- **Left-hand traffic.** Lane 0 is the kerb (leftmost) lane.
- **Links** are one-directional road segments with a lane count, lane width, speed limit and layer.
  A two-way road is two links.
- **Nodes** are boundaries (where vehicles enter and leave), signalised junctions, or priority
  (give-way) junctions. Merge and diverge points are priority junctions.
- **Flyovers** are links with `layer ≥ 1`. They connect to the rest of the network only at their
  ramps. Where a flyover's geometry crosses another road there is no node, so no interaction.
- **Junction movements** are generated for every turn except U-turns. Each is realised as
  lane-level **connectors**: short internal lanes from an incoming lane to an outgoing lane.
  Left turns leave from the kerb lane, right turns from the outermost lane, through traffic from all lanes.
  Where two through roads merge, each keeps to its side of the outgoing road and one lane is shared.
- Connectors **conflict** if they cross, merge into the same lane, or diverge from the same lane.

## Driving

**Car following: Intelligent Driver Model** (Treiber, Hennecke & Helbing 2000)

```
dv/dt = a [ 1 − (v/v0)^δ − (s*/s)² ],   s* = s0 + max(0, vT + vΔv / (2√(ab)))
```

integrated with the ballistic scheme (Treiber & Kanagaraj 2015), which stops a vehicle at its
stopping point instead of letting its speed go negative.

| Parameter | Value | Source |
|---|---|---|
| Desired speed v0 | link speed limit × lane-width factor × driver factor (±10 %) | |
| Time headway T | 1.0 s (longer on narrow lanes) | typical urban value |
| Max acceleration a | 1.5 m/s² | calibrated to saturation flow |
| Comfortable braking b | 2.0 m/s² | calibrated to saturation flow |
| Standstill gap s0 | 2 m | typical |
| Vehicle length | 4.5 m | cars only |

**Lane width (assumption, not calibrated).** Desired speed is multiplied by a factor rising linearly
from 0.7 at 2.5 m to 1.0 at 3.5 m; the time headway is lengthened correspondingly.

**Turning speed.** A connector's speed is limited by its radius at 2 m/s² lateral acceleration
(minimum 4 m/s). Vehicles slow for it in advance at comfortable braking.

**Lane changes** (evaluated once a second per vehicle):
- *Mandatory*: the current lane cannot make the next turn.
- *Strategic*: the lane is valid for the next turn but leads to the wrong lane for the turn after.
- *Discretionary* (MOBIL): another lane is faster by more than 0.2 m/s², counting 30 % of the effect
  on the new follower.

All require that nobody is forced to brake harder than 4 m/s², including vehicles about to arrive
from a junction and the tail of a vehicle just leaving the lane. When a mandatory change is blocked,
the vehicle behind in the target lane holds back (at no more than comfortable braking) to make room.

## Junction entry

The front vehicle of each lane asks to enter when it is within a request distance of the stop line
(`max(40 m, v²/2b + 20 m)`, enough to stop comfortably if refused). Requests are settled one at a
time, nearest first. Entry needs all of:

1. **Signal**: green, or the vehicle is committed (below).
2. **No crossing path is occupied or reserved.**
3. **Merging by car-following**: against each vehicle on, or approved for, a merging path: if it is
   ahead, I must be able to follow it at comfortable braking; if it is behind, it must be able to follow me.
4. **Priority** (give-way junctions): I must not make any approaching vehicle with right of way
   slow by more than 1.5 m/s². *Calibrated against HCM gap-acceptance capacities.*
5. **Don't block the box**: on paths that cross others, wait for room downstream, unless it is too
   late to stop gently.

**Signals.** Fixed-time plans of phases (green, 3 s amber, 2 s all-red). The default is split
phasing, one approach at a time. The first time a vehicle sees its signal not green it decides
once: stop if the driver model's own braking response to the stop line is gentler than 3.0 m/s²
(the ITE yellow-interval value), otherwise commit and go. Committed vehicles are admitted during
amber and all-red only.

**Turn-taking in congestion (assumption).** At a give-way junction, once a vehicle has been stopped
for 4 s, conflicting traffic that is itself queued (below 5 m/s) lets it go first. Free-flowing
priority traffic never yields.

## Demand and routing

- Demand is a list of origin → destination flows (veh/h) between boundary nodes. Arrivals are a
  Poisson process from a seeded generator, so a run is reproducible.
- A vehicle enters at its leader's speed once the gap is at least `s0 + vT`. Vehicles that cannot
  enter wait in a queue outside the network; their wait counts in their travel time.
- **Routing is reactive**: each vehicle takes the quickest route at departure, using recently
  measured link travel times (re-evaluated every 10 s) plus the expected wait to enter. This
  approximates, but is not, a predictive user equilibrium.
- Closed links are never used. An unreachable destination is reported and its demand counted as unserved.

## Safety nets (reported, never silent)

| Counter | Meaning |
|---|---|
| `rerouted` | stuck in a wrong lane at a stop line for 15 s; took another route from there |
| `dropped` | stuck 180 s with no possible route; removed |
| `unserved` | demand with no route to its destination |
| `gridlockAt` | first time 20 or more vehicles had been stopped for over 5 minutes |
| `hardestBrake` | strongest braking any moving vehicle used |

## Not modelled

Two-wheelers and lane filtering, buses and stops, pedestrians, parking, actuated or coordinated
signals, roundabouts, U-turns, overtaking into oncoming lanes, incidents, weather, and driver error.
