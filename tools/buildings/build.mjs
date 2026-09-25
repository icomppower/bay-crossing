// G2b pipeline: cached building footprints + heights → extruded building tiles (GLB) in the bay frame.
//   node tools/buildings/build.mjs [--raw <dir>] [--out <dir>]
// SF (DataSF, PDDL): roof = LiDAR median first-return elevation (median_1st_m, NAVD88) → local MSL.
// Sausalito (OSM, ODbL): OSM `height`, else `building:levels` × 3 m, else a logged 6 m default.
// Base: lowest terrain under the footprint − 1 m, never deeper than 2 m below MSL (pier sheds stand on the
// water line; the DEM has no piers, D22). Tiles: the 600 m terrain tile grid, by footprint centroid.
// Vertex data per tile: POSITION (tile-local), NORMAL, TEXCOORD_0 (walls: metres along the wall, metres
// above the base; roofs: world x, z), COLOR_0 (rgb: wall colour on walls, roof colour on roofs; a = class:
// 0 house, 128 mid-rise, 255 tower). Roofs take their colour from NAIP aerial imagery where it can be trusted.
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import earcut from 'earcut';
import { readCached, RAW } from '../data/cache.mjs';
import { readTiff } from '../geo/tiff.mjs';
import { toUTM } from '../geo/utm.mjs';
import { writeGLB } from '../geo/glb.mjs';
import { mergeHeights, GRID } from '../terrain/build.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const MM = v => Math.round(v * 1000) / 1000;
export const DEFAULT_HEIGHT = 6, LEVEL_HEIGHT = 3, MAX_SINK = -2;
export const LOD_DISTANCES = [900, 2500]; // m from the tile: LOD0 nearer than 900 m, LOD1 to 2.5 km, LOD2 beyond

// Wall palettes by building type (sRGB bytes). Towers: glass and stone curtain walls; mid-rise: concrete,
// sandstone, brick (Jackson Square and the Embarcadero warehouses); houses: San Francisco's painted Victorians;
// Sausalito: wood shingle and white clapboard; pier sheds: the cream Beaux-Arts bulkheads. D38.
const WALLS = {
  tower: [[118, 138, 152], [104, 126, 124], [150, 156, 162], [92, 104, 120], [186, 182, 172], [132, 146, 160], [170, 168, 160]],
  mid: [[182, 178, 170], [160, 157, 150], [206, 192, 162], [190, 170, 140], [150, 82, 62], [136, 72, 56], [166, 98, 72], [224, 220, 210], [198, 196, 188], [176, 150, 120]],
  house: [[214, 226, 205], [238, 222, 160], [230, 192, 190], [182, 206, 226], [240, 236, 226], [202, 192, 222], [226, 206, 172], [168, 180, 168], [236, 214, 196], [196, 216, 214]],
  sausalito: [[142, 112, 82], [122, 96, 72], [236, 232, 224], [202, 212, 208], [230, 220, 182], [168, 140, 106], [214, 206, 192]],
  pier: [[222, 212, 186], [210, 200, 178], [198, 194, 184]],
};
// Roof palettes where no aerial colour is used (tall buildings lean in the imagery, tiny footprints, no pixels)
const ROOFS = {
  city: [[92, 92, 92], [118, 116, 110], [138, 136, 128], [104, 100, 96], [156, 152, 144]],
  sausalito: [[164, 92, 62], [150, 84, 58], [92, 82, 72], [118, 118, 116], [132, 104, 80]],
};
export const NAIP_MAX_HEIGHT = 40; // m: above this, relief displacement moves the roof off its footprint in NAIP
const pick = (list, id, salt) => list[hash(id + salt) % list.length];
// ±8 % brightness per building so neighbours with the same swatch still differ
const jitter = (c, id) => { const k = 0.92 + (hash(id + 'j') % 1000) / 1000 * 0.16; return c.map(v => Math.max(0, Math.min(255, Math.round(v * k)))); };
const hash = s => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; };

function local(lat, lon) { const [E, N] = toUTM(lat, lon); return [MM(E - GRID.originE), MM(GRID.originN - N)]; }

function heightSampler(merged) {
  const { res, size } = GRID, texel = size / res, o = -size / 2;
  return (x, z) => {
    const fx = (x - o) / texel - 0.5, fz = (z - o) / texel - 0.5;
    const i = Math.max(0, Math.min(res - 2, Math.floor(fx))), j = Math.max(0, Math.min(res - 2, Math.floor(fz)));
    const tx = Math.max(0, Math.min(1, fx - i)), tz = Math.max(0, Math.min(1, fz - j)), H = merged.heights, k = j * res + i;
    return ((H[k] * (1 - tx) + H[k + 1] * tx) * (1 - tz) + (H[k + res] * (1 - tx) + H[k + res + 1] * tx) * tz) / 100;
  };
}

function cleanRing(pts) {
  const out = [];
  for (const p of pts) { const q = out[out.length - 1]; if (!q || q[0] !== p[0] || q[1] !== p[1]) out.push(p); }
  if (out.length > 1 && out[0][0] === out[out.length - 1][0] && out[0][1] === out[out.length - 1][1]) out.pop();
  return out.length >= 3 ? out : null;
}
const inside = (r, x, z) => { let c = false; for (let i = 0, j = r.length - 1; i < r.length; j = i++) { const [xi, zi] = r[i], [xj, zj] = r[j]; if ((zi > z) !== (zj > z) && x < (xj - xi) * (z - zi) / (zj - zi) + xi) c = !c; } return c; };
const area2 = r => { let a = 0; for (let i = 0; i < r.length; i++) { const p = r[i], q = r[(i + 1) % r.length]; a += p[0] * q[1] - q[0] * p[1]; } return a; };

// Roof colour from NAIP: the per-channel median of the pixels inside the footprint (shadow pixels, luma < 40,
// left out), or null when there are too few usable pixels.
// Haze correction (dark-object subtraction): each channel's 1st percentile over the image is atmospheric path
// radiance, not surface; subtract it, stretch the 99th percentile to 235, then restore saturation ×1.5 about the
// luma (the haze greys roofs out). D38.
function dehaze(tif) {
  const lo = [], hi = [];
  for (const band of tif.bands) {
    const hist = new Uint32Array(256);
    for (let k = 0; k < band.length; k += 7) hist[band[k] | 0]++;
    const total = hist.reduce((a, b) => a + b, 0);
    let acc = 0, p1 = 0, p99 = 255;
    for (let v = 0; v < 256; v++) { acc += hist[v]; if (acc < total * 0.01) p1 = v; if (acc < total * 0.99) p99 = v; }
    lo.push(p1); hi.push(Math.max(p99, p1 + 1));
  }
  return ([r, g, b]) => {
    const c = [r, g, b].map((v, i) => Math.max(0, (v - lo[i]) / (hi[i] - lo[i]) * 235));
    const l = 0.3 * c[0] + 0.59 * c[1] + 0.11 * c[2];
    return c.map(v => Math.max(0, Math.min(255, Math.round(l + (v - l) * 1.5))));
  };
}

function naipSampler(tif) {
  const [, , , e0, n0] = tif.tags[33922], W = tif.width, H = tif.height, [R, Gc, B] = tif.bands;
  const fix = dehaze(tif);
  return (rings) => {
    const outer = rings[0].map(([x, z]) => [x + GRID.originE - e0, n0 - (GRID.originN - z)]); // pixel coords (col, row)
    let c0 = Infinity, c1 = -Infinity, r0 = Infinity, r1 = -Infinity;
    for (const [c, r] of outer) { c0 = Math.min(c0, c); c1 = Math.max(c1, c); r0 = Math.min(r0, r); r1 = Math.max(r1, r); }
    if (c1 < 0 || r1 < 0 || c0 >= W || r0 >= H) return null;
    const rs = [], gs = [], bs = [];
    const holes = rings.slice(1).map(h => h.map(([x, z]) => [x + GRID.originE - e0, n0 - (GRID.originN - z)]));
    for (let r = Math.max(0, Math.floor(r0)); r <= Math.min(H - 1, Math.ceil(r1)); r++) for (let c = Math.max(0, Math.floor(c0)); c <= Math.min(W - 1, Math.ceil(c1)); c++) {
      const px = c + 0.5, py = r + 0.5;
      if (!inside(outer, px, py) || holes.some(h => inside(h, px, py))) continue;
      const k = r * W + c, luma = 0.3 * R[k] + 0.59 * Gc[k] + 0.11 * B[k];
      if (luma < 40) continue;
      rs.push(R[k]); gs.push(Gc[k]); bs.push(B[k]);
    }
    if (rs.length < 12) return null;
    const med = a => { a.sort((p, q) => p - q); return a[a.length >> 1]; };
    return fix([med(rs), med(gs), med(bs)]);
  };
}

// Collect every building as { id, polys: [[outer, ...holes]], top, base, cls, tint, src }
export function collectBuildings({ rawDir = RAW, merged } = {}) {
  merged = merged || mergeHeights({ rawDir });
  const hAt = heightSampler(merged), msl = merged.msl;
  const log = { sfLidar: 0, sfFallback: 0, osmHeight: 0, osmLevels: 0, osmDefault: 0, skipped: 0 };
  const roofLog = { naip: 0, paletteTall: 0, paletteNoPixels: 0 };
  const naip = { sf: naipSampler(readTiff(readCached('naip-sf.tif', rawDir))), osm: naipSampler(readTiff(readCached('naip-sausalito.tif', rawDir))) };
  // footprints replaced by a landmark model (data/landmarks.json, D4 / G2c)
  const anchors = JSON.parse(readFileSync(join(root, 'data/landmarks.json'), 'utf8')).landmarks
    .filter(l => l.replacesFootprint).map(l => ({ name: l.name, p: local(l.lat, l.lon) }));
  const excluded = [];
  const out = [];
  const finish = (id, polys, roofAbove, roofAbs, src) => {
    let gMin = Infinity, gMax = -Infinity;
    for (const poly of polys) for (const [x, z] of poly[0]) { const g = hAt(x, z); gMin = Math.min(gMin, g); gMax = Math.max(gMax, g); }
    const base = MM(Math.max(gMin - 1, MAX_SINK));
    let top = roofAbs !== null ? roofAbs : Math.max(gMax, 0) + roofAbove;
    if (!(top > Math.max(gMax, 0) + 2)) top = Math.max(gMax, 0) + Math.max(roofAbove || 0, 3);
    top = MM(top);
    const h = top - Math.max(gMax, 0);
    const cls = h > 60 ? 255 : h > 15 ? 128 : 0;
    const overWater = base <= MAX_SINK;
    const walls = src === 'osm' ? WALLS.sausalito : overWater ? WALLS.pier : cls === 255 ? WALLS.tower : cls === 128 ? WALLS.mid : WALLS.house;
    const wall = jitter(pick(walls, id, 'w'), id);
    let roof = h <= NAIP_MAX_HEIGHT ? naip[src](polys[0]) : null;
    if (roof) roofLog.naip++; else { roofLog[h > NAIP_MAX_HEIGHT ? 'paletteTall' : 'paletteNoPixels']++; roof = jitter(pick(src === 'osm' ? ROOFS.sausalito : ROOFS.city, id, 'r'), id); }
    out.push({ id, polys, top, base, cls, wall, roof, src, h, area: Math.abs(polys.reduce((a, poly) => a + area2(poly[0]), 0)) / 2 });
  };

  const sf = JSON.parse(readCached('sf-buildings.geojson', rawDir).toString('utf8'));
  for (const f of sf.features) {
    const p = f.properties, geom = f.geometry;
    const polys = (geom.type === 'MultiPolygon' ? geom.coordinates : [geom.coordinates])
      .map(poly => poly.map(ring => cleanRing(ring.map(([lon, lat]) => local(lat, lon)))).filter(Boolean))
      .filter(poly => poly.length && Math.abs(area2(poly[0])) > 1);
    if (!polys.length) { log.skipped++; continue; }
    const lm = anchors.find(a => polys.some(poly => inside(poly[0], a.p[0], a.p[1])));
    if (lm) { excluded.push({ landmark: lm.name, id: 'sf' + p.sf16_bldgid }); continue; }
    const roofAbs = parseFloat(p.median_1st_m), above = parseFloat(p.hgt_median_m);
    if (Number.isFinite(roofAbs) && Number.isFinite(above) && above > 1) { log.sfLidar++; finish('sf' + p.sf16_bldgid, polys, above, roofAbs - msl, 'sf'); }
    else { log.sfFallback++; finish('sf' + p.sf16_bldgid, polys, Number.isFinite(above) && above > 0 ? above : DEFAULT_HEIGHT, null, 'sf'); }
  }

  const osm = JSON.parse(readCached('sausalito-osm.json', rawDir).toString('utf8'));
  const ways = osm.elements.filter(e => e.type === 'way' && e.tags?.building && e.geometry?.length >= 4).sort((a, b) => a.id - b.id);
  for (const w of ways) {
    const ring = cleanRing(w.geometry.map(g => local(g.lat, g.lon)));
    if (!ring || Math.abs(area2(ring)) < 2) { log.skipped++; continue; }
    const hTag = parseFloat(String(w.tags.height || '').replace(/[^\d.]/g, '')), lv = parseFloat(w.tags['building:levels']);
    let above;
    if (Number.isFinite(hTag) && hTag > 0) { above = hTag; log.osmHeight++; }
    else if (Number.isFinite(lv) && lv > 0) { above = lv * LEVEL_HEIGHT; log.osmLevels++; }
    else { above = DEFAULT_HEIGHT; log.osmDefault++; }
    finish('osm' + w.id, [[ring]], above, null, 'osm');
  }
  return { buildings: out, log, excluded, roofLog };
}

// Walls + roof of one building, appended to a tile's arrays (positions relative to the tile centre).
function extrude(b, cx, cz, G) {
  for (const poly of b.polys) {
    poly.forEach((ring, ri) => {
      const s = (area2(ring) > 0 ? 1 : -1) * (ri > 0 ? -1 : 1);
      let run = 0;
      for (let i = 0; i < ring.length; i++) {
        const [ax, az] = ring[i], [bx, bz] = ring[(i + 1) % ring.length];
        const dx = bx - ax, dz = bz - az, len = Math.hypot(dx, dz);
        if (len < 1e-3) continue;
        const nx = s * dz / len, nz = -s * dx / len;
        const v0 = G.pos.length / 3;
        const quad = [[ax, b.base, az, run, 0], [bx, b.base, bz, run + len, 0], [bx, b.top, bz, run + len, b.top - b.base], [ax, b.top, az, run, b.top - b.base]];
        for (const [x, y, z, u, v] of quad) { G.pos.push(MM(x - cx), y, MM(z - cz)); G.nrm.push(nx, 0, nz); G.uv.push(MM(u), MM(v)); G.col.push(...b.wall, b.cls); }
        // winding: the triangle normal must match the outward wall normal
        // triangle (v0, v0+2, v0+1) has normal ∝ (dz, 0, −dx) · height
        const flip = (dz * nx - dx * nz) < 0;
        if (!flip) G.idx.push(v0, v0 + 2, v0 + 1, v0, v0 + 3, v0 + 2); else G.idx.push(v0, v0 + 1, v0 + 2, v0, v0 + 2, v0 + 3);
        run += len;
      }
    });
    // roof
    const flat = [], holes = [];
    poly.forEach((ring, ri) => { if (ri) holes.push(flat.length / 2); for (const [x, z] of ring) flat.push(x, z); });
    const tris = earcut(flat, holes, 2);
    const v0 = G.pos.length / 3;
    for (let k = 0; k < flat.length; k += 2) { G.pos.push(MM(flat[k] - cx), b.top, MM(flat[k + 1] - cz)); G.nrm.push(0, 1, 0); G.uv.push(flat[k], flat[k + 1]); G.col.push(...b.roof, b.cls); }
    for (let t = 0; t < tris.length; t += 3) {
      const [a, c, d] = [tris[t], tris[t + 1], tris[t + 2]];
      // up-facing: (p1 − p0) × (p2 − p0) must have +y
      const y = (flat[d * 2] - flat[a * 2]) * (flat[c * 2 + 1] - flat[a * 2 + 1]) - (flat[c * 2] - flat[a * 2]) * (flat[d * 2 + 1] - flat[a * 2 + 1]);
      if (Math.abs(y) < 2e-3) continue; // degenerate sliver (< 1 mm²·10³): rounding could flip it
      if (y >= 0) G.idx.push(v0 + a, v0 + c, v0 + d); else G.idx.push(v0 + a, v0 + d, v0 + c);
    }
  }
}

// Level-of-detail variants of a building (null = dropped at that level). LOD1: rings simplified to 1.5 m,
// small low buildings dropped; LOD2: outer rings simplified to 4 m, only tall or large buildings kept.
export const LODS = [
  { tol: 0, keep: () => true },
  { tol: 1.5, keep: b => b.h >= 8 || b.area >= 150, holes: true },
  { tol: 4, keep: b => b.h >= 20 || b.area >= 1500, holes: false },
];
function simplifyRing(r, tol) {
  if (!tol || r.length <= 4) return r;
  // Douglas–Peucker on the closed ring, split at the vertex farthest from vertex 0
  let far = 0, fd = -1;
  for (let i = 1; i < r.length; i++) { const d = Math.hypot(r[i][0] - r[0][0], r[i][1] - r[0][1]); if (d > fd) { fd = d; far = i; } }
  const dp = pts => {
    if (pts.length <= 2) return pts;
    const [a, b] = [pts[0], pts[pts.length - 1]], L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1e-9;
    let idx = 0, md = -1;
    for (let i = 1; i < pts.length - 1; i++) { const d = Math.abs((b[0] - a[0]) * (a[1] - pts[i][1]) - (a[0] - pts[i][0]) * (b[1] - a[1])) / L; if (d > md) { md = d; idx = i; } }
    return md > tol ? [...dp(pts.slice(0, idx + 1)).slice(0, -1), ...dp(pts.slice(idx))] : [a, b];
  };
  const out = [...dp(r.slice(0, far + 1)).slice(0, -1), ...dp([...r.slice(far), r[0]]).slice(0, -1)];
  return out.length >= 3 && Math.abs(area2(out)) > 1 ? out : r;
}
export function lodBuilding(b, lod) {
  const L = LODS[lod];
  if (!L.keep(b)) return null;
  if (!L.tol) return b;
  return { ...b, polys: b.polys.map(poly => (L.holes ? poly : poly.slice(0, 1)).map(r => simplifyRing(r, L.tol))) };
}

export function buildTiles(buildings, lod = 0) {
  const { size, tile, res } = GRID, span = tile * size / res, n = res / tile, o = -size / 2;
  const tiles = new Map();
  for (const b of buildings) {
    let sx = 0, sz = 0, c = 0;
    for (const [x, z] of b.polys[0][0]) { sx += x; sz += z; c++; }
    const i = Math.max(0, Math.min(n - 1, Math.floor((sx / c - o) / span))), j = Math.max(0, Math.min(n - 1, Math.floor((sz / c - o) / span)));
    const key = `${i}_${j}`;
    if (!tiles.has(key)) tiles.set(key, { i, j, list: [] });
    tiles.get(key).list.push(b);
  }
  return [...tiles.values()].sort((a, b) => a.j - b.j || a.i - b.i).map(t => {
    const cx = o + (t.i + 0.5) * span, cz = o + (t.j + 0.5) * span;
    const G = { pos: [], nrm: [], uv: [], col: [], idx: [] };
    t.list.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    for (const b0 of t.list) { const b = lodBuilding(b0, lod); if (b) extrude(b, cx, cz, G); }
    return { ...t, cx, cz, G };
  });
}

export function writeBuildingTiles(lodTiles, log, outDir, excluded = [], roofLog = null) {
  const tiles = lodTiles[0];
  mkdirSync(outDir, { recursive: true });
  for (const f of readdirSync(outDir)) if (/^b_\d+_\d+(_l\d)?\.glb(\.deflate)?$/.test(f) || f === 'index.json') rmSync(join(outDir, f));
  const write = (t, lod) => {
    const name = `b_${t.i}_${t.j}${lod ? '_l' + lod : ''}.glb.deflate`;
    const glb = deflateSync(writeGLB({ meshes: [{
      name: `buildings_${t.i}_${t.j}_lod${lod}`, translation: [t.cx, 0, t.cz],
      position: new Float32Array(t.G.pos), normal: new Float32Array(t.G.nrm), uv: new Float32Array(t.G.uv),
      color: new Uint8Array(t.G.col), index: new Uint32Array(t.G.idx),
    }] }), { level: 9, memLevel: 9 });
    writeFileSync(join(outDir, name), glb);
    return { name, triangles: t.G.idx.length / 3, sha256: createHash('sha256').update(glb).digest('hex') };
  };
  const files = [];
  tiles.forEach((t, k) => {
    const l0 = write(t, 0);
    files.push({ ...l0, i: t.i, j: t.j, buildings: t.list.length, lods: [1, 2].map(lod => write(lodTiles[lod][k], lod)) });
  });
  const index = {
    format: 'bay-buildings/2', lodDistances: LOD_DISTANCES, tileSpan: GRID.tile * GRID.size / GRID.res, frame: 'BayFrame (x east, z south); node translation = tile centre',
    heights: { log, defaultHeight: DEFAULT_HEIGHT, levelHeight: LEVEL_HEIGHT, maxSink: MAX_SINK },
    landmarkExclusions: excluded,
    colours: { walls: 'typed palettes (D38)', roofs: roofLog, naipMaxHeight: NAIP_MAX_HEIGHT },
    totals: { buildings: files.reduce((s, f) => s + f.buildings, 0), triangles: files.reduce((s, f) => s + f.triangles, 0) },
    files,
  };
  writeFileSync(join(outDir, 'index.json'), JSON.stringify(index, null, 1) + '\n');
  return index;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const t0 = performance.now();
  const { buildings, log, excluded, roofLog } = collectBuildings({ rawDir: arg('--raw', RAW) });
  const index = writeBuildingTiles([0, 1, 2].map(lod => buildTiles(buildings, lod)), log, arg('--out', join(root, 'public/buildings')), excluded, roofLog);
  console.log(`roofs: ${JSON.stringify(roofLog)}`);
  console.log(`landmark exclusions ${JSON.stringify(excluded)}`);
  const lt = [1, 2].map(l => index.files.reduce((s, f) => s + f.lods[l - 1].triangles, 0));
  console.log(`LOD triangles: ${index.totals.triangles} / ${lt[0]} / ${lt[1]}`);
  console.log(`buildings: ${index.totals.buildings} in ${index.files.length} tiles, ${index.totals.triangles} triangles, heights ${JSON.stringify(log)}, ${((performance.now() - t0) / 1000).toFixed(1)} s`);
}
