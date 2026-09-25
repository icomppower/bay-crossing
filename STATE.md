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
| G5 M4 budget | BLOCKED | 2026-09-24 | 49.8 fps p95 @1080p low (floor 40 frozen), 0 swap-outs; GPU-memory metric was wrong (22 MB vs ~717 MB real) and its frozen cap needs replacing — BLOCKED.md |
| G6 Look (advisory) | PASS | 2026-09-24 | shots/golden-hour.png, blue-hour.png, night.png (solar 17.47 / 18.40 / 19.25 h) for human review |

## Current

**BLOCKED at G5.** See `BLOCKED.md` for the one question (replace the frozen GPU-memory cap, which was
calibrated on a metric that missed Metal's "(graphics)" footprint categories).

Last full verify.sh run: G0–G4 PASS, G5 FAIL (the negative leak fixture passed), G6 PASS (advisory). The shots
in `shots/` are ready for review.

Next on a yes: fix `gpuMemory()` in `gates/g5.mjs` (sum every "(graphics)" category), drop
`G5.gpuMemoryMB` from SPEC-THRESHOLDS.md via a DECISIONS entry citing BLOCKED.md, recalibrate, then run a clean
`./verify.sh` and create `DONE` if G0–G5 are green.
