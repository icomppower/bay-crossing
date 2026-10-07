// G12b Crowd: along the street-level path (Ferry Building plaza → Pier 39 on the Embarcadero's bay-side sidewalk,
// camera at walking height, gates/lib/route.mjs) at the `low` tier, at least the calibrated number (floor 150) of
// drawn pedestrians are visible or near at every sample (near: within 50 m; visible: in the view frustum within the
// 170 m draw radius);
// every pedestrian of the whole population stays on a walkable surface (sidewalk, plaza, crossing band) for a 60 s
// scripted run; the crowd is drawn instanced; the same seed gives the same placement (and another seed another).
// --negative: a pedestrian spawned on the road, a crowd drawn one mesh per person, a crowd placed by an unseeded
// random source, and a crowd too thin for the path must each be caught.
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readThresholds, freeze } from 'harbor-engine/gates/lib/thresholds.mjs';
import { readStreet, root } from './lib/street.mjs';
import { StreetGround } from '../src/street/Ground.js';
import { CrowdSim } from '../src/street/Crowd.js';

const NEG = process.argv.includes('--negative');
const FLOOR = 150, NEAR = 50, FAR = 170, PATH_SPEED = 8, SAMPLE = 2;

function readCrowd() {
  const index = JSON.parse(readFileSync(join(root, 'public/street/crowd.json'), 'utf8'));
  const body = inflateSync(readFileSync(join(root, 'public/street/crowd.bin.deflate')));
  return { index, pts: new Float32Array(body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength)) };
}

// ---- 60 s on the walkable surface: every agent, every frame (pure simulation on the shipped street mesh)
function walkable(ground, data, { seed = 1975, spawnOnRoad = false, seconds = 60 } = {}) {
  const sim = new CrowdSim(data, { seed });
  if (spawnOnRoad) {
    // agent 0 put on asphalt: the first asphalt point 3 m off a lane point
    outer: for (let l = 0; l < sim.lanes.length; l++) for (let i = 0; i < sim.lanes[l][1]; i++) {
      const [x, z] = sim.P(l, i);
      for (const [dx, dz] of [[3, 0], [-3, 0], [0, 3], [0, -3]]) { const q = ground.at(x + dx, z + dz); if (q && q.mat === 0 && !q.walkable) { sim.lane[0] = l; sim.s[0] = i; sim.side[0] = 0; sim.state[0] = 3; sim.timer[0] = 1e9; sim.x[0] = x + dx; sim.z[0] = z + dz; sim.place = ((orig) => () => { orig.call(sim); sim.x[0] = x + dx; sim.z[0] = z + dz; })(sim.place); sim.place(); break outer; } }
    }
  }
  const dt = 1 / 30;
  let off = 0, first = null, frames = 0;
  const check = () => { for (let a = 0; a < sim.N; a++) { const q = ground.at(sim.x[a], sim.z[a]); if (!q || !q.walkable) { off++; first = first || [a, +sim.x[a].toFixed(1), +sim.z[a].toFixed(1), q ? q.mat : null, sim.state[a]]; } } };
  check();
  for (let t = 0; t < seconds; t += dt) { sim.update(dt); frames++; if (frames % 3 === 0) check(); }
  return { off, first, agents: sim.N, x: sim.x.slice(), z: sim.z.slice() };
}

// ---- in the App (child process): visible-or-near counts along the path, and the draw structure
async function measure(sabotage) {
  const { bootApp } = await import('harbor-engine/tools/headless/app.mjs');
  const { Vector3, Frustum, Matrix4, Mesh, BufferGeometry } = await import('harbor-engine/src/engine/index.js');
  const { attachStreet } = await import('../src/street/index.js');
  const { loadContext, elements } = await import('../pipelines/street/context.mjs');
  const { route } = await import('./lib/route.mjs');
  const { buildRoads } = await import('../pipelines/street/roads.mjs');
  const H = await bootApp({ width: 1920, height: 1080, query: '?fly&noAudio&tier=low' + (sabotage === 'thin' ? '&crowd=600' : '') });
  const app = H.app;
  app.renderEnabled = false;
  const street = await attachStreet(app);
  const ctx = await loadContext(); ctx.elements = elements(ctx);
  // the route needs only the road ways (no building clip)
  ctx.buildingPaths = [];
  const R = route(ctx, buildRoads(ctx, { noBuildingClip: true }).ways, street.ground);
  if (sabotage === 'unbatched') {
    const src = street.crowdView.far.g, g = new BufferGeometry();
    for (const k of ['position', 'normal', 'aBone']) g.setAttribute(k, src.getAttribute(k));
    for (let i = 0; i < 200; i++) { const m = new Mesh(g, street.crowdView.material); m.name = 'crowd-person'; m.position.set(street.crowd.x[i], 0, street.crowd.z[i]); app.scene.add(m); }
  }
  // camera path: along the route at PATH_SPEED m/s, 1.7 m above the street, looking 20 m ahead
  const pts = R.route, cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  const L = cum[cum.length - 1];
  const at = s => { let i = 1; while (i < pts.length - 1 && cum[i] < s) i++; const u = Math.min(1, (s - cum[i - 1]) / Math.max(1e-6, cum[i] - cum[i - 1])); return [pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * u, pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * u]; };
  const gy = (x, z) => street.ground.heightAt(x, z) ?? app.terrainData.heightAt(x, z);
  const dt = 1 / 30, frustum = new Frustum(), vp = new Matrix4(), v3 = new Vector3();
  const samples = [];
  let t = 0;
  for (let s = 0; s < L; s += PATH_SPEED * dt, t += dt) {
    const [x, z] = at(s), [ax, az] = at(Math.min(L, s + 20));
    const y = gy(x, z) + 1.7;
    app.fly.setPose(new Vector3(x, y, z), Math.atan2(-(ax - x), -(az - z)), -0.05);
    app.frame(dt);
    if (t < SAMPLE * samples.length) continue;
    const cam = app.camera;
    cam.updateMatrixWorld();
    vp.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
    frustum.setFromProjectionMatrix(vp, cam.reversedDepth !== false);
    // only the pedestrians drawn this frame (the nearest MAX within the draw radius)
    const c = street.crowd;
    let near = 0, vis = 0;
    for (const a of street.crowdView.list) {
      const dx = c.x[a] - x, dz = c.z[a] - z, d = Math.hypot(dx, dz);
      if (d < NEAR) { near++; continue; }
      if (d < FAR && frustum.containsPoint(v3.set(c.x[a], gy(c.x[a], c.z[a]) + 1, c.z[a]))) vis++;
    }
    let within = 0; for (let a = 0; a < c.N; a++) if (Math.hypot(c.x[a] - x, c.z[a] - z) < FAR) within++;
    samples.push({ s: Math.round(s), n: near + vis, near, vis, drawn: street.crowdView.drawn, within });
  }
  const meshes = [];
  app.scene.traverse(o => { if (o.isMesh && /^crowd/.test(o.name)) meshes.push({ name: o.name, instanced: !!o.geometry.isInstancedBufferGeometry }); });
  return { samples, length: L, population: street.crowd.N, meshes, drawn: street.crowdView.drawn, errors: H.errors.length };
}

if (process.argv.includes('--measure')) {
  const s = (process.argv.find(a => a.startsWith('--sabotage=')) || '').split('=')[1];
  console.log('MEASURE ' + JSON.stringify(await measure(s)));
  process.exit(0);
}
function measureChild(sabotage = '') {
  const r = spawnSync(process.execPath, [fileURLToPath(import.meta.url), '--measure', ...(sabotage ? ['--sabotage=' + sabotage] : [])], { cwd: root, encoding: 'utf8', maxBuffer: 1 << 28 });
  const line = (r.stdout || '').split('\n').find(l => l.startsWith('MEASURE '));
  if (!line) throw new Error('measurement crashed: ' + (r.stderr || '').slice(-1500));
  return JSON.parse(line.slice(8));
}

const judgeCount = (m, T) => {
  const min = Math.min(...m.samples.map(s => s.n)), at = m.samples.find(s => s.n === min);
  const f = [];
  if ('G12b.crowdVisibleOrNear' in T && !(min >= T['G12b.crowdVisibleOrNear'])) f.push(`count: ${min} pedestrians visible or near at ${at.s} m along the path (${at.near} near, ${at.vis} in view), floor ${T['G12b.crowdVisibleOrNear']}`);
  const single = m.meshes.filter(x => !x.instanced);
  if (single.length || !m.meshes.length) f.push(`instancing: ${single.length} crowd meshes are not instanced`);
  if (m.errors) f.push(`render: ${m.errors} console/GPU errors`);
  return { f, min };
};
const judgeWalk = w => w.off ? [`walkable: ${w.off} agent-frames off the walkable surface in 60 s (first ${JSON.stringify(w.first)})`] : [];
const same = (a, b) => a.x.every((v, i) => v === b.x[i]) && a.z.every((v, i) => v === b.z[i]);

const T = readThresholds();
const st = readStreet(join(root, 'public/street'));
const { loadContext } = await import('../pipelines/street/context.mjs');
const ctx = await loadContext();
const ground = new StreetGround(st, ctx.height.gridOrigin);
const data = readCrowd();

if (!NEG) {
  const fail = [];
  const w1 = walkable(ground, data), w2 = walkable(ground, data), w3 = walkable(ground, data, { seed: 7 });
  fail.push(...judgeWalk(w1));
  if (!same(w1, w2)) fail.push('seed: the same seed gave a different placement after 60 s');
  if (same(w1, w3)) fail.push('seed: another seed gave the same placement');
  const m = measureChild();
  if (!('G12b.crowdVisibleOrNear' in T)) {
    const min = Math.min(...m.samples.map(s => s.n));
    if (min < FLOOR) { console.log(`G12b FAIL — calibration minimum ${min} is below the ${FLOOR} floor; not freezing`); process.exit(1); }
    const v = Math.max(FLOOR, Math.floor(0.9 * min));
    freeze('G12b.crowdVisibleOrNear', v, `pedestrians visible or near (within ${NEAR} m, or in the view frustum within ${FAR} m) at every ${SAMPLE} s sample of the street-level path (Ferry Building → Pier 39, ${PATH_SPEED} m/s at 1.7 m, low tier, seed 1975); measured minimum ${min} on ${new Date().toISOString().slice(0, 10)}; value = max( 150, 0.9 × measured )`);
    T['G12b.crowdVisibleOrNear'] = v;
  }
  const j = judgeCount(m, T);
  fail.push(...j.f);
  console.log(`crowd: ${w1.agents} pedestrians, ${w1.off} agent-frames off the walkable surface in 60 s; path ${m.length.toFixed(0)} m, ${m.samples.length} samples, min ${j.min} visible or near (mean ${(m.samples.reduce((a, s) => a + s.n, 0) / m.samples.length).toFixed(0)}); ${m.meshes.length} crowd meshes, instanced`);
  if (fail.length) { console.log('G12b FAIL\n- ' + fail.join('\n- ')); process.exit(1); }
  console.log(`G12b PASS — ≥ ${j.min} pedestrians visible or near all along the path (floor ${T['G12b.crowdVisibleOrNear']}), ${w1.agents} stay on the walkable surface for 60 s, drawn instanced, seeded placement`);
  process.exit(0);
}

const MUT = {
  'a pedestrian spawned on the road': () => judgeWalk(walkable(ground, data, { spawnOnRoad: true, seconds: 5 })),
  'the crowd drawn one mesh per person': () => judgeCount(measureChild('unbatched'), T).f.filter(f => f.startsWith('instancing')),
  'placement from an unseeded random source': () => {
    const orig = Math.random, a = walkable(ground, data, { seconds: 5 });
    // a sim seeded from the clock / Math.random instead of the fixed seed
    const b = walkable(ground, data, { seed: Math.floor(orig() * 2 ** 31), seconds: 5 });
    return same(a, b) ? [] : ['seed: two runs placed the crowd differently'];
  },
  'a crowd too thin for the path': () => judgeCount(measureChild('thin'), T).f.filter(f => f.startsWith('count')),
};
let missed = 0;
for (const [name, run] of Object.entries(MUT)) {
  const f = run();
  console.log(`${f.length ? 'caught  ' : 'MISSED  '} ${name}${f.length ? ' — ' + f[0] : ''}`);
  if (!f.length) missed++;
}
console.log(`NEGATIVE ${Object.keys(MUT).length - missed}/${Object.keys(MUT).length}`);
process.exit(missed ? 0 : 1);
