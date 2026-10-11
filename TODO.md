# TODO

- [x] G0 Data check — SF building footprints + heights, Sausalito OSM buildings, USGS 3DEP terrain, NOAA bathymetry; scripted, cached, checksummed, licences in CREDITS
- [x] G1 Clean fork — D7 removals, build, ocean + sky in headless Dawn, dependency audit
- [x] G2a Terrain + bathymetry pipeline — raw → tiles, byte-identical ×2 from cache
- [x] G2b Building pipeline — footprints + heights → extruded tiles, byte-identical ×2 from cache
- [x] G2c Landmarks + LOD — offline-Blender landmark GLBs, per-CDLOD-tile merge, triangle/draw caps (calibrate)
- [x] G3 Georeference — ≥5 control points within tolerance; shifted dataset fails
- [x] G4 Ferry — Ferry Building → Sausalito, cited schedule range, draft clearance on route
- [x] G5 M4 budget — scripted camera path at `low`, fps floor, GPU memory cap, no swap
- [x] G6 Look (advisory) — golden hour / blue hour / night shots in `shots/`

## Run 3 — Facades

- [x] G15 Heights frozen
- [x] G16 Classification
- [x] G17 Floor + bay alignment
- [x] G18 Depth elements
- [x] G18b SF look (no HK drift)
- [x] G19 Materials + windows
- [ ] G20 Facade budget — near-band cap frozen and green; fps / memory half on the M4
- [ ] G21 Look (advisory) — full set on the M4 (software renders of 4 views in shots/facades/)
- [ ] Full `./verify.sh` on the M4 → `DONE-run3` → merge `facades` → `main`
