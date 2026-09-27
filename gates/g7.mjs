// G7 Baseline-limits compile (the owner's Chrome crash, 2026-09-26): every pipeline compiles and every frame
// validates on an adapter with only WebGPU's default limits and no optional features — the real App on this
// title's data, low / mobile / high tiers, ferry mode and free flight over the fixed views (gates/lib/views.mjs).
// The machinery (adapter proxy, reverted-fix fixtures) is the engine's: harbor-engine/gates/lib/baseline.mjs.
// --negative: each engine fix reverted in a copy of the engine must fail, and so must a run without the clamp.
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runBaselineGate } from 'harbor-engine/gates/lib/baseline.mjs';

runBaselineGate( { views: join( dirname( fileURLToPath( import.meta.url ) ), 'lib/views.mjs' ), label: 'G7' } );
