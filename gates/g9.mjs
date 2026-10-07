// G9 Road mesh: the street pipeline meshes ≥ the calibrated share (floor 95 %) of the OSM drivable centerline
// length in the slice; no road surface reaches more than 0.5 m into a building footprint; intersections are
// watertight (every junction disk is covered, every point of the road region is covered, and the triangles'
// area equals the region's area, so nothing overlaps); two offline runs from the cache are byte-identical and
// equal public/street + data/street/log.json.
// --negative: 10 % of the ways dropped, the building clip skipped, a hole cut at a junction, overlapping strips,
// a non-deterministic rerun and stale shipped data must each be caught.
import { cpSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { readThresholds, freeze } from 'harbor-engine/gates/lib/thresholds.mjs';
import { buildStreet, writeStreet } from '../pipelines/street/build.mjs';
import { polygons, Region, area } from '../pipelines/street/geom.mjs';
import { readStreet, TriIndex, offlineRuns, differing, cleanup, root } from './lib/street.mjs';

const NEG = process.argv.includes('--negative');
// the road base: asphalt (0) and trackway (4); paint and rails (1–3) are decals on top of it
const BASE = mat => mat === 0 || mat === 4;
const FLOOR = 0.95;

// Coverage base: every ground drivable way of the full (unmodified) cache, sampled every metre inside the
// slice boxes and over land.
function coverageBase(full) {
  const { ctx } = full, boxes = new Region(ctx.boxes.map(b => [b.ring]));
  const samples = [];
  for (const w of full.roads.ways) for (let i = 0; i + 1 < w.pts.length; i++) {
    const [ax, az] = w.pts[i], [bx, bz] = w.pts[i + 1], L = Math.hypot(bx - ax, bz - az);
    for (let s = 0.5; s < L; s += 1) {
      const x = ax + (bx - ax) * s / L, z = az + (bz - az) * s / L;
      if (boxes.contains(x, z) && ctx.height.at(x, z) >= 0.3) samples.push([x, z]);
    }
  }
  return samples;
}

function junctions(full) {
  const ends = new Map(), width = new Map();
  for (const w of full.roads.ways) w.nodes.forEach((n, k) => {
    ends.set(n, (ends.get(n) || 0) + (k === 0 || k === w.nodes.length - 1 ? 1 : 2));
    width.set(n, Math.min(width.get(n) ?? Infinity, w.width));
    if (!ends.has('p' + n)) ends.set('p' + n, w.pts[k]);
  });
  const out = [];
  for (const [n, c] of ends) if (typeof n === 'number' && c >= 3) out.push({ id: n, p: ends.get('p' + n), r: 0.4 * width.get(n) });
  return out;
}

function analyse(full, mesh, base) {
  const { ctx } = full, fail = [];
  const idx = new TriIndex(mesh, ctx.height.gridOrigin, BASE);
  // 1. coverage
  let hit = 0;
  for (const [x, z] of base.samples) if (idx.find(x, z) >= 0) hit++;
  const coverage = hit / base.samples.length;
  // 2. building penetration: road vertices and triangle centroids inside a footprint, by depth
  const bld = base.bld;
  let depth = 0, at = null;
  const v = mesh.vertices, ix = mesh.indices;
  for (let t = 0; t < ix.length; t += 3) {
    const a = ix[t] * 10, b = ix[t + 1] * 10, c = ix[t + 2] * 10;
    if (!BASE(Math.round(v[a + 6]))) continue;
    for (const [x, z] of [[v[a], v[a + 2]], [v[b], v[b + 2]], [v[c], v[c + 2]], [(v[a] + v[b] + v[c]) / 3, (v[a + 2] + v[b + 2] + v[c + 2]) / 3]]) {
      if (!bld.contains(x, z)) continue;
      const d = bld.distance(x, z, 20);
      if (d > depth) { depth = d; at = [x, z]; }
    }
  }
  // 3. watertight junctions: a disk of 0.4 × the narrowest incident width, sampled every 0.5 m
  let holes = 0, checked = 0, firstHole = null;
  for (const j of base.junctions) {
    const [jx, jz] = j.p;
    if (!base.boxes.contains(jx, jz) || ctx.height.at(jx, jz) < 0.5 || bld.distance(jx, jz, j.r + 1) < Infinity || bld.contains(jx, jz)) continue;
    checked++;
    let miss = 0;
    for (let dx = -j.r; dx <= j.r; dx += 0.5) for (let dz = -j.r; dz <= j.r; dz += 0.5) {
      if (dx * dx + dz * dz > j.r * j.r) continue;
      if (ctx.height.at(jx + dx, jz + dz) < 0.35 || !base.boxes.contains(jx + dx, jz + dz)) continue;
      if (idx.find(jx + dx + 0.013, jz + dz + 0.017) < 0) miss++;
    }
    if (miss) { holes++; firstHole = firstHole || j; }
  }
  // 4. the road region is covered everywhere (sample grid) and the triangles add up to its area (no overlaps)
  const roadPolys = base.roadPolys;
  let uncovered = 0;
  for (const [x, z] of base.regionSamples) if (idx.find(x, z) < 0) uncovered++;
  const S = full.log.surfaces;
  let poly = 0, water = 0;
  for (const m of [0, 4]) if (S[m]) { poly += S[m].polyArea; water += S[m].waterArea; }
  const areaErr = Math.abs(idx.area + water - poly) / poly;
  const m = { coverage, samples: base.samples.length, depth, at, junctions: checked, holes, firstHole, uncovered, regionSamples: base.regionSamples.length, areaErr, meshArea: idx.area, polyArea: poly };
  return { m, roadPolys };
}

function judge(m, T) {
  const fail = [];
  const floor = T['G9.roadCoverage'] ?? FLOOR;
  if (!(m.coverage >= floor)) fail.push(`coverage: ${(100 * m.coverage).toFixed(2)} % of ${m.samples} drivable centerline metres meshed, floor ${(100 * floor).toFixed(2)} %`);
  if (!(m.depth <= 0.5)) fail.push(`buildings: road surface reaches ${m.depth.toFixed(2)} m into a footprint at (${m.at.map(v => v.toFixed(1))}), max 0.5 m`);
  if (m.holes) fail.push(`junctions: ${m.holes}/${m.junctions} junction disks have holes (first at node ${m.firstHole.id})`);
  if (m.uncovered) fail.push(`watertight: ${m.uncovered}/${m.regionSamples} points of the road region are not covered by the mesh`);
  if (!(m.areaErr <= 1e-3)) fail.push(`overlap: mesh area ${m.meshArea.toFixed(0)} m² (+ water) vs region ${m.polyArea.toFixed(0)} m² — ${(100 * m.areaErr).toFixed(2)} % off`);
  return fail;
}

// triangles touching water are dropped whole: sample only where the 6 m cell around is all land
const landAround = (ctx, x, z) => { for (const dx of [-6, 0, 6]) for (const dz of [-6, 0, 6]) if (ctx.height.at(x + dx, z + dz) < 0.3) return false; return true; };

const t0 = Date.now();
const full = await buildStreet();
const { ctx } = full;
const base = {
  samples: coverageBase(full), junctions: junctions(full),
  bld: new Region(ctx.buildings.flatMap(b => b.polys.map(p => [p[0]]))),
  boxes: new Region(ctx.boxes.map(b => [b.ring])),
};
// road region (all road-level surfaces) and a sample grid over it
base.roadPolys = polygons(full.roads.R.concat(full.roads.T));
const roadRegion = new Region(base.roadPolys);
base.regionSamples = [];
{
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (const b of ctx.boxes) for (const [x, z] of b.ring) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); }
  for (let z = z0 + 0.37; z < z1; z += 4.13) for (let x = x0 + 0.29; x < x1; x += 4.07)
    if (roadRegion.contains(x, z) && roadRegion.distance(x, z, 0.02) === Infinity && landAround(ctx, x, z)) {
      base.regionSamples.push([x, z]);
    }
}

const T = readThresholds();
if (!NEG) {
  const { m } = analyse(full, full.packed, base);
  console.log(`coverage ${(100 * m.coverage).toFixed(2)} % of ${m.samples} centerline metres; max building penetration ${m.depth.toFixed(3)} m; ${m.junctions} junctions, ${m.holes} with holes; ${m.uncovered}/${m.regionSamples} region samples uncovered; mesh/region area error ${(100 * m.areaErr).toFixed(4)} %`);
  if (!('G9.roadCoverage' in T)) {
    if (m.coverage < FLOOR) { console.log(`G9 FAIL — calibration coverage ${(100 * m.coverage).toFixed(2)} % is below the ${FLOOR * 100} % floor; not freezing`); process.exit(1); }
    const v = Math.max(FLOOR, Math.floor(m.coverage * 1000) / 1000 - 0.005);
    freeze('G9.roadCoverage', +v.toFixed(3), `share of OSM drivable ground centerline metres (D58) inside the slice boxes and over land covered by the road mesh; measured ${(100 * m.coverage).toFixed(2)} % on ${new Date().toISOString().slice(0, 10)}; value = max( 0.95, measured − 0.5 % )`);
    T['G9.roadCoverage'] = +v.toFixed(3);
  }
  const fail = judge(m, T);
  // 5. determinism: two offline runs, byte-identical, equal to what is shipped
  const runs = offlineRuns(2);
  const d12 = differing(join(runs[0], 'out'), join(runs[1], 'out')).concat(differing(runs[0], runs[1], ['log.json']));
  const dShip = differing(join(runs[0], 'out'), join(root, 'public/street')).concat(readFileSync(join(runs[0], 'log.json')).equals(readFileSync(join(root, 'data/street/log.json'))) ? [] : ['log.json']);
  cleanup(runs);
  if (d12.length) fail.push(`determinism: two offline runs differ in ${d12.join(', ')}`);
  if (dShip.length) fail.push(`shipped: public/street or data/street/log.json differ from the pipeline output (${dShip.join(', ')}) — rerun pipelines/street/build.mjs`);
  if (fail.length) { console.log('G9 FAIL\n- ' + fail.join('\n- ')); process.exit(1); }
  console.log(`G9 PASS — ${(100 * m.coverage).toFixed(2)} % of drivable centerline meshed (floor ${(100 * T['G9.roadCoverage']).toFixed(1)} %), no building overlap > 0.5 m, ${m.junctions} junctions watertight, byte-identical offline ×2 = shipped (${((Date.now() - t0) / 1000).toFixed(0)} s)`);
  process.exit(0);
}

// ---- negative fixtures
const MUT = {};
MUT['10 % of the road ways dropped'] = async () => {
  let k = 0;
  const r = await buildStreet({ roadsOnly: true, roadOptions: { dropWays: () => (k++ % 10) === 3 } });
  return judge(analyse(full, r.packed, base).m, T);
};
MUT['building clip skipped'] = async () => {
  const r = await buildStreet({ roadsOnly: true, roadOptions: { noBuildingClip: true } });
  return judge(analyse(full, r.packed, base).m, T);
};
MUT['hole cut at a junction'] = async () => {
  const j = base.junctions.find(j => base.boxes.contains(...j.p) && ctx.height.at(...j.p) > 2 && !base.bld.contains(...j.p) && base.bld.distance(j.p[0], j.p[1], j.r + 1) === Infinity && j.r > 1.5);
  const ix = full.packed.indices.slice(), v = full.packed.vertices;
  // remove the base triangle under the junction point
  const t = new TriIndex(full.packed, ctx.height.gridOrigin, BASE).find(j.p[0] + 0.013, j.p[1] + 0.017);
  ix[t] = ix[t + 1] = ix[t + 2] = 0;
  return judge(analyse(full, { vertices: v, indices: ix }, base).m, T);
};
MUT['overlapping strips (2 % of triangles drawn twice)'] = async () => {
  const ix = full.packed.indices, extra = [];
  for (let t = 0; t < ix.length; t += 3) if ((t / 3) % 50 === 7) extra.push(ix[t], ix[t + 1], ix[t + 2]);
  const both = new Uint32Array(ix.length + extra.length); both.set(ix); both.set(extra, ix.length);
  return judge(analyse(full, { vertices: full.packed.vertices, indices: both }, base).m, T);
};
MUT['non-deterministic rerun'] = async () => {
  const [a] = offlineRuns(1), [b] = offlineRuns(1, { STREET_FIXTURE: 'jitter' });
  const d = differing(join(a, 'out'), join(b, 'out'));
  cleanup([a, b]);
  return d.length ? [`determinism: two offline runs differ in ${d.join(', ')}`] : [];
};
MUT['stale shipped data'] = async () => {
  const [a] = offlineRuns(1);
  const p = join(a, 'out/street.json'); writeFileSync(p, readFileSync(p, 'utf8').replace(/"tile":\d+/, '"tile":101'));
  const d = differing(join(a, 'out'), join(root, 'public/street'));
  cleanup([a]);
  return d.length ? [`shipped differs: ${d.join(', ')}`] : [];
};
let missed = 0;
for (const [name, run] of Object.entries(MUT)) {
  const f = await run();
  console.log(`${f.length ? 'caught  ' : 'MISSED  '} ${name}${f.length ? ' — ' + f[0] : ''}`);
  if (!f.length) missed++;
}
console.log(`NEGATIVE ${Object.keys(MUT).length - missed}/${Object.keys(MUT).length}`);
process.exit(missed ? 0 : 1);
