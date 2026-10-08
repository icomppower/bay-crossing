// Storefront band (D49, D50, D56): a 4–5 m ground-floor module on every building edge that faces the street
// (walkway or road within 3 m in front of it). A module is glass, a door, an awning or a roller shutter and a sign
// board; its category comes from the OSM shop / amenity / tourism features in or in front of the footprint, else
// from the district default (Embarcadero commercial, Fisherman's Wharf tourist, Chinatown, North Beach, Sausalito
// waterfront); houses on residential streets get garage doors and front doors instead, no signs. Sign text is
// generic category text only (signs.mjs). Seeded by position: the same cache gives the same storefronts.
import { storeCategory } from './osm.mjs';
import { polygons, Region, union } from './geom.mjs';
import { SIGN_TEXT, SIGN_ZH, DISTRICT_MIX, DISTRICTS } from './signs.mjs';

export const KIND = { shop: 0, door: 1, shutter: 2, garage: 3, home: 4 };
const COMMERCIAL_ROADS = /^(primary|secondary|tertiary|trunk|pedestrian)(_link)?$/;

const rand = (...k) => { let h = 2166136261; for (const v of k.join(',')) { h ^= v.charCodeAt(0); h = Math.imul(h, 16777619); } return ((h >>> 0) % 1000003) / 1000003; };
const pickWeighted = (mix, r) => { const e = Object.entries(mix), tot = e.reduce((a, [, w]) => a + w, 0); let x = r * tot; for (const [k, w] of e) { if ((x -= w) < 0) return k; } return e[e.length - 1][0]; };

export function buildStores(ctx, roads, walks) {
  const { local } = ctx;
  const log = { buildings: 0, edges: 0, facing: 0, modules: 0, withPoi: 0, poiAssigned: 0, poiUnplaced: 0, residential: 0, byDistrict: {}, byKind: {}, signs: 0 };
  const street = new Region(polygons(union(walks.walkAll, union(roads.R, roads.T)), false));
  const districts = DISTRICTS.map(d => ({ ...d, ring: [[d.south, d.west], [d.south, d.east], [d.north, d.east], [d.north, d.west]].map(([la, lo]) => local(la, lo)) }));
  const distRegions = districts.map(d => ({ name: d.name, r: new Region([[d.ring]]) }));
  const sausalito = new Region([[ctx.boxes.find(b => b.name === 'sausalito').ring]]);
  const districtAt = (x, z) => sausalito.contains(x, z) ? 'sausalito' : (distRegions.find(d => d.r.contains(x, z))?.name || 'embarcadero');

  // nearest road class to a point (segment grid)
  const segGrid = new Map(), G = 25;
  for (const w of roads.ways) for (let i = 0; i + 1 < w.pts.length; i++) {
    const [ax, az] = w.pts[i], [bx, bz] = w.pts[i + 1];
    for (const [x, z] of [[ax, az], [bx, bz], [(ax + bx) / 2, (az + bz) / 2]]) {
      const k = Math.floor(x / G) + ',' + Math.floor(z / G);
      if (!segGrid.has(k)) segGrid.set(k, new Set());
      segGrid.get(k).add(w);
    }
  }
  const roadNear = (x, z) => {
    let best = Infinity, cls = null;
    const gx = Math.floor(x / G), gz = Math.floor(z / G);
    for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) for (const w of segGrid.get((gx + i) + ',' + (gz + j)) || []) for (let k = 0; k + 1 < w.pts.length; k++) {
      const [ax, az] = w.pts[k], [bx, bz] = w.pts[k + 1], dx = bx - ax, dz = bz - az, L = dx * dx + dz * dz;
      const t = L > 0 ? Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / L)) : 0;
      const d = Math.hypot(x - ax - t * dx, z - az - t * dz);
      if (d < best) { best = d; cls = w.tags.highway; }
    }
    return cls;
  };

  // ---- POIs → buildings (inside the footprint, else the nearest footprint within 6 m)
  const buildings = ctx.buildings.filter(b => !b.landmark && b.h >= 3.5);
  const bRegion = new Region(buildings.flatMap((b, i) => b.polys.map(p => [p[0]])));
  // per-building point lookup: bucket outer rings
  const ringGrid = new Map(), RG = 50;
  buildings.forEach((b, i) => b.polys.forEach(p => { let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity; for (const [x, z] of p[0]) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); } for (let gx = Math.floor((x0 - 6) / RG); gx <= Math.floor((x1 + 6) / RG); gx++) for (let gz = Math.floor((z0 - 6) / RG); gz <= Math.floor((z1 + 6) / RG); gz++) { const k = gx + ',' + gz; if (!ringGrid.has(k)) ringGrid.set(k, []); ringGrid.get(k).push([i, p[0]]); } }));
  const inRing = (r, x, z) => { let c = false; for (let i = 0, j = r.length - 1; i < r.length; j = i++) { const [xi, zi] = r[i], [xj, zj] = r[j]; if ((zi > z) !== (zj > z) && x < (xj - xi) * (z - zi) / (zj - zi) + xi) c = !c; } return c; };
  const ringDist = (r, x, z) => { let d = Infinity; for (let i = 0, j = r.length - 1; i < r.length; j = i++) { const [ax, az] = r[j], [bx, bz] = r[i], dx = bx - ax, dz = bz - az, L = dx * dx + dz * dz, t = L > 0 ? Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / L)) : 0; d = Math.min(d, Math.hypot(x - ax - t * dx, z - az - t * dz)); } return d; };
  const poisOf = new Map();
  for (const e of ctx.elements) {
    if (!e.tags) continue;
    const cat = storeCategory(e.tags);
    if (!cat) continue;
    let lat, lon;
    if (e.type === 'node') { lat = e.lat; lon = e.lon; }
    else if (e.type === 'way' && e.geometry?.length) { lat = e.geometry.reduce((a, g) => a + g.lat, 0) / e.geometry.length; lon = e.geometry.reduce((a, g) => a + g.lon, 0) / e.geometry.length; }
    else continue;
    if (e.tags.level && +e.tags.level !== 0 && !/^0/.test(e.tags.level)) continue; // upstairs businesses have no storefront
    const [x, z] = local(lat, lon);
    const cand = ringGrid.get(Math.floor(x / RG) + ',' + Math.floor(z / RG)) || [];
    let best = null, bd = 6;
    for (const [i, r] of cand) { if (inRing(r, x, z)) { best = i; bd = 0; break; } const d = ringDist(r, x, z); if (d < bd) { bd = d; best = i; } }
    if (best === null) { log.poiUnplaced++; continue; }
    if (!poisOf.has(best)) poisOf.set(best, []);
    poisOf.get(best).push({ cat, x, z });
    log.poiAssigned++;
  }

  // ---- edges and modules
  const modules = [], texts = new Map(), extras = [];
  const textId = s => { if (!texts.has(s)) texts.set(s, texts.size); return texts.get(s); };
  buildings.forEach((b, bi) => {
    log.buildings++;
    const pois = poisOf.get(bi) || [];
    if (pois.length) log.withPoi++;
    let poiTurn = 0;
    b.polys.forEach((poly, pi) => {
      const ring = poly[0];
      // outward side: the ring's orientation (area sign)
      let a2 = 0; for (let i = 0; i < ring.length; i++) { const p = ring[i], q = ring[(i + 1) % ring.length]; a2 += p[0] * q[1] - q[0] * p[1]; }
      for (let i = 0; i < ring.length; i++) {
        const p = ring[i], q = ring[(i + 1) % ring.length], L = Math.hypot(q[0] - p[0], q[1] - p[1]);
        if (L < 2.5) continue;
        log.edges++;
        const dx = (q[0] - p[0]) / L, dz = (q[1] - p[1]) / L;
        // left of p→q is (dz, -dx); a ring with positive signed area (x east, z south) has its outside on the left
        const ox = a2 > 0 ? dz : -dz, oz = a2 > 0 ? -dx : dx;
        let facing = 0, n = 0;
        for (let s = 0.5; s < L; s += 1) {
          n++;
          const x = p[0] + dx * s, z = p[1] + dz * s;
          if ([0.6, 1.6, 2.6].some(d => street.contains(x + ox * d, z + oz * d) && !bRegion.contains(x + ox * d, z + oz * d))) facing++;
        }
        if (facing < 0.5 * n) continue;
        log.facing++;
        const mx = (p[0] + q[0]) / 2, mz = (p[1] + q[1]) / 2;
        const district = districtAt(mx, mz), road = roadNear(mx + ox * 4, mz + oz * 4);
        const residential = !pois.length && (district === 'sausalito' ? road !== 'primary' && road !== 'secondary' : !COMMERCIAL_ROADS.test(road || '')) && b.h < 18;
        if (residential) log.residential++;
        // modules of 4–5 m (one for an edge under 4 m)
        let nm = Math.max(1, Math.round(L / 4.5));
        while (L / nm > 5 && nm < 200) nm++;
        while (nm > 1 && L / nm < 4) nm--;
        for (let k = 0; k < nm; k++) {
          const seed = rand(b.id, pi, i, k);
          const x0 = p[0] + dx * L * k / nm, z0 = p[1] + dz * L * k / nm, x1 = p[0] + dx * L * (k + 1) / nm, z1 = p[1] + dz * L * (k + 1) / nm;
          let kind, cat = null, text = null, zh = null;
          if (residential) {
            kind = seed < 0.45 ? KIND.garage : seed < 0.8 ? KIND.home : KIND.door;
          } else {
            // the POI nearest this module claims it first, then the building's POIs take turns
            if (pois.length) {
              const near = pois.map(o => [Math.hypot(o.x - (x0 + x1) / 2, o.z - (z0 + z1) / 2), o]).sort((u, v) => u[0] - v[0])[0];
              cat = near[0] < 8 ? near[1].cat : pois[poiTurn++ % pois.length].cat;
            } else cat = pickWeighted(DISTRICT_MIX[district], rand(b.id, pi, i, k, 'cat'));
            kind = cat === 'lobby' ? KIND.door : seed < 0.86 ? KIND.shop : seed < 0.94 ? KIND.door : KIND.shutter;
            if (kind === KIND.shop || (kind === KIND.door && rand(b.id, i, k, 'lob') < 0.35)) {
              const list = kind === KIND.door ? SIGN_TEXT.lobby : SIGN_TEXT[cat] || SIGN_TEXT.shop;
              if (rand(b.id, i, k, 'sign') < 0.9) {
                text = list[Math.floor(rand(b.id, i, k, 'txt') * list.length)];
                if (district === 'chinatown' && SIGN_ZH[cat] && kind === KIND.shop) zh = SIGN_ZH[cat];
              }
            }
          }
          const r = s => rand(b.id, pi, i, k, s);
          const awningP = { wharf: 0.6, sausalito: 0.5, chinatown: 0.5, northbeach: 0.5, embarcadero: 0.3 }[district];
          const flags =
            (kind === KIND.shop && r('aw') < awningP ? 1 : 0) |                                                // awning
            (text && kind === KIND.shop && r('bl') < (/^(bar|cafe|restaurant|chinese|hotel|theatre)$/.test(cat) ? 0.45 : 0.15) ? 2 : 0) | // blade sign
            (text && kind === KIND.shop && r('wl') < 0.3 ? 4 : 0) |                                           // window lettering
            (text && /^(bar|cafe|restaurant|chinese|theatre|hotel|fastfood)$/.test(cat) && r('ne') < 0.5 ? 8 : 0); // neon
          const label = text ? (zh ? `${zh} ${text}` : text) : null;
          if (label) log.signs++;
          modules.push({ x0, z0, x1, z1, ox, oz, kind, flags, sign: label ? textId(label) : -1, height: residential ? 3.0 : b.h > 60 ? 5.0 : 4.5,
            board: Math.floor(r('bd') * 8), ink: Math.floor(r('ink') * 6), awning: Math.floor(r('awc') * 6), seed: Math.round(seed * 1e6) / 1e6, district, cat });
          log.byKind[kind] = (log.byKind[kind] || 0) + 1;
          log.byDistrict[district] = (log.byDistrict[district] || 0) + 1;
        }
        // D56: fire escapes and bay windows on residential / mid-rise street faces (instanced props, G12)
        if (b.h >= 9 && b.h <= 30 && L >= 6 && district !== 'sausalito') {
          const fr = rand(b.id, pi, i, 'fe');
          if (fr < 0.22) extras.push({ type: 'fireEscape', x: mx, z: mz, ox, oz, len: Math.min(L - 1, 6), floors: Math.min(6, Math.floor((b.h - 4) / 3)) });
          else if (fr < 0.55) for (let s = 3; s + 3 <= L; s += 7) extras.push({ type: 'bayWindow', x: p[0] + dx * (s + 1.5), z: p[1] + dz * (s + 1.5), ox, oz, floors: Math.min(5, Math.floor((b.h - 4) / 3)) });
        }
      }
    });
  });
  log.modules = modules.length;
  return { modules, texts: [...texts.keys()], extras, log };
}
