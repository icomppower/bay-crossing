# Resolved blocks

## BLOCKED — G5 M4 budget (2026-09-24)

### What

G5 fails because its GPU-memory check cannot detect a leak: a leaked 1.5 GB of GPU buffers passed under the
frozen cap `G5.gpuMemoryMB = 28` (SPEC-THRESHOLDS.md). The fps floor and swap checks work: the 4K
negative is caught at 16.7 fps against a 40 fps floor, the recorded swap-outs are caught, and the real
path runs at 49.8 fps at p95 with 0 swap-outs.

### Why

The metric was wrong, and the cap was calibrated on it. `gates/g5.mjs` summed the `footprint` categories
matching `IOAccelerator|IOSurface`, which gave 22 MB. On Apple Silicon, Metal allocations made through Dawn
land mostly in **"Owned physical footprint (unmapped) (graphics)"**. Measured on the App at 1080p `low`:

| footprint category | baseline | + 1 GB leaked buffers |
|---|---|---|
| Owned physical footprint (unmapped) (graphics) | 625 MB | 1,649 MB |
| IOAccelerator (graphics) | 92 MB | 348 MB |
| **all "(graphics)" categories** | **~717 MB** | **~1,997 MB** |

So the real GPU memory is ~717 MB, not 22 MB. Fixing the metric (sum every "(graphics)" category) makes the
gate detect the leak, but then the real run fails the frozen 28 MB cap. Passing therefore requires changing a
frozen threshold, which is a §7 stop rule. The 28 MB value is a measurement bug, not a budget anyone chose.

### The one question

**May I replace the frozen `G5.gpuMemoryMB = 28` with a recalibration on the corrected metric (the sum of
footprint's "(graphics)" categories, cap = 1.25 × the measured path peak, expected ~900 MB)?**

Everything else stays frozen (`G5.fpsFloor = 40` and all other gates' thresholds). On a yes, the next session
fixes `gpuMemory()` in `gates/g5.mjs`, removes the old key with a DECISIONS entry citing this file, recalibrates,
and reruns `./verify.sh` for DONE.

**Answer (owner, 2026-09-25): yes.** GPU memory now sums footprint's "(graphics)" categories; cap recalibrated to 862 MB (measured 689 MB). See D36.
