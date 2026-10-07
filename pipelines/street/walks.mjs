// Sidewalks, plazas and curbs (D47, D56): sidewalk strips along every road side that has one (OSM tags, else
// the class default), the gap to the building line closed where it is under 6 m (a morphological closing of
// sidewalks ∪ buildings by 3 m), footways and pedestrian areas added; all of it off roads, trackways and
// buildings. Curb faces (15 cm) where a walkway meets a road, skirts down to the ground elsewhere; curb paint
// red beside crosswalks, seeded yellow / green / white / blue runs elsewhere.
import { sidewalkSides } from './osm.mjs';
import { bufferLine, union, diff, inter, offset, toPath, polygons, Region, clean, perTile, area } from './geom.mjs';
import { MAT } from './roads.mjs';

export const CURB_PAINT = { grey: 7, red: 8, yellow: 9, green: 10, white: 11, blue: 12 };

const rand = (...k) => { let h = 2166136261; for (const v of k.join(',')) { h ^= v.charCodeAt(0); h = Math.imul(h, 16777619); } return ((h >>> 0) % 100000) / 100000; };

// one-sided strip from the centerline out to `d` on the left (+1) or right (-1) of travel
function sideStrip(pts, d, side) {
  const out = [];
  for (let i = 0; i + 1 < pts.length; i++) {
    const [ax, az] = pts[i], [bx, bz] = pts[i + 1], L = Math.hypot(bx - ax, bz - az);
    if (L === 0) continue;
    const nx = (bz - az) / L * side, nz = -(bx - ax) / L * side;
    out.push(toPath([[ax - nx * 0.1, az - nz * 0.1], [bx - nx * 0.1, bz - nz * 0.1], [bx + nx * d, bz + nz * d], [ax + nx * d, az + nz * d]]));
  }
  return out;
}

export function buildWalks(ctx, roads, { gapAt = null } = {}) {
  const T0 = Date.now(), lap = what => { if (process.env.STREET_TIMING) console.error(`  walks ${what}: ${((Date.now() - T0) / 1000).toFixed(1)} s`); };
  const { local } = ctx;
  const log = { sidewalkWays: 0, sidewalkDefaults: 0, oneSided: 0, footways: 0, pedestrianAreas: 0 };
  const strips = [];
  for (const w of roads.ways) {
    const sw = sidewalkSides(w.tags);
    if (!sw.left && !sw.right) continue;
    log.sidewalkWays++;
    if (sw.source === 'default') log.sidewalkDefaults++;
    const d = w.width / 2 + sw.width;
    if (sw.left && sw.right) strips.push(...bufferLine(w.pts, d));
    else { log.oneSided++; strips.push(...sideStrip(w.pts, d, sw.left ? 1 : -1)); }
  }
  const S0 = union(strips);
  lap('strips');

  // footways / paths / pedestrian streets at ground level (not the crossings over roads, not steps)
  const ground = t => !(t.tunnel && t.tunnel !== 'no') && !(t.bridge && t.bridge !== 'no') && !(+t.layer) && t.indoor !== 'yes' && !(t.level && +t.level !== 0);
  const foot = [], ped = [];
  for (const e of ctx.elements) {
    if (e.type !== 'way' || !e.geometry || e.geometry.length < 2 || !ground(e.tags || {})) continue;
    const t = e.tags, h = t.highway;
    if (!/^(footway|pedestrian|path)$/.test(h) || t.footway === 'crossing' || t.path === 'crossing') continue;
    const pts = e.geometry.map(g => local(g.lat, g.lon));
    const closed = pts.length >= 4 && pts[0][0] === pts[pts.length - 1][0] && pts[0][1] === pts[pts.length - 1][1];
    if (h === 'pedestrian' && closed && t.area === 'yes') { ped.push(toPath(pts)); log.pedestrianAreas++; continue; }
    const wTag = parseFloat(t.width);
    const half = (wTag >= 1 && wTag <= 20 ? wTag : h === 'pedestrian' ? 5 : 2) / 2;
    (h === 'pedestrian' ? ped : foot).push(...bufferLine(pts, half));
    log.footways++;
  }

  const B = ctx.buildingPaths;
  const boxes = union(ctx.boxes.map(b => toPath(b.ring)));
  const roadAll = union(roads.R, roads.T);
  // per 400 m tile: close gaps under 6 m between sidewalks and the building line, add footways, take away roads,
  // trackways, buildings and (for plain walks) pedestrian areas
  const TW = 400;
  const tiled = (fn) => perTile(TW, 15, { S0, B, foot, ped, roadAll, boxes }, fn);
  // (cleaned to 2 cm only: a coarser clean opens slivers between the walkway and the road edge)
  let walk5 = clean(tiled(t => {
    const closed = offset(offset(union(t.S0, t.B), 3, 'miter'), -3, 'miter');
    // footways count within 20 m of a road (promenades, plaza links); park paths further in stay ground colour (D48)
    const foot = inter(union(t.foot), offset(t.roadAll, 20, 'miter'));
    return diff(diff(inter(union(closed, foot), t.boxes), union(t.roadAll, t.B)), union(t.ped));
  }), 0.02);
  let walk6 = tiled(t => diff(inter(union(t.ped), t.boxes), union(t.roadAll, t.B)));
  // paved open space (D74): gaps under 40 m between walkways, roads and buildings (a 20 m closing) that the aerial
  // imagery shows paved, not planted — the Embarcadero promenade, plazas, forecourts — become plaza; lawns and parks
  // keep the ground colour (D48)
  if (ctx.naip) {
    const walkPre = union(walk5, walk6);
    const cand = perTile(TW, 45, { W: walkPre, roadAll, B, boxes }, t => {
      const solid = union(t.W, union(t.roadAll, t.B));
      return diff(inter(offset(offset(solid, 20, 'miter'), -20, 'miter'), t.boxes), solid);
    });
    const paved = [];
    for (const poly of polygons(cand, false)) {
      const area = Math.abs(ringArea(poly[0])) - poly.slice(1).reduce((a, h) => a + Math.abs(ringArea(h)), 0);
      if (area < 4) continue;
      let n = 0, hard = 0, wet = 0;
      let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
      for (const [x, z] of poly[0]) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); }
      const step = Math.max(1, Math.sqrt((x1 - x0) * (z1 - z0) / 400));
      for (let z = z0 + step / 2; z < z1; z += step) for (let x = x0 + step / 2; x < x1; x += step) {
        if (!inRings(poly, x, z)) continue;
        n++;
        if (ctx.height.filled(x, z) < 0.3) { wet++; continue; }
        const c = ctx.naip(x, z);
        if (c && !c.green) hard++;
      }
      if (n && wet === 0 && hard >= 0.75 * n) paved.push(...polyPaths(poly));
    }
    log.pavedFill = Math.round(area(union(paved)));
    walk6 = union(walk6, diff(union(paved), union(roadAll, B)));
  }
  // G10 negative fixture: a 6 m gap cut across the walk at a point
  if (gapAt) walk5 = diff(walk5, bufferLine([[gapAt[0] - 0.01, gapAt[1]], [gapAt[0] + 0.01, gapAt[1]]], 3, 'round'));
  const walkAll = union(walk5, walk6);
  lap('walk region');

  // nearest road direction for the sidewalk scoring pattern (data.y)
  const segGrid = new Map(), G = 25;
  for (const w of roads.ways) for (let i = 0; i + 1 < w.pts.length; i++) {
    const [ax, az] = w.pts[i], [bx, bz] = w.pts[i + 1];
    const k = Math.floor((ax + bx) / 2 / G) + ',' + Math.floor((az + bz) / 2 / G);
    if (!segGrid.has(k)) segGrid.set(k, []);
    segGrid.get(k).push([ax, az, bx, bz]);
  }
  const angleAt = (x, z) => {
    let best = Infinity, ang = 0;
    const gx = Math.floor(x / G), gz = Math.floor(z / G);
    for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) for (const [ax, az, bx, bz] of segGrid.get((gx + i) + ',' + (gz + j)) || []) {
      const dx = bx - ax, dz = bz - az, L = dx * dx + dz * dz;
      const t = L > 0 ? Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / L)) : 0;
      const d = Math.hypot(x - ax - t * dx, z - az - t * dz);
      if (d < best) { best = d; ang = Math.atan2(dz, dx); }
    }
    return Math.round(ang * 1000) / 1000;
  };

  // curb faces and skirts along every walkway boundary edge, cut into ≤ 6 m pieces
  const roadRegion = new Region(polygons(roadAll, false));
  const bldRegion = ctx.buildingRegion;
  const walkRegion = new Region(polygons(walkAll, false));
  const crossC = roads.crosswalks.map(c => c.centre);
  const edges = []; // { a, b, kind: 'curb' | 'skirt', mat }
  let ringId = 0;
  for (const poly of polygons(walkAll, false)) for (const ring of poly) {
    ringId++;
    let along = 0;
    for (let i = 0; i < ring.length; i++) {
      const p = ring[i], q = ring[(i + 1) % ring.length], L = Math.hypot(q[0] - p[0], q[1] - p[1]);
      if (L < 1e-3) continue;
      const n = Math.max(1, Math.ceil(L / 6));
      for (let k = 0; k < n; k++) {
        const a = [p[0] + (q[0] - p[0]) * k / n, p[1] + (q[1] - p[1]) * k / n], b = [p[0] + (q[0] - p[0]) * (k + 1) / n, p[1] + (q[1] - p[1]) * (k + 1) / n];
        const mx = (a[0] + b[0]) / 2, mz = (a[1] + b[1]) / 2, dx = (b[0] - a[0]) / (L / n), dz = (b[1] - a[1]) / (L / n);
        // left of a→b
        const lx = dz, lz = -dx;
        const inLeft = walkRegion.contains(mx + lx * 0.05, mz + lz * 0.05);
        const out = inLeft ? [-lx, -lz] : [lx, lz];
        const ox = mx + out[0] * 0.25, oz = mz + out[1] * 0.25;
        along += L / n;
        // tile seams (walk regions are built per 400 m tile) are not edges
        const seam = (u, v) => Math.abs(u - Math.round(u / TW) * TW) < 1e-3 && Math.abs(v - Math.round(v / TW) * TW) < 1e-3 && Math.abs(u - v) < 1e-3;
        if (seam(a[0], b[0]) || seam(a[1], b[1])) continue;
        if (bldRegion.contains(ox, oz)) continue;
        const kind = roadRegion.contains(ox, oz) ? 'curb' : 'skirt';
        let mat = CURB_PAINT.grey;
        if (kind === 'curb') {
          const nearX = crossC.some(([cx, cz]) => Math.abs(cx - mx) < 9 && Math.abs(cz - mz) < 9 && Math.hypot(cx - mx, cz - mz) < 9);
          if (nearX) mat = CURB_PAINT.red;
          else {
            const r = rand('curb', ringId, Math.floor(along / 18));
            mat = r < 0.07 ? CURB_PAINT.yellow : r < 0.11 ? CURB_PAINT.green : r < 0.14 ? CURB_PAINT.white : r < 0.155 ? CURB_PAINT.blue : r < 0.22 ? CURB_PAINT.red : CURB_PAINT.grey;
          }
        }
        // order the endpoints so the face looks outward (left of the pair)
        edges.push(inLeft ? { a: b, b: a, kind, mat } : { a, b, kind, mat });
      }
    }
  }
  lap('edges');
  log.curbEdges = edges.filter(e => e.kind === 'curb').length;
  log.skirtEdges = edges.length - log.curbEdges;
  log.curbPaint = {};
  for (const e of edges) if (e.kind === 'curb') log.curbPaint[e.mat] = (log.curbPaint[e.mat] || 0) + 1;

  return {
    surfaces: [
      { mat: MAT.walk, paths: walk5, level: 'walk' },
      { mat: MAT.plaza, paths: walk6, level: 'walk' },
    ],
    walkAll, edges, angleAt, roadRegion, S0, log,
  };
}

const ringArea = r => { let a = 0; for (let i = 0; i < r.length; i++) { const p = r[i], q = r[(i + 1) % r.length]; a += p[0] * q[1] - q[0] * p[1]; } return a / 2; };
const inRing = (r, x, z) => { let c = false; for (let i = 0, j = r.length - 1; i < r.length; j = i++) { const [xi, zi] = r[i], [xj, zj] = r[j]; if ((zi > z) !== (zj > z) && x < (xj - xi) * (z - zi) / (zj - zi) + xi) c = !c; } return c; };
const inRings = (poly, x, z) => inRing(poly[0], x, z) && !poly.slice(1).some(h => inRing(h, x, z));
const polyPaths = poly => poly.map(r => toPath(r));
