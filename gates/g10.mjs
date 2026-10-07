// G10 Sidewalks + walkability.
//  (a) Every road side in built-up blocks has a curb and a sidewalk: each side of a sidewalk-bearing road class
//      that faces buildings (within 35 m) is sampled every 5 m; just past the carriageway edge there must be
//      walkway (or another road / a walkable crossing: corners, driveways), a curb above the road.
//      Sides OSM tags as having no sidewalk are left out (logged).
//  (b) A scripted walk from the Ferry Building to Pier 39 along the Embarcadero's bay-side sidewalk, by the real
//      Player in the real App (headless, physics only) on the street surface: every frame the feet must be on a
//      walkable triangle at its height (not under it), and the walk must arrive.
// --negative: a 6 m sidewalk gap cut on the route must fail the walk; a pipeline without curbs (sidewalks at road
// height) must fail (a); sidewalks dropped from a block must fail (a).
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildStreet, writeStreet } from '../pipelines/street/build.mjs';
import { sidewalkSides, CLASS_SIDEWALK, CURB } from '../pipelines/street/osm.mjs';
import { Region } from '../pipelines/street/geom.mjs';
import { readStreet, root } from './lib/street.mjs';
import { StreetGround } from '../src/street/Ground.js';
import { local, loadContext, elements } from '../pipelines/street/context.mjs';

const NEG = process.argv.includes('--negative');
const FERRY = [37.79555, -122.39350], PIER39 = [37.80860, -122.40960];

// ---- (b) the walk, in a child process (one App per process)
if (process.argv.includes('--walk')) {
  const routeFile = process.argv[process.argv.indexOf('--walk') + 1];
  const fixture = process.argv.includes('--street') ? process.argv[process.argv.indexOf('--street') + 1] : null;
  const route = JSON.parse(readFileSync(routeFile, 'utf8'));
  const { bootApp } = await import('harbor-engine/tools/headless/app.mjs');
  const { attachStreet } = await import('../src/street/index.js');
  const H = await bootApp({ width: 320, height: 240, query: '?noAudio&tier=low' });
  const app = H.app;
  app.renderEnabled = false;
  const street = await attachStreet(app, { data: fixture ? readStreet(fixture) : null });
  const pl = app.player, g = street.ground;
  if (app.freeCam) app.setFreeCam(false);
  pl.mode = 'walk';
  pl.position.set(route[0][0], g.heightAt(route[0][0], route[0][1]) ?? pl.terrain.heightAt(route[0][0], route[0][1]), route[0][1]);
  pl.velocity.set(0, 0, 0);
  const dt = 1 / 30;
  let frames = 0, off = 0, under = 0, firstOff = null, firstUnder = null, maxDev = 0;
  // the route as arc length; pure pursuit: steer at the point 1.5 m past the player's projection on the route
  const cum = [0];
  for (let i = 1; i < route.length; i++) cum.push(cum[i - 1] + Math.hypot(route[i][0] - route[i - 1][0], route[i][1] - route[i - 1][1]));
  const L = cum[cum.length - 1];
  const at = s => { let i = 1; while (i < route.length - 1 && cum[i] < s) i++; const t = (s - cum[i - 1]) / Math.max(1e-9, cum[i] - cum[i - 1]); return [route[i - 1][0] + (route[i][0] - route[i - 1][0]) * Math.min(1, t), route[i - 1][1] + (route[i][1] - route[i - 1][1]) * Math.min(1, t)]; };
  let seg = 1, prog = 0;
  const limit = Math.ceil(L / 2.0 / dt) + 600;
  app.input.keys.add('KeyW');
  while (frames < limit) {
    const p = pl.position;
    // project onto the route near the current segment
    let best = Infinity;
    for (let i = Math.max(1, seg - 2); i < Math.min(route.length, seg + 8); i++) {
      const [ax, az] = route[i - 1], [bx, bz] = route[i], dx = bx - ax, dz = bz - az, l2 = dx * dx + dz * dz;
      const t = l2 > 0 ? Math.max(0, Math.min(1, ((p.x - ax) * dx + (p.z - az) * dz) / l2)) : 0;
      const d = Math.hypot(p.x - ax - t * dx, p.z - az - t * dz);
      if (d < best) { best = d; seg = i; prog = cum[i - 1] + t * Math.sqrt(l2); }
    }
    if (prog >= L - 0.6) break;
    const [tx, tz] = at(Math.min(L, prog + 1.5));
    pl.yaw = Math.atan2(-(tx - p.x), -(tz - p.z));
    app.frame(dt);
    await H.settle();
    frames++;
    const s = g.at(p.x, p.z);
    if (!s || !s.walkable) { off++; firstOff = firstOff || [+p.x.toFixed(1), +p.z.toFixed(1), s ? s.mat : null, frames]; }
    else if (p.y < s.y - 0.05) { under++; firstUnder = firstUnder || [+p.x.toFixed(1), +p.z.toFixed(1), +(s.y - p.y).toFixed(2)]; }
    if (s) maxDev = Math.max(maxDev, Math.abs(p.y - s.y));
  }
  const next = prog >= L - 0.6 ? route.length : 0;
  app.input.keys.delete('KeyW');
  console.log('RUN ' + JSON.stringify({ arrived: next >= route.length, frames, seconds: frames * dt, length: L, off, under, firstOff, firstUnder, maxDev, errors: H.errors.length }));
  process.exit(0);
}

function walk(route, streetDir = null) {
  const d = mkdtempSync(join(tmpdir(), 'g10-'));
  writeFileSync(join(d, 'route.json'), JSON.stringify(route));
  const r = spawnSync(process.execPath, [fileURLToPath(import.meta.url), '--walk', join(d, 'route.json'), ...(streetDir ? ['--street', streetDir] : [])], { cwd: root, encoding: 'utf8', maxBuffer: 1 << 26 });
  rmSync(d, { recursive: true, force: true });
  const line = (r.stdout || '').split('\n').find(l => l.startsWith('RUN '));
  if (!line) throw new Error('walk crashed: ' + (r.stderr || r.stdout || '').slice(-1500));
  return JSON.parse(line.slice(4));
}
const judgeWalk = w => {
  const f = [];
  if (!w.arrived) f.push(`walk: did not reach Pier 39 (${w.frames} frames, ${w.seconds.toFixed(0)} s for a ${w.length.toFixed(0)} m route)`);
  if (w.off) f.push(`walk: ${w.off} frames off the walkable surface (first at ${JSON.stringify(w.firstOff)})`);
  if (w.under) f.push(`walk: ${w.under} frames under the surface (first at ${JSON.stringify(w.firstUnder)})`);
  if (w.errors) f.push(`walk: ${w.errors} console/GPU errors`);
  return f;
};

// ---- the route: the Embarcadero's northbound carriageway (bay side = right of travel) from the Ferry Building
// to Pier 39, 1.5 m into the sidewalk from its curb edge (or the middle of a narrower one)
function route(ctx, ways, ground) {
  const emb = ways.filter(w => w.tags.name === 'The Embarcadero');
  const [fx, fz] = local(...FERRY), [px, pz] = local(...PIER39);
  // northbound = heading towards Pier 39 (north-west here: x falls, z falls)
  const north = w => { const a = w.pts[0], b = w.pts[w.pts.length - 1]; return (b[0] - a[0]) * (px - fx) + (b[1] - a[1]) * (pz - fz) > 0; };
  const oneNorth = emb.filter(w => (w.tags.oneway === 'yes') && north(w));
  let cur = oneNorth.map(w => ({ w, d: Math.min(...w.pts.map(([x, z]) => Math.hypot(x - fx, z - fz))) })).sort((a, b) => a.d - b.d)[0].w;
  const chain = [cur];
  for (let k = 0; k < 60; k++) {
    const end = cur.nodes[cur.nodes.length - 1];
    const nxt = emb.find(w => w !== cur && w.nodes[0] === end && !chain.includes(w));
    const [ex, ez] = cur.pts[cur.pts.length - 1];
    if (!nxt || Math.hypot(ex - px, ez - pz) < 60) break;
    chain.push(nxt); cur = nxt;
  }
  const pts = [];
  for (const w of chain) for (const p of w.pts) { const q = pts[pts.length - 1]; if (!q || q[0] !== p[0] || q[1] !== p[1]) pts.push(p); }
  // start at the point nearest the Ferry Building, stop nearest Pier 39
  const near = ([x, z]) => pts.reduce((b, p, i) => Math.hypot(p[0] - x, p[1] - z) < Math.hypot(pts[b][0] - x, pts[b][1] - z) ? i : b, 0);
  const seg = pts.slice(near([fx, fz]), near([px, pz]) + 1);
  // anchors: the sidewalk's middle (capped 1.5 m in from the kerb edge) every 10 m along the carriageway
  const anchors = [], missing = [];
  for (let i = 0; i + 1 < seg.length; i++) {
    const [ax, az] = seg[i], [bx, bz] = seg[i + 1], L = Math.hypot(bx - ax, bz - az);
    const dx = (bx - ax) / L, dz = (bz - az) / L, rx = -dz, rz = dx; // right of travel
    const w = chain.find(c => c.pts.some(p => p[0] === ax && p[1] === az))?.width ?? 10;
    for (let s = 0; s < L; s += 10) {
      const cx = ax + dx * s, cz = az + dz * s;
      let first = null, last = null;
      for (let o = w / 2 - 0.5; o <= w / 2 + 16; o += 0.25) {
        const q = ground.at(cx + rx * o, cz + rz * o);
        const ok = q && q.walkable;
        if (ok && first === null) first = o;
        if (ok) last = o; else if (first !== null) break;
      }
      if (first === null) { missing.push([+cx.toFixed(1), +cz.toFixed(1)]); continue; }
      const o = first + Math.min(1.5, (last - first) / 2);
      anchors.push([cx + rx * o, cz + rz * o]);
    }
  }
  // between anchors: the shortest walkable path (A* on a 0.5 m grid, kept 0.5 m off the walkable edge where it
  // can be), string-pulled
  const out = [anchors[0]];
  let unreachable = 0;
  for (let k = 1; k < anchors.length; k++) {
    // plan 0.5 m clear of the walkable edge where there is room, else on the walkable surface itself
    const p = astar(ground, out[out.length - 1], anchors[k], 1) || astar(ground, out[out.length - 1], anchors[k], 0);
    if (!p) { unreachable++; missing.push(anchors[k].map(v => +v.toFixed(1))); continue; }
    out.push(...p.slice(1));
  }
  return { route: out, missing, chain: chain.map(w => w.id), anchors: anchors.length, unreachable };
}

function astar(ground, a, b, erode = 0) {
  const C = 0.5, pad = 30;
  const x0 = Math.min(a[0], b[0]) - pad, z0 = Math.min(a[1], b[1]) - pad;
  const W = Math.ceil((Math.abs(a[0] - b[0]) + 2 * pad) / C), H = Math.ceil((Math.abs(a[1] - b[1]) + 2 * pad) / C);
  const walk = new Uint8Array(W * H);
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) { const q = ground.at(x0 + (i + 0.5) * C, z0 + (j + 0.5) * C); walk[j * W + i] = q && q.walkable ? 1 : 0; }
  // erode: cells within `erode` cells of a non-walkable one are closed (the start and goal stay open)
  for (let e = 0; e < erode; e++) {
    const keep = walk.slice();
    for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) if (keep[j * W + i]) for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) { const ii = i + di, jj = j + dj; if (ii < 0 || jj < 0 || ii >= W || jj >= H || !keep[jj * W + ii]) walk[j * W + i] = 0; }
  }
  { const [i0, j0] = [Math.floor((a[0] - x0) / C), Math.floor((a[1] - z0) / C)], [i1, j1] = [Math.floor((b[0] - x0) / C), Math.floor((b[1] - z0) / C)]; if (erode) { const open = (i, j) => { for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) { const ii = i + di, jj = j + dj; if (ii >= 0 && jj >= 0 && ii < W && jj < H) { const q = ground.at(x0 + (ii + 0.5) * C, z0 + (jj + 0.5) * C); if (q && q.walkable) walk[jj * W + ii] = 1; } } }; open(i0, j0); open(i1, j1); } }
  // cost 1 per cell, 4 within 0.5 m of a non-walkable cell
  const cost = new Float32Array(W * H);
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
    if (!walk[j * W + i]) continue;
    let edge = false;
    for (let dj = -1; dj <= 1 && !edge; dj++) for (let di = -1; di <= 1; di++) { const ii = i + di, jj = j + dj; if (ii < 0 || jj < 0 || ii >= W || jj >= H || !walk[jj * W + ii]) { edge = true; break; } }
    cost[j * W + i] = edge ? 4 : 1;
  }
  const cell = ([x, z]) => [Math.floor((x - x0) / C), Math.floor((z - z0) / C)];
  const [si, sj] = cell(a), [ti, tj] = cell(b);
  if (!walk[sj * W + si] || !walk[tj * W + ti]) return null;
  const g = new Float32Array(W * H).fill(Infinity), from = new Int32Array(W * H).fill(-1);
  const heap = [[0, sj * W + si]];
  g[sj * W + si] = 0;
  const h = k => Math.hypot(k % W - ti, Math.floor(k / W) - tj);
  const push = (f, k) => { heap.push([f, k]); let n = heap.length - 1; while (n > 0) { const p = (n - 1) >> 1; if (heap[p][0] <= heap[n][0]) break; [heap[p], heap[n]] = [heap[n], heap[p]]; n = p; } };
  const pop = () => { const top = heap[0], last = heap.pop(); if (heap.length) { heap[0] = last; let n = 0; for (;;) { const l = 2 * n + 1, r = l + 1; let m = n; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m === n) break; [heap[m], heap[n]] = [heap[n], heap[m]]; n = m; } } return top; };
  const goal = tj * W + ti;
  while (heap.length) {
    const [, k] = pop();
    if (k === goal) break;
    const i = k % W, j = Math.floor(k / W);
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
      if (!di && !dj) continue;
      const ii = i + di, jj = j + dj;
      if (ii < 0 || jj < 0 || ii >= W || jj >= H) continue;
      const n = jj * W + ii;
      if (!walk[n] || (di && dj && (!walk[j * W + ii] || !walk[jj * W + i]))) continue;
      const ng = g[k] + cost[n] * (di && dj ? Math.SQRT2 : 1);
      if (ng < g[n]) { g[n] = ng; from[n] = k; push(ng + h(n), n); }
    }
  }
  if (from[goal] < 0 && goal !== sj * W + si) return null;
  const cells = [];
  for (let k = goal; k >= 0; k = from[k]) cells.push(k);
  cells.reverse();
  const pts = cells.map(k => [x0 + (k % W + 0.5) * C, z0 + (Math.floor(k / W) + 0.5) * C]);
  // string-pull: skip ahead while the straight line stays on cost-1 cells
  const clear = (p, q) => { const n = Math.ceil(Math.hypot(q[0] - p[0], q[1] - p[1]) / 0.25); for (let s = 0; s <= n; s++) { const [ci, cj] = cell([p[0] + (q[0] - p[0]) * s / n, p[1] + (q[1] - p[1]) * s / n]); const k = cj * W + ci; if (!walk[k] || cost[k] > 1) return false; } return true; };
  const out = [a];
  let i = 0;
  while (i < pts.length - 1) {
    let j = pts.length - 1;
    while (j > i + 1 && !clear(out[out.length - 1], pts[j])) j--;
    out.push(pts[j]); i = j;
  }
  out[out.length - 1] = b;
  return out;
}

// curb faces in the mesh (vertical quads of materials 7–12; data.w = 1 on their top edge): segment and height,
// bucketed by 6 m cell
const segDist = (x, z, s) => { const dx = s.x2 - s.x, dz = s.z2 - s.z, L = dx * dx + dz * dz, t = L > 0 ? Math.max(0, Math.min(1, ((x - s.x) * dx + (z - s.z) * dz) / L)) : 0; return Math.hypot(x - s.x - t * dx, z - s.z - t * dz); };
function curbIndex({ pos, dat, indices }) {
  const cells = new Map();
  for (let t = 0; t < indices.length; t += 3) {
    const ks = [indices[t], indices[t + 1], indices[t + 2]];
    const m = dat[ks[0] * 4];
    if (m < 7) continue;
    const bot = ks.filter(k => dat[k * 4 + 3] === 0), top = ks.filter(k => dat[k * 4 + 3] === 1);
    if (!bot.length || !top.length) continue;
    const P = k => [pos[k * 3], pos[k * 3 + 1], pos[k * 3 + 2]];
    // height: a top vertex straight above a bottom vertex; the segment: the triangle's extent in plan
    let h = null;
    for (const kb of bot) for (const kt of top) { const b = P(kb), u = P(kt); if (Math.abs(b[0] - u[0]) < 1e-4 && Math.abs(b[2] - u[2]) < 1e-4) h = u[1] - b[1]; }
    if (h === null) continue;
    const pts = ks.map(P), far = pts.slice(1).reduce((m, p) => Math.hypot(p[0] - pts[0][0], p[2] - pts[0][2]) > Math.hypot(m[0] - pts[0][0], m[2] - pts[0][2]) ? p : m, pts[0]);
    const seg = { x: pts[0][0], z: pts[0][2], x2: far[0], z2: far[2], h };
    const key = Math.floor(seg.z / 6) * 100000 + Math.floor(seg.x / 6);
    if (!cells.has(key)) cells.set(key, []);
    cells.get(key).push(seg);
  }
  return { near(x, z, r) { const out = []; for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) for (const s of cells.get((Math.floor(z / 6) + j) * 100000 + Math.floor(x / 6) + i) || []) if (segDist(x, z, s) < r) out.push(s); return out; } };
}

// ---- (a) sidewalks along road sides in built-up blocks
function sidewalks(ctx, ways, ground, curbs) {
  const bld = ctx.buildingRegion, boxes = new Region(ctx.boxes.map(b => [b.ring]));
  let sides = 0, bad = 0, samples = 0, okSamples = 0, taggedNo = 0, noCurb = 0, noRoom = 0, median = 0;
  const worst = [];
  for (const w of ways) {
    if (CLASS_SIDEWALK[w.tags.highway] === undefined) continue;
    const sw = sidewalkSides(w.tags);
    for (const side of [1, -1]) {
      const has = side === 1 ? sw.left : sw.right;
      if (!has && sw.tagged) { taggedNo++; continue; }
      let n = 0, ok = 0, curbOk = 0, built = 0, L0 = 0;
      for (let i = 0; i + 1 < w.pts.length; i++) {
        const [ax, az] = w.pts[i], [bx, bz] = w.pts[i + 1], L = Math.hypot(bx - ax, bz - az);
        if (L === 0) continue;
        const dx = (bx - ax) / L, dz = (bz - az) / L, nx = dz * side, nz = -dx * side; // left of travel for side = 1
        let total = 0; for (let k = 0; k + 1 < w.pts.length; k++) total += Math.hypot(w.pts[k + 1][0] - w.pts[k][0], w.pts[k + 1][1] - w.pts[k][1]);
        for (let s = 2.5; s < L; s += 5) {
          const along = L0 + s;
          if (along < 12 || along > total - 12) continue; // junction ends
          const cx = ax + dx * s, cz = az + dz * s;
          const o = w.width / 2;
          if (!boxes.contains(cx, cz) || !boxes.contains(cx + nx * (o + 3), cz + nz * (o + 3)) || ctx.height.at(cx, cz) < 0.5) continue;
          if (bld.distance(cx + nx * (o + 4), cz + nz * (o + 4), 35) === Infinity && !bld.contains(cx + nx * (o + 4), cz + nz * (o + 4))) continue; // not built up
          built++;
          // no room: a building within 1.8 m of the carriageway edge (alleys whose default width reaches the
          // building line, D45) cannot carry a sidewalk; counted, not judged
          if (bld.contains(cx + nx * (o + 0.9), cz + nz * (o + 0.9)) || bld.distance(cx + nx * (o + 0.9), cz + nz * (o + 0.9), 0.9) < Infinity) { built--; noRoom++; continue; }
          // a median side (another carriageway or a busway right past this one) is not a block edge
          const m2 = ground.at(cx + nx * (o + 2.5), cz + nz * (o + 2.5));
          if (m2 && m2.mat <= 4 && !m2.walkable) { built--; median++; continue; }
          const q = ground.at(cx + nx * (o + 0.8), cz + nz * (o + 0.8));
          const r = ground.at(cx + nx * (o - 0.6), cz + nz * (o - 0.6));
          if (!q) continue; // a building or open ground right at the kerb line: judged below by the share
          n++;
          if (q.walkable || q.mat <= 4) {
            ok++;
            if (q.mat === 5 || q.mat === 6) {
              // a curb face of 15 cm (± 3 cm) within 1.5 m of the kerb point
              const near = curbs.near(cx + nx * o, cz + nz * o, 1.5);
              if (near.some(c => Math.abs(c.h - CURB) < 0.03)) curbOk++; else noCurb++;
            }
          }
        }
        L0 += L;
      }
      if (built < 3) continue;
      sides++;
      samples += built; okSamples += ok;
      // a side passes when it misses walkway / crossing / road at no more than max( 1, 10 % ) of its built-up samples
      if (built - ok > Math.max(1, 0.1 * built)) { bad++; worst.push([w.id, side > 0 ? 'left' : 'right', `${ok}/${built}`]); }
    }
  }
  return { sides, bad, samples, okSamples, taggedNo, noCurb, noRoom, median, worst: worst.slice(0, 8) };
}

// ---- run
const full = await buildStreet();
const shipped = readStreet(join(root, 'public/street'));
const { ctx } = full;
const ground = new StreetGround(shipped, ctx.height.gridOrigin);
const judgeSide = a => a.bad || a.noCurb > 0.01 * a.samples ? [`sidewalks: ${a.bad}/${a.sides} built-up road sides lack a sidewalk on ≥ 10 % of their length (e.g. ${JSON.stringify(a.worst.slice(0, 3))}); ${a.noCurb} walkway samples without a 15 cm curb`] : [];
const R = route(ctx, full.roads.ways, ground);

if (!NEG) {
  const fail = [];
  const a = sidewalks(ctx, full.roads.ways, ground, curbIndex(shipped));
  console.log(`sidewalks: ${a.sides} built-up road sides, ${a.bad} short of sidewalk; ${a.okSamples}/${a.samples} samples ok; ${a.noCurb} without a curb; ${a.taggedNo} sides tagged without sidewalk (left out); ${a.noRoom} samples with no room (building within 1.8 m), ${a.median} on median sides`);
  fail.push(...judgeSide(a));
  if (R.missing.length) fail.push(`route: ${R.missing.length} of ${R.anchors} places on the Embarcadero with no bay-side sidewalk or no walkable way to it (first ${JSON.stringify(R.missing[0])})`);
  const w = walk(R.route);
  console.log(`walk: ${w.length.toFixed(0)} m route over ${R.chain.length} Embarcadero ways, ${w.arrived ? 'arrived' : 'did not arrive'} in ${w.seconds.toFixed(0)} s; ${w.off} frames off the walkable surface, ${w.under} under it; max height deviation ${w.maxDev.toFixed(3)} m`);
  fail.push(...judgeWalk(w));
  if (fail.length) { console.log('G10 FAIL\n- ' + fail.join('\n- ')); process.exit(1); }
  console.log(`G10 PASS — ${a.sides} built-up road sides all have curb + sidewalk; Ferry Building → Pier 39 walk (${w.length.toFixed(0)} m) stayed on the walkable surface`);
  process.exit(0);
}

const MUT = {};
MUT['a 6 m sidewalk gap on the route'] = async () => {
  const mid = R.route[Math.floor(R.route.length / 2)];
  const r = await buildStreet({ walkOptions: { gapAt: mid } });
  const d = mkdtempSync(join(tmpdir(), 'g10fx-'));
  writeStreet(r, { out: join(d, 'out'), logFile: join(d, 'log.json') });
  const w = walk(R.route, join(d, 'out'));
  rmSync(d, { recursive: true, force: true });
  return judgeWalk(w);
};
MUT['no curbs (walkways at road height)'] = async () => {
  const pos = shipped.pos.slice();
  for (let i = 0; i < pos.length / 3; i++) if (shipped.dat[i * 4] === 5 || shipped.dat[i * 4] === 6) pos[i * 3 + 1] -= CURB;
  // and no curb faces
  const ix = shipped.indices.slice();
  for (let t = 0; t < ix.length; t += 3) if (shipped.dat[ix[t] * 4] >= 7) ix[t] = ix[t + 1] = ix[t + 2] = 0;
  return judgeSide(sidewalks(ctx, full.roads.ways, new StreetGround({ ...shipped, pos }, ctx.height.gridOrigin), curbIndex({ ...shipped, pos, indices: ix })));
};
MUT['sidewalks dropped along a block'] = async () => {
  // every walkway triangle within 150 m of Washington Square removed
  const [cx, cz] = local(37.8008, -122.4101);
  const ix = shipped.indices.slice(), v = shipped.vertices;
  for (let t = 0; t < ix.length; t += 3) { const a = ix[t] * 10; if ((Math.round(v[a + 6]) === 5) && Math.hypot(v[a] - cx, v[a + 2] - cz) < 150) ix[t] = ix[t + 1] = ix[t + 2] = 0; }
  return judgeSide(sidewalks(ctx, full.roads.ways, new StreetGround({ ...shipped, indices: ix }, ctx.height.gridOrigin), curbIndex(shipped)));
};
let missed = 0;
for (const [name, run] of Object.entries(MUT)) {
  const f = await run();
  console.log(`${f.length ? 'caught  ' : 'MISSED  '} ${name}${f.length ? ' — ' + f[0] : ''}`);
  if (!f.length) missed++;
}
console.log(`NEGATIVE ${Object.keys(MUT).length - missed}/${Object.keys(MUT).length}`);
process.exit(missed ? 0 : 1);
