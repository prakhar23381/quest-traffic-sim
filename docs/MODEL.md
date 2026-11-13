# Model description

What the simulator models, the equations and parameters it uses, and which choices are assumptions
rather than calibrated facts. Evidence for each behaviour is in [VALIDATION.md](VALIDATION.md).

## Network

- **Left-hand traffic.** Lane 0 is the kerb (leftmost) lane.
- **Links** are one-directional road segments with a lane count, lane width, speed limit and layer.
  A two-way road is two links.
- **Nodes** are boundaries (where vehicles enter and leave), signalised junctions, or give-way
  (priority) junctions. Merge and diverge points are give-way junctions.
- **Flyovers** are links with `layer ≥ 1`. They connect to the rest of the network only at their
  ramps. Where a flyover's geometry crosses another road there is no node, so no interaction.
- **Junction movements** are generated for every turn except U-turns. Each is realised as
  lane-level **connectors**: short internal lanes from an incoming lane to an outgoing lane.
  By default left turns leave from the kerb lane, right turns from the outermost lane, through
  traffic from all lanes. Where two through roads merge, each keeps to its side and one lane is shared.
  A node may instead carry **lane-use weights** per movement (used for demand-designed lanes).
- Connectors **conflict** if they cross, merge into the same lane, or diverge from the same lane.

## Real networks from OpenStreetMap

`data/build_network.py` converts an OSM extract (see [data/README.md](../data/README.md)):

- crops to a study box; roads leaving it end at boundary (entry/exit) nodes;
- joins the several OSM nodes of one junction into one node, whenever a link would keep less than
  20 m of road after junction trimming, **never across levels**;
- a junction is signalised if a `traffic_signals` tag lies within 35 m on its own level and it has
  at least two approaches;
- bridges shorter than 30 m that cross no road are treated as ground level (drain and canal bridges);
- keeps chosen road classes; a road of an excluded class is kept if it is a simple chain joining kept
  roads at both ends (a service road); a kept road whose continuation was excluded ends as an entry/exit;
- drops dead ends, disconnected pieces and links no vehicle can use;
- imputes missing lane counts and speed limits by road class, and records how often it did.

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

**Looking ahead.** A vehicle follows the nearest of: the vehicle ahead in its lane; vehicles on
connectors that merge into its path or have just diverged from its lane; vehicles approved to enter
those connectors; the stop line, if it has no permission to cross. Near a stop line it also watches
the nearest vehicle on its own path through the junction.

**Anticipation (assumptions).** Approaching a junction where entry may be refused (a crossing, or a
merge into traffic with equal or higher priority, e.g. a lane drop), a vehicle keeps to a speed from
which it could still stop at the line at comfortable braking. A vehicle in the wrong lane for its
next turn prepares to stop at the line even while following a leader that can go.

**Lane changes** (evaluated once a second per vehicle):
- *Mandatory*: the current lane cannot make the next turn.
- *Strategic*: the lane is valid for the next turn but not for the turns after it (looking up to
  four movements ahead).
- *Discretionary* (MOBIL): another lane is faster by more than 0.2 m/s², counting 30 % of the effect
  on the new follower.

All require that nobody is forced to brake harder than 4 m/s², including vehicles about to arrive
from a junction and the tail of a vehicle just leaving the lane. No lane change may cut in front of a
vehicle already approved to enter the junction. When a mandatory or strategic change is blocked,
the vehicle behind in the target lane holds back (at no more than comfortable braking) to make room.

## Junction entry

The front vehicle of each lane asks to enter when it is within a request distance of the stop line
(`max(40 m, v²/2b + 20 m)`, enough to stop comfortably if refused). Requests are settled one at a
time, nearest first. Entry needs all of:

1. **Signal**: green, or the vehicle is committed (below).
2. **No crossing path is occupied or reserved.**
3. **Merging by car-following**: against each vehicle on, or approved for, a merging path: if it is
   ahead, I must be able to follow it; if it is behind, it must be able to follow me. Traffic with
   priority may be slowed by at most 1.5 m/s² (*calibrated against HCM gap acceptance*). Between equal
   streams the lesser harm wins: entry is refused only if approving would be uncomfortable *and*
   worse than stopping at the line, or if there is no room at all.
4. **Priority** (give-way junctions): no approaching vehicle with right of way may have to slow by
   more than 1.5 m/s².
5. **Don't block the box**: on paths that cross others, wait for room downstream, unless it is too
   late to stop gently.

**Signals.** Fixed-time plans of phases (green, 3 s amber, 2 s all-red). The default is split
phasing, one approach at a time. Within 100 m of the stop line, the first time a vehicle sees its
signal not green it decides once: **stop** if it can, at no more than 2.5 m/s² average deceleration
measured to where it would stand (s0 before the line), otherwise **commit** and go. Committed
vehicles are admitted during amber and all-red. An approval is withdrawn on red only from a vehicle
that can still stop. A vehicle entering the network on a link that leads into a junction enters no
faster than allows a comfortable stop before that junction.

**Signal timing and lane design for a demand** (`engine/src/signalTiming.ts`). Each OD flow is
assigned to its free-flow shortest route. Lanes are shared between an approach's movements in
proportion to their flows. Signals are then timed by **Webster's method** on the busiest (critical)
lane of each approach: `C0 = (1.5 L + 5)/(1 − Y)`, green in proportion to each phase's flow ratio,
cycle 60–180 s, minimum green 7 s.

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
- **Synthetic demand for OSM networks** (`engine/scripts/osm-demand-lib.ts`): each entry sends
  (entry lanes × rate) veh/h, split over reachable exits in proportion to their lanes × distance²,
  so trips across the area outweigh turns to a neighbouring exit. Not calibrated.

## Safety nets (reported, never silent)

| Counter | Meaning |
|---|---|
| `rerouted` | stuck in a wrong lane at a stop line for 15 s; took another route from there |
| `droppedWrongLane` | stuck 180 s in a lane that cannot make its turn, with no possible route; removed |
| `droppedGridlock` | head of a queue that has not moved for 300 s; removed (as SUMO's time-to-teleport) |
| `unserved` | demand with no route to its destination |
| `gridlockAt` | first time 20 or more vehicles had been stopped for over 5 minutes |
| `hardestBrake` | strongest braking any moving vehicle used |

## Not modelled

Two-wheelers and lane filtering, buses and stops, pedestrians, parking, actuated or coordinated
signals, roundabouts, U-turns, OSM turn restrictions, overtaking into oncoming lanes, incidents,
weather, and driver error.
