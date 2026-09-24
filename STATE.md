# State

| Gate | Status | Last run | Notes |
|------|--------|----------|-------|
| G0 Data check | PASS | 2026-09-24 | 4 sources cached + checksummed (81 MB); 5/5 negative mutations caught |
| G1 Clean fork | PASS | 2026-09-24 | D7 removals, build, audit, real App renders ocean + sky headless; 5/5 negatives caught |
| G2a Terrain + bathymetry pipeline | PASS | 2026-09-24 | 256 tiles byte-identical ×2 offline, = public/terrain, plausible, no seam cliffs, loader exact; 7/7 negatives |
| G2b Building pipeline | PASS | 2026-09-24 | 10,309 buildings / 569k tris in 39 tiles, byte-identical ×2 offline, = public/buildings, winding/ground/LiDAR checks, loader exact; 6/6 negatives |
| G2c Landmarks + LOD | PASS | 2026-09-24 | 5 Blender landmarks × 3 LODs; 39 tiles × 3 merged LODs; caps frozen (city 302,670 / frame 1,953,488 tris / 126 draws / tile 77,209); 6/6 negatives |
| G3 Georeference | PASS | 2026-09-24 | 6 gated control points 1.1–6.5 m vs NOAA ENC / OSM, tolerance 10 m (frozen); 3/3 shifted datasets fail |
| G4 Ferry | not started | | |
| G5 M4 budget | not started | | |
| G6 Look (advisory) | not started | | |

## Current

G0–G3 are green (full verify.sh run, 5.5 min). Nine cached sources. The Ferry Building comes from OSM parts
(D31). Ferry facts (terminal berths, published 30 min crossing) are in `public/ferry/schedule.json` (D30).

Next: G4 Ferry. Hull from published dimensions of a Sausalito-route vessel (cite); a route from the SF
Gate B/C berths to the Sausalito landing planned on the NCEI bathymetry (draft clearance); a crossing that
completes within the cited schedule range; the hull never in water shallower than its draft.
