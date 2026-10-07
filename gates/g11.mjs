// G11 Storefront band: ≥ the calibrated share (floor 80 %) of street-facing building edges in the slice carry
// ground-floor modules; every sign string is generic category text (pipelines/street/signs.mjs) and none is a name,
// brand or operator found in the cached OSM data; the storefront data is byte-identical across two offline runs
// and equal to what is shipped; no sign image files are shipped (signs are drawn by code, D50).
// Street-facing is judged here from the shipped street mesh, not from the pipeline's own test: an edge (≥ 2.5 m, not
// a landmark) faces the street when walkway or road lies within 3 m in front of at least half of it.
// --negative: a brand name on a sign, an OSM business name on a sign, modules dropped from a third of the edges, a
// non-deterministic rerun, and a sign image file in public/street must each be caught.
import { readFileSync, readdirSync, writeFileSync, mkdtempSync, cpSync, rmSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readThresholds, freeze } from 'harbor-engine/gates/lib/thresholds.mjs';
import { loadContext, elements } from '../pipelines/street/context.mjs';
import { GENERIC } from '../pipelines/street/signs.mjs';
import { readStreet, offlineRuns, differing, cleanup, root } from './lib/street.mjs';
import { StreetGround } from '../src/street/Ground.js';

const NEG = process.argv.includes('--negative');
const FLOOR = 0.8;

export function readStores(dir) {
  const index = JSON.parse(readFileSync(join(dir, 'stores.json'), 'utf8'));
  const body = inflateSync(readFileSync(join(dir, 'stores.bin.deflate')));
  return { index, modules: new Float32Array(body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength)) };
}

function coverage(ctx, ground, modules) {
  // modules by 10 m cell of their midpoint
  const cells = new Map();
  for (let i = 0; i < modules.length; i += 12) {
    const x = (modules[i] + modules[i + 4]) / 2, z = (modules[i + 1] + modules[i + 5]) / 2, k = Math.floor(z / 10) * 1e5 + Math.floor(x / 10);
    if (!cells.has(k)) cells.set(k, []);
    cells.get(k).push(i);
  }
  let facing = 0, carried = 0;
  const street = (x, z) => { const q = ground.at(x, z); return !!q; };
  for (const b of ctx.buildings) {
    if (b.landmark || b.h < 3.5) continue;
    for (const poly of b.polys) {
      const ring = poly[0];
      let a2 = 0; for (let i = 0; i < ring.length; i++) { const p = ring[i], q = ring[(i + 1) % ring.length]; a2 += p[0] * q[1] - q[0] * p[1]; }
      for (let i = 0; i < ring.length; i++) {
        const p = ring[i], q = ring[(i + 1) % ring.length], L = Math.hypot(q[0] - p[0], q[1] - p[1]);
        if (L < 2.5) continue;
        const dx = (q[0] - p[0]) / L, dz = (q[1] - p[1]) / L, ox = a2 > 0 ? dz : -dz, oz = a2 > 0 ? -dx : dx;
        let f = 0, n = 0;
        for (let s = 0.5; s < L; s += 1) { n++; const x = p[0] + dx * s, z = p[1] + dz * s; if ([0.6, 1.6, 2.6].some(d => street(x + ox * d, z + oz * d) && !ctx.buildingRegion.contains(x + ox * d, z + oz * d))) f++; }
        if (f < 0.5 * n) continue;
        facing++;
        // modules lying on this edge (both ends within 5 cm of its line, inside its span)
        let cover = 0;
        const mx = (p[0] + q[0]) / 2, mz = (p[1] + q[1]) / 2, seen = new Set();
        for (let cz = Math.floor((mz - L / 2 - 10) / 10); cz <= Math.floor((mz + L / 2 + 10) / 10); cz++) for (let cx = Math.floor((mx - L / 2 - 10) / 10); cx <= Math.floor((mx + L / 2 + 10) / 10); cx++) for (const m of cells.get(cz * 1e5 + cx) || []) {
          if (seen.has(m)) continue;
          seen.add(m);
          const ends = [[modules[m], modules[m + 1]], [modules[m + 4], modules[m + 5]]];
          if (ends.every(([x, z]) => Math.abs((x - p[0]) * dz - (z - p[1]) * dx) < 0.05 && (x - p[0]) * dx + (z - p[1]) * dz > -0.05 && (x - p[0]) * dx + (z - p[1]) * dz < L + 0.05)) cover += Math.hypot(ends[1][0] - ends[0][0], ends[1][1] - ends[0][1]);
        }
        if (cover >= 0.8 * L) carried++;
      }
    }
  }
  return { facing, carried, share: carried / facing };
}

// every distinct name / brand / operator in the cached OSM street data (upper case)
function osmNames(ctx) {
  const s = new Set();
  for (const e of ctx.elements) for (const k of ['name', 'brand', 'operator', 'name:en', 'name:zh', 'official_name', 'alt_name']) if (e.tags?.[k]) s.add(e.tags[k].toUpperCase().trim());
  return s;
}
function signFails(texts, names) {
  const f = [];
  for (const t of texts) {
    const parts = t.split(' ');
    const zh = /^[⺀-鿿]$/.test(parts[0]) ? parts.shift() : null;
    const en = parts.join(' ');
    if (!GENERIC.has(en) || (zh && !GENERIC.has(zh))) f.push(`sign "${t}" is not generic category text`);
    if (names.has(t.toUpperCase()) && !GENERIC.has(t)) f.push(`sign "${t}" is a name from the OSM data`);
  }
  return f;
}
const imageFiles = dir => readdirSync(dir).filter(f => /\.(png|jpe?g|webp|gif|ktx2?|basis|avif)$/i.test(f));

const ctx = await loadContext();
ctx.elements = elements(ctx);
const { Region } = await import('../pipelines/street/geom.mjs');
ctx.buildingRegion = new Region(ctx.buildings.flatMap(b => b.polys.map(p => [p[0]])));
const shipped = readStores(join(root, 'public/street'));
const ground = new StreetGround(readStreet(join(root, 'public/street')), ctx.height.gridOrigin);
const names = osmNames(ctx);
const T = readThresholds();

if (!NEG) {
  const fail = [];
  const c = coverage(ctx, ground, shipped.modules);
  console.log(`storefronts: ${shipped.modules.length / 12} modules; ${c.carried}/${c.facing} street-facing edges carry them (${(100 * c.share).toFixed(1)} %); ${shipped.index.texts.length} distinct sign strings`);
  if (!('G11.storefrontShare' in T)) {
    if (c.share < FLOOR) { console.log(`G11 FAIL — calibration share ${(100 * c.share).toFixed(1)} % is below the 80 % floor; not freezing`); process.exit(1); }
    const v = Math.max(FLOOR, Math.floor(c.share * 100) / 100 - 0.02);
    freeze('G11.storefrontShare', v, `share of street-facing building edges (≥ 2.5 m, walkway or road within 3 m in front, judged on the shipped street mesh) carrying ground-floor modules over ≥ 80 % of their length; measured ${(100 * c.share).toFixed(1)} % on ${new Date().toISOString().slice(0, 10)}; value = max( 0.80, measured − 2 % )`);
    T['G11.storefrontShare'] = v;
  }
  if (!(c.share >= T['G11.storefrontShare'])) fail.push(`coverage: ${(100 * c.share).toFixed(1)} % of street-facing edges carry modules, floor ${(100 * T['G11.storefrontShare']).toFixed(0)} %`);
  fail.push(...signFails(shipped.index.texts, names));
  const imgs = imageFiles(join(root, 'public/street'));
  if (imgs.length) fail.push(`sign images shipped: ${imgs.join(', ')}`);
  const runs = offlineRuns(2);
  const files = ['stores.json', 'stores.bin.deflate'];
  const d12 = differing(join(runs[0], 'out'), join(runs[1], 'out'), files), dShip = differing(join(runs[0], 'out'), join(root, 'public/street'), files);
  cleanup(runs);
  if (d12.length) fail.push(`determinism: two offline runs differ in ${d12.join(', ')}`);
  if (dShip.length) fail.push(`shipped: public/street ${dShip.join(', ')} differ from the pipeline output`);
  if (fail.length) { console.log('G11 FAIL\n- ' + fail.slice(0, 12).join('\n- ')); process.exit(1); }
  console.log(`G11 PASS — ${(100 * c.share).toFixed(1)} % of ${c.facing} street-facing edges carry storefront modules (floor ${(100 * T['G11.storefrontShare']).toFixed(0)} %), ${shipped.index.texts.length} sign strings all generic, byte-identical offline ×2 = shipped`);
  process.exit(0);
}

const shop = ctx.elements.find(e => e.tags?.shop && e.tags?.name && !GENERIC.has(e.tags.name.toUpperCase()));
const MUT = {
  'brand name on a sign': () => signFails([...shipped.index.texts.slice(1), 'STARBUCKS'], names),
  [`OSM business name on a sign ("${shop?.tags.name}")`]: () => signFails([...shipped.index.texts, shop.tags.name.toUpperCase()], names),
  'modules dropped from a third of the edges': () => {
    const m = shipped.modules, keep = [];
    for (let i = 0; i < m.length; i += 12) if (Math.floor((m[i] + m[i + 1]) * 7) % 3 !== 0) keep.push(...m.subarray(i, i + 12));
    const c = coverage(ctx, ground, new Float32Array(keep));
    return c.share >= T['G11.storefrontShare'] ? [] : [`coverage ${(100 * c.share).toFixed(1)} % below the floor`];
  },
  'non-deterministic rerun': () => {
    const [a] = offlineRuns(1), [b] = offlineRuns(1, { STREET_FIXTURE: 'jitter-stores' });
    const d = differing(join(a, 'out'), join(b, 'out'), ['stores.json', 'stores.bin.deflate']);
    cleanup([a, b]);
    return d.length ? [`determinism: differ in ${d.join(', ')}`] : [];
  },
  'a sign image file shipped': () => {
    const d = mkdtempSync(join(tmpdir(), 'g11-'));
    cpSync(join(root, 'public/street'), d, { recursive: true });
    writeFileSync(join(d, 'sign-cafe.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    const imgs = imageFiles(d);
    rmSync(d, { recursive: true, force: true });
    return imgs.length ? [`sign images shipped: ${imgs.join(', ')}`] : [];
  },
};
let missed = 0;
for (const [name, run] of Object.entries(MUT)) {
  const f = run();
  console.log(`${f.length ? 'caught  ' : 'MISSED  '} ${name}${f.length ? ' — ' + f[0] : ''}`);
  if (!f.length) missed++;
}
console.log(`NEGATIVE ${Object.keys(MUT).length - missed}/${Object.keys(MUT).length}`);
process.exit(missed ? 0 : 1);
