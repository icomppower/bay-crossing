// G13 Street-level budget: with the street layer and the crowd enabled, G5's measurement (real App, headless Dawn →
// Metal on the M4, low tier, 1920×1080, CPU + GPU serialised, no vsync) on
//   1. the street-level camera path: the Embarcadero sidewalk from the Ferry Building plaza to Pier 39
//      (gates/lib/route.mjs) at walking height (1.7 m above the street), 10 m/s, looking 25 m ahead, late afternoon;
//   2. the existing G5 path (gates/g5.mjs: the five fixed views), now with the street layer attached;
// must meet G5's frozen floor and cap: p95 ≥ G5.fpsFloor fps, GPU memory ≤ G5.gpuMemoryMB, no swap-outs.
// --negative: the street path rendered at 3840×2160, a leaked 1.5 GB of GPU buffers, and recorded swap-outs must
// each be caught (as for G5).
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { readThresholds } from 'harbor-engine/gates/lib/thresholds.mjs';
import { gpuMemory, vmstat, percentiles, judgeBudget } from './lib/budget.mjs';
import { root } from './lib/street.mjs';

const NEG = process.argv.includes('--negative');
const SPEED = 10, SEG = 10;

async function streetPath(app, street) {
  const { loadContext, elements } = await import('../pipelines/street/context.mjs');
  const { buildRoads } = await import('../pipelines/street/roads.mjs');
  const { route } = await import('./lib/route.mjs');
  const ctx = await loadContext(); ctx.elements = elements(ctx); ctx.buildingPaths = [];
  const pts = route(ctx, buildRoads(ctx, { noBuildingClip: true }).ways, street.ground).route;
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  const L = cum[cum.length - 1];
  const at = s => { s = Math.max(0, Math.min(L, s)); let i = 1; while (i < pts.length - 1 && cum[i] < s) i++; const u = Math.min(1, (s - cum[i - 1]) / Math.max(1e-6, cum[i] - cum[i - 1])); return [pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * u, pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * u]; };
  const gy = (x, z) => street.ground.heightAt(x, z) ?? app.terrainData.heightAt(x, z);
  // a smoothed look direction: 25 m ahead along the route
  return { duration: L / SPEED, pose: t => { const s = t * SPEED, [x, z] = at(s), [ax, az] = at(s + 25); return { eye: [x, gy(x, z) + 1.7, z], yaw: Math.atan2(-(ax - x), -(az - z)), pitch: -0.04 }; } };
}

async function g5Path() {
  const { VIEWS, poseFor } = await import('./lib/views.mjs');
  const keys = [];
  for (const v of VIEWS) {
    const p = await poseFor(v), d = 200;
    keys.push({ eye: [p.x, p.y, p.z], at: [p.x - Math.sin(p.yaw) * Math.cos(p.pitch) * d, p.y + Math.sin(p.pitch) * d, p.z - Math.cos(p.yaw) * Math.cos(p.pitch) * d] });
  }
  const cr = (a, b, c, d, t) => a.map((_, i) => 0.5 * (2 * b[i] + (-a[i] + c[i]) * t + (2 * a[i] - 5 * b[i] + 4 * c[i] - d[i]) * t * t + (-a[i] + 3 * b[i] - 3 * c[i] + d[i]) * t * t * t));
  return { duration: SEG * (VIEWS.length - 1), pose: time => {
    const n = keys.length, s = Math.min(time / SEG, n - 1 - 1e-6), k = Math.floor(s), t = s - k, K = i => keys[Math.max(0, Math.min(n - 1, i))];
    const eye = cr(K(k - 1).eye, K(k).eye, K(k + 1).eye, K(k + 2).eye, t), at = cr(K(k - 1).at, K(k).at, K(k + 1).at, K(k + 2).at, t);
    eye[1] = Math.max(eye[1], 3);
    const dx = at[0] - eye[0], dy = at[1] - eye[1], dz = at[2] - eye[2];
    return { eye, yaw: Math.atan2(-dx, -dz), pitch: Math.atan2(dy, Math.hypot(dx, dz)) };
  } };
}

async function run(which, sabotage) {
  const { bootApp } = await import('harbor-engine/tools/headless/app.mjs');
  const { Vector3 } = await import('harbor-engine/src/engine/index.js');
  const { attachStreet } = await import('../src/street/index.js');
  const uhd = sabotage === 'uhd';
  const H = await bootApp({ width: uhd ? 3840 : 1920, height: uhd ? 2160 : 1080, query: '?fly&noAudio&tier=low' });
  const app = H.app;
  const street = await attachStreet(app);
  let leak = null;
  if (sabotage === 'leak') {
    leak = [];
    for (let i = 0; i < 6; i++) { const b = H.GPU.device.createBuffer({ size: 256 * 2 ** 20, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST }); H.GPU.queue.writeBuffer(b, 0, new Uint8Array(256 * 2 ** 20).fill(1)); leak.push(b); }
  }
  app.settings.timeOfDay = 17.5;
  const path = which === 'street' ? await streetPath(app, street) : await g5Path();
  const dt = 1 / 60;
  const place = t => { const p = path.pose(t); app.fly.setPose(new Vector3(...p.eye), p.yaw, p.pitch); };
  place(0);
  for (let i = 0; i < 60; i++) app.frame(dt);
  await H.settle();
  const ms = [];
  let mem = { gpuMB: 0, footprintMB: 0 }, crowdMin = Infinity;
  for (let t = 0; t < path.duration; t += dt) {
    place(t);
    const t0 = performance.now();
    app.frame(dt);
    await H.settle();
    ms.push(performance.now() - t0);
    if (ms.length % 600 === 300) { const m = gpuMemory(process.pid); if (m.gpuMB > mem.gpuMB) mem = m; }
    if (which === 'street') crowdMin = Math.min(crowdMin, street.crowdView.drawn);
  }
  return { ...percentiles(ms), ...mem, errors: H.errors.length, keep: leak ? leak.length : 0, crowdDrawnMin: crowdMin === Infinity ? null : crowdMin, population: street.crowd.N };
}

if (process.argv.includes('--run')) {
  const which = process.argv[process.argv.indexOf('--run') + 1];
  const s = (process.argv.find(a => a.startsWith('--sabotage=')) || '').split('=')[1];
  console.log('RUN ' + JSON.stringify(await run(which, s)));
  process.exit(0);
}

function runChild(which, sabotage = '') {
  const before = vmstat();
  const r = spawnSync(process.execPath, [fileURLToPath(import.meta.url), '--run', which, ...(sabotage ? ['--sabotage=' + sabotage] : [])], { cwd: root, encoding: 'utf8', maxBuffer: 1 << 26 });
  const after = vmstat();
  const line = (r.stdout || '').split('\n').find(l => l.startsWith('RUN '));
  if (!line) throw new Error('run crashed: ' + (r.stderr || '').slice(-1500));
  return { ...JSON.parse(line.slice(4)), swapBefore: before, swapAfter: after };
}

const T = readThresholds();
if (!NEG) {
  const s = runChild('street');
  const fail = judgeBudget(s, T, `street-level path (crowd ${s.population}, ≥ ${s.crowdDrawnMin} drawn)`);
  const g = runChild('g5');
  fail.push(...judgeBudget(g, T, 'G5 path with the street layer'));
  if (fail.length) { console.log('G13 FAIL\n- ' + fail.join('\n- ')); process.exit(1); }
  console.log(`G13 PASS — street-level path ${(1000 / s.p95).toFixed(1)} fps p95, ${s.gpuMB.toFixed(0)} MB; G5 path with the street layer ${(1000 / g.p95).toFixed(1)} fps p95, ${g.gpuMB.toFixed(0)} MB (floor ${T['G5.fpsFloor']} fps, cap ${T['G5.gpuMemoryMB']} MB), no swap`);
  process.exit(0);
}

const MUTATIONS = [
  ['street path rendered at 3840×2160 (4× the pixels)', 'fps:', () => judgeBudget(runChild('street', 'uhd'), T, 'street path (4K)')],
  ['a leaked 1.5 GB of GPU buffers', 'memory:', () => judgeBudget(runChild('street', 'leak'), T, 'street path (leak)')],
  ['swap-outs recorded during the run', 'swap:', () => judgeBudget({ frames: 1, p50: 1, p95: 1, p99: 1, max: 1, gpuMB: 1, footprintMB: 1, errors: 0, swapBefore: 'Swapouts: 1000.', swapAfter: 'Swapouts: 1450.' }, T, 'recorded')],
];
let missed = 0;
for (const [name, label, fn] of MUTATIONS) {
  const fail = fn().filter(m => m.startsWith(label));
  console.log(`${fail.length ? 'caught  ' : 'MISSED  '} ${name}${fail.length ? ' — ' + fail[0] : ''}`);
  if (!fail.length) missed++;
}
console.log(`NEGATIVE ${MUTATIONS.length - missed}/${MUTATIONS.length}`);
process.exit(missed ? 0 : 1);
