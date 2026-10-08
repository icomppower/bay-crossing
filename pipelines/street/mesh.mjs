// Surfaces → draped, tiled triangle mesh that never dips under the terrain.
// The terrain is the bilinear surface through the 3 m texel centres (the runtime HeightField; the CDLOD terrain
// draws it at 0.2 m near the camera). Streets drape on the pit-filled terrain (context.mjs fillPits: lidar pits such as
// station stairwells are bridged; water is what stays below +0.3 m after filling). Surfaces are clipped tile → 6 m row → 6 m cell (on the texel-centre grid;
// Clipper only where a surface's boundary crosses a cell, covered cells are two triangles) and draped with their
// vertices on the terrain plus their lift: roads +3 cm, paint 12 mm above the road, walkways a 15 cm curb above the
// road near roads and +6 cm away from them.
// A flat triangle can pass under a bump of the bilinear terrain between its vertices, so every triangle's deficit
// (the most the terrain rises above its plane: sampled at the texel centres inside it and along its edges) is
// measured; each 6 m cell keeps the largest deficit of its triangles (at most RAISE_CAP), and every vertex is raised
// by the largest of the cells it touches (so road and walkway rise together and the curb stays 15 cm). Each point of a triangle is a convex combination of its raised vertices, so the surface clears the
// terrain by at least its lift wherever the deficit is under the cap, and shared vertices keep it watertight.
// Triangles over water (terrain below +0.3 m) are dropped. Vertex: position (x, y, z), normal, data (material, u, v,
// seed). Tiles of TILE metres keep their own vertex and index ranges so the runtime draws only the near ones. Every
// triangle lies inside one CELL.
import { polygons, triangulate, inter, S, toPath } from './geom.mjs';
import { CURB } from './osm.mjs';

export const TILE = 100;
export const LIFT = { road: 0.03, paint: 0.042, walk: 0.03 + CURB, path: 0.06 };
export const CELL = 6, BLOCK = CELL;
const WATER = 0.3;
// the most a vertex is raised: past it (a street meeting a retaining wall or stairs the 3 m DEM draws as a slope) the
// terrain is left to show through the street locally (D61); such triangles are counted
export const RAISE_CAP = 0.15;

const F = new Float32Array(1);
export const f32 = v => { F[0] = v; return F[0]; };

export class MeshBuilder {
  constructor(height) {
    this.h = height;
    this.o = height.gridOrigin;
    this.tris = []; // { p: [3][x, z], lift: [3], data: [3][4] }
    this.raise = new Map(); // 6 m cell → largest deficit of the street triangles in it (capped)
    this.walls = [];
  }
  normal(x, z) {
    const e = this.h.texel, at = this.h.at;
    const hx = at(x + e, z) - at(x - e, z), hz = at(x, z + e) - at(x, z - e);
    const l = Math.hypot(hx, 2 * e, hz);
    return [-hx / l, 2 * e / l, -hz / l];
  }
  // the most the bilinear terrain rises above the plane through the triangle's terrain points
  deficit(tri) {
    const at = this.h.at, T = this.h.texel, o = this.o;
    const y = tri.map(([x, z]) => this.h.filled(x, z));
    const [[x0, z0], [x1, z1], [x2, z2]] = tri;
    const det = (z1 - z2) * (x0 - x2) + (x2 - x1) * (z0 - z2);
    if (Math.abs(det) < 1e-12) return 0;
    const plane = (x, z) => { const l0 = ((z1 - z2) * (x - x2) + (x2 - x1) * (z - z2)) / det, l1 = ((z2 - z0) * (x - x2) + (x0 - x2) * (z - z2)) / det; return { l0, l1, y: l0 * y[0] + l1 * y[1] + (1 - l0 - l1) * y[2] }; };
    let d = 0;
    // texel centres inside
    const xmin = Math.min(x0, x1, x2), xmax = Math.max(x0, x1, x2), zmin = Math.min(z0, z1, z2), zmax = Math.max(z0, z1, z2);
    for (let gz = Math.ceil((zmin - o) / T); o + gz * T <= zmax; gz++) for (let gx = Math.ceil((xmin - o) / T); o + gx * T <= xmax; gx++) {
      const px = o + gx * T, pz = o + gz * T, p = plane(px, pz);
      if (p.l0 < -1e-9 || p.l1 < -1e-9 || p.l0 + p.l1 > 1 + 1e-9) continue;
      d = Math.max(d, at(px, pz) - p.y);
    }
    // along the edges, every metre
    for (let k = 0; k < 3; k++) {
      const [ax, az] = tri[k], [bx, bz] = tri[(k + 1) % 3], n = Math.ceil(Math.hypot(bx - ax, bz - az));
      for (let s = 1; s < n; s++) { const px = ax + (bx - ax) * s / n, pz = az + (bz - az) * s / n; d = Math.max(d, at(px, pz) - plane(px, pz).y); }
    }
    return d;
  }
  // a triangle (x, z) with lift(x, z) and data(x, z) at its vertices
  addTri(tri, lift, data) {
    if (Math.min(...tri.map(([x, z]) => this.h.filled(x, z))) < WATER) return false;
    const s = (tri[1][0] - tri[0][0]) * (tri[2][1] - tri[0][1]) - (tri[1][1] - tri[0][1]) * (tri[2][0] - tri[0][0]);
    // counter-clockwise seen from above (+y): x east, z south → signed area in (x, z) must be negative
    const t = s < 0 ? tri : [tri[0], tri[2], tri[1]];
    const d0 = this.deficit(t), d = Math.min(RAISE_CAP, d0);
    if (d0 > RAISE_CAP) { this.capped = (this.capped || 0) + 1; this.cappedArea = (this.cappedArea || 0) + Math.abs(s) / 2; }
    const rec = { p: t.map(([x, z]) => [f32(x), f32(z)]), lift: t.map(([x, z]) => typeof lift === 'function' ? lift(x, z) : lift), data: t.map(([x, z]) => data(x, z)) };
    const cx = (t[0][0] + t[1][0] + t[2][0]) / 3, cz = (t[0][1] + t[1][1] + t[2][1]) / 3;
    const ck = Math.floor((cz - this.o) / CELL) * 100000 + Math.floor((cx - this.o) / CELL);
    if (d > (this.raise.get(ck) || 0)) this.raise.set(ck, d);
    this.tris.push(rec);
    return true;
  }
  emitTri(tri, lift, data, acc) {
    const a = Math.abs((tri[1][0] - tri[0][0]) * (tri[2][1] - tri[0][1]) - (tri[1][1] - tri[0][1]) * (tri[2][0] - tri[0][0])) / 2;
    if (a < 1e-9) return;
    if (this.addTri(tri, lift, data)) { acc.tris++; acc.mesh += a; } else { acc.dropped++; acc.water += a; }
  }
  // a vertical quad from (a, ya0..ya1) to (b, yb0..yb1) facing left of a→b (x east, z south), for curb faces and
  // skirts; heights are absolute (the caller reads them off the finished surface)
  wall(a, b, ya0, ya1, yb0, yb1, data) { this.walls.push({ a, b, ya0, ya1, yb0, yb1, data }); }
  addSurface(paths, lift, data, stats) {
    const acc = { tris: 0, dropped: 0, mesh: 0, water: 0 };
    const o = this.o;
    for (const [tile, tpaths] of bucket(paths)) {
      const [tx, tz] = tile;
      const x0 = tx * TILE, z0 = tz * TILE;
      const inTile = inter(tpaths, [rectPath(x0, z0, x0 + TILE, z0 + TILE)]);
      if (!inTile.length) continue;
      const r0 = Math.floor((z0 - o) / CELL), r1 = Math.ceil((z0 + TILE - o) / CELL);
      for (let r = r0; r < r1; r++) {
        const za = Math.max(z0, o + r * CELL), zb = Math.min(z0 + TILE, o + (r + 1) * CELL);
        if (zb - za < 1e-6) continue;
        const row = inter(inTile, [rectPath(x0, za, x0 + TILE, zb)]);
        if (!row.length) continue;
        // boundary edges of the row by cell column, and the row's coverage at mid-height (even-odd crossings)
        const zm = (za + zb) / 2, xs = [], edgeCols = new Set();
        let rx0 = Infinity, rx1 = -Infinity;
        for (const p of row) for (let i = 0; i < p.length; i++) {
          const ax = p[i].X / S, az = p[i].Y / S, bx = p[(i + 1) % p.length].X / S, bz = p[(i + 1) % p.length].Y / S;
          rx0 = Math.min(rx0, ax); rx1 = Math.max(rx1, ax);
          const flat = Math.abs(az - bz) < 1e-9 && (Math.abs(az - za) < 1e-6 || Math.abs(az - zb) < 1e-6);
          if (!flat) for (let c = Math.floor((Math.min(ax, bx) - o) / CELL); c <= Math.floor((Math.max(ax, bx) - o) / CELL); c++) edgeCols.add(c);
          if ((az > zm) !== (bz > zm)) xs.push(ax + (bx - ax) * (zm - az) / (bz - az));
        }
        xs.sort((a, b) => a - b);
        const covered = x => { let n = 0; for (const v of xs) if (v < x) n++; return n % 2 === 1; };
        const c0 = Math.floor((rx0 - o) / CELL), c1 = Math.floor((rx1 - o) / CELL);
        for (let c = c0; c <= c1; c++) {
          const xa = Math.max(x0, o + c * CELL), xb = Math.min(x0 + TILE, o + (c + 1) * CELL);
          if (xb - xa < 1e-6) continue;
          if (!edgeCols.has(c)) {
            if (!covered((xa + xb) / 2)) continue;
            this.emitTri([[xa, za], [xb, za], [xb, zb]], lift, data, acc);
            this.emitTri([[xa, za], [xb, zb], [xa, zb]], lift, data, acc);
            continue;
          }
          for (const poly of polygons(inter(row, [rectPath(xa, za, xb, zb)]))) for (const tri of safeTriangles(poly)) this.emitTri(tri, lift, data, acc);
        }
      }
    }
    if (stats) {
      stats.tris = (stats.tris || 0) + acc.tris; stats.overWater = (stats.overWater || 0) + acc.dropped;
      stats.meshArea = (stats.meshArea || 0) + acc.mesh; stats.waterArea = (stats.waterArea || 0) + acc.water;
    }
  }
  // the finished surface height among triangles that `keep( material, data )`: the triangle at (x, z), its plane evaluated
  // at `at` (default (x, z)); null if there is none
  surfaceAt(x, z, keep, at = null) {
    if (!this.cellIndex) {
      this.cellIndex = new Map();
      this.tris.forEach((r, i) => {
        const k = Math.floor(((r.p[0][1] + r.p[1][1] + r.p[2][1]) / 3 - this.o) / CELL) * 100000 + Math.floor(((r.p[0][0] + r.p[1][0] + r.p[2][0]) / 3 - this.o) / CELL);
        if (!this.cellIndex.has(k)) this.cellIndex.set(k, []);
        this.cellIndex.get(k).push(i);
      });
    }
    const list = this.cellIndex.get(Math.floor((z - this.o) / CELL) * 100000 + Math.floor((x - this.o) / CELL)) || [];
    for (const i of list) {
      const r = this.tris[i];
      if (!keep(r.data[0][0], r.data[0])) continue;
      const [[x0, z0], [x1, z1], [x2, z2]] = r.p;
      const det = (z1 - z2) * (x0 - x2) + (x2 - x1) * (z0 - z2);
      const l0 = ((z1 - z2) * (x - x2) + (x2 - x1) * (z - z2)) / det, l1 = ((z2 - z0) * (x - x2) + (x0 - x2) * (z - z2)) / det, l2 = 1 - l0 - l1;
      if (l0 < -1e-6 || l1 < -1e-6 || l2 < -1e-6) continue;
      const y = r.p.map(([px, pz], k) => this.vertexY(px, pz, r.lift[k]));
      const [ax, az] = at || [x, z];
      const m0 = ((z1 - z2) * (ax - x2) + (x2 - x1) * (az - z2)) / det, m1 = ((z2 - z0) * (ax - x2) + (x0 - x2) * (az - z2)) / det;
      return m0 * y[0] + m1 * y[1] + (1 - m0 - m1) * y[2];
    }
    return null;
  }
  // walkable (sidewalk / plaza, or a crossing / driveway band) at (x, z), conservatively: a 0.25 m bitset in 64 m
  // tiles, rasterised once from the walkable triangles (a cell is walkable when its centre is inside one), eroded
  walkableAt(x, z) {
    if (!this.walkBits) {
      const R = 0.25, TS = 256, bits = this.walkBits = new Map();
      for (const r of this.tris) {
        const [mat, , flag] = r.data[0];
        if (!(mat === 5 || mat === 6 || flag === 1)) continue;
        const [[x0, z0], [x1, z1], [x2, z2]] = r.p;
        const gx0 = Math.ceil(Math.min(x0, x1, x2) / R - 0.5), gx1 = Math.floor(Math.max(x0, x1, x2) / R - 0.5);
        const gz0 = Math.ceil(Math.min(z0, z1, z2) / R - 0.5), gz1 = Math.floor(Math.max(z0, z1, z2) / R - 0.5);
        const d = (ax, az, bx, bz, px, pz) => (bx - ax) * (pz - az) - (bz - az) * (px - ax);
        for (let gz = gz0; gz <= gz1; gz++) for (let gx = gx0; gx <= gx1; gx++) {
          const px = (gx + 0.5) * R, pz = (gz + 0.5) * R;
          const a = d(x0, z0, x1, z1, px, pz), b = d(x1, z1, x2, z2, px, pz), c = d(x2, z2, x0, z0, px, pz);
          if (!((a >= 0 && b >= 0 && c >= 0) || (a <= 0 && b <= 0 && c <= 0))) continue;
          const tx = Math.floor(gx / TS), tz = Math.floor(gz / TS), k = tz * 100000 + tx;
          let t = bits.get(k);
          if (!t) bits.set(k, t = new Uint8Array(TS * TS / 8));
          const i = (gz - tz * TS) * TS + (gx - tx * TS);
          t[i >> 3] |= 1 << (i & 7);
        }
      }
    }
    // eroded by one cell (the cell and its four neighbours): a walkable answer is at least a quarter metre inside
    const R = 0.25, TS = 256, gx = Math.floor(x / R), gz = Math.floor(z / R);
    const bit = (cx, cz) => { const tx = Math.floor(cx / TS), tz = Math.floor(cz / TS), t = this.walkBits.get(tz * 100000 + tx); if (!t) return false; const i = (cz - tz * TS) * TS + (cx - tx * TS); return (t[i >> 3] >> (i & 7) & 1) === 1; };
    return bit(gx, gz) && bit(gx + 1, gz) && bit(gx - 1, gz) && bit(gx, gz + 1) && bit(gx, gz - 1);
  }
  // the finished height of a surface vertex (terrain + raise + lift)
  vertexY(x, z, lift) { return f32(this.h.filled(x, z) + this.raiseAt(x, z) + lift); }
  // the raise at a vertex: the largest of the cells whose closure holds it (so road and walk in one cell rise together)
  raiseAt(x, z) {
    const fx = (x - this.o) / CELL, fz = (z - this.o) / CELL, c = Math.floor(fx), r = Math.floor(fz);
    const cs = [c], rs = [r];
    if (fx - c < 1e-6) cs.push(c - 1);
    if (fz - r < 1e-6) rs.push(r - 1);
    let m = 0;
    for (const cc of cs) for (const rr of rs) m = Math.max(m, this.raise.get(rr * 100000 + cc) || 0);
    return m;
  }
  // packed, sorted tiles: { tiles: [{ tx, tz, v0, vn, i0, in }], vertices: Float32Array (×10), indices: Uint32Array }
  pack() {
    const tiles = new Map();
    const tileOf = (x, z) => { const tx = Math.floor(x / TILE), tz = Math.floor(z / TILE), k = tz * 10000 + tx; let t = tiles.get(k); if (!t) tiles.set(k, t = { tx, tz, v: [], i: [], vmap: new Map() }); return t; };
    const vertex = (t, x, y, z, n, d) => {
      const key = `${x},${y},${z},${n[0]},${n[1]},${n[2]},${d[0]},${d[1]},${d[2]},${d[3]}`;
      let k = t.vmap.get(key);
      if (k === undefined) { k = t.v.length / 10; t.v.push(x, y, z, n[0], n[1], n[2], d[0], d[1], d[2], d[3]); t.vmap.set(key, k); }
      return k;
    };
    for (const r of this.tris) {
      const t = tileOf((r.p[0][0] + r.p[1][0] + r.p[2][0]) / 3, (r.p[0][1] + r.p[1][1] + r.p[2][1]) / 3);
      for (let k = 0; k < 3; k++) { const [x, z] = r.p[k]; t.i.push(vertex(t, x, this.vertexY(x, z, r.lift[k]), z, this.normal(x, z).map(f32), r.data[k])); }
    }
    for (const w of this.walls) {
      const { a, b } = w, t = tileOf((a[0] + b[0]) / 2, (a[1] + b[1]) / 2);
      let nx = b[1] - a[1], nz = -(b[0] - a[0]); const l = Math.hypot(nx, nz) || 1; nx /= l; nz /= l;
      const n = [f32(nx), 0, f32(nz)];
      const v = [[a, w.ya0], [b, w.yb0], [b, w.yb1], [a, w.ya1]].map(([p, y], k) => vertex(t, f32(p[0]), f32(y), f32(p[1]), n, w.data(k)));
      // (nx, nz) = left of a→b; wound counter-clockwise seen from that side
      t.i.push(v[0], v[2], v[1], v[0], v[3], v[2]);
    }
    const keys = [...tiles.values()].sort((a, b) => a.tz - b.tz || a.tx - b.tx);
    let nv = 0, ni = 0;
    for (const t of keys) { nv += t.v.length / 10; ni += t.i.length; }
    const vertices = new Float32Array(nv * 10), indices = new Uint32Array(ni), out = [];
    let v0 = 0, i0 = 0;
    for (const t of keys) {
      vertices.set(t.v, v0 * 10);
      for (let k = 0; k < t.i.length; k++) indices[i0 + k] = t.i[k] + v0;
      out.push({ tx: t.tx, tz: t.tz, v0, vn: t.v.length / 10, i0, in: t.i.length });
      v0 += t.v.length / 10; i0 += t.i.length;
    }
    return { tiles: out, vertices, indices };
  }
}

const rectPath = (x0, z0, x1, z1) => [[x0, z0], [x1, z0], [x1, z1], [x0, z1]].map(([x, z]) => ({ X: Math.round(x * S), Y: Math.round(z * S) }));

// paths → [[tx, tz], paths overlapping that TILE] in sorted order
function bucket(paths) {
  const m = new Map();
  for (const p of paths) {
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (const q of p) { x0 = Math.min(x0, q.X); x1 = Math.max(x1, q.X); z0 = Math.min(z0, q.Y); z1 = Math.max(z1, q.Y); }
    for (let tx = Math.floor(x0 / S / TILE); tx <= Math.floor(x1 / S / TILE); tx++) for (let tz = Math.floor(z0 / S / TILE); tz <= Math.floor(z1 / S / TILE); tz++) {
      const k = tz * 10000 + tx;
      if (!m.has(k)) m.set(k, { tile: [tx, tz], paths: [] });
      m.get(k).paths.push(p);
    }
  }
  return [...m.keys()].sort((a, b) => a - b).map(k => [m.get(k).tile, m.get(k).paths]);
}

// Triangles of a polygon [outer, ...holes]: earcut, checked by area; where earcut is wrong (it can be, on a hole in a
// small cell piece), horizontal slabs through every vertex height instead — each slab of the polygon is a set of
// convex trapezoids.
const ringArea2 = r => { let a = 0; for (let i = 0; i < r.length; i++) { const p = r[i], q = r[(i + 1) % r.length]; a += p[0] * q[1] - q[0] * p[1]; } return a / 2; };
export function safeTriangles(poly) {
  const want = Math.abs(ringArea2(poly[0])) - poly.slice(1).reduce((a, h) => a + Math.abs(ringArea2(h)), 0);
  const tris = triangulate(poly);
  const got = tris.reduce((a, t) => a + Math.abs(ringArea2(t)), 0);
  if (Math.abs(got - want) <= 1e-6 * Math.max(1, want)) return tris;
  const zs = [...new Set(poly.flat().map(p => p[1]))].sort((a, b) => a - b);
  let x0 = Infinity, x1 = -Infinity;
  for (const [x] of poly.flat()) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); }
  const paths = poly.map(r => toPath(r)), out = [];
  for (let k = 0; k + 1 < zs.length; k++) {
    if (zs[k + 1] - zs[k] < 1e-9) continue;
    for (const piece of polygons(inter(paths, [toPath([[x0 - 1, zs[k]], [x1 + 1, zs[k]], [x1 + 1, zs[k + 1]], [x0 - 1, zs[k + 1]]])]))) {
      const r = piece[0];
      for (let i = 1; i + 1 < r.length; i++) out.push([r[0], r[i], r[i + 1]]);
    }
  }
  return out;
}
