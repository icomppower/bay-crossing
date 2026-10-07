// Shared helpers for the street gates (G9–G12b): reading the baked street mesh, point → triangle lookups on
// the 6 m mesh cells, and offline double runs of the street pipeline.
import { spawnSync } from 'node:child_process';
import { readFileSync, readdirSync, mkdtempSync, rmSync, existsSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BLOCK as CELL } from '../../pipelines/street/mesh.mjs';

export const root = join(dirname(fileURLToPath(import.meta.url)), '../..');

// A street output dir → { index, pos, nrm, dat, indices } (the shipped layout) plus `vertices`: the pipeline's
// 10-float stride (x y z, nx ny nz, material, angle, walkable, wall) for the gate checks.
export function readStreet(dir) {
  const index = JSON.parse(readFileSync(join(dir, 'street.json'), 'utf8'));
  const body = inflateSync(readFileSync(join(dir, 'surface.bin.deflate')));
  const n = index.vertices, ab = body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength);
  const pos = new Float32Array(ab, 0, n * 3), nrm = new Int8Array(ab, n * 12, n * 4), dat = new Uint8Array(ab, n * 16, n * 4);
  const indices = new Uint32Array(ab, n * 20, index.indices);
  const vertices = new Float32Array(n * 10);
  for (let i = 0; i < n; i++) {
    const o = i * 10;
    vertices[o] = pos[i * 3]; vertices[o + 1] = pos[i * 3 + 1]; vertices[o + 2] = pos[i * 3 + 2];
    vertices[o + 3] = nrm[i * 4] / 127; vertices[o + 4] = nrm[i * 4 + 1] / 127; vertices[o + 5] = nrm[i * 4 + 2] / 127;
    vertices[o + 6] = dat[i * 4]; vertices[o + 7] = dat[i * 4 + 1] / 255 * 2 * Math.PI - Math.PI; vertices[o + 8] = dat[i * 4 + 2]; vertices[o + 9] = dat[i * 4 + 3];
  }
  return { index, pos, nrm, dat, indices, vertices };
}

// Triangles bucketed by the mesh cell that holds them (every draped triangle lies in one 6 m cell).
export class TriIndex {
  constructor({ vertices, indices }, gridOrigin, keep = () => true, stride = 10) {
    this.v = vertices; this.ix = indices; this.s = stride; this.o = gridOrigin;
    this.cells = new Map();
    this.tris = 0; this.area = 0;
    for (let t = 0; t < indices.length; t += 3) {
      const a = indices[t] * stride, b = indices[t + 1] * stride, c = indices[t + 2] * stride;
      if (!keep(vertices[a + 6], vertices[a + 1], t)) continue;
      const cx = (vertices[a] + vertices[b] + vertices[c]) / 3, cz = (vertices[a + 2] + vertices[b + 2] + vertices[c + 2]) / 3;
      const k = this.key(cx, cz);
      if (!this.cells.has(k)) this.cells.set(k, []);
      this.cells.get(k).push(t);
      this.tris++;
      this.area += Math.abs((vertices[b] - vertices[a]) * (vertices[c + 2] - vertices[a + 2]) - (vertices[b + 2] - vertices[a + 2]) * (vertices[c] - vertices[a])) / 2;
    }
  }
  key(x, z) { return Math.floor((z - this.o) / CELL) * 1e5 + Math.floor((x - this.o) / CELL); }
  // the triangle containing (x, z), or -1 (a point on a cell line is looked up on both sides)
  find(x, z) {
    const e = 1e-4;
    for (const [dx, dz] of [[0, 0], [e, 0], [-e, 0], [0, e], [0, -e]]) {
      const list = this.cells.get(this.key(x + dx, z + dz));
      if (!list) continue;
      for (const t of list) if (this.inTri(t, x, z)) return t;
    }
    return -1;
  }
  inTri(t, x, z) {
    const v = this.v, s = this.s, a = this.ix[t] * s, b = this.ix[t + 1] * s, c = this.ix[t + 2] * s;
    const d = (px, pz, qx, qz, rx, rz) => (qx - px) * (rz - pz) - (qz - pz) * (rx - px);
    const d1 = d(v[a], v[a + 2], v[b], v[b + 2], x, z), d2 = d(v[b], v[b + 2], v[c], v[c + 2], x, z), d3 = d(v[c], v[c + 2], v[a], v[a + 2], x, z);
    const e = 1e-7;
    return (d1 <= e && d2 <= e && d3 <= e) || (d1 >= -e && d2 >= -e && d3 >= -e);
  }
  // surface height of triangle t at (x, z)
  yAt(t, x, z) {
    const v = this.v, s = this.s, a = this.ix[t] * s, b = this.ix[t + 1] * s, c = this.ix[t + 2] * s;
    const det = (v[b + 2] - v[c + 2]) * (v[a] - v[c]) + (v[c] - v[b]) * (v[a + 2] - v[c + 2]);
    const l1 = ((v[b + 2] - v[c + 2]) * (x - v[c]) + (v[c] - v[b]) * (z - v[c + 2])) / det;
    const l2 = ((v[c + 2] - v[a + 2]) * (x - v[c]) + (v[a] - v[c]) * (z - v[c + 2])) / det;
    return l1 * v[a + 1] + l2 * v[b + 1] + (1 - l1 - l2) * v[c + 1];
  }
}

// Run the street pipeline twice from the cache with the network blocked; returns the two output dirs (caller
// removes them) or throws with the child's stderr.
export function offlineRuns(n = 2, env = {}) {
  const dirs = [];
  for (let k = 0; k < n; k++) {
    const d = mkdtempSync(join(tmpdir(), 'street-run-'));
    const r = spawnSync(process.execPath, ['--import', 'harbor-engine/gates/lib/no-network.mjs', join(root, 'pipelines/street/build.mjs'), '--out', join(d, 'out'), '--log', join(d, 'log.json')],
      { cwd: root, encoding: 'utf8', env: { ...process.env, ...env }, maxBuffer: 1 << 26 });
    if (r.status !== 0) throw new Error('street pipeline failed: ' + (r.stderr || '').slice(-1500));
    dirs.push(d);
  }
  return dirs;
}

// Files that differ between two dirs (by bytes); `files` defaults to every file in a.
export function differing(a, b, files = readdirSync(a)) {
  return files.filter(f => !existsSync(join(b, f)) || !readFileSync(join(a, f)).equals(readFileSync(join(b, f))));
}
export const cleanup = dirs => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); };
