# Decisions

Seeded from SPEC §3. New decisions are appended with a one-line reason. The earlier Hong Kong run's decisions
are in `docs/archive-hong-kong.md`.

- **D1** Fork commit pinned; never pull upstream. Pinned: `1438b1abfcaee3267092b75573014f4d9b4a983c`
  (Tidewater `main`, 2026-09-24). The remote is renamed `upstream` and is never fetched.
- **D2** Slice, run 1: Ferry Building waterfront (Embarcadero ~Pier 1 to Pier 39) + ferry route to Sausalito +
  Sausalito waterfront strip. Golden Gate Bridge, Alcatraz, Angel Island as distant low-LOD landmarks. Expand
  only after G5 is green.
- **D3** Ferry: procedural hull from published dimensions of a vessel on the route; cite the source.
- **D4** Regular buildings: extruded in code from footprint + height, procedural facades. Landmarks (Ferry
  Building, Coit Tower, Transamerica Pyramid, Golden Gate Bridge, Alcatraz): procedural or CC0 models
  processed **offline in Blender** into LOD GLBs, committed, steps in `CREDITS.md`. No bespoke hand-modelled
  assets.
- **D5** Bathymetry from NOAA; any gaps filled and logged.
- **D6** Quality tiers in one config: `low` = Mac mini M4 baseline (only tier gated now), `high` reserved for a
  later PC run.
- **D7** Remove: `src/game/`, vendors, island terrain, village, reef, vegetation, swash sim. Keep: ocean, sky,
  post, boat controller, player, CDLOD, headless tests, audio system (bay ambience only if CC0; else mute).
- **D8** `CREDITS.md`: Tidewater MIT notice + every data source with licence.
- **D9** One Max 20x account. On usage limit: stop cleanly (`STATE.md` current); user resumes after reset.
- **D10** Sessions are started by the user. No scripts that relaunch Claude Code automatically.

## Appended

- **D11** `verify.sh` runs every gate twice: once against its negative fixture (must FAIL) and once for real
  (must PASS). A gate is green only when both hold, so the negative fixture is re-proved on every run.
  Reason: §5 makes the negative fixture a precondition of every positive run.
- **D12** G6 is advisory: `verify.sh` runs it but its result never changes the exit code.
- **D13** SF footprints are published under ODC PDDL 1.0, not CC0 as §2 says. Both are public-domain
  dedications; the portal's actual licence is what `CREDITS.md` records. Reason: record the licence as found.
- **D14** One frame for everything: WGS84 / UTM 10N (EPSG:32610) metres, NAVD88 heights, slice extent
  E 544800–554208, N 4182000–4191600, 3 m raster grid (`data/slice.json`). Both DEMs are fetched already
  resampled onto that grid. Reason: one grid for terrain and seabed makes G2a and G3 simple.
- **D15** Terrain comes from USGS 3DEP and seabed from the NOAA NCEI topobathy mosaic. Both services cover the
  whole extent without gaps (G0 checks there are no no-data cells), so D5's gap fill isn't needed for run 1.
  Reason: measured at G0.
- **D16** Building heights are from 2016, so post-2016 towers (Salesforce Tower, 326 m, finished 2018) are
  missing or wrong. Logged, not fixed in run 1. Reason: G0 found the tallest building is Transamerica
  (260.8 m) and Salesforce Tower is absent.
- **D17** D7 extended to everything bound to the island: wildlife (birds, crabs, shorebirds), the humpback,
  debris, rocks, gulls and fish are removed with their assets (`public/models/*`) and asset tools
  (`tools/characters`, `tools/props`). Tests for removed systems are deleted; `npm test` is the engine smoke test.
  Reason: they read the island generator's masks and have no place in the bay slice.
- **D18** The procedural island (`TerrainData`) is replaced by a generic `HeightField` (`src/world/HeightField.js`)
  with the same accessors. It holds a flat −20 m seabed until G2a fills it. `TerrainGPU`, `Terrain`, the shore
  field and the CDLOD terrain mesh are kept unchanged. World frame: `src/world/BayFrame.js` (x east, z south,
  origin at the centre of the slice extent). Reason: the ocean, shore, spray and wake all read the heightfield
  interface; swapping the source keeps them intact.
- **D19** `tools/headless/app.mjs` boots the real App in headless Dawn (DOM shim, offscreen canvas texture,
  fetch of `public/`). Gates measure its frames numerically, with one App per process. Reason: gate the
  product itself, not stub harnesses.
