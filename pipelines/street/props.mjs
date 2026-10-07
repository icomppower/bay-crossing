// Street props (D52, D55, D56), all drawn instanced at runtime (src/street/Props.js): street trees at their DataSF
// positions (Sausalito: OSM trees, else seeded spacing along Bridgeway), street lamps (OSM lamps, plus seeded ones
// every LAMP_MIN–LAMP_MAX m along sidewalk sides that have none), Muni trolley poles and overhead wires on streets
// OSM tags `trolley_wire`, hydrants and green street-name blades at junction corners, parking meters and parked cars
// along kerbs where parking is allowed (OSM parking tags, else a logged class default), OSM benches, red lanterns
// strung over Grant Avenue in Chinatown, fire escapes and bay windows on mid-rise street faces (stores.mjs extras).
// Seeded by position. Each instance: 8 floats [ x, y, z, yaw, scale, variant, a, b ] (wires: [ ax, ay, az, bx, by,
// bz, radius, kind ]).
import { CLASS_SIDEWALK, sidewalkSides, parkingSides } from './osm.mjs';
import { DISTRICTS } from './signs.mjs';

export const LAMP_MIN = 24, LAMP_MAX = 36;
export const TYPES = ['tree', 'lamp', 'muni', 'hydrant', 'meter', 'blade', 'bench', 'lantern', 'car', 'fireEscape', 'bayWindow', 'wire'];
const CAR_SLOT = 6.4;

const rand = (...k) => { let h = 2166136261; for (const v of k.join(',')) { h ^= v.charCodeAt(0); h = Math.imul(h, 16777619); } return ((h >>> 0) % 1000003) / 1000003; };
const norm = (dx, dz) => { const l = Math.hypot(dx, dz) || 1; return [dx / l, dz / l]; };

// DataSF species → tree shape: 0 broad round crown, 1 columnar, 2 palm, 3 small ornamental
export function treeShape(species = '') {
  const s = species.toLowerCase();
  if (/phoenix|washingtonia|syagrus|trachycarpus|palm|archontophoenix|butia|chamaerops/.test(s)) return 2;
  if (/cupressus|pyrus|ginkgo|populus|carpinus|quercus ilex|tristaniopsis|callistemon viminalis/.test(s)) return 1;
  if (/prunus|arbutus|magnolia|melaleuca|olea|lagerstroemia|cercis|malus|ceanothus|pittosporum|leptospermum/.test(s)) return 3;
  return 0;
}
// DBH range ("0-6", "6-12", …, inches) → crown scale
const dbhScale = r => { const m = /(\d+)\s*-\s*(\d+)/.exec(r || ''); const d = m ? (+m[1] + +m[2]) / 2 : /\+/.test(r || '') ? 40 : 9; return Math.max(0.55, Math.min(1.6, 0.5 + d / 24)); };

// street name on a blade: upper case, the usual SF abbreviations
export function bladeText(name) {
  return name.toUpperCase().replace(/\bTHE\s+/, '').replace(/\bSTREET\b/, 'ST').replace(/\bAVENUE\b/, 'AV').replace(/\bBOULEVARD\b/, 'BLVD')
    .replace(/\bPLACE\b/, 'PL').replace(/\bTERRACE\b/, 'TER').replace(/\bLANE\b/, 'LN').replace(/\bDRIVE\b/, 'DR').replace(/\bALLEY\b/, 'ALY').replace(/\bROAD\b/, 'RD').trim();
}

export function buildProps(ctx, roads, walks, stores, surfaceAt) {
  const { local } = ctx;
  const P = Object.fromEntries(TYPES.map(t => [t, []]));
  const log = { treesDataSF: 0, treesDropped: 0, treesOSM: 0, treesSeeded: 0, lampsOSM: 0, lampsSeeded: 0, muniPoles: 0, wires: 0, parkingDefaultSides: 0, cars: 0, meters: 0, blades: 0, hydrants: 0, benches: 0, lanterns: 0, fireEscapes: 0, bayWindows: 0, byShape: {} };
  const H = ctx.height.filled;
  const isWalk = m => m === 5 || m === 6, isRoad = m => m === 0 || m === 4;
  const walkY = (x, z) => surfaceAt(x, z, isWalk);
  const groundY = (x, z) => surfaceAt(x, z, m => m <= 6) ?? H(x, z);
  const boxes = ctx.boxes;
  const inBox = (x, z) => boxes.some(b => { let c = false; const r = b.ring; for (let i = 0, j = r.length - 1; i < r.length; j = i++) { const [xi, zi] = r[i], [xj, zj] = r[j]; if ((zi > z) !== (zj > z) && x < (xj - xi) * (z - zi) / (zj - zi) + xi) c = !c; } return c; });

  // ---- trees: DataSF (SF), OSM natural=tree (Sausalito), else seeded along Bridgeway
  for (const t of ctx.trees) {
    if (t.planttype !== 'Tree') continue;
    const lat = +t.latitude, lon = +t.longitude;
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) { log.treesDropped++; continue; }
    const [x, z] = local(lat, lon);
    if (!inBox(x, z) || H(x, z) < 0.3) { log.treesDropped++; continue; }
    const shape = treeShape(t.species);
    log.byShape[shape] = (log.byShape[shape] || 0) + 1;
    P.tree.push([x, groundY(x, z), z, rand('ty', t.treeid) * 6.283, dbhScale(t.dbhrange) * (0.85 + 0.3 * rand('ts', t.treeid)), shape, rand('tc', t.treeid), 0]);
    log.treesDataSF++;
  }
  const sauBox = boxes.find(b => b.name === 'sausalito');
  const inSau = (x, z) => { let c = false; const r = sauBox.ring; for (let i = 0, j = r.length - 1; i < r.length; j = i++) { const [xi, zi] = r[i], [xj, zj] = r[j]; if ((zi > z) !== (zj > z) && x < (xj - xi) * (z - zi) / (zj - zi) + xi) c = !c; } return c; };
  for (const e of ctx.elements) {
    if (e.type !== 'node' || e.tags?.natural !== 'tree') continue;
    const [x, z] = local(e.lat, e.lon);
    if (!inSau(x, z) || H(x, z) < 0.3) continue;
    P.tree.push([x, groundY(x, z), z, rand('ty', e.id) * 6.283, 0.9 + 0.3 * rand('ts', e.id), treeShape(e.tags.species || e.tags.genus || ''), rand('tc', e.id), 0]);
    log.treesOSM++;
  }

  // Sausalito with (almost) no mapped trees: seeded every 15 m along Bridgeway's sidewalks (logged)
  if (log.treesOSM < 20) for (const w of roads.ways) {
    if (w.tags.name !== 'Bridgeway' || !inSau(...w.pts[0])) continue;
    for (let i = 0; i + 1 < w.pts.length; i++) {
      const [ax, az] = w.pts[i], [bx, bz] = w.pts[i + 1], L = Math.hypot(bx - ax, bz - az), [dx, dz] = norm(bx - ax, bz - az);
      for (let s = 7.5 * rand('sbp', w.id, i); s < L; s += 15) for (const side of [1, -1]) {
        const x = ax + dx * s + dz * side * (w.width / 2 + 0.9), z = az + dz * s - dx * side * (w.width / 2 + 0.9), y = walkY(x, z);
        if (y === null || rand('sbo', w.id, i, s, side) < 0.3) continue;
        P.tree.push([x, y, z, rand('ty', x, z) * 6.283, 0.8 + 0.3 * rand('ts', x, z), rand('tsh', x, z) < 0.3 ? 3 : 0, rand('tc', x, z), 0]);
        log.treesSeeded++;
      }
    }
  }

  // ---- along road sides: lamps, Muni poles, parked cars, meters
  const osmLamps = ctx.elements.filter(e => e.type === 'node' && e.tags?.highway === 'street_lamp').map(e => local(e.lat, e.lon)).filter(([x, z]) => inBox(x, z));
  for (const [x, z] of osmLamps) { P.lamp.push([x, groundY(x, z), z, 0, 1, 0, 0, 0]); log.lampsOSM++; }
  const lampGrid = new Map(), LG = 20;
  const lampAdd = (x, z) => { const k = Math.floor(x / LG) + ',' + Math.floor(z / LG); if (!lampGrid.has(k)) lampGrid.set(k, []); lampGrid.get(k).push([x, z]); };
  const lampNear = (x, z, r) => { for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) for (const [px, pz] of lampGrid.get((Math.floor(x / LG) + i) + ',' + (Math.floor(z / LG) + j)) || []) if (Math.hypot(px - x, pz - z) < r) return true; return false; };
  for (const [x, z] of osmLamps) lampAdd(x, z);
  const crossC = roads.crosswalks.map(c => c.centre);
  const nearCross = (x, z, r) => crossC.some(([cx, cz]) => Math.abs(cx - x) < r && Math.abs(cz - z) < r && Math.hypot(cx - x, cz - z) < r);
  const commercial = new Set(['primary', 'secondary', 'tertiary', 'trunk']);
  const lampRuns = []; // per side: seeded lamp positions along it (G12 checks their spacing)
  for (const w of roads.ways) {
    const t = w.tags, sw = sidewalkSides(t), pk = parkingSides(t);
    const trolley = t.trolley_wire === 'yes';
    const twoWay = !(t.oneway === 'yes' || t.oneway === '1' || t.oneway === '-1');
    // walk the polyline by arc length
    const cum = [0];
    for (let i = 1; i < w.pts.length; i++) cum.push(cum[i - 1] + Math.hypot(w.pts[i][0] - w.pts[i - 1][0], w.pts[i][1] - w.pts[i - 1][1]));
    const L = cum[cum.length - 1];
    if (L < 20) continue;
    const at = s => { let i = 1; while (i < w.pts.length - 1 && cum[i] < s) i++; const a = w.pts[i - 1], b = w.pts[i], u = (s - cum[i - 1]) / Math.max(1e-9, cum[i] - cum[i - 1]); const [dx, dz] = norm(b[0] - a[0], b[1] - a[1]); return { x: a[0] + (b[0] - a[0]) * u, z: a[1] + (b[1] - a[1]) * u, dx, dz }; };
    for (const side of [1, -1]) {
      const has = side === 1 ? sw.left : sw.right;
      const off = w.width / 2;
      // Muni trolley poles every 35 m both sides (they light the street too: no lamp within 4 m of one)
      if (trolley && CLASS_SIDEWALK[t.highway] !== undefined) for (let s = 10 + 15 * rand('mp', w.id); s < L - 10; s += 35) {
        const p = at(s), nx = p.dz * side, nz = -p.dx * side, x = p.x + nx * (off + 0.5), z = p.z + nz * (off + 0.5);
        const y = walkY(x, z);
        if (y === null) continue;
        P.muni.push([x, y, z, Math.atan2(-nx, -nz), 1, 0, off * 2 + 1, 0]);
        lampAdd(x, z);
        log.muniPoles++;
      }
      if (has && CLASS_SIDEWALK[t.highway] !== undefined) {
        // seeded lamps where no OSM lamp stands within half the spacing
        const spacing = LAMP_MIN + (LAMP_MAX - LAMP_MIN) * rand('ls', w.id, side), run = [];
        for (let s = 8 + spacing * rand('lp', w.id, side); s < L - 8; s += spacing) {
          const p = at(s), nx = p.dz * side, nz = -p.dx * side, x = p.x + nx * (off + 0.55), z = p.z + nz * (off + 0.55);
          if (lampNear(x, z, spacing / 2)) { run.length && lampRuns.push(run.splice(0)); continue; }
          const y = walkY(x, z);
          if (y === null) { run.length && lampRuns.push(run.splice(0)); continue; }
          P.lamp.push([x, y, z, Math.atan2(-nx, -nz), 1, 1, 0, 0]);
          lampAdd(x, z);
          run.push([x, z, s]);
          log.lampsSeeded++;
        }
        if (run.length) lampRuns.push(run);
      }
      // parked cars in the kerb lane (and a meter beside each on commercial streets)
      let allowed = side === 1 ? pk.left : pk.right;
      if (allowed === null) {
        allowed = /^(residential|tertiary|secondary|unclassified|living_street)$/.test(t.highway) && !(+t.lanes >= 3 && !twoWay) && t.highway !== 'busway';
        if (allowed) log.parkingDefaultSides++;
      }
      if (!allowed || CLASS_SIDEWALK[t.highway] === undefined) continue;
      const meters = commercial.has(t.highway);
      for (let s = 12 + CAR_SLOT * rand('cp', w.id, side); s < L - 12; s += CAR_SLOT) {
        const p = at(s), nx = p.dz * side, nz = -p.dx * side;
        const x = p.x + nx * (off - 1.15), z = p.z + nz * (off - 1.15);
        if (nearCross(x, z, 9)) continue;
        const ry = surfaceAt(x, z, isRoad);
        if (ry === null || rand('occ', w.id, side, Math.round(s)) < 0.18) continue; // about a fifth of the slots are free
        // the car faces the traffic of its lane: the right side of travel faces forwards
        const yaw = Math.atan2(-p.dx, -p.dz) + (side === 1 && twoWay ? Math.PI : 0);
        P.car.push([x, ry, z, yaw, 1, Math.floor(rand('cv', w.id, side, Math.round(s)) * 4), Math.floor(rand('cc', w.id, side, Math.round(s)) * 12), 0]);
        log.cars++;
        if (meters) {
          const mx = p.x + nx * (off + 0.45), mz = p.z + nz * (off + 0.45), my = walkY(mx, mz);
          if (my !== null) { P.meter.push([mx, my, mz, Math.atan2(-nx, -nz), 1, 0, 0, 0]); log.meters++; }
        }
      }
    }
    // overhead trolley wires: two pairs over the carriageway at 5.8 m, following the road
    if (trolley) {
      const pairs = twoWay ? [-w.width / 4, w.width / 4] : [0];
      for (const c of pairs) for (const d of [-0.3, 0.3]) for (let s = 0; s + 1 < L; s += 12) {
        const a = at(s), b = at(Math.min(L, s + 12));
        const ax = a.x + a.dz * (c + d), az = a.z - a.dx * (c + d), bx = b.x + b.dz * (c + d), bz = b.z - b.dx * (c + d);
        const ya = groundY(ax, az), yb = groundY(bx, bz);
        if (!inBox(ax, az)) continue;
        P.wire.push([ax, ya + 5.8, az, bx, yb + 5.8, bz, 0.009, 0]);
        log.wires++;
      }
    }
  }
  // lamps closer than a Muni pole: the pole carries the light
  P.lamp = P.lamp.filter(([x, , z, , , v]) => v === 0 || !P.muni.some(([mx, , mz]) => Math.abs(mx - x) < 4 && Math.abs(mz - z) < 4 && Math.hypot(mx - x, mz - z) < 4));

  // ---- junction corners: street-name blades and hydrants
  const wayAt = new Map();
  for (const w of roads.ways) w.nodes.forEach((n, k) => { if (!wayAt.has(n)) wayAt.set(n, []); wayAt.get(n).push([w, k]); });
  const names = new Map();
  const nameId = s => { if (!names.has(s)) names.set(s, names.size); return names.get(s); };
  for (const [n, inc] of [...wayAt.entries()].sort((a, b) => a[0] - b[0])) {
    const named = [...new Map(inc.filter(([w]) => w.tags.name && CLASS_SIDEWALK[w.tags.highway] !== undefined).map(([w, k]) => [w.tags.name, [w, k]])).values()];
    if (named.length < 2) continue;
    const [w1, k1] = named[0], [w2, k2] = named[1];
    const p = w1.pts[k1];
    if (!inBox(...p)) continue;
    const dir = (w, k) => { const q = w.pts[k + 1] || w.pts[k - 1]; return norm(q[0] - p[0], q[1] - p[1]); };
    const d1 = dir(w1, k1), d2 = dir(w2, k2);
    // the corner between the two streets' legs, beyond both carriageways
    const corners = [[d1[0] + d2[0], d1[1] + d2[1]], [d1[0] - d2[0], d1[1] - d2[1]], [-d1[0] + d2[0], -d1[1] + d2[1]], [-d1[0] - d2[0], -d1[1] - d2[1]]].map(([a, b]) => norm(a, b));
    const reach = Math.max(w1.width, w2.width) / 2 + 1.6;
    const spots = corners.map(([cx, cz]) => { const r = reach * 1.35; const x = p[0] + cx * r, z = p[1] + cz * r; return { x, z, y: walkY(x, z) }; }).filter(s => s.y !== null);
    if (!spots.length) continue;
    const b = spots[Math.floor(rand('bl', n) * spots.length)];
    P.blade.push([b.x, b.y, b.z, Math.atan2(-d1[0], -d1[1]), 1, 0, nameId(bladeText(w1.tags.name)), nameId(bladeText(w2.tags.name))]);
    log.blades++;
    const others = spots.filter(s => s !== b);
    if (others.length && rand('hy', n) < 0.7) {
      const h = others[Math.floor(rand('hs', n) * others.length)];
      P.hydrant.push([h.x, h.y, h.z, rand('hr', n) * 6.283, 1, rand('hk', n) < 0.15 ? 1 : 0, 0, 0]);
      log.hydrants++;
    }
  }

  // ---- benches (OSM), facing the nearest road
  for (const e of ctx.elements) {
    if (e.type !== 'node' || e.tags?.amenity !== 'bench') continue;
    const [x, z] = local(e.lat, e.lon);
    if (!inBox(x, z)) continue;
    const y = surfaceAt(x, z, m => m <= 6);
    if (y === null && H(x, z) < 0.3) continue;
    P.bench.push([x, y ?? H(x, z), z, rand('bn', e.id) * 6.283, 1, 0, 0, 0]);
    log.benches++;
  }

  // ---- Chinatown: red lanterns strung across Grant Avenue every 9 m (D56)
  const cb = DISTRICTS.find(d => d.name === 'chinatown'), cr = [[cb.south, cb.west], [cb.south, cb.east], [cb.north, cb.east], [cb.north, cb.west]].map(([la, lo]) => local(la, lo));
  const ct = (x, z) => { let c = false; for (let i = 0, j = cr.length - 1; i < cr.length; j = i++) { const [xi, zi] = cr[i], [xj, zj] = cr[j]; if ((zi > z) !== (zj > z) && x < (xj - xi) * (z - zi) / (zj - zi) + xi) c = !c; } return c; };
  for (const w of roads.ways) {
    if (w.tags.name !== 'Grant Avenue') continue;
    for (let i = 0; i + 1 < w.pts.length; i++) {
      const [ax, az] = w.pts[i], [bx, bz] = w.pts[i + 1], L = Math.hypot(bx - ax, bz - az);
      const [dx, dz] = norm(bx - ax, bz - az), nx = dz, nz = -dx;
      for (let s = 4; s < L; s += 9) {
        const cx = ax + dx * s, cz = az + dz * s;
        if (!ct(cx, cz)) continue;
        // span from building face to building face (≤ 9 m each side)
        const reachTo = sgn => { for (let o = w.width / 2; o < 9; o += 0.25) if (ctx.buildingRegion.contains(cx + nx * o * sgn, cz + nz * o * sgn)) return o - 0.2; return 8; };
        const l = reachTo(1), r = reachTo(-1);
        const y0 = groundY(cx, cz) + 7.2;
        const ax2 = cx + nx * l, az2 = cz + nz * l, bx2 = cx - nx * r, bz2 = cz - nz * r;
        P.wire.push([ax2, y0, az2, bx2, y0, bz2, 0.006, 1]);
        log.wires++;
        const span = l + r;
        for (let q = 0.8; q < span - 0.8; q += 1.6) {
          const u = q / span, sag = 0.6 * 4 * u * (1 - u);
          P.lantern.push([ax2 + (bx2 - ax2) * u, y0 - sag - 0.3, az2 + (bz2 - az2) * u, Math.atan2(-nx, -nz), 0.9 + 0.2 * rand('lt', w.id, i, s, q), 0, 0, 0]);
          log.lanterns++;
        }
      }
    }
  }

  // ---- facade props from the storefront pass
  for (const e of stores.extras) {
    const y = walkY(e.x + e.ox * 0.5, e.z + e.oz * 0.5) ?? H(e.x, e.z) + 0.18;
    const yaw = Math.atan2(-e.ox, -e.oz);
    if (e.type === 'fireEscape') { P.fireEscape.push([e.x + e.ox * 0.05, y, e.z + e.oz * 0.05, yaw, 1, 0, e.len, e.floors]); log.fireEscapes++; }
    else for (let f = 1; f <= e.floors; f++) { P.bayWindow.push([e.x + e.ox * 0.05, y + 0.6 + f * 3.0, e.z + e.oz * 0.05, yaw, 1, 0, 0, 0]); log.bayWindows++; }
  }

  // sorted, rounded to f32 (deterministic output)
  for (const k of TYPES) P[k].sort((a, b) => a[2] - b[2] || a[0] - b[0] || a[1] - b[1]);
  return { props: P, names: [...names.keys()], lampRuns, log };
}
