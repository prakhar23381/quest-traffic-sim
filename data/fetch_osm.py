"""Fetch drivable roads in a bounding box from OpenStreetMap.

    python3 data/fetch_osm.py <south> <west> <north> <east> <out.json>

Uses the main OSM API `map` call (Overpass was unreachable from the build
machine). The call returns every feature in the box, so roads are filtered here.
Large boxes are split into tiles to stay under the API's per-request node limit.
Writes an Overpass-style JSON ({"elements": [...]}) containing only road ways and
their nodes. The full downloads are cached in data/.cache/ (not committed).

Standard library only. The request carries only the bounding box and a generic
client name. Map data © OpenStreetMap contributors, ODbL 1.0.
"""
import json
import os
import sys
import time
import urllib.error
import urllib.request
import xml.etree.ElementTree as ET
from datetime import datetime, timezone

API = "https://api.openstreetmap.org/api/0.6/map?bbox={w},{s},{e},{n}"
HIGHWAYS = {
    "motorway", "trunk", "primary", "secondary", "tertiary",
    "motorway_link", "trunk_link", "primary_link", "secondary_link", "tertiary_link",
}
CACHE = os.path.join(os.path.dirname(os.path.abspath(__file__)), ".cache")
UA = "traffic-sim-osm-fetch/0.1"


def fetch_tile(s, w, n, e):
    """Return parsed XML root for a tile, splitting it if the API refuses (too many nodes)."""
    os.makedirs(CACHE, exist_ok=True)
    path = os.path.join(CACHE, f"map_{s:.5f}_{w:.5f}_{n:.5f}_{e:.5f}.osm")
    if not os.path.exists(path):
        url = API.format(s=s, w=w, n=n, e=e)
        req = urllib.request.Request(url, headers={"User-Agent": UA})
        try:
            with urllib.request.urlopen(req, timeout=60) as r:
                body = r.read()
        except urllib.error.HTTPError as err:
            if err.code == 400:  # too many nodes: split into four
                print(f"  tile too large, splitting: {s},{w},{n},{e}")
                ms, mw = (s + n) / 2, (w + e) / 2
                return [t for q in ((s, w, ms, mw), (s, mw, ms, e), (ms, w, n, mw), (ms, mw, n, e)) for t in fetch_tile(*q)]
            raise
        with open(path, "wb") as f:
            f.write(body)
        time.sleep(1)  # be polite to the API
        print(f"  fetched tile {s},{w},{n},{e}: {len(body) / 1e6:.1f} MB")
    return [ET.parse(path).getroot()]


def main() -> None:
    s, w, n, e = (float(x) for x in sys.argv[1:5])
    out = sys.argv[5]
    roots = fetch_tile(s, w, n, e)

    nodes, ways = {}, {}
    for root in roots:
        for el in root:
            if el.tag == "node":
                tags = {t.get("k"): t.get("v") for t in el.findall("tag")}
                nodes[int(el.get("id"))] = {"type": "node", "id": int(el.get("id")), "lat": float(el.get("lat")), "lon": float(el.get("lon")), **({"tags": tags} if tags else {})}
            elif el.tag == "way":
                tags = {t.get("k"): t.get("v") for t in el.findall("tag")}
                if tags.get("highway") not in HIGHWAYS:
                    continue
                if tags.get("access") in ("no", "private") or tags.get("motor_vehicle") == "no":
                    continue
                ways[int(el.get("id"))] = {"type": "way", "id": int(el.get("id")), "nodes": [int(nd.get("ref")) for nd in el.findall("nd")], "tags": tags}

    needed = {nid for wy in ways.values() for nid in wy["nodes"]}
    missing = needed - nodes.keys()
    if missing:
        print(f"warning: {len(missing)} referenced nodes missing; ways touching them are trimmed")
        for wy in ways.values():
            wy["nodes"] = [x for x in wy["nodes"] if x in nodes]
    elements = [nodes[i] for i in sorted(needed & nodes.keys())] + [ways[i] for i in sorted(ways)]
    data = {
        "elements": elements,
        "_fetch": {
            "endpoint": API.split("?")[0],
            "bbox": [s, w, n, e],
            "filter": f"ways with highway in {sorted(HIGHWAYS)}, excluding access=no/private",
            "fetched_utc": datetime.now(timezone.utc).isoformat(timespec="seconds"),
            "license": "Map data © OpenStreetMap contributors, ODbL 1.0 (https://www.openstreetmap.org/copyright)",
        },
    }
    with open(out, "w") as f:
        json.dump(data, f, separators=(",", ":"))
    print(f"wrote {out}: {len(ways)} road ways, {len(needed)} nodes ({os.path.getsize(out) / 1e3:.0f} kB)")


if __name__ == "__main__":
    main()
