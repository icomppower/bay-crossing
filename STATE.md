# State

| Gate | Status | Last run | Notes |
|------|--------|----------|-------|
| G0 Data check | PASS | 2026-09-24 | 4 sources cached + checksummed (81 MB); 5/5 negative mutations caught |
| G1 Clean fork | PASS | 2026-09-24 | D7 removals, build, audit, real App renders ocean + sky headless; 5/5 negatives caught |
| G2a Terrain + bathymetry pipeline | PASS | 2026-09-24 | 256 tiles byte-identical ×2 offline, = public/terrain, plausible, no seam cliffs, loader exact; 7/7 negatives |
| G2b Building pipeline | PASS | 2026-09-24 | 10,309 buildings / 569k tris in 39 tiles, byte-identical ×2 offline, = public/buildings, winding/ground/LiDAR checks, loader exact; 6/6 negatives |
| G2c Landmarks + LOD | not started | | |
| G3 Georeference | not started | | |
| G4 Ferry | not started | | |
| G5 M4 budget | not started | | |
| G6 Look (advisory) | not started | | |

## Current

G0–G2b are green. The app loads the bay floor and 10,309 extruded buildings (`public/buildings/`, built by
`node tools/buildings/build.mjs`) with procedural facades (D24). Landmark footprints are excluded (D25).

Next: G2c Landmarks + LOD. Build the Ferry Building, Coit Tower, Transamerica, Golden Gate Bridge and Alcatraz
procedurally in Blender (offline, headless) into LOD GLBs; add building LODs merged per CDLOD tile; calibrate
triangle and draw-call caps into SPEC-THRESHOLDS.md.
