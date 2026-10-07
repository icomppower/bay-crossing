// G12 Props: the street-tree count in the SF box matches the DataSF Street Tree List within 5 %; seeded lamps along
// each sidewalk run are LAMP_MIN–LAMP_MAX m apart (pipelines/street/props.mjs); every prop type is drawn instanced
// (one instanced draw per type, no per-object meshes); with the street layer attached, the frame stays within the
// run-1 caps (G2c.frameTriangles, G2c.frameDraws) at the fixed views, and the street layer's own triangles stay within
// a calibrated cap (G12.streetTriangles).
// --negative: a tenth of the trees dropped, lamps spaced twice too far, a prop type drawn as one mesh per object, and
// a street layer past the triangle cap must each be caught.
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readThresholds, freeze } from 'harbor-engine/gates/lib/thresholds.mjs';
import { root } from './lib/street.mjs';
import { LAMP_MIN, LAMP_MAX } from '../pipelines/street/props.mjs';

const NEG = process.argv.includes('--negative');

// ---- in-App measurement (child process): frame stats at the fixed views without and with the street layer, and the
// prop layers' draw structure
async function measure(sabotage) {
  const { bootApp } = await import('harbor-engine/tools/headless/app.mjs');
  const { Vector3, Mesh, BufferGeometry } = await import('harbor-engine/src/engine/index.js');
  const { VIEWS, poseFor } = await import('./lib/views.mjs');
  const { attachStreet } = await import('../src/street/index.js');
  const H = await bootApp({ width: 1920, height: 1080, query: '?fly&noAudio' });
  const app = H.app;
  const at = async () => {
    const out = [];
    for (const v of VIEWS) {
      const p = await poseFor(v);
      app.settings.timeOfDay = 16;
      app.fly.setPose(new Vector3(p.x, p.y, p.z), p.yaw, p.pitch);
      app.frame(1 / 30);
      for (let i = 0; i < 11; i++) { app.frame(1 / 30); await H.settle(); }
      app.frame(1 / 30);
      const st = app.engine.meshRenderer.stats;
      // the street layer's own triangles this frame, counted from its meshes: instances × template (or the draw
      // range), once for the main pass and once per shadow cascade for casters (they are not culled per pass)
      let street = 0;
      app.scene.traverse(o => {
        if (!o.isMesh || !/^street-/.test(o.name) || !o.visible) return;
        const g = o.geometry, base = g.index ? Math.min(g.index.count, g.drawRange.count) / 3 : g.attributes.position.count / 3;
        const n = g.isInstancedBufferGeometry ? base * (g.instanceCount ?? 0) : base;
        street += n * (1 + (o.castShadow ? 3 : 0));
      });
      out.push({ view: v[0], triangles: st.triangles, draws: st.draws, street });
    }
    return out;
  };
  const before = await at();
  const street = await attachStreet(app);
  if (sabotage === 'unbatched') {
    // lamps drawn one mesh per lamp
    const l = street.props.layers.lamp, src = l.main.g;
    const g = new BufferGeometry();
    for (const k of ['position', 'normal', 'aPart']) g.setAttribute(k, src.getAttribute(k));
    for (let i = 0; i < Math.min(300, l.all.length / 8); i++) {
      const m = new Mesh(g, l.material); m.name = 'street-lamp-single'; m.position.set(l.all[i * 8], l.all[i * 8 + 1], l.all[i * 8 + 2]); m.frustumCulled = false; app.scene.add(m);
    }
  }
  if (sabotage === 'heavy') for (const l of Object.values(street.props.layers)) l.radiusScale = 6;
  // (no second precompile: attachStreet built the pipelines, and precompile() would restart the frame hook)
  const after = await at();
  // structure: every street prop mesh in the scene is instanced and its layer has instances somewhere on the path
  const meshes = [];
  app.scene.traverse(o => { if (o.isMesh && /^street-/.test(o.name) && !/^street-(surface|stores)$/.test(o.name)) meshes.push({ name: o.name, instanced: !!o.geometry.isInstancedBufferGeometry || !!o.isInstancedMesh }); });
  const types = Object.fromEntries(Object.entries(street.props.layers).map(([k, l]) => [k, { meshes: l.meshes.length, instancedGeometry: l.meshes.every(m => m.geometry.isInstancedBufferGeometry) }]));
  return { before, after, meshes, types, errors: H.errors.length };
}

if (process.argv.includes('--measure')) {
  const s = (process.argv.find(a => a.startsWith('--sabotage=')) || '').split('=')[1];
  console.log('MEASURE ' + JSON.stringify(await measure(s)));
  process.exit(0);
}
function measureChild(sabotage = '') {
  const r = spawnSync(process.execPath, [fileURLToPath(import.meta.url), '--measure', ...(sabotage ? ['--sabotage=' + sabotage] : [])], { cwd: root, encoding: 'utf8', maxBuffer: 1 << 26 });
  const line = (r.stdout || '').split('\n').find(l => l.startsWith('MEASURE '));
  if (!line) throw new Error('measurement crashed: ' + (r.stderr || '').slice(-1500));
  return JSON.parse(line.slice(8));
}

function readProps() {
  const index = JSON.parse(readFileSync(join(root, 'public/street/props.json'), 'utf8'));
  const body = inflateSync(readFileSync(join(root, 'public/street/props.bin.deflate')));
  return { index, all: new Float32Array(body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength)) };
}

// ---- static checks
async function staticChecks({ dropTrees = 0, lampScale = 1 } = {}) {
  const fail = [];
  const { loadContext } = await import('../pipelines/street/context.mjs');
  const { Region } = await import('../pipelines/street/geom.mjs');
  const ctx = await loadContext();
  const sf = new Region([[ctx.boxes.find(b => b.name === 'sfBuildings').ring]]);
  const { index, all } = readProps();
  const t = index.types.tree;
  let trees = 0;
  for (let i = t.offset; i < t.offset + t.count; i++) { if (dropTrees && i % Math.round(1 / dropTrees) === 0) continue; if (sf.contains(all[i * 8], all[i * 8 + 2])) trees++; }
  const datasf = ctx.trees.length;
  const err = Math.abs(trees - datasf) / datasf;
  const m = { trees, datasf, treeErr: err };
  if (!(err <= 0.05)) fail.push(`trees: ${trees} street trees in the SF box against ${datasf} DataSF records (${(100 * err).toFixed(1)} % off, max 5 %)`);
  // lamp spacing: the pipeline's seeded runs, rebuilt from the cache
  const { buildStreet } = await import('../pipelines/street/build.mjs');
  const res = await buildStreet();
  let pairs = 0, bad = 0, worst = null;
  for (const run of res.props.lampRuns) for (let i = 1; i < run.length; i++) {
    const gap = (run[i][2] - run[i - 1][2]) * lampScale;
    pairs++;
    if (gap < LAMP_MIN - 0.01 || gap > LAMP_MAX + 0.01) { bad++; worst = worst || gap; }
  }
  m.lampPairs = pairs; m.lampBad = bad;
  if (bad) fail.push(`lamps: ${bad}/${pairs} consecutive seeded lamps outside ${LAMP_MIN}–${LAMP_MAX} m (e.g. ${worst.toFixed(1)} m)`);
  return { fail, m };
}

function judgeFrame(r, T) {
  const fail = [];
  for (const v of r.after) {
    if (!(v.triangles <= T['G2c.frameTriangles'])) fail.push(`frame: ${v.triangles} triangles at ${v.view} with the street layer, cap ${T['G2c.frameTriangles']}`);
    if (!(v.draws <= T['G2c.frameDraws'])) fail.push(`frame: ${v.draws} draws at ${v.view} with the street layer, cap ${T['G2c.frameDraws']}`);
  }
  const street = Math.max(...r.after.map(v => v.street));
  if ('G12.streetTriangles' in T && !(street <= T['G12.streetTriangles'])) fail.push(`street layer: ${street} triangles a frame at worst, cap ${T['G12.streetTriangles']}`);
  const single = r.meshes.filter(m => !m.instanced);
  if (single.length) fail.push(`instancing: ${single.length} street prop meshes are not instanced (${[...new Set(single.map(m => m.name))].slice(0, 3).join(', ')})`);
  for (const [k, t] of Object.entries(r.types)) if (!t.instancedGeometry) fail.push(`instancing: prop type ${k} is not drawn instanced`);
  if (r.errors) fail.push(`render: ${r.errors} console/GPU errors`);
  return { fail, street };
}

const T = readThresholds();
if (!NEG) {
  const s = await staticChecks();
  const r = measureChild();
  const j = judgeFrame(r, T);
  console.log(`trees ${s.m.trees} vs DataSF ${s.m.datasf} (${(100 * s.m.treeErr).toFixed(2)} %); ${s.m.lampPairs} seeded lamp gaps checked; ${Object.keys(r.types).length} prop types, all instanced`);
  for (const [i, v] of r.after.entries()) console.log(`  ${v.view.padEnd(26)} ${v.draws} draws, ${v.triangles} triangles (street layer ${v.street}; without it ${r.before[i].triangles})`);
  if (!('G12.streetTriangles' in T)) {
    const cap = Math.ceil(1.25 * j.street);
    freeze('G12.streetTriangles', cap, `triangles a frame added by the street layer (surface, storefronts, props; all passes) at the fixed views (gates/lib/views.mjs), 1920×1080; measured max ${j.street} on ${new Date().toISOString().slice(0, 10)}; cap = 1.25 × measured`);
    T['G12.streetTriangles'] = cap;
  }
  const fail = [...s.fail, ...judgeFrame(r, T).fail];
  if (fail.length) { console.log('G12 FAIL\n- ' + fail.join('\n- ')); process.exit(1); }
  console.log(`G12 PASS — ${s.m.trees} street trees (DataSF ${s.m.datasf}, ${(100 * s.m.treeErr).toFixed(2)} % off), lamps ${LAMP_MIN}–${LAMP_MAX} m apart, ${Object.keys(r.types).length} prop types instanced, run-1 frame caps hold with the street layer (+${j.street} triangles at worst, cap ${T['G12.streetTriangles']})`);
  process.exit(0);
}

const MUT = {
  'a tenth of the trees dropped': async () => (await staticChecks({ dropTrees: 0.1 })).fail.filter(f => f.startsWith('trees')),
  'lamps spaced twice too far': async () => (await staticChecks({ lampScale: 2 })).fail.filter(f => f.startsWith('lamps')),
  'lamps drawn one mesh per lamp': async () => judgeFrame(measureChild('unbatched'), T).fail.filter(f => f.startsWith('instancing') || f.startsWith('frame')),
  'street layer past its triangle cap': async () => judgeFrame(measureChild('heavy'), T).fail.filter(f => f.startsWith('street layer') || f.startsWith('frame')),
};
let missed = 0;
for (const [name, run] of Object.entries(MUT)) {
  const f = await run();
  console.log(`${f.length ? 'caught  ' : 'MISSED  '} ${name}${f.length ? ' — ' + f[0] : ''}`);
  if (!f.length) missed++;
}
console.log(`NEGATIVE ${Object.keys(MUT).length - missed}/${Object.keys(MUT).length}`);
process.exit(missed ? 0 : 1);
