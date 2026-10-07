// 2D polygon toolkit for the street pipeline: Clipper (integer millimetres) for buffers, unions and
// differences; earcut for triangles; a grid split so meshes drape on the 3 m terrain grid. Everything is
// deterministic: integer clipping, sorted inputs, canonical edge intersections (shared edges split at
// bit-identical points, so neighbouring triangles stay watertight).
import ClipperLib from 'clipper-lib';
import earcut from 'earcut';

const C = ClipperLib;
export const S = 1000; // clipper units per metre (mm)
const ARC = 0.15 * S; // round joins / ends to 15 cm

export const toPath = pts => pts.map(([x, z]) => ({ X: Math.round(x * S), Y: Math.round(z * S) }));
export const fromPath = p => p.map(q => [q.X / S, q.Y / S]);

// Buffer an open polyline (metres) by `half` metres each side; round joins and ends.
export function bufferLine(pts, half, end = 'round') {
  const co = new C.ClipperOffset(2, ARC);
  co.AddPath(toPath(pts), C.JoinType.jtRound, end === 'round' ? C.EndType.etOpenRound : C.EndType.etOpenButt);
  const out = new C.Paths();
  co.Execute(out, half * S);
  return out;
}

// Offset closed paths (Clipper units) by `d` metres (negative shrinks).
export function offset(paths, d, join = 'round') {
  const co = new C.ClipperOffset(join === 'miter' ? 2.5 : 2, ARC);
  co.AddPaths(paths, join === 'miter' ? C.JoinType.jtMiter : C.JoinType.jtRound, C.EndType.etClosedPolygon);
  const out = new C.Paths();
  co.Execute(out, d * S);
  return out;
}

function exec(type, subj, clip) {
  const c = new C.Clipper();
  c.AddPaths(subj, C.PolyType.ptSubject, true);
  if (clip && clip.length) c.AddPaths(clip, C.PolyType.ptClip, true);
  const out = new C.Paths();
  c.Execute(type, out, C.PolyFillType.pftNonZero, C.PolyFillType.pftNonZero);
  return out;
}
export const union = (a, b = []) => exec(C.ClipType.ctUnion, a, b);
export const diff = (a, b) => b.length ? exec(C.ClipType.ctDifference, a, b) : union(a);
export const inter = (a, b) => exec(C.ClipType.ctIntersection, a, b);
// drop vertices closer than d metres to their neighbours' line (building footprints carry 1 cm jogs)
export const clean = (paths, d = 0.1) => C.Clipper.CleanPolygons(paths, d * S).filter(p => p.length >= 3);
export const area = paths => paths.reduce((s, p) => s + C.Clipper.Area(p), 0) / (S * S); // m², holes negative

// Polygons as [outer, ...holes] (metres) from clipper paths, via a PolyTree (outer contours own their holes).
export function polygons(paths) {
  const c = new C.Clipper();
  c.AddPaths(paths, C.PolyType.ptSubject, true);
  const tree = new C.PolyTree();
  c.Execute(C.ClipType.ctUnion, tree, C.PolyFillType.pftNonZero, C.PolyFillType.pftNonZero);
  const out = [];
  const walk = node => {
    for (const ch of node.Childs()) {
      if (ch.IsHole()) continue;
      out.push([fromPath(ch.Contour()), ...ch.Childs().map(h => fromPath(h.Contour()))]);
      for (const h of ch.Childs()) walk(h);
    }
  };
  walk(tree);
  return out;
}

// Triangles [[x,z]×3] of a polygon [outer, ...holes].
export function triangulate(poly) {
  const flat = [], holes = [];
  for (const ring of poly) {
    if (flat.length) holes.push(flat.length / 2);
    for (const [x, z] of ring) flat.push(x, z);
  }
  const idx = earcut(flat, holes);
  const tris = [];
  for (let i = 0; i < idx.length; i += 3) {
    const t = [idx[i], idx[i + 1], idx[i + 2]].map(k => [flat[2 * k], flat[2 * k + 1]]);
    if (Math.abs(cross(t)) > 1e-9) tris.push(t);
  }
  return tris;
}
const cross = ([a, b, c]) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);

// Split a convex polygon (here: a triangle) by axis lines at `origin + k * cell`. Each edge crossing is
// computed from the edge's endpoints in a canonical order, so two triangles sharing an edge put the split
// vertex at the same bits.
function cut(poly, axis, c) {
  const lo = [], hi = [];
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i], q = poly[(i + 1) % poly.length];
    const ps = p[axis] - c, qs = q[axis] - c;
    if (ps <= 0) lo.push(p);
    if (ps >= 0) hi.push(p);
    if ((ps < 0 && qs > 0) || (ps > 0 && qs < 0)) {
      const [a, b] = (p[0] < q[0] || (p[0] === q[0] && p[1] < q[1])) ? [p, q] : [q, p];
      const t = (c - a[axis]) / (b[axis] - a[axis]);
      const x = axis === 0 ? c : a[0] + (b[0] - a[0]) * t;
      const z = axis === 1 ? c : a[1] + (b[1] - a[1]) * t;
      lo.push([x, z]); hi.push([x, z]);
    }
  }
  return [lo, hi];
}
export function splitGrid(tri, cell, origin = 0) {
  let pieces = [tri];
  for (const axis of [0, 1]) {
    const next = [];
    for (const poly of pieces) {
      const vs = poly.map(p => p[axis]);
      const k0 = Math.ceil((Math.min(...vs) - origin) / cell), k1 = Math.floor((Math.max(...vs) - origin) / cell);
      let rest = poly;
      for (let k = k0; k <= k1; k++) {
        const [lo, hi] = cut(rest, axis, origin + k * cell);
        if (lo.length >= 3) next.push(lo);
        rest = hi;
        if (rest.length < 3) break;
      }
      if (rest.length >= 3) next.push(rest);
    }
    pieces = next;
  }
  // fan-triangulate the convex pieces, dropping slivers
  const out = [];
  for (const p of pieces) for (let i = 1; i + 1 < p.length; i++) {
    const t = [p[0], p[i], p[i + 1]];
    if (Math.abs(cross(t)) > 1e-6) out.push(t);
  }
  return out;
}

// Fast point-in-region test over polygons (metres). Containment: edges bucketed into thin z bands, even-odd
// crossing count of a ray towards whichever side of the band has fewer edges. Distance: a 2D bucket grid.
export class Region {
  constructor(polys, band = 4, cell = 16) {
    this.band = band; this.cell = cell;
    this.bands = new Map(); this.grid = new Map();
    this.edges = [];
    for (const poly of polys) for (const ring of poly) for (let i = 0; i < ring.length; i++) {
      const p = ring[i], q = ring[(i + 1) % ring.length];
      if (p[0] === q[0] && p[1] === q[1]) continue;
      const e = this.edges.length;
      this.edges.push([p[0], p[1], q[0], q[1]]);
      for (let z = Math.floor(Math.min(p[1], q[1]) / band); z <= Math.floor(Math.max(p[1], q[1]) / band); z++) {
        if (!this.bands.has(z)) this.bands.set(z, []);
        this.bands.get(z).push(e);
      }
      // 2D cells along the segment's bounding box (segments here are short; long ones cover a few rows)
      const x0 = Math.floor(Math.min(p[0], q[0]) / cell), x1 = Math.floor(Math.max(p[0], q[0]) / cell);
      const z0 = Math.floor(Math.min(p[1], q[1]) / cell), z1 = Math.floor(Math.max(p[1], q[1]) / cell);
      for (let zc = z0; zc <= z1; zc++) for (let xc = x0; xc <= x1; xc++) {
        const k = zc * 1e6 + xc;
        if (!this.grid.has(k)) this.grid.set(k, []);
        this.grid.get(k).push(e);
      }
    }
  }
  contains(x, z) {
    const list = this.bands.get(Math.floor(z / this.band));
    if (!list) return false;
    let inside = false;
    for (const e of list) {
      const [x1, z1, x2, z2] = this.edges[e];
      if ((z1 > z) !== (z2 > z) && x < (x2 - x1) * (z - z1) / (z2 - z1) + x1) inside = !inside;
    }
    return inside;
  }
  // distance from (x, z) to the nearest boundary edge within `r` metres (Infinity if none)
  distance(x, z, r) {
    let best = Infinity;
    const c = this.cell, seen = new Set();
    for (let zc = Math.floor((z - r) / c); zc <= Math.floor((z + r) / c); zc++) for (let xc = Math.floor((x - r) / c); xc <= Math.floor((x + r) / c); xc++) {
      const list = this.grid.get(zc * 1e6 + xc);
      if (!list) continue;
      for (const e of list) {
        if (seen.has(e)) continue;
        seen.add(e);
        const [x1, z1, x2, z2] = this.edges[e];
        const dx = x2 - x1, dz = z2 - z1, L = dx * dx + dz * dz;
        const t = L > 0 ? Math.max(0, Math.min(1, ((x - x1) * dx + (z - z1) * dz) / L)) : 0;
        best = Math.min(best, Math.hypot(x - x1 - t * dx, z - z1 - t * dz));
      }
    }
    return best <= r ? best : Infinity;
  }
}

// Run fn( sets ) tile by tile (size m, inputs taken `margin` m beyond the tile) and clip each result to its
// tile: big boolean jobs stay local and fast. sets: { name: paths }. Tiles in sorted order (deterministic).
export function perTile(size, margin, sets, fn) {
  const tiles = new Map();
  const bb = p => { let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity; for (const q of p) { x0 = Math.min(x0, q.X); x1 = Math.max(x1, q.X); z0 = Math.min(z0, q.Y); z1 = Math.max(z1, q.Y); } return [x0 / S, z0 / S, x1 / S, z1 / S]; };
  for (const [name, paths] of Object.entries(sets)) for (const p of paths) {
    const [x0, z0, x1, z1] = bb(p);
    for (let tx = Math.floor((x0 - margin) / size); tx <= Math.floor((x1 + margin) / size); tx++) for (let tz = Math.floor((z0 - margin) / size); tz <= Math.floor((z1 + margin) / size); tz++) {
      const k = tz * 10000 + tx;
      if (!tiles.has(k)) tiles.set(k, { tx, tz, sets: Object.fromEntries(Object.keys(sets).map(n => [n, []])) });
      tiles.get(k).sets[name].push(p);
    }
  }
  const out = [];
  for (const k of [...tiles.keys()].sort((a, b) => a - b)) {
    const t = tiles.get(k), x0 = t.tx * size, z0 = t.tz * size;
    const res = fn(t.sets, [x0 - margin, z0 - margin, x0 + size + margin, z0 + size + margin]);
    if (!res.length) continue;
    out.push(...inter(res, [toPath([[x0, z0], [x0 + size, z0], [x0 + size, z0 + size], [x0, z0 + size]])]));
  }
  return out;
}
