# Run log

Hong Kong run entries are archived in `docs/archive-hong-kong.md`.

| Date | Gate | Result | Min | Notes |
|------|------|--------|-----|-------|
| 2026-09-24 | G0 | PASS | 30 | DataSF ynuv-fyni (8,489 footprints, PDDL), OSM Overpass Sausalito (1,828 bldgs, 23 with height/levels), 3DEP + NCEI DEM via ImageServer exportImage on UTM 10N 3 m grid. Salesforce Tower absent (2016 heights) — D16 |
| 2026-09-24 | G1 | PASS | 45 | Removed game/vendors/island/village/reef/veg/swash + island-bound life (D17); HeightField replaces TerrainData (D18); headless real-App runner (D19). First negative missed the hidden ocean (sequential frames drift ~8); fixed by freezing time for the on/off pair |
| 2026-09-24 | G2a | PASS | 35 | NOAA datums added as G0 source (MSL = NAVD88+0.969). 3200² @3 m, Int16 cm, 256 deflated tiles (12 MB). Offline double-run determinism, shipped = pipeline, plausibility, seam, loader. Fixed a G1 build fixture that silently stopped mutating |
| 2026-09-24 | G2b | PASS | 50 | First run: 8 sliver roof tris flipped by rounding (now dropped); 'tallest' check hit Marin ridge huts (switched to height above ground); Transamerica LiDAR median 68 m vs 264 m peak → landmark footprints excluded (D25) |
| 2026-09-24 | G2c | PASS | 70 | OSM landmark source added (D27). Blender 5.2 exporter kwarg is export_texcoords. Whole-frame triangle cap could not see LOD (1.22×) → city-layer cap (D29). GG tower check first failed at 3 m: it averaged in cable vertices; fixed to leg tops |
| 2026-09-24 | G3 | PASS | 75 | First measurement: Transamerica 11 m (vertex-mean anchor bias), Ferry tower 13 m (hand anchor): fixed from data (area centroids, OSM tower parts). North light / Alcatraz Light reported advisory with reasons (D32). NOAA ENC + GTFS sources added |
| 2026-09-24 | G4 | PASS | 70 | Ferry = MV Golden Gate dims (D33), FerryController + autopilot + A* route on bathymetry (D35). First negative run: slow helmsman reported as 'arrival' not 'duration' (judge only checked duration on arrival) → fixed. Range cited both ends (D34) |
| 2026-09-24 | G5 | BLOCKED | 45 | Real Metal M4 via headless Dawn: 49.8 fps p95 serialised @1080p low, floor frozen at 40; 4K negative caught. GPU memory metric summed the wrong footprint categories (22 MB; real ~717 MB in '(graphics)'), leak negative missed; fixing it needs the frozen 28 MB cap replaced → BLOCKED.md |
| 2026-09-24 | G6 | PASS (advisory) | 15 | Golden/blue/night shots from sun elevations +6/−5/−15° on the SF sun model; brightness ordered; noon-frozen negative caught |
| 2026-09-25 | G5 | PASS | 25 | Owner approved replacing the cap. Metric fixed (all '(graphics)' footprint categories), recalibrated 689 MB → cap 862 MB (D36); leak negative now caught (2,225 MB) |
| 2026-09-25 | DONE | PASS | 20 | Full verify.sh: G0–G5 green, G6 advisory green |
| 2026-09-25 | mobile | PASS | 60 | Touch controls + mobile tier + helm camera scaled to hull (D37); phone emulation 390×844 / 844×390 layout, walk, look, helm, autopilot checked; full verify.sh green |
