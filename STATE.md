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
| G5 M4 budget | PASS | 2026-09-25 | 51.5 fps p95 @1080p low (floor 40), GPU memory 689 MB (cap 862, recalibrated per D36), 0 swap-outs; 3/3 negatives |
| G7 Baseline-limits compile | PASS | 2026-09-26 | low / mobile / high × ferry / fly at WebGPU default limits, no optional features: 0 failed pipelines, 0 validation errors; 6/6 negatives (5 reverted fixes + unclamped adapter) |
| G6 Look (advisory) | PASS | 2026-09-24 | shots/golden-hour.png, blue-hour.png, night.png (solar 17.47 / 18.40 / 19.25 h) for human review |
| G8 Street data | PASS | 2026-10-07 | OSM streets SF 9.5 MB + Sausalito 0.6 MB (Overpass), DataSF 12,846 trees (PDDL read from metadata), cached + checksummed; 7/7 negatives |
| G9 Road mesh | PASS | 2026-10-07 | 99.53 % of drivable centerline meshed (floor frozen 99.0 %), max building penetration 0.09 m, 1,505 junctions watertight, mesh area = region area, byte-identical offline ×2 = shipped; 6/6 negatives |
| G10 Sidewalks + walkability | PASS | 2026-10-07 | 2,183 built-up road sides with curb + sidewalk (D66); real Player walks Ferry Building → Pier 39 (1,887 m) on the street mesh, 0 frames off / under; 3/3 negatives |
| G11 Storefront band | PASS | 2026-10-07 | 64,221 modules; 36,407 / 36,411 street-facing edges carry them (floor frozen 97 %); 133 sign strings, all generic, none an OSM name; byte-identical ×2 = shipped; 5/5 negatives |
| G12 Props | PASS | 2026-10-07 | 12,844 trees vs DataSF 12,846 (0.02 %), seeded lamps 24–36 m apart (2,440 gaps), 13 prop types instanced; with the street layer the run-1 frame caps hold at all views; street layer ≤ 231k triangles (cap frozen 260,359, D72); 4/4 negatives |
| G12b Crowd | TODO | — | run 2 |
| G13 Street-level budget | TODO | — | run 2 |
| G14 Street look (advisory) | TODO | — | run 2 |

## Current

**Run 2 (street level)** started 2026-10-07 on branch `street-level` (SPEC.md "Run 2 — Street level", D45–D60).
Baseline before the run: full `./verify.sh` green (G0–G5, G7; G6 advisory).

### Run 1

**Harbor Engine title** since 2026-09-26 (D44): G0–G7 re-verified green on harbor-engine v1.0.0.

**DONE.** G0–G5 green in one clean `./verify.sh` run (G6 advisory green); see `DONE`. The G5 block was resolved
by the owner (docs/resolved-blocks.md, D36).

Per D2, expanding the slice (full corridor) is now allowed but not started. Known gaps: Embarcadero pier decks
are not walkable, the ferry is helm-only, Salesforce Tower is missing (2016 heights), Alcatraz is uncertain to
~14 m.
