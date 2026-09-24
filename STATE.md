# State

| Gate | Status | Last run | Notes |
|------|--------|----------|-------|
| G0 Data check | PASS | 2026-09-24 | 4 sources cached + checksummed (81 MB); 5/5 negative mutations caught |
| G1 Clean fork | not started | | |
| G2a Terrain + bathymetry pipeline | not started | | |
| G2b Building pipeline | not started | | |
| G2c Landmarks + LOD | not started | | |
| G3 Georeference | not started | | |
| G4 Ferry | not started | | |
| G5 M4 budget | not started | | |
| G6 Look (advisory) | not started | | |

## Current

G0 green. Data is fetched by `node tools/data/fetch.mjs` into `data/raw/` (gitignored) with `MANIFEST.sha256`
and `sources.json`. The frame is UTM 10N / NAVD88 on a 3 m grid (`data/slice.json`, D14).

Next: G1 Clean fork — D7 removals, build, ocean + sky in headless Dawn, dependency audit.
