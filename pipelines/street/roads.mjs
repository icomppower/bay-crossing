// Roads (D45, D46, D58): ground-level drivable OSM ways → one road region (buffered centerlines, unioned, so
// intersections are single polygons with no overlapping strips), clipped to the slice boxes and off building
// footprints; markings (centre lines, lane dividers, crosswalks) and tram rails as decals on top.
import { isGroundRoad, roadWidth } from './osm.mjs';
import { bufferLine, union, diff, inter, area, toPath, offset } from './geom.mjs';

export const MAT = { asphalt: 0, yellow: 1, white: 2, rail: 3, trackway: 4, walk: 5, plaza: 6, curb: 7 };
const DASH = 3, GAP = 9; // m: US lane line 10 ft dash / 30 ft gap
const XW = 3; // crosswalk width along the road (m)

const norm = (dx, dz) => { const l = Math.hypot(dx, dz) || 1; return [dx / l, dz / l]; };

// The polyline cut to [s0, s1] metres along it.
function sub(pts, s0, s1) {
  const out = [];
  let s = 0;
  for (let i = 0; i + 1 < pts.length; i++) {
    const [ax, az] = pts[i], [bx, bz] = pts[i + 1], L = Math.hypot(bx - ax, bz - az);
    if (L === 0) continue;
    const a = Math.max(s0, s), b = Math.min(s1, s + L);
    if (b > a) {
      const p = t => [ax + (bx - ax) * (t - s) / L, az + (bz - az) * (t - s) / L];
      if (!out.length) out.push(p(a));
      out.push(p(b));
    }
    s += L;
  }
  return out;
}
const lengthOf = pts => { let s = 0; for (let i = 0; i + 1 < pts.length; i++) s += Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]); return s; };

// A polyline shifted sideways by d (left of travel = +d), mitred joints (clamped).
export function shift(pts, d) {
  if (d === 0) return pts.slice();
  const out = [];
  for (let i = 0; i < pts.length; i++) {
    const a = pts[Math.max(0, i - 1)], b = pts[i], c = pts[Math.min(pts.length - 1, i + 1)];
    const n1 = norm(b[0] - a[0], b[1] - a[1]), n2 = norm(c[0] - b[0], c[1] - b[1]);
    const t1 = i === 0 ? n2 : n1, t2 = i === pts.length - 1 ? n1 : n2;
    // left normal of a direction (x east, z south): (dz, -dx)
    let nx = t1[1] + t2[1], nz = -t1[0] - t2[0];
    const l = Math.hypot(nx, nz) || 1; nx /= l; nz /= l;
    const cos = nx * t2[1] + nz * -t2[0];
    const k = d / Math.max(0.5, cos);
    out.push([b[0] + nx * k, b[1] + nz * k]);
  }
  return out;
}

// Dashed copies of a line: [s, s + DASH] every DASH + GAP.
function dashes(pts) {
  const L = lengthOf(pts), out = [];
  for (let s = GAP / 2; s + DASH <= L; s += DASH + GAP) out.push(sub(pts, s, s + DASH));
  return out;
}

export function buildRoads(ctx, { dropWays = null, noBuildingClip = false } = {}) {
  const { local } = ctx;
  const log = { widthDefaults: [], widthFromLanes: 0, widthFromTag: 0, notGround: {}, ways: 0 };
  const els = ctx.elements;
  const nodeById = new Map();
  for (const e of els) if (e.type === 'node') nodeById.set(e.id, e);

  // ---- ground road ways
  const ways = [];
  for (const e of els) {
    if (e.type !== 'way' || !e.tags?.highway || !e.geometry || e.geometry.length < 2) continue;
    if (!isGroundRoad(e.tags)) {
      if (['motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'residential', 'unclassified', 'service', 'busway', 'living_street'].includes(e.tags.highway) || /_link$/.test(e.tags.highway)) {
        const why = e.tags.tunnel && e.tags.tunnel !== 'no' ? 'tunnel' : e.tags.bridge && e.tags.bridge !== 'no' ? 'bridge' : e.tags.layer ? 'layer' : e.tags.area === 'yes' ? 'area' : e.tags.service || 'other';
        log.notGround[why] = (log.notGround[why] || 0) + 1;
      }
      continue;
    }
    if (dropWays && dropWays(e)) continue;
    const pts = e.geometry.map(g => local(g.lat, g.lon));
    const { width, source } = roadWidth(e.tags);
    if (source === 'default') log.widthDefaults.push([e.id, e.tags.highway, width]);
    else if (source === 'lanes') log.widthFromLanes++; else log.widthFromTag++;
    ways.push({ id: e.id, tags: e.tags, pts, nodes: e.nodes || [], width });
  }
  log.ways = ways.length;

  // ---- road region: union of buffered centerlines, clipped to the boxes, minus buildings
  const boxPaths = union(ctx.boxes.map(b => toPath(b.ring)));
  const buffers = ways.map(w => bufferLine(w.pts, w.width / 2));
  const R0 = inter(union(buffers.flat()), boxPaths);
  const B = noBuildingClip ? [] : ctx.buildingPaths;
  const overlap = area(inter(R0, B));
  const R = diff(R0, B);
  log.roadArea = Math.round(area(R));
  log.clippedByBuildings = Math.round(overlap);

  // ---- markings
  // which ways meet each way (not its own continuation): their buffers are its intersection zones
  const grid = new Map(), G = 100;
  const bbox = ways.map(w => { let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity; for (const [x, z] of w.pts) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); } const r = w.width; return [x0 - r, z0 - r, x1 + r, z1 + r]; });
  ways.forEach((w, i) => { const [x0, z0, x1, z1] = bbox[i]; for (let gx = Math.floor(x0 / G); gx <= Math.floor(x1 / G); gx++) for (let gz = Math.floor(z0 / G); gz <= Math.floor(z1 / G); gz++) { const k = gx + ',' + gz; if (!grid.has(k)) grid.set(k, []); grid.get(k).push(i); } });
  const neighbours = i => { const [x0, z0, x1, z1] = bbox[i], s = new Set(); for (let gx = Math.floor(x0 / G); gx <= Math.floor(x1 / G); gx++) for (let gz = Math.floor(z0 / G); gz <= Math.floor(z1 / G); gz++) for (const j of grid.get(gx + ',' + gz) || []) if (j !== i) { const b = bbox[j]; if (b[0] <= x1 && b[2] >= x0 && b[1] <= z1 && b[3] >= z0) s.add(j); } return [...s].sort((a, b) => a - b); };
  const heading = (pts, atStart) => { const [a, b] = atStart ? [pts[0], pts[1]] : [pts[pts.length - 1], pts[pts.length - 2]]; return norm(a[0] - b[0], a[1] - b[1]); };
  // a continuation: shares an end node with this way, roughly straight on, same name / class
  const continues = (a, b) => {
    const ends = [[a.nodes[0], true], [a.nodes[a.nodes.length - 1], false]];
    for (const [n, aStart] of ends) for (const [m, bStart] of [[b.nodes[0], true], [b.nodes[b.nodes.length - 1], false]]) {
      if (n === undefined || n !== m) continue;
      const da = heading(a.pts, aStart), db = heading(b.pts, bStart);
      if (da[0] * db[0] + da[1] * db[1] < -0.85 && (a.tags.name || '') === (b.tags.name || '') && a.tags.highway === b.tags.highway) return true;
    }
    return false;
  };

  const paint = { [MAT.yellow]: [], [MAT.white]: [] };
  let centreLines = 0, dividers = 0;
  ways.forEach((w, i) => {
    const t = w.tags;
    if (t.lane_markings === 'no' || /^(service|busway|living_street)$/.test(t.highway)) return;
    const lanesTag = parseInt(t.lanes, 10);
    const minor = /^(residential|unclassified)$/.test(t.highway);
    if (minor && !(lanesTag >= 2)) return; // SF residential streets: no painted lines unless lanes are tagged
    const L = lanesTag >= 1 ? lanesTag : Math.max(1, Math.round(w.width / 3.3));
    const oneway = t.oneway === 'yes' || t.oneway === '1' || t.oneway === '-1' || /motorway/.test(t.highway) || t.junction === 'roundabout';
    const lines = [];
    if (!oneway && L >= 2) {
      // double yellow centre line (US): two 10 cm lines 10 cm apart, offset to the lane split
      const fwd = parseInt(t['lanes:forward'], 10), bwd = parseInt(t['lanes:backward'], 10);
      const c = fwd >= 1 && bwd >= 1 ? (bwd - fwd) / L * w.width / 2 : 0;
      for (const d of [-0.1, 0.1]) lines.push({ mat: MAT.yellow, pts: shift(w.pts, c + d), half: 0.05 });
      centreLines++;
      // white dividers inside each direction
      const per = w.width / L;
      for (let k = 1; k < L; k++) {
        const d = -w.width / 2 + k * per;
        if (Math.abs(d - c) < per * 0.5) continue;
        for (const p of dashes(shift(w.pts, d))) lines.push({ mat: MAT.white, pts: p, half: 0.05 });
        dividers++;
      }
    } else if (L >= 2) {
      const per = w.width / L;
      for (let k = 1; k < L; k++) { for (const p of dashes(shift(w.pts, -w.width / 2 + k * per))) lines.push({ mat: MAT.white, pts: p, half: 0.05 }); dividers++; }
    }
    if (!lines.length) return;
    const zone = union(neighbours(i).filter(j => !continues(w, ways[j])).flatMap(j => offset(buffers[j], 1.5)));
    for (const l of lines) {
      if (l.pts.length < 2) continue;
      paint[l.mat].push(...diff(bufferLine(l.pts, l.half, 'butt'), zone));
    }
  });
  log.centreLines = centreLines; log.dividers = dividers;

  // ---- crosswalks (D46, D56 ladder style): crossing nodes on road ways, and the legs of signalised junctions
  // that have no crossing node of their own within 25 m
  const wayAtNode = new Map();
  for (const w of ways) w.nodes.forEach((n, k) => { if (!wayAtNode.has(n)) wayAtNode.set(n, []); wayAtNode.get(n).push([w, k]); });
  const crosswalks = []; // { centre, dir (along road), width (across), style }
  const crossingNodes = els.filter(e => e.type === 'node' && e.tags?.highway === 'crossing' && wayAtNode.has(e.id));
  const marked = n => { const m = n.tags['crossing:markings'], c = n.tags.crossing; return m ? m !== 'no' && m !== 'surface' : c !== 'unmarked' && c !== 'no'; };
  const styleOf = n => { const m = n.tags['crossing:markings'] || ''; return /lines|dashes/.test(m) ? 'lines' : /ladder/.test(m) ? 'ladder' : 'zebra'; };
  const dirAt = (w, k) => { const a = w.pts[Math.max(0, k - 1)], b = w.pts[Math.min(w.pts.length - 1, k + 1)]; return norm(b[0] - a[0], b[1] - a[1]); };
  for (const n of crossingNodes) {
    if (!marked(n)) continue;
    const [w, k] = wayAtNode.get(n.id)[0];
    crosswalks.push({ centre: w.pts[k], dir: dirAt(w, k), width: w.width, style: styleOf(n), node: n.id });
  }
  const crossPts = crosswalks.map(c => c.centre);
  let signalLegs = 0;
  for (const n of els) {
    if (n.type !== 'node' || n.tags?.highway !== 'traffic_signals' || !wayAtNode.has(n.id)) continue;
    const inc = wayAtNode.get(n.id);
    if (inc.length < 2) continue;
    const reach = Math.max(...inc.map(([w]) => w.width / 2));
    for (const [w, k] of inc) for (const step of [-1, 1]) {
      if (k + step < 0 || k + step >= w.pts.length) continue;
      const p = w.pts[k], q = w.pts[k + step], d = norm(q[0] - p[0], q[1] - p[1]);
      const at = reach + 1.5 + XW / 2;
      if (Math.hypot(q[0] - p[0], q[1] - p[1]) < at) continue;
      const c = [p[0] + d[0] * at, p[1] + d[1] * at];
      if (crossPts.some(([x, z]) => Math.hypot(x - c[0], z - c[1]) < 25)) continue;
      crosswalks.push({ centre: c, dir: d, width: w.width, style: 'ladder', node: n.id });
      signalLegs++;
    }
  }
  // unmarked crossings (California: every leg of an intersection carries a legal crosswalk, marked or not): a
  // walkable band without paint on each junction leg that has no marked crosswalk within 15 m
  let unmarked = 0;
  const marks = crosswalks.map(c => c.centre);
  const ends = new Map();
  for (const w of ways) w.nodes.forEach((n, k) => ends.set(n, (ends.get(n) || 0) + (k === 0 || k === w.nodes.length - 1 ? 1 : 2)));
  for (const [n, c] of ends) {
    if (c < 3 || !wayAtNode.has(n)) continue;
    const inc = wayAtNode.get(n);
    for (const [w, k] of inc) for (const step of [-1, 1]) {
      if (k + step < 0 || k + step >= w.pts.length) continue;
      const others = inc.filter(([o]) => o !== w);
      if (!others.length) continue;
      const reach = Math.max(...others.map(([o]) => o.width / 2));
      const p = w.pts[k], q = w.pts[k + step], d = norm(q[0] - p[0], q[1] - p[1]);
      const at = reach + 1.5;
      if (Math.hypot(q[0] - p[0], q[1] - p[1]) < at + 2) continue;
      const cpt = [p[0] + d[0] * at, p[1] + d[1] * at];
      if (marks.some(([x, z]) => Math.hypot(x - cpt[0], z - cpt[1]) < 15)) continue;
      crosswalks.push({ centre: cpt, dir: d, width: w.width, style: 'unmarked', node: n });
      unmarked++;
    }
  }
  log.unmarkedCrossings = unmarked;
  const crossBands = [], white = paint[MAT.white];
  for (const c of crosswalks) {
    const [dx, dz] = c.dir, nx = dz, nz = -dx, half = c.width / 2 + 0.5;
    const rect = (a0, a1, b0, b1) => toPath([[a0, b0], [a1, b0], [a1, b1], [a0, b1]].map(([a, b]) => [c.centre[0] + dx * a + nx * b, c.centre[1] + dz * a + nz * b]));
    crossBands.push(c.style === 'unmarked' ? rect(-2, 2, -half, half) : rect(-XW / 2, XW / 2, -half, half));
    if (c.style === 'unmarked') continue;
    if (c.style !== 'lines') for (let b = -half + 0.3; b + 0.6 <= half; b += 1.2) white.push(rect(-XW / 2, XW / 2, b, b + 0.6));
    if (c.style !== 'zebra') for (const a of [-XW / 2, XW / 2 - 0.3]) white.push(rect(a, a + 0.3, -half, half));
  }
  log.crosswalks = crosswalks.length - unmarked; log.signalLegCrosswalks = signalLegs;
  // centre lines and dividers stop at crosswalks
  const bands = union(crossBands.map(p => [p]).flat());
  const yellow = diff(inter(union(paint[MAT.yellow]), R), offset(bands, 0.5));
  const whiteAll = inter(union(white), R);

  // ---- tram / light rail at ground: rails (standard gauge) and the trackway they sit in where it is not road
  const railWays = els.filter(e => e.type === 'way' && /^(tram|light_rail)$/.test(e.tags?.railway) && e.geometry?.length >= 2 &&
    !(e.tags.tunnel && e.tags.tunnel !== 'no') && !(e.tags.bridge && e.tags.bridge !== 'no') && !(+e.tags.layer) && !e.tags.level);
  const railPaths = [], trackPaths = [];
  for (const r of railWays) {
    const pts = r.geometry.map(g => local(g.lat, g.lon));
    trackPaths.push(...bufferLine(pts, 1.5));
    for (const d of [-0.7175, 0.7175]) railPaths.push(...bufferLine(shift(pts, d), 0.045, 'butt'));
  }
  const T = diff(diff(inter(union(trackPaths), boxPaths), R), B);
  const rails = inter(union(railPaths), union(R, T));
  log.railWays = railWays.length;

  // ---- final surfaces: asphalt and trackway are the base (no overlaps between them); paint and rails are
  // decals 12 mm above it (D46), so the base stays simple
  const surfaces = [
    { mat: MAT.asphalt, paths: R, level: 'road' },
    { mat: MAT.trackway, paths: T, level: 'road' },
    { mat: MAT.yellow, paths: diff(yellow, rails), level: 'paint' },
    { mat: MAT.white, paths: diff(diff(whiteAll, rails), yellow), level: 'paint' },
    { mat: MAT.rail, paths: rails, level: 'paint' },
  ];
  // service roads (driveways, pier and lot access): where they cross a sidewalk strip, pedestrians keep right of way
  const serviceR = inter(union(ways.flatMap((w, i) => w.tags.highway === 'service' ? buffers[i] : [])), R);
  return { ways, R, T, crossBands: inter(bands, union(R, T)), serviceR, surfaces, log, crosswalks };
}
