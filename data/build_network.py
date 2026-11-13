"""Convert an Overpass OSM extract into a NetworkSpec JSON for the traffic engine.

    python3 -I data/build_network.py <raw.osm.json> <out.network.json> \
        --crop S W N E [--id ID] [--name NAME] [--overrides overrides.json]

Standard library only. Steps:
  1. crop ways to the study area; where a road crosses the edge, add a boundary node
  2. split ways into directed segments between intersections
  3. join intersection nodes linked by a short segment on the same layer into one
     junction (OSM draws a big junction as several nodes; a flyover deck never
     shares a node with the road below it, so it is never joined to it)
  4. mark junctions signalised if a traffic_signals node lies within SIGNAL_RADIUS
  5. drop dead ends and links no vehicle can use; merge pass-through nodes
Every imputed value is counted and reported (see "imputed" in the output metadata).
Map data © OpenStreetMap contributors, ODbL 1.0.
"""
import argparse
import json
import math
from collections import defaultdict

SMALL_BRIDGE = 30.0  # m: bridges shorter than this that cross no road are treated as ground level
MIN_USABLE = 20.0  # m: a link must keep at least this much road after the engine trims it
# back from the junctions at its ends; otherwise its end nodes are joined into one junction.
# (On shorter links lane changes are impossible and the don't-block-the-box rule sees the
# link as permanently full. Measured on Silk Board before this rule: 53 vehicles dropped and
# gridlock within 9 minutes at the lowest demand.)
SIGNAL_RADIUS = 35.0  # m
MIN_LINK = 1.0  # m

# Per-direction defaults by road class (imputed when OSM has no tag).
DEFAULT_LANES_ONEWAY = {"motorway": 3, "trunk": 3, "primary": 3, "secondary": 2, "tertiary": 2}
DEFAULT_LANES_TWOWAY = {"motorway": 3, "trunk": 2, "primary": 2, "secondary": 1, "tertiary": 1}
DEFAULT_SPEED = {"motorway": 80, "trunk": 60, "primary": 50, "secondary": 40, "tertiary": 30}
LINK_SPEED = 30
LANE_WIDTH = 3.5


def base_class(hw: str) -> str:
    return hw[: -len("_link")] if hw.endswith("_link") else hw


def parse_int(v):
    try:
        return int(str(v).split(";")[0].strip())
    except (TypeError, ValueError):
        return None


def parse_speed(v):
    if v is None:
        return None
    s = str(v).lower().replace("km/h", "").replace("kmh", "").strip()
    if s.endswith("mph"):
        n = parse_int(s[:-3])
        return round(n * 1.609) if n else None
    return parse_int(s)


class Projector:
    def __init__(self, lat0: float, lon0: float):
        self.lat0, self.lon0 = lat0, lon0
        self.kx = 111320.0 * math.cos(math.radians(lat0))
        self.ky = 110540.0

    def __call__(self, lat: float, lon: float):
        return ((lon - self.lon0) * self.kx, (lat - self.lat0) * self.ky)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("raw")
    ap.add_argument("out")
    ap.add_argument("--crop", nargs=4, type=float, required=True, metavar=("S", "W", "N", "E"))
    ap.add_argument("--id", default="osm")
    ap.add_argument("--name", default="OSM network")
    ap.add_argument("--overrides")
    ap.add_argument("--classes", default="motorway,trunk,primary,secondary,tertiary",
                    help="road classes to keep (their _link variants are kept too)")
    args = ap.parse_args()

    raw = json.load(open(args.raw))
    overrides = json.load(open(args.overrides)) if args.overrides else {}
    way_over = overrides.get("ways", {})
    drop_ways = set(str(w) for w in overrides.get("drop_ways", []))

    keep_classes = set(args.classes.split(","))
    imputed = defaultdict(int)
    stats = defaultdict(int)
    S, W, N, E = args.crop
    proj = Projector((S + N) / 2, (W + E) / 2)
    x0, y0 = proj(S, W)
    x1, y1 = proj(N, E)

    nodes = {}
    signal_nodes = []
    ways = []
    excluded = []
    for el in raw["elements"]:
        if el["type"] == "node":
            nodes[el["id"]] = proj(el["lat"], el["lon"])
            if el.get("tags", {}).get("highway") == "traffic_signals":
                signal_nodes.append(el["id"])
        elif el["type"] == "way" and str(el["id"]) not in drop_ways:
            if base_class(el.get("tags", {}).get("highway", "")) in keep_classes:
                ways.append(el)
            else:
                excluded.append(el)

    # Excluded-class roads that are simple chains joining kept roads at exactly their two
    # ends are kept after all: service roads alongside a highway and short connectors
    # between major roads. Without them, closing the Silk Board Flyover left southbound
    # Hosur Road traffic with no route (the ground road is a "tertiary" service road).
    # Neighbourhood street grids branch and touch the main roads in many places: excluded.
    kept_nodes = {n for w in ways for n in w["nodes"]}
    parent_w = {w["id"]: w["id"] for w in excluded}
    def fw(x):
        while parent_w[x] != x:
            parent_w[x] = parent_w[parent_w[x]]
            x = parent_w[x]
        return x
    node_ways = defaultdict(list)
    for w in excluded:
        for n in w["nodes"]:
            node_ways[n].append(w["id"])
    for n, ws in node_ways.items():
        if n in kept_nodes:
            continue  # chains are joined through their own nodes, not through a major road
        for a in ws[1:]:
            parent_w[fw(a)] = fw(ws[0])
    comps = defaultdict(list)
    for w in excluded:
        comps[fw(w["id"])].append(w)
    excluded_nodes = set()
    for comp in comps.values():
        ids = {w["id"] for w in comp}
        cnodes = [n for w in comp for n in w["nodes"]]
        attach = {n for n in cnodes if n in kept_nodes}
        branching = any(len([x for x in node_ways[n] if x in ids]) >= 3 for n in set(cnodes) if n not in kept_nodes)
        ends = [w["nodes"][0] for w in comp] + [w["nodes"][-1] for w in comp]
        if len(attach) == 2 and not branching and attach <= set(ends):
            ways.extend(comp)
            stats["excluded-class chains kept (service roads/connectors)"] += 1
        else:
            stats["ways excluded by class"] += len(comp)
            for w in comp:
                excluded_nodes.update(w["nodes"])

    def inside(p):
        return x0 <= p[0] <= x1 and y0 <= p[1] <= y1

    def edge_point(a, b):
        """Point where segment a(inside)→b(outside) leaves the crop box."""
        t_best = 1.0
        for (lo, hi, i) in ((x0, x1, 0), (y0, y1, 1)):
            d = b[i] - a[i]
            for bound in (lo, hi):
                if d != 0:
                    t = (bound - a[i]) / d
                    if 0 <= t < t_best:
                        q = (a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1]))
                        if x0 - 1e-6 <= q[0] <= x1 + 1e-6 and y0 - 1e-6 <= q[1] <= y1 + 1e-6:
                            t_best = t
        return (a[0] + t_best * (b[0] - a[0]), a[1] + t_best * (b[1] - a[1]))

    # Small bridges over drains and canals are tagged bridge=yes/layer=1 like flyovers, but
    # treating them as elevated would stop the junctions at their ends from being joined and
    # leave unusably short links.
    def _segs(w):
        pts = [nodes[n] for n in w["nodes"] if n in nodes]
        return list(zip(pts, pts[1:]))

    def _cross(a, b, c, d):
        o = lambda p, q, r: (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0])
        return (o(c, d, a) * o(c, d, b) < 0) and (o(a, b, c) * o(a, b, d) < 0)

    def _layer(w):
        t = w.get("tags", {})
        L = parse_int(t.get("layer"))
        return L if L is not None else (1 if t.get("bridge") in ("yes", "viaduct") else 0)

    flatten = set()
    seg_cache = {w["id"]: _segs(w) for w in ways}
    for w in ways:
        if _layer(w) == 0:
            continue
        crosses = any(
            _layer(o) != _layer(w) and _cross(a, b, c, d)
            for o in ways if o is not w
            for (a, b) in seg_cache[w["id"]] for (c, d) in seg_cache[o["id"]]
        )
        pts = [nodes[n] for n in w["nodes"] if n in nodes]
        L = sum(math.dist(pts[i], pts[i + 1]) for i in range(len(pts) - 1))
        # Short and crossing nothing: a culvert or drain bridge. A long deck piece that happens
        # not to cross a road itself (e.g. 88 m of the double-decker) stays elevated, and
        # underpasses (layer < 0) are left alone.
        if not crosses and _layer(w) > 0 and L < SMALL_BRIDGE:
            flatten.add(w["id"])
    stats["bridges flattened (cross no road)"] = len(flatten)

    # ---------------------------------------------------------- 1. crop + attributes
    pos = dict(nodes)  # node id -> (x, y); synthetic boundary nodes get string ids
    boundary = set()
    pieces = []  # (way, attrs, [node ids])
    for w in ways:
        tags = dict(w.get("tags", {}))
        tags.update(way_over.get(str(w["id"]), {}))
        hw = tags.get("highway", "")
        cls = base_class(hw)
        is_link = hw.endswith("_link")
        ow = str(tags.get("oneway", "")).lower()
        if ow in ("yes", "true", "1"):
            dirs = ["f"]
        elif ow == "-1":
            dirs = ["b"]
        elif hw in ("motorway", "motorway_link") or tags.get("junction") == "roundabout":
            dirs = ["f"]
            imputed["oneway (implied by class)"] += 1
        else:
            dirs = ["f", "b"]
        oneway = len(dirs) == 1

        lanes_total = parse_int(tags.get("lanes"))
        per_dir = {}
        for d, key in (("f", "lanes:forward"), ("b", "lanes:backward")):
            v = parse_int(tags.get(key))
            if v:
                per_dir[d] = v
        for d in dirs:
            if d in per_dir:
                continue
            if lanes_total:
                per_dir[d] = lanes_total if oneway else max(1, lanes_total // 2)
            else:
                per_dir[d] = 1 if is_link else (DEFAULT_LANES_ONEWAY if oneway else DEFAULT_LANES_TWOWAY).get(cls, 1)
                imputed["lanes"] += 1
        speed = parse_speed(tags.get("maxspeed"))
        if not speed:
            speed = LINK_SPEED if is_link else DEFAULT_SPEED.get(cls, 30)
            imputed["maxspeed"] += 1
        layer = 0 if w["id"] in flatten else _layer({"tags": tags})
        attrs = {
            "wid": w["id"], "hw": hw, "name": tags.get("name") or tags.get("ref") or "",
            "dirs": dirs, "lanes": per_dir, "speed": speed, "layer": layer, "oneway": oneway,
        }
        # Keep maximal runs of inside nodes; add boundary nodes at the crossings.
        run = []
        ids = w["nodes"]
        for k, nid in enumerate(ids):
            p = nodes[nid]
            if inside(p):
                if not run and k > 0:
                    bid = f"b{w['id']}_{k}"
                    pos[bid] = edge_point(p, nodes[ids[k - 1]])
                    boundary.add(bid)
                    run.append(bid)
                run.append(nid)
            elif run:
                bid = f"b{w['id']}_{k}e"
                pos[bid] = edge_point(nodes[ids[k - 1]], p)
                boundary.add(bid)
                run.append(bid)
                pieces.append((attrs, run))
                run = []
        if len(run) >= 2:
            pieces.append((attrs, run))
    stats["ways"] = len(ways)

    # A way ending exactly on the crop edge without leaving it also counts as boundary.
    def on_edge(p, tol=2.0):
        return min(abs(p[0] - x0), abs(p[0] - x1), abs(p[1] - y0), abs(p[1] - y1)) < tol

    # ------------------------------------------------- 2. split at intersections
    use = defaultdict(int)
    for _, run in pieces:
        for nid in set(run):
            use[nid] += 1
        use[run[0]] += 1
        use[run[-1]] += 1
    is_break = lambda nid: use[nid] >= 2 or nid in boundary
    segs = []  # dict(a, b, pts, attrs, dir)
    for attrs, run in pieces:
        start = 0
        for k in range(1, len(run)):
            if k == len(run) - 1 or is_break(run[k]):
                chain = run[start : k + 1]
                for d in attrs["dirs"]:
                    c = chain if d == "f" else chain[::-1]
                    segs.append({"a": c[0], "b": c[-1], "mid": c[1:-1], "attrs": attrs, "dir": d})
                start = k

    def seg_len(s):
        pts = [pos[s["a"]]] + [pos[m] for m in s["mid"]] + [pos[s["b"]]]
        return sum(math.dist(pts[i], pts[i + 1]) for i in range(len(pts) - 1))

    # ---------------------------------------------------- 3. junction clustering
    parent = {}

    def find(u):
        parent.setdefault(u, u)
        while parent[u] != u:
            parent[u] = parent[parent[u]]
            u = parent[u]
        return u

    def union(u, v):
        parent[find(u)] = find(v)

    degree = defaultdict(set)
    node_layers = defaultdict(set)
    for s in segs:
        degree[s["a"]].add(s["b"])
        degree[s["b"]].add(s["a"])
        node_layers[s["a"]].add(s["attrs"]["layer"])
        node_layers[s["b"]].add(s["attrs"]["layer"])
    junction_like = {n for n, nb in degree.items() if len(nb) >= 3}
    # Same trimming radius the engine uses (engine/src/network.ts): widest incident road + 3 m
    # at junctions, 3 m at pass-through/merge nodes.
    width = defaultdict(float)
    for s_ in segs:
        w_ = s_["attrs"]["lanes"][s_["dir"]] * LANE_WIDTH
        width[s_["a"]] = max(width[s_["a"]], w_)
        width[s_["b"]] = max(width[s_["b"]], w_)
    radius = lambda n: 0.0 if n in boundary else (width[n] + 3 if n in junction_like else 3.0)
    internal = set()
    for i, s in enumerate(segs):
        if s["a"] not in boundary and s["b"] not in boundary:
            # Only join nodes whose roads are all on the same level as the joining segment:
            # a short ramp piece must never pull a flyover node into the junction below it.
            L = s["attrs"]["layer"]
            if node_layers[s["a"]] != {L} or node_layers[s["b"]] != {L}:
                stats["not joined: mixed layers"] += 1
                continue
            if seg_len(s) < radius(s["a"]) + radius(s["b"]) + MIN_USABLE:
                union(s["a"], s["b"])
                internal.add(i)
    clusters = defaultdict(list)
    for n in degree:
        clusters[find(n)].append(n)
    cpos = {}
    for root, members in clusters.items():
        xs = [pos[m][0] for m in members]
        ys = [pos[m][1] for m in members]
        cpos[root] = (sum(xs) / len(xs), sum(ys) / len(ys))
    stats["junction clusters (≥2 OSM nodes)"] = sum(1 for m in clusters.values() if len(m) > 1)

    # ------------------------------------------------------------- 4. signals
    # Layer of each OSM node, from the raw ways through it (signals are tagged on nodes).
    raw_layer = defaultdict(set)
    for attrs, run in pieces:
        for nid_ in run:
            raw_layer[nid_].add(attrs["layer"])
    sig_clusters = set()
    for sn in signal_nodes:
        if sn not in pos or not raw_layer.get(sn):
            continue  # outside the crop, or not on a kept road
        best, bd = None, SIGNAL_RADIUS
        for root, members in clusters.items():
            if len(degree[members[0]]) < 3 and len(members) == 1:
                continue
            # A signal belongs to a junction on its own level, never to a deck above or below.
            if not any(raw_layer[sn] & node_layers[m] for m in members):
                continue
            d = math.dist(pos[sn], cpos[root])
            if d < bd:
                best, bd = root, d
        if best is not None:
            sig_clusters.add(best)

    # ------------------------------------------------ links between clusters
    links = []
    for i, s in enumerate(segs):
        if i in internal:
            continue
        a, b = find(s["a"]), find(s["b"])
        if a == b:
            stats["dropped: loop within a junction"] += 1
            continue
        L = seg_len(s)
        if L < MIN_LINK:
            continue
        links.append({
            "from": a, "to": b,
            "mid": [pos[m] for m in s["mid"]],
            "lanes": s["attrs"]["lanes"][s["dir"]],
            "speed": s["attrs"]["speed"], "layer": s["attrs"]["layer"],
            "oneway": s["attrs"]["oneway"], "name": s["attrs"]["name"], "hw": s["attrs"]["hw"],
            "wid": s["attrs"]["wid"], "dir": s["dir"],
        })

    # Parallel links (same endpoints and direction) are kept: at Silk Board they are real,
    # e.g. a 3-lane Hosur Road carriageway with a 2-lane service road beside it. An earlier
    # version kept only the widest and silently dropped the service road.
    pair_count = defaultdict(int)
    for l in links:
        pair_count[(l["from"], l["to"])] += 1
    stats["parallel links kept"] = sum(c for c in pair_count.values() if c > 1)

    # -------------------------------------------- 5. prune unusable / dead ends
    bnodes = {find(b) for b in boundary}
    bnodes |= {find(n) for n in degree if on_edge(pos[n])}
    # A kept road whose only continuation was an excluded road ends there as if it left the
    # study area: e.g. double-decker ramps landing on tertiary streets become exits/entries
    # instead of being pruned as dead ends (which removed the whole layer-2 interchange).
    # The test is "no kept way in, or no kept way out": a ramp merging with a slip road that
    # then continues as a tertiary street has two ways in and none out.
    has_in, has_out = set(), set()
    for l in links:
        has_out.add(l["from"])
        has_in.add(l["to"])
    cut = {
        r for r in has_in | has_out
        if r not in bnodes and (r not in has_in or r not in has_out) and any(m in excluded_nodes for m in clusters[r])
    }
    stats["cut ends made entry/exit (continued on an excluded road)"] = len(cut)
    bnodes |= cut
    changed = True
    while changed:
        changed = False
        outs, ins = defaultdict(list), defaultdict(list)
        for l in links:
            outs[l["from"]].append(l)
            ins[l["to"]].append(l)
        # forward reachability from boundary origins, backward from boundary destinations
        fwd, stack = set(), [n for n in bnodes if outs[n]]
        while stack:
            n = stack.pop()
            if n in fwd:
                continue
            fwd.add(n)
            stack.extend(l["to"] for l in outs[n])
        bwd, stack = set(), [n for n in bnodes if ins[n]]
        while stack:
            n = stack.pop()
            if n in bwd:
                continue
            bwd.add(n)
            stack.extend(l["from"] for l in ins[n])
        keep = [l for l in links if l["from"] in fwd and l["to"] in bwd]
        if len(keep) != len(links):
            stats["dropped: unreachable or dead-end links"] += len(links) - len(keep)
            links = keep
            changed = True
            continue
        # Dead-end stubs: an inner node whose only neighbour is one other node. A loop
        # n20→n22→n20 passes the reachability test above, but the engine would treat
        # n22 as an entry/exit point and create traffic in the middle of the network.
        nbrs = defaultdict(set)
        for l in links:
            nbrs[l["from"]].add(l["to"])
            nbrs[l["to"]].add(l["from"])
        stubs = {n for n, nb in nbrs.items() if len(nb) <= 1 and n not in bnodes}
        if stubs:
            keep = [l for l in links if l["from"] not in stubs and l["to"] not in stubs]
            stats["dropped: dead-end stub links"] += len(links) - len(keep)
            links = keep
            changed = True
            continue

    # Keep only the largest connected network (ignoring direction): roads that cross the
    # study area without touching the rest of it carry no interaction worth simulating.
    adj = defaultdict(set)
    for l in links:
        adj[l["from"]].add(l["to"])
        adj[l["to"]].add(l["from"])
    comps, seen_c = [], set()
    for start in adj:
        if start in seen_c:
            continue
        comp, stack = set(), [start]
        while stack:
            n = stack.pop()
            if n in comp:
                continue
            comp.add(n)
            stack.extend(adj[n] - comp)
        seen_c |= comp
        comps.append(comp)
    main = max(comps, key=len)
    before = len(links)
    links = [l for l in links if l["from"] in main]
    stats["dropped: links in disconnected pieces"] = before - len(links)
    stats["disconnected pieces dropped"] = len(comps) - 1

    # A signal needs at least two approaches; a lone signal tag on a single approach
    # (typically a pedestrian crossing) would just stop traffic every cycle for nothing.
    in_from = defaultdict(set)
    for l in links:
        in_from[l["to"]].add(l["from"])
    lone = {c for c in sig_clusters if len(in_from[c]) < 2}
    stats["signal tags ignored (fewer than 2 approaches)"] = len(lone)
    sig_clusters -= lone

    # ------------------------------------------- merge pass-through nodes
    def mergeable(n, outs, ins):
        if n in bnodes or n in sig_clusters:
            return False
        o, i = outs[n], ins[n]
        if not (len(o) == len(i) and 1 <= len(o) <= 2):
            return False
        nbrs = {l["to"] for l in o} | {l["from"] for l in i}
        if len(nbrs) != len(o):  # a simple chain node: each in-link continues to one out-link
            return False
        for li in i:
            cont = [lo for lo in o if lo["to"] != li["from"]]
            if len(cont) != 1:
                return False
            lo = cont[0]
            if (li["lanes"], li["speed"], li["layer"]) != (lo["lanes"], lo["speed"], lo["layer"]):
                return False
        return True

    merged = 0
    while True:
        outs, ins = defaultdict(list), defaultdict(list)
        for l in links:
            outs[l["from"]].append(l)
            ins[l["to"]].append(l)
        cand = next((n for n in list(outs) if mergeable(n, outs, ins)), None)
        if cand is None:
            break
        for li in list(ins[cand]):
            lo = next(x for x in outs[cand] if x["to"] != li["from"])
            li["mid"] = li["mid"] + [cpos[cand]] + lo["mid"]
            li["to"] = lo["to"]
            links.remove(lo)
            merged += 1
    stats["merged pass-through nodes"] = merged

    # -------------------------------------------------------------- output
    used = {l["from"] for l in links} | {l["to"] for l in links}
    nid = {}
    out_nodes = []
    for k, root in enumerate(sorted(used, key=lambda r: (cpos[r][0], cpos[r][1]))):
        nid[root] = f"n{k}"
        node = {"id": f"n{k}", "x": round(cpos[root][0], 2), "y": round(cpos[root][1], 2)}
        # Every kind is explicit, so the engine never has to infer one.
        node["kind"] = "boundary" if root in bnodes else "signal" if root in sig_clusters else "priority"
        out_nodes.append(node)
    out_links = []
    seen = defaultdict(int)
    for l in links:
        base = f"w{l['wid']}{'+' if l['dir'] == 'f' else '-'}"
        seen[base] += 1
        lid = base if seen[base] == 1 else f"{base}{seen[base]}"
        spec = {
            "id": lid, "from": nid[l["from"]], "to": nid[l["to"]], "lanes": l["lanes"],
            "speedLimitKmh": l["speed"],
        }
        if l["mid"]:
            spec["points"] = [[round(p[0], 2), round(p[1], 2)] for p in l["mid"]]
        if l["layer"]:
            spec["layer"] = l["layer"]
        if l["oneway"]:
            spec["offset"] = 0  # OSM geometry of a one-way way is already the carriageway centre
        if l["name"]:
            spec["name"] = l["name"]
        spec["osm"] = {"way": l["wid"], "highway": l["hw"]}
        out_links.append(spec)

    net = {
        "id": args.id,
        "name": args.name,
        "description": "Built from OpenStreetMap. Lane counts and speed limits missing in OSM are imputed by road class.",
        "nodes": out_nodes,
        "links": out_links,
        "meta": {
            "source": raw.get("_fetch", {}),
            "crop": [S, W, N, E],
            "projection": {"lat0": proj.lat0, "lon0": proj.lon0, "kx": proj.kx, "ky": proj.ky},
            "attribution": "Map data © OpenStreetMap contributors, ODbL 1.0",
            "imputed": dict(imputed),
            "stats": dict(stats),
        },
    }
    with open(args.out, "w") as f:
        json.dump(net, f, indent=1)
    print(f"wrote {args.out}: {len(out_nodes)} nodes ({sum(1 for n in out_nodes if n.get('kind') == 'boundary')} boundary, "
          f"{sum(1 for n in out_nodes if n.get('kind') == 'signal')} signal), {len(out_links)} links")
    print("imputed:", dict(imputed))
    print("stats:", dict(stats))


if __name__ == "__main__":
    main()
