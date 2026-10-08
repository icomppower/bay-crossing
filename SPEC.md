# SF Bay Crossing — SPEC

Source of truth: Notion page "SF Bay Crossing — SPEC.md (Opus 5.5)" (3e51f269eaea818ab5b1f2117068fcd7).
§1, §4 and §5 are copied here; data sources (§2), the per-gate protocol (§6) and stop rules (§7) live on that
page. Decisions (§3) are in `DECISIONS.md`.

## 1. Objective

Replace Tidewater's island with a real-data **San Francisco Bay** scene: the Embarcadero waterfront at the
**Ferry Building**, a ferry crossing past Alcatraz to the **Sausalito** waterfront, with the Golden Gate Bridge
in view. Player can walk the Embarcadero and drive the ferry; time of day from golden hour to night. Desktop
only, WebGPU.

## 4. Environment and guardrails

- Mac mini M4, 16 GB unified memory. One browser instance max. **Never run Blender and the dev server at the
  same time.**
- No subagents.
- Commit and update `STATE.md` after every gate.
- Never lower a threshold to pass. Never modify a frozen threshold without a `BLOCKED.md`.
- Dependency audit: every import resolves to a dependency declared in package.json.
- Cache all raw downloads in `data/raw/` with a checksum manifest; pipelines read from cache, not the network.

## 5. Gates (`verify.sh`)

Each gate must first **fail on a negative fixture** before a positive run counts. Values marked *calibrate*
are measured at first run, written to `SPEC-THRESHOLDS.md`, then frozen.

- **G0 Data check:** building heights, terrain, and bathymetry for the slice downloaded by script, cached,
  checksummed; licences recorded.
- **G1 Clean fork:** D7 removals done; `npm run build` passes; ocean + sky render in headless Dawn;
  dependency audit passes.
- **G2a Terrain + bathymetry pipeline:** raw → terrain/seabed tiles, byte-identical across two runs from cache.
- **G2b Building pipeline:** footprints + heights → extruded building tiles, byte-identical across two runs
  from cache.
- **G2c Landmarks + LOD:** landmark GLBs (offline Blender) and building LODs merged per CDLOD tile; triangle
  and draw-call caps (*calibrate*).
- **G3 Georeference:** ≥5 control points (Ferry Building tower, pier ends, Coit Tower, Sausalito ferry landing,
  a Golden Gate tower) within tolerance (*calibrate*, ≤10 m). A shifted dataset must fail.
- **G4 Ferry:** Ferry Building → Sausalito crossing completes; duration within the cited schedule range; hull
  never in water shallower than its draft on the route.
- **G5 M4 budget:** scripted camera path at `low` tier; fps floor (*calibrate*, target ≥30 @ 1080p); GPU memory
  cap; no swap during the run.
- **G6 Look (advisory):** headless screenshots at fixed seed — golden hour, blue hour, night — in `shots/` for
  human review.
- **G7 Baseline-limits compile** (added 2026-09-26, D41): the real App on an adapter with only WebGPU's default
  limits and no optional features; every pipeline compiles and every frame validates, all tiers, ferry + fly.
- **DONE** = G0–G5 and G7 green in one clean `verify.sh` run. Create file `DONE`.

## Run 2 — Street level

Brief: Notion page "Bay Crossing — Street-Level Pass SPEC.md" (3f21f269eaea8159bb35dcda9e3bcdc2), branch
`street-level`, merged to `main` only when DONE. Its §3 decisions are D45–D57 in `DECISIONS.md` (renumbered +1:
D44 was already taken by the Harbor Engine conversion).

### 1. Objective

Make the existing run-1 slice (Embarcadero ~Pier 1 → Pier 39, Sausalito waterfront strip) read as a city **at
eye level**. Today, walking mode shows a grey textured plane, window-grid boxes down to the ground, and no
street furniture. Target: real streets with lanes, markings, curbs and sidewalks; a ground-floor storefront band;
code-drawn signs; instanced street props; an instanced pedestrian crowd. Same slice — no map expansion this run.

### 4. Environment and guardrails

Same as run 1: Mac mini M4, 16 GB; one browser instance; never Blender and the dev server at once; no subagents;
commit and update `STATE.md` after every gate; never lower a threshold to pass; all raw downloads cached in
`data/raw/` with checksums; pipelines read from cache.

### 5. Gates (verify.sh)

Each gate must first **fail on a negative fixture** before a positive run counts. *Calibrate* = measure at first
run, write to `SPEC-THRESHOLDS.md`, then freeze.

- **G8 Street data:** OSM roads + POIs and DataSF trees for the slice fetched by script, cached, checksummed,
  licences in `CREDITS.md`. Negative fixture: a corrupted cache file fails the checksum.
- **G9 Road mesh:** ≥ 95% of OSM drivable centerline length in the slice is meshed (*calibrate*, floor 95%); no
  road polygon overlaps a building footprint by more than 0.5 m; intersections watertight; byte-identical across
  two runs from cache. Negative fixture: dropping 10% of ways fails coverage.
- **G10 Sidewalks + walkability:** every road edge in built-up blocks has a curb and sidewalk; a scripted walk
  from the Ferry Building to Pier 39 along the Embarcadero sidewalk completes without leaving the walkable surface
  or falling through. Negative fixture: a sidewalk gap must fail the walk.
- **G11 Storefront band:** ≥ 80% of street-facing building edges in the slice carry a ground-floor module
  (*calibrate*); sign strings are all from the generic category list. Negative fixture: an injected brand name
  fails. Byte-identical reruns.
- **G12 Props:** the street-tree count in the slice matches DataSF within 5%; lamp spacing within the configured
  range; every prop type is drawn instanced; draw calls and triangles within run-1 caps (*calibrate* any new cap).
- **G12b Crowd:** ≥ 150 pedestrians visible-or-near on the street-level path at `low` (*calibrate*); every
  pedestrian stays on a walkable surface for a 60 s scripted run; crowd is drawn instanced; same seed → same
  placement. Negative fixture: a pedestrian spawned on the road must fail.
- **G13 Budget:** with the crowd enabled, run G5's measurement on a new scripted street-level camera path (Ferry
  Building plaza → Pier 39 at walking height) at `low`: p95 ≥ 40 fps at 1080p, GPU memory ≤ 862 MB, no swap. The
  existing G5 path must stay green.
- **G14 Look (advisory):** fixed-seed headless shots at Ferry Building plaza, Embarcadero at Pier 7 and Sausalito
  Bridgeway — midday and night — plus before/after pairs against run 1, in `shots/street/`, for human review.
- **DONE (run 2)** = G0–G5, G7 and G8–G13 (including G12b) green in one clean `verify.sh` run. Create file
  `DONE-run2`.
