// Storefront band (D49, D50, D56): a 4–5 m ground-floor module on every building edge that faces the street
// (walkway or road within 3 m in front of it). A module is glass, a door, an awning or a roller shutter and a sign
// board. Businesses are real (run 3, D94): every OSM shop / amenity / tourism feature in or in front of a footprint is
// one business that claims the street-facing modules nearest it, about its category's typical frontage (signs.mjs
// FRONTAGE) along one edge, with one sign, one awning colour and one board for the whole business. Frontage no business
// claims stays unlabelled (a plain shopfront, a lobby door or a shutter), never an invented shop; houses on
// residential streets get garage doors and front doors, no signs. Sign text is generic category text only.
import { storeCategory } from './osm.mjs';
import { polygons, Region, union } from './geom.mjs';
import { SIGN_TEXT, SIGN_ZH, DISTRICTS, CATEGORY_ID, AWNING, NEON, FRONTAGE } from './signs.mjs';

export const KIND = { shop: 0, door: 1, shutter: 2, garage: 3, home: 4 };
const COMMERCIAL_ROADS = /^(primary|secondary|tertiary|trunk|pedestrian)(_link)?$/;

const rand = (...k) => { let h = 2166136261; for (const v of k.join(',')) { h ^= v.charCodeAt(0); h = Math.imul(h, 16777619); } return ((h >>> 0) % 1000003) / 1000003; };

export function buildStores(ctx, roads, walks) {
  const { local } = ctx;
  const log = { buildings: 0, edges: 0, facing: 0, modules: 0, withPoi: 0, poiAssigned: 0, poiUnplaced: 0, residential: 0, byDistrict: {}, byKind: {}, signs: 0, businesses: 0, poiNoFrontage: 0, unlabelled: 0, byCategory: {} };
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
    // a sign text the tag itself names, where it does (a dentist says DENTIST, a bank BANK), else the category's list
    const hint = { dentist: 'DENTIST', clinic: 'CLINIC', doctors: 'CLINIC', bank: 'BANK', pharmacy: 'PHARMACY', cinema: 'CINEMA', theatre: 'THEATRE', bakery: 'BAKERY', florist: 'FLORIST', books: 'BOOKS', hotel: 'HOTEL', hostel: 'INN', motel: 'INN', guest_house: 'INN', ice_cream: 'ICE CREAM', hairdresser: 'SALON', barber: 'BARBER', nails: 'NAILS', jewelry: 'JEWELRY', shoes: 'SHOES', wine: 'WINE', alcohol: 'LIQUORS', deli: 'DELI', supermarket: 'MARKET', greengrocer: 'PRODUCE', bicycle: 'BIKES', gallery: 'GALLERY', art: 'ART' }[e.tags.amenity || e.tags.shop || e.tags.tourism];
    poisOf.get(best).push({ cat, x, z, id: e.type[0] + e.id, hint });
    log.poiAssigned++;
  }

  // ---- edges and modules
  const modules = [], texts = new Map(), extras = [];
  const textId = s => { if (!texts.has(s)) texts.set(s, texts.size); return texts.get(s); };
  buildings.forEach((b, bi) => {
    log.buildings++;
    const pois = poisOf.get(bi) || [];
    if (pois.length) log.withPoi++;
    const bmods = [];
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
          const r = s => rand(b.id, pi, i, k, s);
          let kind;
          if (residential) kind = seed < 0.45 ? KIND.garage : seed < 0.8 ? KIND.home : KIND.door;
          else kind = seed < 0.55 ? KIND.shop : seed < 0.85 ? KIND.door : KIND.shutter; // unlabelled until a business claims it
          const m = { x0, z0, x1, z1, ox, oz, kind, flags: 0, sign: -1, height: residential ? 3.0 : b.h > 60 ? 5.0 : 4.5,
            board: Math.floor(r('bd') * 8), ink: Math.floor(r('ink') * 6), awning: Math.floor(r('awc') * 6), seed: Math.round(seed * 1e6) / 1e6, district, cat: null, catId: 0,
            edge: pi + ':' + i, k, len: L / nm, mx: (x0 + x1) / 2, mz: (z0 + z1) / 2 };
          modules.push(m);
          if (!residential) bmods.push(m);
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
    assignBusinesses(b, pois, bmods, log, textId);
    for (const m of bmods) if (!m.catId) log.unlabelled++;
  });
  for (const m of modules) log.byKind[m.kind] = (log.byKind[m.kind] || 0) + 1;
  log.modules = modules.length;
  return { modules, texts: [...texts.keys()], extras, log };
}

// Each POI of a building becomes one business (D94): it takes the free street-facing module nearest to it, then
// grows along that edge (alternating sides) until it has about its category's frontage; later POIs take what is left.
// The whole business shares one look; its one sign sits on the module nearest the POI.
function assignBusinesses(b, pois, bmods, log, textId) {
  if (!pois.length || !bmods.length) return;
  const byEdge = new Map();
  for (const m of bmods) { if (!byEdge.has(m.edge)) byEdge.set(m.edge, []); byEdge.get(m.edge).push(m); }
  for (const list of byEdge.values()) list.sort((p, q) => p.k - q.k);
  const ordered = pois.slice().sort((p, q) => (p.id < q.id ? -1 : p.id > q.id ? 1 : 0));
  for (const poi of ordered) {
    const free = bmods.filter(m => !m.catId).map(m => [Math.hypot(m.mx - poi.x, m.mz - poi.z), m]).sort((u, v) => u[0] - v[0] || u[1].k - v[1].k);
    if (!free.length) { log.poiNoFrontage++; continue; }
    const anchor = free[0][1], row = byEdge.get(anchor.edge), at = row.indexOf(anchor);
    const want = FRONTAGE[poi.cat] || 6, claim = [anchor];
    let got = anchor.len, lo = at - 1, hi = at + 1, turn = 0;
    while (got < want - 0.5) {
      const order = turn++ % 2 === 0 ? ['hi', 'lo'] : ['lo', 'hi'];
      let grew = false;
      for (const sideName of order) {
        const j = sideName === 'hi' ? hi : lo, m = row[j];
        if (m && !m.catId && !claim.includes(m)) { claim.push(m); got += m.len; if (sideName === 'hi') hi++; else lo--; grew = true; break; }
      }
      if (!grew) break;
    }
    const br = s => rand(poi.id, s);
    const cat = poi.cat, catId = CATEGORY_ID[cat] || CATEGORY_ID.shop;
    const board = Math.floor(br('bd') * 8), ink = Math.floor(br('ink') * 6), awning = Math.floor(br('awc') * 6);
    const list = SIGN_TEXT[cat] || SIGN_TEXT.shop;
    const text = poi.hint && list.includes(poi.hint) ? poi.hint : list[Math.floor(br('txt') * list.length)];
    const zh = anchor.district === 'chinatown' && SIGN_ZH[cat] ? SIGN_ZH[cat] : null;
    const label = zh ? `${zh} ${text}` : text;
    for (const m of claim) {
      m.cat = cat; m.catId = catId; m.board = board; m.ink = ink; m.awning = awning;
      m.kind = cat === 'lobby' ? KIND.door : KIND.shop;
      m.flags = AWNING.has(cat) ? 1 : 0;
    }
    anchor.sign = textId(label);
    anchor.flags |= (/^(bar|cafe|restaurant|chinese|hotel|theatre)$/.test(cat) && br('bl') < 0.5 ? 2 : 0) | (br('wl') < 0.3 ? 4 : 0) | (NEON.has(cat) ? 8 : 0);
    log.signs++; log.businesses++;
    log.byCategory[cat] = (log.byCategory[cat] || 0) + 1;
  }
}
