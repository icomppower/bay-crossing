# TODO

- [x] G0 Data check — SF building footprints + heights, Sausalito OSM buildings, USGS 3DEP terrain, NOAA bathymetry; scripted, cached, checksummed, licences in CREDITS
- [x] G1 Clean fork — D7 removals, build, ocean + sky in headless Dawn, dependency audit
- [x] G2a Terrain + bathymetry pipeline — raw → tiles, byte-identical ×2 from cache
- [x] G2b Building pipeline — footprints + heights → extruded tiles, byte-identical ×2 from cache
- [x] G2c Landmarks + LOD — offline-Blender landmark GLBs, per-CDLOD-tile merge, triangle/draw caps (calibrate)
- [x] G3 Georeference — ≥5 control points within tolerance; shifted dataset fails
- [ ] G4 Ferry — Ferry Building → Sausalito, cited schedule range, draft clearance on route
- [ ] G5 M4 budget — scripted camera path at `low`, fps floor, GPU memory cap, no swap
- [ ] G6 Look (advisory) — golden hour / blue hour / night shots in `shots/`
