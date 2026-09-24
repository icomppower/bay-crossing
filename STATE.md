# State

| Gate | Status | Last run | Notes |
|------|--------|----------|-------|
| G0 Data check | PASS | 2026-09-24 | 4 sources cached + checksummed (81 MB); 5/5 negative mutations caught |
| G1 Clean fork | PASS | 2026-09-24 | D7 removals, build, audit, real App renders ocean + sky headless; 5/5 negatives caught |
| G2a Terrain + bathymetry pipeline | PASS | 2026-09-24 | 256 tiles byte-identical ×2 offline, = public/terrain, plausible, no seam cliffs, loader exact; 7/7 negatives |
| G2b Building pipeline | not started | | |
| G2c Landmarks + LOD | not started | | |
| G3 Georeference | not started | | |
| G4 Ferry | not started | | |
| G5 M4 budget | not started | | |
| G6 Look (advisory) | not started | | |

## Current

G0, G1 and G2a are green. The app now loads the real bay floor (`public/terrain/`, built by
`node tools/terrain/build.mjs`) in local-MSL heights (D20, D21). Piers are not in the DEM (D22).

Next: G2b Building pipeline. SF footprints + LiDAR heights and Sausalito OSM (levels × 3 m, else a logged
default) → extruded building tiles with procedural facades, byte-identical across two offline runs from cache.
