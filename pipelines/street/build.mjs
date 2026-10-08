// Street pipeline (run 2): cached OSM / DataSF + run-1 building footprints + terrain → street-level data.
//   node pipelines/street/build.mjs [--out <dir>] [--log <file>]
// Output (default public/street/): street.json (tile index, counts) + surface.bin.deflate (Float32 vertices ×10,
// Uint32 indices), and the log (default data/street/log.json) with every default used (D45: way IDs).
// Deterministic: cache only, sorted inputs, integer clipping, fixed zlib settings, no clocks or randomness.
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { join, dirname } from 'node:path';
import { TITLE, isMain } from 'harbor-engine/tools/lib/title.mjs';
import { loadContext, elements } from './context.mjs';
import { union, diff, inter, toPath, area, Region, clean, perTile, offset } from './geom.mjs';
import { buildWalks } from './walks.mjs';
import { buildStores } from './stores.mjs';
import { buildProps, TYPES } from './props.mjs';
import { buildCrowdGraph } from './crowd.mjs';
import { buildRoads, MAT } from './roads.mjs';
import { MeshBuilder, LIFT, TILE, f32 } from './mesh.mjs';

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
export const VERSION = 2;

// hash → [0, 1) for per-polygon variation (seeded, positional)
export const rand = (...k) => { let h = 2166136261; for (const v of k.join(',')) { h ^= v.charCodeAt(0); h = Math.imul(h, 16777619); } return ((h >>> 0) % 100000) / 100000; };

export async function buildStreet({ rawDir, roadOptions = {}, walkOptions = {}, roadsOnly = false } = {}) {
  const T0 = Date.now(), lap = what => { if (process.env.STREET_TIMING) console.error(`${what}: ${((Date.now() - T0) / 1000).toFixed(1)} s`); };
  const ctx = await loadContext(rawDir ? { rawDir } : {});
  ctx.elements = elements(ctx);
  ctx.buildingPaths = clean(union(ctx.buildings.flatMap(b => b.polys.map(p => toPath(p[0])))));
  ctx.buildingRegion = new Region(ctx.buildings.flatMap(b => b.polys.map(p => [p[0]])));

  lap('context');
  const roads = buildRoads(ctx, roadOptions);
  lap('roads');
  // roadsOnly (gate fixtures that only judge roads): no walkways, curbs or skirts
  const walks = roadsOnly ? { surfaces: [], edges: [], log: {} } : buildWalks(ctx, roads, walkOptions);
  lap('walks');
  const mesh = new MeshBuilder(ctx.height);
  const stats = {};
  // road base (asphalt, trackway) split at the crosswalk bands and where driveways cross a sidewalk strip: data.z = 1
  // there (walkable); paint and rails are decals above it
  // driveways: service road where it crosses a gap under 8 m in the walkways (a 4 m closing of them)
  const driveways = roadsOnly ? [] : perTile(400, 10, { svc: roads.serviceR, w: walks.walkAll }, t => t.svc.length ? inter(t.svc, offset(offset(t.w, 4, 'miter'), -4, 'miter')) : []);
  const walkBands = union(roads.crossBands, driveways);
  for (const s of roads.surfaces) {
    const st = stats[s.mat] = {};
    if (s.level === 'road') {
      mesh.addSurface(diff(s.paths, walkBands), LIFT.road, () => [s.mat, 0, 0, 0], st);
      mesh.addSurface(inter(s.paths, walkBands), LIFT.road, () => [s.mat, 0, 1, 0], st);
    } else mesh.addSurface(s.paths, LIFT[s.level], () => [s.mat, 0, 0, 0], st);
    st.polyArea = area(s.paths);
  }
  lap('road mesh');
  // walkways: a curb above the road within 8 m of one, easing down to path height by 12 m
  const walkLift = (x, z) => {
    const d = walks.roadRegion.distance(x, z, 12);
    return d <= 8 ? LIFT.walk : d >= 12 ? LIFT.path : LIFT.walk + (LIFT.path - LIFT.walk) * (d - 8) / 4;
  };
  for (const s of walks.surfaces) {
    const st = stats[s.mat] = {};
    mesh.addSurface(s.paths, walkLift, (x, z) => [s.mat, walks.angleAt(x, z), 0, 0], st);
    st.polyArea = area(s.paths);
  }
  lap('walk mesh');
  // curb faces (road → walk level) and skirts (walk level → just under the ground) where the walk is raised; heights
  // read off the finished surfaces just inside the walk and just outside it
  const h = ctx.height.filled;
  const isWalk = m => m === MAT.walk || m === MAT.plaza, isRoad = m => m === MAT.asphalt || m === MAT.trackway;
  let walls = 0;
  for (const e of walks.edges) {
    if (Math.min(ctx.height.filled(...e.a), ctx.height.filled(...e.b)) < 0.3) continue;
    const ta = walkLift(...e.a), tb = walkLift(...e.b);
    if (e.kind === 'skirt' && Math.max(ta, tb) < 0.1) continue;
    // outward = left of a→b
    const dx = e.b[0] - e.a[0], dz = e.b[1] - e.a[1], L = Math.hypot(dx, dz), ox = dz / L * 0.05, oz = -dx / L * 0.05;
    // each side's triangle just inside / outside, its plane evaluated at the edge point itself
    const top = (p, t) => mesh.surfaceAt(p[0] - ox, p[1] - oz, isWalk, p) ?? h(...p) + t;
    const bottom = p => e.kind === 'curb' ? mesh.surfaceAt(p[0] + ox, p[1] + oz, isRoad, p) ?? h(...p) + LIFT.road : h(...p) - 0.05;
    const ya1 = top(e.a, ta), yb1 = top(e.b, tb), ya0 = Math.min(bottom(e.a), ya1 - 0.02), yb0 = Math.min(bottom(e.b), yb1 - 0.02);
    mesh.wall(e.a, e.b, f32(ya0), f32(ya1), f32(yb0), f32(yb1), k => [e.mat, 0, 0, k >= 2 ? 1 : 0]);
    walls++;
  }
  stats.walls = walls;
  stats.raiseCapped = { triangles: mesh.capped || 0, area: Math.round(mesh.cappedArea || 0) };
  lap('walls');
  // storefront modules (G11): their base follows the walkway (or road) in front of the wall
  const stores = roadsOnly ? null : buildStores(ctx, roads, walks);
  if (stores) {
    const front = (x, z, ox, oz) => mesh.surfaceAt(x + ox * 0.5, z + oz * 0.5, m => isWalk(m) || isRoad(m)) ?? ctx.height.filled(x, z) + LIFT.walk;
    for (const m of stores.modules) { m.y0 = f32(front(m.x0, m.z0, m.ox, m.oz)); m.y1 = f32(front(m.x1, m.z1, m.ox, m.oz)); }
    lap('stores');
  }
  // street props (G12)
  const props = roadsOnly ? null : buildProps(ctx, roads, walks, stores, (x, z, keep) => mesh.surfaceAt(x, z, keep));
  if (props) lap('props');
  // the crowd's walking lanes and crossings (G12b)
  const crowd = roadsOnly ? null : buildCrowdGraph(ctx, roads, walks, (x, z, keep) => mesh.surfaceAt(x, z, keep), (x, z) => mesh.walkableAt(x, z));
  if (crowd) lap('crowd');
  const packed = mesh.pack();
  // gate fixture (G9 --negative): a non-deterministic run
  if (process.env.STREET_FIXTURE === 'jitter') packed.vertices[10 * Math.floor(Math.random() * 1000) + 1] += 1e-3;
  if (stores && process.env.STREET_FIXTURE === 'jitter-stores') stores.modules[Math.floor(Math.random() * stores.modules.length)].height += 0.01;
  const log = { roads: roads.log, walks: walks.log, stores: stores?.log, props: props?.log, crowd: crowd?.log, surfaces: stats };
  return { ctx, roads, walks, stores, props, crowd, packed, log };
}

// Shipped layout (surface.bin.deflate): positions Float32 ×3, normals Int8 ×4 (snorm), data Uint8 ×4 (material,
// angle 0–255 ↔ −π…π, walkable flag, wall flag), then Uint32 indices. 20 bytes a vertex.
export function compact(packed) {
  const { vertices: v } = packed, n = v.length / 10;
  const pos = new Float32Array(n * 3), nrm = new Int8Array(n * 4), dat = new Uint8Array(n * 4);
  for (let i = 0; i < n; i++) {
    const o = i * 10;
    pos[i * 3] = v[o]; pos[i * 3 + 1] = v[o + 1]; pos[i * 3 + 2] = v[o + 2];
    nrm[i * 4] = Math.round(v[o + 3] * 127); nrm[i * 4 + 1] = Math.round(v[o + 4] * 127); nrm[i * 4 + 2] = Math.round(v[o + 5] * 127);
    dat[i * 4] = v[o + 6]; dat[i * 4 + 1] = Math.round((v[o + 7] + Math.PI) / (2 * Math.PI) * 255) & 255; dat[i * 4 + 2] = v[o + 8]; dat[i * 4 + 3] = v[o + 9];
  }
  return { pos, nrm, dat };
}

// stores.bin.deflate: 12 Float32 a module (src/street/Stores.js): x0 z0 y0 H | x1 z1 y1 seed | kind flags sign palette,
// grouped in 100 m tiles (stores.json: texts, tiles [tx, tz, first, count])
export function writeStores(stores, out) {
  const tileOf = m => [Math.floor((m.x0 + m.x1) / 2 / TILE), Math.floor((m.z0 + m.z1) / 2 / TILE)];
  const mods = stores.modules.map(m => ({ m, t: tileOf(m) })).sort((a, b) => a.t[1] - b.t[1] || a.t[0] - b.t[0] || a.m.x0 - b.m.x0 || a.m.z0 - b.m.z0);
  const arr = new Float32Array(mods.length * 12), tiles = [];
  mods.forEach(({ m, t }, i) => {
    const left = m.ox * (m.z1 - m.z0) - m.oz * (m.x1 - m.x0) > 0 ? 16 : 0; // outward is left of x0→x1: (dz, -dx)
    arr.set([m.x0, m.z0, m.y0, m.height, m.x1, m.z1, m.y1, m.seed, m.kind, m.flags | left, m.sign, m.board + m.ink * 8 + m.awning * 64], i * 12);
    const last = tiles[tiles.length - 1];
    if (last && last[0] === t[0] && last[1] === t[1]) last[3]++; else tiles.push([t[0], t[1], i, 1]);
  });
  const body = Buffer.from(arr.buffer);
  writeFileSync(join(out, 'stores.bin.deflate'), deflateSync(body, { level: 9 }));
  writeFileSync(join(out, 'stores.json'), JSON.stringify({ version: VERSION, tile: TILE, count: mods.length, texts: stores.texts, tiles, sha256: createHash('sha256').update(body).digest('hex') }) + '\n');
}

// props.bin.deflate: per type (props.json `types`, in TYPES order), 8 Float32 an instance (pipelines/street/props.mjs),
// grouped in 100 m tiles [tx, tz, first, count] (first counts instances within the type)
export function writeProps(props, out) {
  const types = {}, parts = [];
  let offset = 0;
  for (const k of TYPES) {
    const list = props.props[k].map(r => {
      const x = k === 'wire' ? (r[0] + r[3]) / 2 : r[0], z = k === 'wire' ? (r[2] + r[5]) / 2 : r[2];
      return { r, t: [Math.floor(x / TILE), Math.floor(z / TILE)] };
    }).sort((a, b) => a.t[1] - b.t[1] || a.t[0] - b.t[0]);
    const arr = new Float32Array(list.length * 8), tiles = [];
    list.forEach(({ r, t }, i) => {
      arr.set(r, i * 8);
      const last = tiles[tiles.length - 1];
      if (last && last[0] === t[0] && last[1] === t[1]) last[3]++; else tiles.push([t[0], t[1], i, 1]);
    });
    types[k] = { offset, count: list.length, tiles };
    offset += list.length;
    parts.push(Buffer.from(arr.buffer));
  }
  const body = Buffer.concat(parts);
  writeFileSync(join(out, 'props.bin.deflate'), deflateSync(body, { level: 9 }));
  writeFileSync(join(out, 'props.json'), JSON.stringify({ version: VERSION, tile: TILE, stride: 8, types, names: props.names, sha256: createHash('sha256').update(body).digest('hex') }) + '\n');
}

// crowd.bin.deflate: lane points (Float32 x, z, clear half-width); crowd.json: lanes [first point, count, weight], crossings [lane a, point a,
// lane b, point b, band end a x, z, band end b x, z], the low-tier population
export const POPULATION = 17000;
export function writeCrowd(crowd, out) {
  // per lane point: x, z and the clear half-width of the segment that starts there (the last point repeats it)
  const pts = [], lanes = [];
  for (const l of crowd.lanes) { lanes.push([pts.length / 3, l.pts.length, Math.round(l.w * 1000) / 1000]); l.pts.forEach(([x, z], i) => pts.push(x, z, l.hw[Math.min(i, l.hw.length - 1)])); }
  const body = Buffer.from(new Float32Array(pts).buffer);
  writeFileSync(join(out, 'crowd.bin.deflate'), deflateSync(body, { level: 9 }));
  const r = v => Math.fround(v);
  writeFileSync(join(out, 'crowd.json'), JSON.stringify({ version: VERSION, population: POPULATION, lanes, crossings: crowd.crossings.map(c => c.map((v, i) => i < 4 ? v : r(v))), sha256: createHash('sha256').update(body).digest('hex') }) + '\n');
}

export function writeStreet(res, { out, logFile }) {
  const { packed, log } = res;
  mkdirSync(out, { recursive: true });
  const { pos, nrm, dat } = compact(packed);
  const buf = a => Buffer.from(a.buffer, a.byteOffset, a.byteLength);
  const body = Buffer.concat([buf(pos), buf(nrm), buf(dat), buf(packed.indices)]);
  const bin = deflateSync(body, { level: 9 });
  writeFileSync(join(out, 'surface.bin.deflate'), bin);
  const index = {
    version: VERSION, tile: TILE, layout: 'pos f32x3, nrm snorm8x4, dat u8x4 (mat, angle, walkable, wall), indices u32',
    vertices: pos.length / 3, indices: packed.indices.length,
    tiles: packed.tiles.map(t => [t.tx, t.tz, t.v0, t.vn, t.i0, t.in]),
    sha256: createHash('sha256').update(body).digest('hex'),
  };
  writeFileSync(join(out, 'street.json'), JSON.stringify(index) + '\n');
  if (res.stores) writeStores(res.stores, out);
  if (res.props) writeProps(res.props, out);
  if (res.crowd) writeCrowd(res.crowd, out);
  mkdirSync(dirname(logFile), { recursive: true });
  writeFileSync(logFile, JSON.stringify(log, null, 1) + '\n');
  return { bytes: bin.length, vertices: index.vertices, triangles: index.indices / 3 };
}

if (isMain(import.meta.url)) {
  const t = Date.now();
  const res = await buildStreet();
  const w = writeStreet(res, { out: arg('--out', join(TITLE, 'public/street')), logFile: arg('--log', join(TITLE, 'data/street/log.json')) });
  const L = res.log.roads;
  console.log(`street: ${L.ways} road ways (${L.widthDefaults.length} default widths), road ${L.roadArea} m², ${L.crosswalks} crosswalks, ${L.railWays} rail ways`);
  console.log(`walks: ${JSON.stringify(res.log.walks)}`);
  console.log(`mesh: ${w.vertices} vertices, ${w.triangles} triangles in ${res.packed.tiles.length} tiles, ${(w.bytes / 1e6).toFixed(1)} MB deflated, ${((Date.now() - t) / 1000).toFixed(1)} s`);
}
