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
| G10 Sidewalks + walkability | PASS | 2026-10-07 | 2,183 built-up road sides with curb + sidewalk (D66); real Player walks Ferry Building → Pier 39 (1,881 m) on the street mesh, 0 frames off / under (pinholes bridged for the player too); 3/3 negatives |
| G11 Storefront band | PASS | 2026-10-07 | 64,221 modules; 36,407 / 36,411 street-facing edges carry them (floor frozen 97 %); 133 sign strings, all generic, none an OSM name; byte-identical ×2 = shipped; 5/5 negatives |
| G12 Props | PASS | 2026-10-07 | 12,844 trees vs DataSF 12,846 (0.02 %), seeded lamps 24–36 m apart (2,440 gaps), 13 prop types instanced; with the street layer the run-1 frame caps hold at all views; street layer ≤ 229k triangles (cap frozen 260,359, D72; cars, palms and trees cast shadows within 70 m); 4/4 negatives |
| G12b Crowd | PASS | 2026-10-07 | ≥ 174 pedestrians visible or near all along the Ferry Building → Pier 39 path (floor frozen 156); 17,000 stay on the walkable surface for 60 s; instanced; seeded; 4/4 negatives |
| G13 Street-level budget | PASS | 2026-10-07 | street path 58.5 fps p95 / 763 MB; G5 path with the street layer 48.6 fps / 776 MB (floor 40, cap 862), no swap; 3/3 negatives |
| G14 Street look (advisory) | PASS | 2026-10-07 | shots/street/: Ferry plaza, Embarcadero at Pier 7, Sausalito Bridgeway × midday / night / golden fog, + run-1 before pairs |
| G15 Heights frozen | PASS | 2026-10-11 | 118 files of public/buildings/ byte-identical to run 2 (gates/fixtures/buildings-run2.sha256); 10,309 buildings read back; 2/2 negatives |
| G16 Classification | PASS | 2026-10-11 | 10,309 buildings: Victorian 5,971, mid-rise 1,198, warehouse 489, office 209, tower 144, pier 18, Sausalito 1,823, Chinatown 457; 64.0 % by rules alone (cap frozen 67 %); model identical ×2; 2/2 negatives |
| G17 Floor + bay alignment | PASS | 2026-10-11 | 197,535 walls: shader window rows = floors on all; 95,098 windowed walls in whole bays between corner piers; 2/2 negatives |
| G18 Depth elements | PASS | 2026-10-11 | near the path: flat roofs dressed 100 % (frozen 98 %), pre-war faces with fire escapes 83.3 % (frozen 81 %); slice: Victorian faces with bays 97.7 % (frozen 95 %); 3/3 negatives |
| G18b SF look | PASS | 2026-10-11 | no HK-only detail types; balconies only in Chinatown; 17,681 Victorian lots all with bays; 4,471 adjacent Victorian pairs, none sharing a colour; tops = run 2; 4/4 negatives |
| G19 Materials + windows | PASS | 2026-10-11 | no facade textures (all by code); 4 material families on the path (stucco, brick, siding, ashlar); lit at night residential 39.9 %, office 45.7 %; 4/4 negatives |
| G20 Facade budget | PENDING (M4) | 2026-10-11 | near band ≤ 61,432 triangles along the path (cap frozen 76,790); fixed views with facades (lavapipe count): +7 draws / +10.8k triangles at worst (embarcadero-street 74 draws, 1,797,599 triangles; caps 126 / 1,953,488); the fps / memory half runs G13 on the M4 — not measurable in the cloud workspace (no GPU) |
| G21 Facade look (advisory) | — | | run 3 |

## Current

**Run 3 (facades): built on branch `facades`, not merged.** G15–G19 (incl. G18b) green with negatives. Open: G20's fps / GPU-memory half and a full `./verify.sh` need the M4 (`./verify.sh g13 g20 g21`, then the full run); G21 shots partly rendered in software (shots/facades/).

**Run 2 (street level): DONE 2026-10-07.** G0–G5, G7 and G8–G13 (incl. G12b) green in one clean `./verify.sh` run
(G6, G14 advisory green); see `DONE-run2`. Decisions D45–D77; branch `street-level` → `main`.

### Run 1

**Harbor Engine title** since 2026-09-26 (D44): G0–G7 re-verified green on harbor-engine v1.0.0.

**DONE.** G0–G5 green in one clean `./verify.sh` run (G6 advisory green); see `DONE`. The G5 block was resolved
by the owner (docs/resolved-blocks.md, D36).

Per D2, expanding the slice (full corridor) is now allowed but not started. Known gaps: Embarcadero pier decks
are not walkable, the ferry is helm-only, Salesforce Tower is missing (2016 heights), Alcatraz is uncertain to
~14 m.
