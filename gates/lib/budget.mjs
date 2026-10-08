// G5's budget measurement, shared with G13: GPU memory from `footprint` (every "(graphics)" category: Metal
// allocations, D36), swap-outs from vm_stat, and the judge against the frozen G5 floor and cap.
import { spawnSync } from 'node:child_process';

export function gpuMemory(pid) {
  const r = spawnSync('footprint', ['-f', 'bytes', String(pid)], { encoding: 'utf8' });
  let gpu = 0, total = 0;
  for (const line of (r.stdout || '').split('\n')) {
    const m = line.match(/^\s*(\d+)\s*B?\s+(\d+)\s*B?\s+(\d+)\s*B?\s+(\d+)\s+(.+)$/);
    if (m && /\(graphics\)/i.test(m[5])) gpu += Number(m[1]);
    const t = line.match(/Footprint:\s*(\d+)\s*B/);
    if (t) total = Number(t[1]);
  }
  return { gpuMB: gpu / 2 ** 20, footprintMB: total / 2 ** 20 };
}

export const swapouts = text => Number((text.match(/Swapouts:\s+(\d+)/) || [])[1]);
export const vmstat = () => spawnSync('vm_stat', { encoding: 'utf8' }).stdout;

// frame times (ms) → percentiles
export function percentiles(ms) {
  const s = [...ms].sort((a, b) => a - b), q = f => s[Math.min(s.length - 1, Math.floor(f * s.length))];
  return { frames: ms.length, p50: q(0.5), p95: q(0.95), p99: q(0.99), max: s.at(-1) };
}

export function judgeBudget(m, T, what) {
  const fail = [], fps95 = 1000 / m.p95;
  const swaps = swapouts(m.swapAfter) - swapouts(m.swapBefore);
  console.log(`${what}: ${m.frames} frames at 1920×1080 low tier — p50 ${m.p50.toFixed(1)} ms, p95 ${m.p95.toFixed(1)} ms (${fps95.toFixed(1)} fps), p99 ${m.p99.toFixed(1)} ms, max ${m.max.toFixed(1)} ms; GPU memory ${m.gpuMB.toFixed(0)} MB (process footprint ${m.footprintMB.toFixed(0)} MB); swap-outs ${swaps}`);
  if (m.errors) fail.push(`render: ${what}: ${m.errors} console/GPU errors`);
  if (!(fps95 >= T['G5.fpsFloor'])) fail.push(`fps: ${what}: 95th-percentile frame ${m.p95.toFixed(1)} ms = ${fps95.toFixed(1)} fps, floor ${T['G5.fpsFloor']} fps`);
  if (!(m.gpuMB <= T['G5.gpuMemoryMB'])) fail.push(`memory: ${what}: GPU memory ${m.gpuMB.toFixed(0)} MB, cap ${T['G5.gpuMemoryMB']} MB`);
  if (!(swaps === 0)) fail.push(`swap: ${what}: ${swaps} swap-outs during the run`);
  return fail;
}
