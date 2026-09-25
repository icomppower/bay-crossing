# State

| Gate | Status | Last run | Notes |
|------|--------|----------|-------|
| G0 Data check | PASS | 2026-09-24 | 4 sources cached + checksummed (81 MB); 5/5 negative mutations caught |
| G1 Clean fork | PASS | 2026-09-24 | D7 removals, build, audit, real App renders ocean + sky headless; 5/5 negatives caught |
| G2a Terrain + bathymetry pipeline | PASS | 2026-09-24 | 256 tiles byte-identical ×2 offline, = public/terrain, plausible, no seam cliffs, loader exact; 7/7 negatives |
| G2b Building pipeline | PASS | 2026-09-24 | 10,309 buildings / 569k tris in 39 tiles, byte-identical ×2 offline, = public/buildings, winding/ground/LiDAR checks, loader exact; 6/6 negatives |
| G2c Landmarks + LOD | PASS | 2026-09-24 | 5 Blender landmarks × 3 LODs; 39 tiles × 3 merged LODs; caps frozen (city 302,670 / frame 1,953,488 tris / 126 draws / tile 77,209); 6/6 negatives |
| G3 Georeference | PASS | 2026-09-24 | 6 gated control points 1.1–6.5 m vs NOAA ENC / OSM, tolerance 10 m (frozen); 3/3 shifted datasets fail |
| G4 Ferry | PASS | 2026-09-24 | Gate C → Sausalito in 18.03 min (range 8.56–30), min 2.80 m under a 1.5 m draft, 0 keel contacts; 3/3 negatives (shoal, 5 kn, unreachable berth) |
| G5 M4 budget | not started | | |
| G6 Look (advisory) | not started | | |

## Current

G0–G4 are green. The drivable ferry (MV Golden Gate class, `FerryModel` + `FerryController`) is moored at
Ferry Building Gate C. The helmsman (P) sails `public/ferry/route.json` to Sausalito in about 18 min
(D33–D35). A full verify.sh run is in progress after the ferry swap.

Next: G5 M4 budget. A scripted camera path at the `low` tier (D6 config), an fps floor (calibrate, target ≥ 30 @
1080p), a GPU memory cap, and no swap during the run. This needs real-GPU frame timing on the M4 (a Dawn Metal
backend in Node), not headless SwiftShader.
