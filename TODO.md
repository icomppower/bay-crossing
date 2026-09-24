# TODO

- [ ] G0 Data check — fetch one LandsD tile over TST (DTM + 3D buildings), convert to GLB headlessly
- [ ] G1 Clean fork — D7 removals, build, ocean + sky in headless Dawn, dependency audit
- [ ] G2a Terrain pipeline — DTM → terrain tiles, byte-identical ×2
- [ ] G2b Building pipeline — buildings → GLB tiles, byte-identical ×2, cached
- [ ] G2c Merge + LOD — per-CDLOD-tile merge, distant LODs, triangle/draw caps (calibrate)
- [ ] G3 Georeference — ≥5 control points within tolerance; shifted dataset fails
- [ ] G4 Ferry — TST → Central crossing, cited duration range, draft clearance on route
- [ ] G5 M4 budget — scripted camera path at `low`, fps floor, GPU memory cap, no swap
- [ ] G6 Look (advisory) — golden hour / blue hour / night shots in `shots/`
