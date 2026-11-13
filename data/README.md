# Data: real road networks from OpenStreetMap

Map data © [OpenStreetMap contributors](https://www.openstreetmap.org/copyright), licensed under the
Open Database License (ODbL) 1.0. The extract in `raw/` and the networks derived from it in
`../networks/` are covered by the ODbL.

## Silk Board junction, Bengaluru

```bash
# 1. Download roads in a box (main OSM API; standard library only). Already done: the
#    result is committed as data/raw/silk-board.osm.json (fetched 2026-11-13).
python3 data/fetch_osm.py 12.9090 77.6130 12.9255 77.6330 data/raw/silk-board.osm.json

# 2. Convert to the engine's network format (crop, junction joining, layers, signals).
python3 -I data/build_network.py data/raw/silk-board.osm.json networks/silk-board.network.json \
  --crop 12.9127 77.6168 12.9217 77.6288 --id silk-board --name "Silk Board junction, Bengaluru" \
  --overrides data/overrides/silk-board.json --classes motorway,trunk,primary,secondary

# 3. Add synthetic demand (120 veh/h per entry lane), design lane use and signal timings for it.
cd engine && npx tsx scripts/osm-demand.ts ../networks/silk-board.network.json ../networks/silk-board.json 120

# Check by eye (as the engine builds it) and sweep demand levels:
npx tsx scripts/render-network.ts ../networks/silk-board.network.json /tmp/silk-board.svg
SEEDS=1,2,3 LEVELS=120,240 npx tsx scripts/osm-demand.ts ../networks/silk-board.network.json /dev/null 0 --sweep
```

The Overpass API was unreachable from the build machine, so `fetch_osm.py` uses the main OSM API's
`map` call for one small box (about 2 × 2 km) and keeps only drivable road classes.

`overrides/silk-board.json` holds hand fixes on top of OSM (none applied yet). Way 1351994264, a
Ragigudda–Silk Board flyover ramp, is named "(u/c)" (under construction) but tagged as an open road
with a 2024 check date; it is kept, and can be excluded by adding it to `drop_ways`.

Every choice the converter makes is listed in [docs/MODEL.md](../docs/MODEL.md), and the evidence for
them in [docs/VALIDATION.md](../docs/VALIDATION.md) §8.
