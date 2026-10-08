// Pedestrian network for the crowd (D54, G12b): walking lanes are the loops 1.5 m out from the road edge (so they run
// along every sidewalk, round every block) and, where the walkway is wider, at 3.3, 5.1 and 7 m too, sampled every 2 m and kept where the walkway is under them with 0.5 m to
// spare on both sides; crossings link the lanes on either side of every crosswalk band (marked or not, D63). Each
// lane carries a density weight: heaviest at the Ferry Building and Pier 39 (20) and along the Embarcadero waterfront
// (30, within 60 m of it: the promenade and its sidewalks), then Fisherman's Wharf and Chinatown, the Sausalito ferry landing; elsewhere 1.
import { offset, polygons, union } from './geom.mjs';
import { DISTRICTS } from './signs.mjs';

// lanes at these distances from the road edge (the inner ones only where the walkway is that wide: promenades, plazas)
const STEP = 2, OUT = 1.5, OFFSETS = [1.5, 3.3, 5.1, 7.0];
export const HOTSPOTS = [
  { name: 'Ferry Building', lat: 37.79555, lon: -122.39350, r: 320, w: 20 },
  { name: 'Pier 39', lat: 37.80870, lon: -122.40980, r: 260, w: 20 },
  { name: "Fisherman's Wharf", lat: 37.80800, lon: -122.41650, r: 350, w: 4 },
  { name: 'Sausalito ferry landing', lat: 37.85620, lon: -122.47800, r: 300, w: 4 },
];

export function buildCrowdGraph(ctx, roads, walks, surfaceAt, walkableAt) {
  const { local } = ctx;
  const log = { lanes: 0, points: 0, crossings: 0, metres: 0 };
  const isWalk = m => m === 5 || m === 6;
  // walkable: sidewalk / plaza, or a crossing / driveway band on the road
  const walk = walkableAt;
  const roadAll = union(roads.R, roads.T);
  const hot = HOTSPOTS.map(h => { const [x, z] = local(h.lat, h.lon); return { ...h, x, z }; });
  const ct = DISTRICTS.find(d => d.name === 'chinatown'), wharf = DISTRICTS.find(d => d.name === 'wharf');
  const box = d => { const a = local(d.north, d.west), b = local(d.south, d.east); return [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[0], b[0]), Math.max(a[1], b[1])]; };
  const ctB = box(ct), whB = box(wharf);
  const inB = (b, x, z) => x >= b[0] && x <= b[2] && z >= b[1] && z <= b[3];
  // the Embarcadero waterfront (the city's busiest promenade): everything within EMB_R m of its centrelines
  const EMB_R = 60, EMB_W = 30;
  const emb = [];
  for (const w of roads.ways) if (w.tags.name === 'The Embarcadero') for (let i = 0; i + 1 < w.pts.length; i++) emb.push([...w.pts[i], ...w.pts[i + 1]]);
  const embDist = (x, z) => { let d = Infinity; for (const [ax, az, bx, bz] of emb) { if (Math.min(ax, bx) - EMB_R > x || Math.max(ax, bx) + EMB_R < x || Math.min(az, bz) - EMB_R > z || Math.max(az, bz) + EMB_R < z) continue; const dx = bx - ax, dz = bz - az, L = dx * dx + dz * dz, t = L > 0 ? Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / L)) : 0; d = Math.min(d, Math.hypot(x - ax - t * dx, z - az - t * dz)); } return d; };
  const weightAt = (x, z) => {
    let w = embDist(x, z) < EMB_R ? EMB_W : 1;
    for (const h of hot) { const d = Math.hypot(x - h.x, z - h.z); if (d < h.r) w = Math.max(w, 1 + (h.w - 1) * (1 - d / h.r)); }
    if (inB(ctB, x, z)) w = Math.max(w, 3);
    if (inB(whB, x, z)) w = Math.max(w, 3);
    return w;
  };
  // lanes
  const lanes = []; // { pts: [[x, z]...], w }
  for (const d of OFFSETS) for (const poly of polygons(offset(roadAll, d, 'miter'), false)) for (const ring of poly) {
    // resample the ring every STEP m
    const pts = [];
    let carry = 0;
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i], b = ring[(i + 1) % ring.length], L = Math.hypot(b[0] - a[0], b[1] - a[1]);
      let s = carry;
      for (; s < L; s += STEP) pts.push([a[0] + (b[0] - a[0]) * s / L, a[1] + (b[1] - a[1]) * s / L]);
      carry = s - L;
    }
    // keep runs of segments with walkway along them (every 0.2 m) at the centre and 0.5 m to either side: walkers
    // keep within ±0.25 m of the lane (the walkable raster is 0.25 m: a margin of half a diagonal)
    // and, per segment, how far to either side the walkway goes (up to 1.5 m, in 0.25 m steps, at every sample):
    // walkers spread across that width less 0.3 m
    let run = [], hw = [];
    const flush = () => { if (run.length >= 4) lanes.push({ pts: run, hw }); run = []; hw = []; };
    const segOk = (p, q) => {
      const dx = q[0] - p[0], dz = q[1] - p[1], l = Math.hypot(dx, dz) || 1, nx = dz / l, nz = -dx / l;
      const n = Math.max(1, Math.ceil(l / 0.2));
      let width = 1.5;
      for (let k = 0; k <= n; k++) {
        const x = p[0] + dx * k / n, z = p[1] + dz * k / n;
        for (const o of [0, 0.5, -0.5]) if (!walk(x + nx * o, z + nz * o)) return 0;
        while (width > 0.5 && !(walk(x + nx * width, z + nz * width) && walk(x - nx * width, z - nz * width))) width -= 0.25;
      }
      return width;
    };
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i], q = pts[(i + 1) % pts.length], w = segOk(p, q);
      if (w) { if (!run.length) run.push(p); run.push(q); hw.push(w); } else flush();
    }
    flush();
  }
  for (const l of lanes) {
    l.w = l.pts.reduce((a, p) => a + weightAt(p[0], p[1]), 0) / l.pts.length;
    log.metres += (l.pts.length - 1) * STEP;
  }
  log.lanes = lanes.length;
  log.points = lanes.reduce((a, l) => a + l.pts.length, 0);
  // crossings: the two ends of each crosswalk band, each snapped to the nearest lane point within 2.5 m
  const grid = new Map(), G = 10;
  lanes.forEach((l, li) => l.pts.forEach((p, pi) => { const k = Math.floor(p[0] / G) + ',' + Math.floor(p[1] / G); if (!grid.has(k)) grid.set(k, []); grid.get(k).push([li, pi]); }));
  const nearest = (x, z, r) => { let best = null, bd = r; for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) for (const [li, pi] of grid.get((Math.floor(x / G) + i) + ',' + (Math.floor(z / G) + j)) || []) { const p = lanes[li].pts[pi], d = Math.hypot(p[0] - x, p[1] - z); if (d < bd) { bd = d; best = [li, pi]; } } return best; };
  // crossings: lane point → the band's end on this side → across along the band's centre → the other end → lane point
  const walkable = walk;
  const crossings = [];
  for (const c of roads.crosswalks) {
    const [dx, dz] = c.dir, ax = dz, az = -dx, h = c.width / 2 + OUT, e = c.width / 2 + 0.3;
    const a = nearest(c.centre[0] + ax * h, c.centre[1] + az * h, 2.5), b = nearest(c.centre[0] - ax * h, c.centre[1] - az * h, 2.5);
    if (!a || !b || a[0] === b[0]) continue;
    const path = [lanes[a[0]].pts[a[1]], [c.centre[0] + ax * e, c.centre[1] + az * e], [c.centre[0] - ax * e, c.centre[1] - az * e], lanes[b[0]].pts[b[1]]];
    let clear = true;
    for (let k = 0; clear && k + 1 < path.length; k++) {
      const [px, pz] = path[k], [qx, qz] = path[k + 1], L = Math.hypot(qx - px, qz - pz);
      const n = Math.max(1, Math.ceil(L / 0.1));
      for (let k = 0; clear && k <= n; k++) if (!walkable(px + (qx - px) * k / n, pz + (qz - pz) * k / n)) clear = false;
    }
    if (!clear) continue;
    crossings.push([a[0], a[1], b[0], b[1], path[1][0], path[1][1], path[2][0], path[2][1]]);
  }
  log.crossings = crossings.length;
  return { lanes, crossings, log };
}
