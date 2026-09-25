// Ferry route: Ferry Building → Sausalito, planned offline over the shipped bathymetry (public/terrain) with
// the building footprints (public/buildings, pier sheds over the water) and OSM piers as obstacles.
//   node tools/ferry/route.mjs [--raw <dir>] [--out <file>]
// A* on a 6 m grid; a cell is navigable where the water at MSL is at least DEPTH_OPEN deep (draft + under-keel
// clearance + MSL→MLLW, so the route also holds at mean lower low water), relaxed to DEPTH_BERTH within
// BERTH_ZONE of each terminal. Cost grows near shallows / obstacles to keep the ferry off them. The path is then
// string-pulled to waypoints (straight legs that stay navigable). Deterministic.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readCached, RAW } from '../data/cache.mjs';
import { toUTM } from '../geo/utm.mjs';
import { parseGLB } from '../../src/engine/loaders/GLTF.js';
import { FERRY } from '../../src/world/FerrySpec.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const R2 = v => Math.round(v * 100) / 100;

const MSL_TO_MLLW = 2.773 - 1.822; // NOAA 9414290: MSL − MLLW (m)
export const DEPTH_OPEN = FERRY.draft + 1.0 + MSL_TO_MLLW; // 3.45 m below MSL
export const DEPTH_BERTH = FERRY.draft + 0.5; // 2.0 m, within BERTH_ZONE of a terminal
export const BERTH_ZONE = 150;
const CELL = 6, SIZE = 9600, N = SIZE / CELL, O = -SIZE / 2;

function terrain(dir) {
  const index = JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8'));
  const { res, tile } = index, h = new Float32Array(res * res);
  for (const f of index.files) {
    const b = inflateSync(readFileSync(join(dir, f.name)));
    for (let y = 0; y < tile; y++) for (let x = 0; x < tile; x++) h[(f.j * tile + y) * res + f.i * tile + x] = b.readInt16LE((y * tile + x) * 2) / 100;
  }
  return (x, z) => { const i = Math.floor((x - O) / 3), j = Math.floor((z - O) / 3); return i < 0 || j < 0 || i >= res || j >= res ? 0 : h[j * res + i]; };
}

function rasterPolys(block, polys, grow = 0) {
  for (const ring of polys) {
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (const [x, z] of ring) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); }
    for (let j = Math.floor((z0 - grow - O) / CELL); j <= Math.floor((z1 + grow - O) / CELL); j++) for (let i = Math.floor((x0 - grow - O) / CELL); i <= Math.floor((x1 + grow - O) / CELL); i++) {
      if (i < 0 || j < 0 || i >= N || j >= N) continue;
      const cx = O + (i + 0.5) * CELL, cz = O + (j + 0.5) * CELL;
      let inside = false;
      for (let a = 0, b = ring.length - 1; a < ring.length; b = a++) { const [xa, za] = ring[a], [xb, zb] = ring[b]; if ((za > cz) !== (zb > cz) && cx < (xb - xa) * (cz - za) / (zb - za) + xa) inside = !inside; }
      if (inside || (grow && distToRing(ring, cx, cz) < grow)) block[j * N + i] = 1;
    }
  }
}
function distToRing(r, x, z) { let d = Infinity; for (let a = 0, b = r.length - 1; a < r.length; b = a++) d = Math.min(d, segDist(r[b], r[a], x, z)); return d; }
function segDist([ax, az], [bx, bz], x, z) { const dx = bx - ax, dz = bz - az, L = dx * dx + dz * dz || 1e-9; const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / L)); return Math.hypot(ax + t * dx - x, az + t * dz - z); }

export function planRoute({ rawDir = RAW, terrainDir = join(root, 'public/terrain'), buildingsDir = join(root, 'public/buildings'), schedule = join(root, 'public/ferry/schedule.json'), draft = FERRY.draft } = {}) {
  const hAt = terrain(terrainDir);
  const sched = JSON.parse(readFileSync(schedule, 'utf8'));
  // departure gate: the San Francisco SSSF stop with more water within 40 m (Gate C); arrival: Sausalito
  const depth40 = t => { let s = 0; for (let dz = -40; dz <= 40; dz += 10) for (let dx = -40; dx <= 40; dx += 10) s += hAt(t.x + dx, t.z + dz); return s; };
  const from = [...sched.terminals.sanFrancisco].sort((a, b) => depth40(a) - depth40(b))[0], to = sched.terminals.sausalito[0];
  const dOpen = draft + 1.0 + MSL_TO_MLLW, dBerth = draft + 0.5;

  // obstacles: pier sheds and buildings over the water (shipped building roofs → footprints are the tiles'
  // roof polygons; rasterise roof triangles), OSM piers (areas and 6 m wide linear piers)
  const block = new Uint8Array(N * N);
  const bi = JSON.parse(readFileSync(join(buildingsDir, 'index.json'), 'utf8'));
  for (const f of bi.files) {
    const g = parseGLB(inflateSync(readFileSync(join(buildingsDir, f.name))).buffer.slice(0)), n = g.nodes[0], p = g.meshes[n.mesh][0];
    const P = p.attributes.POSITION.array, Nn = p.attributes.NORMAL.array, I = p.indices;
    const tris = [];
    for (let k = 0; k < I.length; k += 3) if (Nn[I[k] * 3 + 1] > 0.5) tris.push([0, 1, 2].map(q => [P[I[k + q] * 3] + n.t[0], P[I[k + q] * 3 + 2] + n.t[2]]));
    rasterPolys(block, tris.filter(t => t.some(([x, z]) => hAt(x, z) < 0.5)), 3);
  }
  const osm = JSON.parse(readCached('landmarks-osm.json', rawDir).toString('utf8')).elements;
  const L = (lat, lon) => { const [E, N2] = toUTM(lat, lon); return [E - 549504, 4186800 - N2]; };
  for (const e of osm) if (e.type === 'way' && e.tags?.man_made === 'pier' && e.geometry) {
    const pts = e.geometry.map(q => L(q.lat, q.lon));
    const closed = pts.length > 3 && pts[0][0] === pts.at(-1)[0] && pts[0][1] === pts.at(-1)[1];
    if (closed) rasterPolys(block, [pts], 3);
    else for (let a = 0; a + 1 < pts.length; a++) rasterPolys(block, [[pts[a], pts[a + 1], pts[a + 1], pts[a]]], 4);
  }

  const near = (x, z, t) => Math.hypot(x - t.x, z - t.z) < BERTH_ZONE;
  const ok = new Uint8Array(N * N);
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const x = O + (i + 0.5) * CELL, z = O + (j + 0.5) * CELL;
    const need = near(x, z, from) || near(x, z, to) ? dBerth : dOpen;
    // near a terminal the berth itself is alongside a pier: the float / slip is not an obstacle within 25 m
    const berth = Math.hypot(x - from.x, z - from.z) < 25 || Math.hypot(x - to.x, z - to.z) < 25;
    ok[j * N + i] = -hAt(x, z) >= need && (!block[j * N + i] || berth) ? 1 : 0;
  }
  // clearance: distance (cells) to the nearest non-navigable cell (chamfer), for the cost
  const D = new Float32Array(N * N).fill(1e9);
  for (let k = 0; k < N * N; k++) if (!ok[k]) D[k] = 0;
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) { const k = j * N + i; if (i) D[k] = Math.min(D[k], D[k - 1] + 1); if (j) { D[k] = Math.min(D[k], D[k - N] + 1); if (i) D[k] = Math.min(D[k], D[k - N - 1] + 1.414); if (i < N - 1) D[k] = Math.min(D[k], D[k - N + 1] + 1.414); } }
  for (let j = N - 1; j >= 0; j--) for (let i = N - 1; i >= 0; i--) { const k = j * N + i; if (i < N - 1) D[k] = Math.min(D[k], D[k + 1] + 1); if (j < N - 1) { D[k] = Math.min(D[k], D[k + N] + 1); if (i < N - 1) D[k] = Math.min(D[k], D[k + N + 1] + 1.414); if (i) D[k] = Math.min(D[k], D[k + N - 1] + 1.414); } }

  const cell = (x, z) => [Math.floor((x - O) / CELL), Math.floor((z - O) / CELL)];
  const [si, sj] = cell(from.x, from.z), [ti, tj] = cell(to.x, to.z);
  // A* (binary heap), 8-connected; step cost = length × (1 + 4 / (1 + clearance cells / 4))
  const g = new Float64Array(N * N).fill(Infinity), came = new Int32Array(N * N).fill(-1), closed = new Uint8Array(N * N);
  const heap = [], push = (k, f) => { heap.push([f, k]); let c = heap.length - 1; while (c) { const p = (c - 1) >> 1; if (heap[p][0] <= heap[c][0]) break; [heap[p], heap[c]] = [heap[c], heap[p]]; c = p; } };
  const pop = () => { const top = heap[0], last = heap.pop(); if (heap.length) { heap[0] = last; let c = 0; for (;;) { const l = 2 * c + 1, r = l + 1; let m = c; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m === c) break; [heap[m], heap[c]] = [heap[c], heap[m]]; c = m; } } return top; };
  const hEst = k => Math.hypot(k % N - ti, Math.floor(k / N) - tj) * CELL;
  const s = sj * N + si, t = tj * N + ti;
  g[s] = 0; push(s, hEst(s));
  const nb = [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, 1.4142], [1, -1, 1.4142], [-1, 1, 1.4142], [-1, -1, 1.4142]];
  while (heap.length) {
    const [, k] = pop();
    if (closed[k]) continue; closed[k] = 1;
    if (k === t) break;
    const i = k % N, j = Math.floor(k / N);
    for (const [di, dj, w] of nb) {
      const a = i + di, b = j + dj; if (a < 0 || b < 0 || a >= N || b >= N) continue;
      const q = b * N + a; if (!ok[q] || closed[q]) continue;
      const c = g[k] + w * CELL * (1 + 4 / (1 + D[q] / 4));
      if (c < g[q]) { g[q] = c; came[q] = k; push(q, c + hEst(q)); }
    }
  }
  if (came[t] < 0) throw new Error('route: no navigable path between the terminals');
  const cells = []; for (let k = t; k >= 0; k = came[k]) cells.push(k);
  cells.reverse();
  const pts = cells.map(k => [O + (k % N + 0.5) * CELL, O + (Math.floor(k / N) + 0.5) * CELL]);
  pts[0] = [from.x, from.z]; pts[pts.length - 1] = [to.x, to.z];
  // string pulling: keep a leg straight while every cell under it is navigable with ≥ 3 cells of clearance
  // (terminal zones exempt)
  const clearLeg = (a, b) => {
    const L2 = Math.hypot(b[0] - a[0], b[1] - a[1]), n = Math.ceil(L2 / 3);
    for (let s2 = 0; s2 <= n; s2++) {
      const x = a[0] + (b[0] - a[0]) * s2 / n, z = a[1] + (b[1] - a[1]) * s2 / n, [i, j] = cell(x, z), k = j * N + i;
      if (!ok[k]) return false;
      if (D[k] < 3 && !near(x, z, from) && !near(x, z, to)) return false;
    }
    return true;
  };
  const way = [pts[0]];
  let cur = 0;
  while (cur < pts.length - 1) {
    let nxt = cur + 1;
    for (let k = pts.length - 1; k > cur + 1; k--) if (clearLeg(pts[cur], pts[k])) { nxt = k; break; }
    way.push(pts[nxt]); cur = nxt;
  }
  let length = 0, minDepth = Infinity;
  for (let k = 1; k < way.length; k++) {
    const [a, b] = [way[k - 1], way[k]], L2 = Math.hypot(b[0] - a[0], b[1] - a[1]);
    length += L2;
    for (let s2 = 0; s2 <= Math.ceil(L2 / 3); s2++) { const x = a[0] + (b[0] - a[0]) * s2 / Math.ceil(L2 / 3), z = a[1] + (b[1] - a[1]) * s2 / Math.ceil(L2 / 3); minDepth = Math.min(minDepth, -hAt(x, z)); }
  }
  return {
    from: { stopId: from.stopId, name: from.name, x: from.x, z: from.z }, to: { stopId: to.stopId, name: to.name, x: to.x, z: to.z },
    rules: { draft, depthOpen: R2(dOpen), depthBerth: R2(dBerth), berthZone: BERTH_ZONE, cell: CELL, datum: 'MSL (NAVD88 + 0.969 m); open water also holds at MLLW' },
    waypoints: way.map(([x, z]) => [R2(x), R2(z)]), length: R2(length), minDepthAlong: R2(minDepth),
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const out = arg('--out', join(root, 'public/ferry/route.json'));
  mkdirSync(dirname(out), { recursive: true });
  const r = planRoute({ rawDir: arg('--raw', RAW) });
  writeFileSync(out, JSON.stringify(r, null, 1) + '\n');
  console.log(`route: ${r.from.name} → ${r.to.name}, ${r.waypoints.length} waypoints, ${(r.length / 1000).toFixed(2)} km, min depth ${r.minDepthAlong} m`);
}
