// Inputs of the street pipeline, read from the cache only: the slice boxes in the title frame, every building
// footprint (run-1 buildings plus the footprints a landmark model replaces), the merged terrain heights and the
// cached OSM / DataSF street files.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { readCached, RAW } from 'harbor-engine/tools/data/cache.mjs';
import { mergeHeights, GRID } from 'harbor-engine/tools/terrain/build.mjs';
import { buildingKit } from 'harbor-engine/tools/buildings/build.mjs';
import { toUTM } from 'harbor-engine/tools/geo/utm.mjs';
import { TITLE } from 'harbor-engine/tools/lib/title.mjs';

const MM = v => Math.round(v * 1000) / 1000;
export const local = (lat, lon) => { const [E, N] = toUTM(lat, lon); return [MM(E - GRID.originE), MM(GRID.originN - N)]; };

// Depression filling (priority flood from the domain edge): every closed pit in the DEM (station stairwells, sunken
// light wells the lidar sees) is filled to its spill height; open water stays as it is. Int16 cm in, Int16 cm out.
export function fillPits(heights, res) {
  const out = new Int16Array(heights), done = new Uint8Array(res * res);
  // binary heap of (height, cell) as two parallel typed arrays
  let n = 0;
  const hv = new Int32Array(res * res), hc = new Int32Array(res * res);
  const push = (h, c) => { let i = n++; hv[i] = h; hc[i] = c; while (i > 0) { const p = (i - 1) >> 1; if (hv[p] < hv[i] || (hv[p] === hv[i] && hc[p] <= hc[i])) break; [hv[p], hv[i]] = [hv[i], hv[p]]; [hc[p], hc[i]] = [hc[i], hc[p]]; i = p; } };
  const pop = () => { const h = hv[0], c = hc[0]; n--; hv[0] = hv[n]; hc[0] = hc[n]; let i = 0; for (;;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < n && (hv[l] < hv[m] || (hv[l] === hv[m] && hc[l] < hc[m]))) m = l; if (r < n && (hv[r] < hv[m] || (hv[r] === hv[m] && hc[r] < hc[m]))) m = r; if (m === i) break; [hv[m], hv[i]] = [hv[i], hv[m]]; [hc[m], hc[i]] = [hc[i], hc[m]]; i = m; } return [h, c]; };
  for (let i = 0; i < res; i++) for (const c of [i, (res - 1) * res + i, i * res, i * res + res - 1]) if (!done[c]) { done[c] = 1; push(out[c], c); }
  while (n) {
    const [h, c] = pop();
    const x = c % res, z = (c - x) / res;
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const xx = x + dx, zz = z + dz;
      if (xx < 0 || zz < 0 || xx >= res || zz >= res) continue;
      const k = zz * res + xx;
      if (done[k]) continue;
      done[k] = 1;
      if (out[k] < h) out[k] = h;
      push(out[k], k);
    }
  }
  return out;
}

// Heights in metres above local MSL, bilinear between texel centres (the runtime HeightField's sampler); `at` is
// the real terrain, `filled` the pit-filled one (street draping and the water test use it).
export function heightSampler(merged) {
  const { res, size } = GRID, texel = size / res, o = -size / 2;
  const make = H => (x, z) => {
    const fx = (x - o) / texel - 0.5, fz = (z - o) / texel - 0.5;
    const i = Math.max(0, Math.min(res - 2, Math.floor(fx))), j = Math.max(0, Math.min(res - 2, Math.floor(fz)));
    const tx = Math.max(0, Math.min(1, fx - i)), tz = Math.max(0, Math.min(1, fz - j)), k = j * res + i;
    return ((H[k] * (1 - tx) + H[k + 1] * tx) * (1 - tz) + (H[k + res] * (1 - tx) + H[k + res + 1] * tx) * tz) / 100;
  };
  // terrain grid lines pass through texel centres: o + (i + 0.5) * texel
  return { at: make(merged.heights), filled: make(fillPits(merged.heights, res)), texel, gridOrigin: o + texel / 2 };
}

export async function loadContext({ rawDir = RAW } = {}) {
  const slice = JSON.parse(readFileSync(join(TITLE, 'data/slice.json'), 'utf8'));
  const boxes = Object.entries(slice.boxes).map(([name, b]) => ({
    name, ...b,
    ring: [[b.south, b.west], [b.south, b.east], [b.north, b.east], [b.north, b.west]].map(([la, lo]) => local(la, lo)),
  }));
  const merged = mergeHeights({ rawDir });
  const height = heightSampler(merged);

  // every footprint, landmark ones included (roads and sidewalks must keep off them too)
  const hooks = await import(pathToFileURL(join(TITLE, 'hooks.js')).href);
  const kit = buildingKit({ rawDir, merged });
  const anchors = kit.landmarkAnchors();
  kit.landmarkAnchors = () => [];
  await hooks.collectBuildings(kit);
  const buildings = kit.out.map(b => ({
    id: b.id, polys: b.polys, top: b.top, base: b.base, cls: b.cls, src: b.src, h: b.h,
    landmark: anchors.find(a => b.polys.some(poly => kit.inside(poly[0], a.p[0], a.p[1])))?.name || null,
  })).sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

  const json = f => JSON.parse(readCached(f, rawDir).toString('utf8'));
  const osm = {
    sf: json('osm-streets-sf.json').elements,
    sausalito: json('osm-streets-sausalito.json').elements,
  };
  const trees = json('datasf-street-trees.json');
  return { slice, boxes, merged, height, buildings, osm, trees, local, GRID };
}

// One de-duplicated element list over both boxes (ways appear once even if both queries return them), sorted
// by type then id so every later step sees the same order.
export function elements(ctx) {
  const seen = new Set(), out = [];
  for (const e of [...ctx.osm.sf, ...ctx.osm.sausalito]) {
    const k = e.type + e.id;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(e);
  }
  const rank = { node: 0, way: 1, relation: 2 };
  return out.sort((a, b) => rank[a.type] - rank[b.type] || a.id - b.id);
}
