// The street-level route along the Embarcadero (G10's scripted walk, G12b's and G13's camera path): from the Ferry
// Building to Pier 39 on the bay-side sidewalk of the northbound carriageway, as a walkable polyline.
import { local } from '../../pipelines/street/context.mjs';

export const FERRY = [37.79555, -122.39350], PIER39 = [37.80860, -122.40960];

// ---- the route: the Embarcadero's northbound carriageway (bay side = right of travel) from the Ferry Building
// to Pier 39, 1.5 m into the sidewalk from its curb edge (or the middle of a narrower one)
export function route(ctx, ways, ground) {
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

export function astar(ground, a, b, erode = 0) {
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

