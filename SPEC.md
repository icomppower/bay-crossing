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
- **DONE** = G0–G5 green in one clean `verify.sh` run. Create file `DONE`.
