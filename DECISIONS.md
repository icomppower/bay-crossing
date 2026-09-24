# Decisions

Seeded from SPEC §3. New decisions are appended with a one-line reason.

- **D1** Fork commit pinned at bootstrap; never pull upstream. Pinned: `1438b1abfcaee3267092b75573014f4d9b4a983c`
  (Tidewater `main`, 2026-09-24). The remote is renamed `upstream` and is never fetched.
- **D2** Slice: TST promenade + one crossing. Expand to full corridor only after G5 is green.
- **D3** Ferry: procedural hull from published real-world dimensions; cite the source here.
- **D4** Level 1 buildings → procedural facades. Level 2/3 → provided textured models. Convert via FBX or VRML
  with headless Blender (not .max). Cache GLB output; convert once.
- **D5** Bathymetry is an approximation; log it.
- **D6** Quality tiers in one config: `low` = Mac mini M4 baseline (only tier gated now), `high` reserved for a
  later PC run.
- **D7** Remove: `src/game/`, vendors, island terrain, village, reef, vegetation, swash sim. Keep: ocean, sky,
  post, boat controller, player, CDLOD, headless tests, audio system (harbour ambience only if CC0; else mute).
- **D8** `CREDITS.md`: Tidewater MIT notice + Lands Department / DATA.GOV.HK attribution from session 0.
- **D9** One Max 20x account. On usage limit: stop cleanly (`STATE.md` current); user resumes after reset.
- **D10** Sessions are started by the user. No scripts that relaunch Claude Code automatically.

## Appended

- **D11** `verify.sh` runs every gate twice: once against its negative fixture (must FAIL) and once for real
  (must PASS). A gate is green only when both hold, so "fails on a negative fixture first" is re-proved on
  every run, not once. Reason: §5 makes the negative fixture a precondition of every positive run.
- **D12** G6 is advisory: `verify.sh` runs it but its result never changes the exit code.
