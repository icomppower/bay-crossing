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
- **D20** Game sea level (y = 0) is local mean sea level: NAVD88 + 0.969 m (NOAA station 9414290, MSL 2.773 −
  NAVD88 1.804 on the station datum, epoch 1983–2001), fetched and cached as a fifth G0 source. Reason: the
  DEMs are NAVD88, which sits near MLLW in SF; a y = 0 sea at NAVD88 would flood the waterfront by ~1 m.
- **D21** Terrain tiles: one 3200² grid at 3 m over the 9.6 km world square (aligned to the source grid, 32-cell
  clamp margins east and west), Int16 centimetres above MSL, 16 × 16 tiles of 200², zlib level 9, in
  `public/terrain/` (12 MB, committed). Merge: NCEI below the waterline, 3DEP lidar above, blended over ±1 m
  of NCEI height. The runtime `HeightField` uses the full 3200 grid; the `low` tier may decimate it at G5.
  Reason: native source resolution, deterministic, small enough to commit.
- **D22** Piers and wharves are structures, not terrain: both DEMs are bare-earth, so the Embarcadero piers
  appear as water. They come back as geometry (G2b/G2c) and colliders. Reason: measured at G2a.
- **D23** Gates that run pipelines run them as child processes with network access blocked
  (`gates/lib/no-network.mjs`), and pipelines read raw files only through `tools/data/cache.mjs`, which
  checks each file against the manifest. Reason: §4, "pipelines read from cache, not the network", becomes
  checkable.
- **D24** Buildings: SF roof = LiDAR median first-return elevation (`median_1st_m`) converted to MSL, so rooftop
  plant and spires are ignored; 34 footprints without it fall back to `hgt_median_m`. Sausalito: OSM `height`
  (17), `building:levels` × 3 m (5), else a 6 m default (1,801 of 1,823, logged in `public/buildings/index.json`).
  Base: lowest terrain under the footprint − 1 m, never deeper than 2 m below MSL, so pier sheds stand on the
  water line. Tiles: the 600 m terrain grid by centroid, one deflated GLB each (`.glb.deflate`, 9 MB total,
  committed). Facades are procedural in the material (storeys and bays from wall UVs; tint and class in vertex
  colour; lit windows at night). Reason: LiDAR medians give believable massing; the default applies only where
  OSM has nothing.
- **D25** Footprints that contain a landmark anchor (`data/landmarks.json`: Ferry Building, Coit Tower,
  Transamerica) are left out of the extruded tiles; the landmark models (G2c) replace them. Reason: the
  Transamerica LiDAR median is 67.8 m against a 264 m peak, so an extruded prism would be a stub.
- **D26** `earcut` (ISC) is a devDependency, used only by the offline building pipeline for roofs with holes.
  Reason: robust, deterministic polygon triangulation; nothing ships at runtime.
- **D27** A sixth G0 source, `landmarks-osm.json` (OSM, ODbL): Golden Gate tower legs, Coit Tower, Transamerica,
  Alcatraz buildings, the Sausalito ferry terminal, Embarcadero piers and Ferry Building gates. It places the
  landmarks and gives G3 an independent reference. Reason: OSM tower centres give a 1,280.1 m span against the
  official 1,280 m.
- **D28** Building LODs per tile: LOD0 full; LOD1 rings simplified to 1.5 m, buildings under 8 m tall and under
  150 m² dropped; LOD2 outer rings simplified to 4 m, only buildings 20 m+ tall or 1,500 m²+ kept (569k / 150k /
  15k triangles). Chosen by distance to the tile: < 900 m, < 2.5 km, beyond. Landmark LODs: < 1.5 km, < 5 km,
  beyond. Building tiles are the 600 m nodes at depth 4 of the CDLOD quadtree over the 9.6 km domain (one merged
  mesh per LOD per node). Reason: "merged per CDLOD tile with distant LODs".
- **D29** G2c caps: "triangle cap" is split in two. City triangles (building + landmark LOD meshes submitted
  per frame) are capped at 1.5 × measured, because a whole-frame cap cannot see LOD (terrain and ocean dominate:
  LOD off moves frame triangles only 1.22×). Frame triangles (all passes) are capped at 1.25 × measured, draw
  calls at 1.5 × measured, and per-tile LOD0 triangles at 1.25 × measured. Measured at five fixed views
  (`gates/lib/views.mjs`) at 1920×1080 and frozen in SPEC-THRESHOLDS.md. Reason: the negatives (LOD off, unmerged
  buildings) must be caught by the caps.
- **D30** Three more G0 sources: NOAA ENC charted landmarks and bridge pylons (public domain), used as the
  independent georeference, and the Golden Gate Ferry GTFS feed. The GTFS licence is not stated, so it is used
  only for facts (terminal positions, published trip times → `public/ferry/schedule.json`); its route shapes
  are not shipped and the zip stays in the gitignored cache. Reason: §2 requires a cited published schedule;
  §7 fallback-before-block.
- **D31** Ferry Building from OSM: the shed from the "San Francisco Ferry Building" outline, the clock tower
  from its `building:part` stack (to 70 m, 83 m flagpole). Landmark anchors use polygon area centroids, not
  vertex means (the Transamerica vertex mean was 15 m off). `data/landmarks.json` anchors are used only to
  exclude DataSF footprints. Reason: G3 found the hand-entered Ferry tower anchor 13 m off the chart.
- **D32** G3 control points: six gated (Ferry tower, Coit Tower, Transamerica, Golden Gate south tower vs NOAA
  ENC; Pier 1 end vs OSM, the only pier whose OSM outline is the shed itself; Sausalito landing from GTFS vs
  OSM). Two advisory: the north tower (the charted "North Light" is not the tower centre) and Alcatraz Light (OSM
  and the chart disagree by 13.8 m and no third source covers Alcatraz, so Alcatraz placement is uncertain to
  ~14 m). Tolerance calibrated to 10 m (worst gated error 6.45 m). Reason: every gated point compares two
  independent surveys.
- **D33** The ferry is MV Golden Gate (ex-Chinook), a Golden Gate Ferry catamaran: 43.7 m × 12.0 m, draft 1.5 m,
  waterjets, 38 kn (Wikipedia, "MV Golden Gate"). Golden Gate Ferry runs route SSSF (GTFS) with its fleet and
  rotates vessels between routes; no source fixes one hull to Sausalito, so the choice is "a fleet vessel on
  the route". It is procedural in code (`src/world/FerryModel.js`), from the dimensions in `FerrySpec.js`.
  Reason: D3.
- **D34** G4 duration range, cited on both ends: lower = the geodesic distance between the GTFS terminals at the
  published top speed (38 kn) = 8.56 min; upper = the published timetable, 30 min (every SSSF trip in GTFS). The
  helmsman (`FerryAutopilot`) sails 8 kn within 400 m of each terminal and 22 kn on the open bay. That speed is a
  setting, so the check proves route geometry, scale and physics give a timetable-consistent crossing, not the
  vessel's real service speed. Reason: GTFS lists one duration (30 min), so no other range is published.
- **D35** Ferry physics: a dedicated `FerryController` with BoatController's public surface (the lobster
  controller is tuned to an 8 m boat with hard-coded constants). The Tidewater lobster boat is no longer
  spawned. The ferry is helm-only in run 1: boarding goes straight to the wheelhouse, within 60 m of the
  boarding point (the berth is on a pier with no walkable deck yet), and leaving the helm steps ashore on the
  nearest dry ground. P toggles the helmsman. Route planning: A* over the shipped bathymetry at 6 m, needing
  ≥ 3.45 m at MSL in open water (draft + 1 m + MSL→MLLW) and ≥ 2.0 m within 150 m of a terminal (the NCEI grid
  is 2.5–4.4 m at the Ferry Building gates), with pier sheds and OSM piers as obstacles. Departure from
  Gate C (GTFS 43000), the deeper SSSF gate. Reason: G4.
- **D36** G5 GPU memory is re-measured as the sum of footprint's "(graphics)" categories, where Metal/Dawn
  allocations actually land. The first frozen cap (`G5.gpuMemoryMB = 28`) summed IOAccelerator|IOSurface,
  missed ~95 % of GPU memory and could not see a 1.5 GB leak. It is removed and recalibrated (1.25 × measured
  peak) with the owner's approval (BLOCKED.md, 2026-09-24, answered "Yes"). No other frozen value changes.
