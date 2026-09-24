# State

| Gate | Status | Last run | Notes |
|------|--------|----------|-------|
| G0 Data check | PASS | 2026-09-24 | 4 sources cached + checksummed (81 MB); 5/5 negative mutations caught |
| G1 Clean fork | PASS | 2026-09-24 | D7 removals, build, audit, real App renders ocean + sky headless; 5/5 negatives caught |
| G2a Terrain + bathymetry pipeline | PASS | 2026-09-24 | 256 tiles byte-identical ×2 offline, = public/terrain, plausible, no seam cliffs, loader exact; 7/7 negatives |
| G2b Building pipeline | PASS | 2026-09-24 | 10,309 buildings / 569k tris in 39 tiles, byte-identical ×2 offline, = public/buildings, winding/ground/LiDAR checks, loader exact; 6/6 negatives |
| G2c Landmarks + LOD | PASS | 2026-09-24 | 5 Blender landmarks × 3 LODs; 39 tiles × 3 merged LODs; caps frozen (city 302,670 / frame 1,953,488 tris / 126 draws / tile 77,209); 6/6 negatives |
| G3 Georeference | not started | | |
| G4 Ferry | not started | | |
| G5 M4 budget | not started | | |
| G6 Look (advisory) | not started | | |

## Current

G0–G2c are green. The scene has the terrain, 10,309 buildings with three LODs per 600 m tile, and five Blender
landmarks with three LODs each. Caps are frozen in SPEC-THRESHOLDS.md (D29).

Next: G3 Georeference. At least 5 control points (Ferry Building tower, pier ends, Coit Tower, the Sausalito
ferry landing, a Golden Gate tower), measured where the scene puts them (data-derived: SF footprints, DEM)
against OSM positions (independent). Tolerance is calibrated (≤ 10 m); a shifted dataset must fail.
