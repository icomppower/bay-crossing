// G14 Look (advisory): fixed-seed headless shots for human review in shots/street/ — the Ferry Building plaza, the
// Embarcadero at Pier 7 and Sausalito's Bridgeway, at midday and at night, and at golden hour in evening fog (D57),
// each from the walkway at eye height (1.7 m), crowd seed 1975 — plus the same views without the street layer (run 1,
// "before-…"). Checked: no shot is blank, night is darker than midday, and every "after" differs visibly from its
// "before".
// --negative: night shots rendered at noon, and "after" shots with the street layer left off must each be caught.
import { spawnSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readPNG } from 'harbor-engine/gates/lib/png.mjs';
import { root } from './lib/street.mjs';

const NEG = process.argv.includes('--negative');
const OUT = join(root, 'shots/street');
// [ name, eye lat, lon, look lat, lon, look height above the street there ]
const PLACES = [
  ['ferry-plaza', 37.79525, -122.39445, 37.79560, -122.39355, 14],
  ['embarcadero-pier7', 37.79870, -122.39700, 37.80150, -122.40050, 3],
  ['sausalito-bridgeway', 37.85545, -122.47930, 37.85698, -122.48053, 3],
];
const TIMES = { midday: { hour: 12.5 }, night: { hour: 21.5 }, golden: { hour: 17.6, fog: 3.5 } };

async function shoot(dir, { street = true, prefix = '', sabotage = '' } = {}) {
  const { bootApp } = await import('harbor-engine/tools/headless/app.mjs');
  const { writePNG } = await import('harbor-engine/test/headless.mjs');
  const { toLocal } = await import('harbor-engine/src/world/Frame.js');
  const { toUTM } = await import('harbor-engine/tools/geo/utm.mjs');
  const { Vector3 } = await import('harbor-engine/src/engine/index.js');
  const { attachStreet } = await import('../src/street/index.js');
  const W = 1600, Hh = 900;
  const H = await bootApp({ width: W, height: Hh, query: '?fly&noAudio&tier=low&seed=1975' });
  const app = H.app;
  const st = street ? await attachStreet(app) : null;
  const ground = (x, z) => (st && st.ground.heightAt(x, z)) ?? app.terrainData.heightAt(x, z);
  // the nearest walkway point to a place (the street layer's ground; without it, the same spot found with a
  // temporary street ground so before / after match)
  const walkGround = st ? st.ground : (await (async () => { const { readStreet } = await import('./lib/street.mjs'); const { StreetGround } = await import('../src/street/Ground.js'); return new StreetGround(readStreet(join(root, 'public/street')), app.terrainData.origin + app.terrainData.texel / 2); })());
  const snap = (x, z) => { for (let r = 0; r <= 15; r += 0.5) for (let a = 0; a < 16; a++) { const px = x + Math.cos(a / 16 * 6.283) * r, pz = z + Math.sin(a / 16 * 6.283) * r, q = walkGround.at(px, pz); if (q && q.walkable) return [px, pz, q.y]; } return [x, z, ground(x, z)]; };
  const stats = [];
  for (const [name, lat, lon, tlat, tlon, ty] of PLACES) for (const [tname, t] of Object.entries(TIMES)) {
    if (prefix === 'before-' && tname === 'golden') continue;
    const p = toLocal(...toUTM(lat, lon)), q = toLocal(...toUTM(tlat, tlon));
    const [x, z, y0] = snap(p.x, p.z);
    const eye = y0 + 1.7, ly = walkGround.heightAt(q.x, q.z) ?? app.terrainData.heightAt(q.x, q.z);
    app.settings.timeOfDay = sabotage === 'noon' ? 12.5 : t.hour;
    if (app.haze) app.haze.density.value = t.fog || 1.6;
    app.fly.setPose(new Vector3(x, eye, z), Math.atan2(-(q.x - x), -(q.z - z)), Math.atan2(ly + ty - eye, Math.hypot(q.x - x, q.z - z)));
    for (let i = 0; i < 60; i++) { app.frame(1 / 30); if (i % 10 === 9) await H.settle(); }
    const px = await H.readPixels();
    const file = join(dir, `${prefix}${name}-${tname}.png`);
    writePNG(file, W, Hh, px);
    stats.push({ name, time: tname, file });
  }
  return { stats, errors: H.errors.length };
}

if (process.argv.includes('--shoot')) {
  const dir = process.argv[process.argv.indexOf('--shoot') + 1];
  const street = !process.argv.includes('--no-street');
  const prefix = (process.argv.find(a => a.startsWith('--prefix=')) || '').split('=')[1] || '';
  const sabotage = (process.argv.find(a => a.startsWith('--sabotage=')) || '').split('=')[1] || '';
  console.log('SHOT ' + JSON.stringify(await shoot(dir, { street, prefix, sabotage })));
  process.exit(0);
}

function child(args) {
  const r = spawnSync(process.execPath, [fileURLToPath(import.meta.url), '--shoot', ...args], { cwd: root, encoding: 'utf8', maxBuffer: 1 << 26 });
  const line = (r.stdout || '').split('\n').find(l => l.startsWith('SHOT '));
  if (!line) throw new Error('shots crashed: ' + (r.stderr || '').slice(-1500));
  return JSON.parse(line.slice(5));
}

const lum = file => { const { width, height, data } = readPNG(file); let s = 0, s2 = 0; const n = width * height; for (let i = 0; i < n; i++) { const l = 0.2126 * data[i * 4] + 0.7152 * data[i * 4 + 1] + 0.0722 * data[i * 4 + 2]; s += l; s2 += l * l; } const m = s / n; return { mean: m, std: Math.sqrt(s2 / n - m * m), data, n }; };
const diff = (a, b) => { let s = 0; for (let i = 0; i < a.n; i++) s += Math.abs(a.data[i * 4] - b.data[i * 4]) + Math.abs(a.data[i * 4 + 1] - b.data[i * 4 + 1]) + Math.abs(a.data[i * 4 + 2] - b.data[i * 4 + 2]); return s / a.n / 3; };

function judge(dir, afterPrefix = '', beforePrefix = 'before-') {
  const fail = [], rows = [];
  for (const [name] of PLACES) {
    const L = Object.fromEntries(Object.keys(TIMES).map(t => [t, lum(join(dir, `${afterPrefix}${name}-${t}.png`))]));
    for (const [t, l] of Object.entries(L)) if (l.std < 6) fail.push(`blank: ${name} ${t} (luminance sd ${l.std.toFixed(1)})`);
    if (!(L.night.mean < 0.6 * L.midday.mean)) fail.push(`night: ${name} night (mean ${L.night.mean.toFixed(0)}) is not darker than midday (${L.midday.mean.toFixed(0)})`);
    for (const t of ['midday', 'night']) {
      const d = diff(L[t], lum(join(dir, `${beforePrefix}${name}-${t}.png`)));
      rows.push(`${name} ${t}: mean ${L[t].mean.toFixed(0)}, before/after difference ${d.toFixed(1)}`);
      if (!(d > 4)) fail.push(`street: ${name} ${t} looks the same as before the street layer (difference ${d.toFixed(1)})`);
    }
  }
  return { fail, rows };
}

mkdirSync(OUT, { recursive: true });
if (!NEG) {
  const a = child([OUT]), b = child([OUT, '--no-street', '--prefix=before-']);
  const j = judge(OUT);
  console.log(j.rows.join('\n'));
  if (a.errors || b.errors) j.fail.push(`render: ${a.errors + b.errors} console/GPU errors`);
  if (j.fail.length) { console.log('G14 FAIL (advisory)\n- ' + j.fail.join('\n- ')); process.exit(1); }
  console.log(`G14 PASS (advisory) — ${a.stats.length} street-level shots and ${b.stats.length} run-1 "before" shots in shots/street/ for review`);
  process.exit(0);
}

const tmp = join(root, '.verify/g14neg');
mkdirSync(tmp, { recursive: true });
const MUT = {
  'night shots rendered at noon': () => { child([tmp, '--sabotage=noon']); child([tmp, '--no-street', '--prefix=before-']); return judge(tmp).fail.filter(f => f.startsWith('night')); },
  'after shots without the street layer': () => { child([tmp, '--no-street', '--prefix=x-']); child([tmp, '--no-street', '--prefix=before-']); return judge(tmp, 'x-').fail.filter(f => f.startsWith('street')); },
};
let missed = 0;
for (const [name, run] of Object.entries(MUT)) {
  let f;
  try { f = run(); } catch (e) { f = []; console.log(String(e).slice(0, 300)); }
  console.log(`${f.length ? 'caught  ' : 'MISSED  '} ${name}${f.length ? ' — ' + f[0] : ''}`);
  if (!f.length) missed++;
}
console.log(`NEGATIVE ${Object.keys(MUT).length - missed}/${Object.keys(MUT).length}`);
process.exit(missed ? 0 : 1);
