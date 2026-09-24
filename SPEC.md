# Victoria Harbour — SPEC

Source of truth: Notion page "Victoria Harbour — SPEC.md (autonomous run, Opus 5.5)"
(3e51f269eaea818ab5b1f2117068fcd7). §1, §4 and §5 are copied here; the per-gate protocol (§6) and stop rules
(§7) live on that page. Decisions (§3) are in `DECISIONS.md`.

## 1. Objective

Replace Tidewater's island with a real-data **Victoria Harbour** slice: Tsim Sha Tsui promenade + one Star
Ferry crossing to Central. Player can walk the promenade and drive the ferry; time of day from golden hour to
night skyline. Desktop only, WebGPU.

## 4. Environment and guardrails

- Mac mini M4, 16 GB unified memory. Keep one browser instance max; don't run Blender conversion and the dev
  server at the same time.
- No subagents.
- Commit and update `STATE.md` after every gate, not at session end.
- Never lower a threshold to pass. Never modify a frozen threshold without a `BLOCKED.md`.
- Dependency audit: every import resolves to a dependency declared in package.json.

## 5. Gates (`verify.sh`)

Each gate must first **fail on a negative fixture** before a positive run counts. Values marked *calibrate*
are measured at first run, written to `SPEC-THRESHOLDS.md`, then frozen.

- **G0 Data check:** one Lands Department tile over TST (DTM + 3D buildings) downloaded and converted to GLB
  headlessly.
- **G1 Clean fork:** D7 removals done; `npm run build` passes; ocean + sky render in headless Dawn;
  dependency audit passes.
- **G2a Terrain pipeline:** DTM → terrain tiles, scripted, byte-identical across two runs.
- **G2b Building pipeline:** building data → GLB tiles, scripted, byte-identical across two runs, cached.
- **G2c Merge + LOD:** buildings merged per CDLOD tile with distant LODs; triangle and draw-call caps
  (*calibrate*).
- **G3 Georeference:** ≥5 control points (pier ends, tower bases, promenade features) within tolerance
  (*calibrate*, ≤10 m). A shifted dataset must fail.
- **G4 Ferry:** TST → Central crossing completes; duration within a cited real-world range; hull never in
  water shallower than its draft on the route.
- **G5 M4 budget:** scripted camera path at `low` tier; fps floor (*calibrate*, target ≥30 @ 1080p); GPU
  memory cap; no swap during the run.
- **G6 Look (advisory):** headless screenshots at fixed seed — golden hour, blue hour, night — saved to
  `shots/` for human review.
- **DONE** = G0–G5 green in one clean `verify.sh` run. Create file `DONE`.
