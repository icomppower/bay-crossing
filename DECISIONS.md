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
