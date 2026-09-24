# State

| Gate | Status | Last run | Notes |
|------|--------|----------|-------|
| G0 Data check | BLOCKED | 2026-09-24 | DTM OK; 3D buildings FBX/VRML not scriptable — see BLOCKED.md |
| G1 Clean fork | — | | |
| G2a Terrain pipeline | — | | |
| G2b Building pipeline | — | | |
| G2c Merge + LOD | — | | |
| G3 Georeference | — | | |
| G4 Ferry | — | | |
| G5 M4 budget | — | | |
| G6 Look (advisory) | — | | |

## Current

**BLOCKED at G0** — see `BLOCKED.md` for the one question.

- Done: bootstrap (session 0); DTM download works (`Whole_HK_DTM_5m.zip`, in `data/raw/dtm/`, gitignored).
- Found: TST = 1:1000 sheet `T11-SW-4D`, Central pier = `T11-SW-9A`. The LandsD 3D Tiles API serves the
  buildings (b3dm + textured glTF); the FBX/VRML open-data download returns "not found".
- Next step once answered: write `gates/g0.mjs` (negative fixture = corrupted/missing tile must fail), a
  fetch script for DTM + the chosen 3D source, and a headless Blender → GLB conversion; then G1.
