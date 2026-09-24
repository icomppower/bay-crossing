# State

| Gate | Status | Last run | Notes |
|------|--------|----------|-------|
| G0 Data check | PASS | 2026-09-24 | 4 sources cached + checksummed (81 MB); 5/5 negative mutations caught |
| G1 Clean fork | PASS | 2026-09-24 | D7 removals, build, audit, real App renders ocean + sky headless; 5/5 negatives caught |
| G2a Terrain + bathymetry pipeline | not started | | |
| G2b Building pipeline | not started | | |
| G2c Landmarks + LOD | not started | | |
| G3 Georeference | not started | | |
| G4 Ferry | not started | | |
| G5 M4 budget | not started | | |
| G6 Look (advisory) | not started | | |

## Current

G0 and G1 are green. The app now boots as ocean + sky + boat over a flat −20 m seabed (`HeightField`, D18) in the
bay frame (`BayFrame.js`, D14). `tools/headless/app.mjs` runs the real App under Dawn for the gates (D19).

Next: G2a Terrain + bathymetry pipeline. Merge 3DEP land and the NCEI seabed from `data/raw/` into
deterministic terrain/seabed tiles that feed `HeightField`, byte-identical across two runs from cache.
