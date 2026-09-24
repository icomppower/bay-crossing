# Calibrated thresholds (frozen)

Measured at first run and frozen (SPEC §5). Each line: key, value, how it was measured. Never lowered to pass;
changing a frozen value needs a BLOCKED.md.

- `G2c.cityTriangles`: 302670 — building + landmark LOD triangles submitted per frame, fixed views (gates/lib/views.mjs); measured max 201780 at embarcadero-street on 2026-09-24; cap = 1.5 × measured
- `G2c.frameTriangles`: 1953488 — triangles per frame, all passes, 1920×1080, fixed views (gates/lib/views.mjs); measured max 1562790 at embarcadero-street on 2026-09-24; cap = 1.25 × measured (terrain + ocean dominate)
- `G2c.frameDraws`: 126 — draw calls per frame, all passes, same views; measured max 84 at sausalito-waterfront on 2026-09-24; cap = 1.5 × measured
- `G2c.tileTriangles`: 77209 — LOD0 triangles in one 600 m building tile; measured max 61767 on 2026-09-24; cap = 1.25 × measured
