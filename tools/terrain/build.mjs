// G2a pipeline: cached 3DEP land + NCEI seabed → one merged heightfield in the bay frame → tiles.
//   node tools/terrain/build.mjs [--raw <dir>] [--out <dir>]
// Output (default public/terrain/): index.json + t_<i>_<j>.bin, each a zlib-deflated Int16LE grid of
// heights in centimetres above local MSL (row-major, row 0 = north). Deterministic: no clocks, no
// randomness, fixed zlib settings.
import { createHash } from 'node:crypto';
import { mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readTiff } from '../geo/tiff.mjs';
import { readCached, RAW } from '../data/cache.mjs';
import { dehaze } from '../geo/naip.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };

// World grid: square domain centred on the frame origin (src/world/BayFrame.js), 3 m cells.
export const GRID = { originE: 549504, originN: 4186800, size: 9600, res: 3200, tile: 200 };
const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };


export function mergeHeights({ rawDir = RAW } = {}) {
  const land = readTiff(readCached('terrain-3dep.tif', rawDir));
  const sea = readTiff(readCached('bathy-ncei.tif', rawDir));
  const datums = JSON.parse(readCached('noaa-datums-9414290.json', rawDir).toString('utf8'));
  const dv = n => datums.datums.find(d => d.name === n).value;
  const msl = dv('MSL') - dv('NAVD88'); // local MSL above NAVD88 (m)
  // both rasters share the slice grid; its NW corner and cell size come from the GeoTIFF tags
  const [, , , e0, n0] = land.tags[33922], cell = land.tags[33550][0];
  const { originE, originN, size, res } = GRID;
  const west = originE - size / 2, north = originN + size / 2, texel = size / res;
  const out = new Int16Array(res * res);
  for (let j = 0; j < res; j++) {
    const N = north - (j + 0.5) * texel;
    const r = Math.min(land.height - 1, Math.max(0, Math.floor((n0 - N) / cell)));
    for (let i = 0; i < res; i++) {
      const E = west + (i + 0.5) * texel;
      const c = Math.min(land.width - 1, Math.max(0, Math.floor((E - e0) / cell)));
      const k = r * land.width + c;
      const B = sea.data[k], T = land.data[k];
      // land (3DEP lidar) above the waterline, NCEI seabed below it, blended over ±1 m of NCEI height
      const w = smooth(msl - 1, msl + 1, B);
      const h = B + (T - B) * w - msl;
      out[j * res + i] = Math.max(-32768, Math.min(32767, Math.round(h * 100)));
    }
  }
  return { heights: out, msl, epoch: datums.epoch };
}

// Ground colour map: the 4 m NAIP image over the whole terrain square (same extent as the heightfield), haze
// corrected, RGB8 sRGB, row 0 = north, zlib deflated. Water deeper than 1.5 m is zeroed (the shader draws bay
// mud there) and channels keep 6 bits: 4.0 MB instead of 15.4 MB (D39).
export const AERIAL_WATER_BELOW = -1.5, AERIAL_BITS = 6, AERIAL_LAND_MEDIAN = 105;
export function aerialMap({ rawDir = RAW, merged } = {}) {
  const t = readTiff(readCached('naip-bay.tif', rawDir));
  merged = merged || mergeHeights({ rawDir });
  const [R, G, B] = t.bands, W = t.width, H = t.height, cell = t.tags[33550][0];
  const { res, size } = GRID, texel = size / res, keep = 0xff << (8 - AERIAL_BITS) & 0xff;
  const hAt = k => { const x = k % W, y = (k / W) | 0; return merged.heights[Math.min(res - 1, Math.floor((y + 0.5) * cell / texel)) * res + Math.min(res - 1, Math.floor((x + 0.5) * cell / texel))] / 100; };
  const fix = dehaze(t, k => hAt(k) > 0.5, { shared: true, saturation: 1.2 }); // haze statistics from land only; colour balance kept
  const rgb = Buffer.alloc(W * H * 3);
  // brightness: NAIP counts are not reflectance; scale so the median land pixel sits at a typical urban albedo
  // (~0.15 linear, sRGB ≈ AERIAL_LAND_MEDIAN)
  const lumas = [];
  for (let k = 0; k < W * H; k += 11) if (hAt(k) > 0.5) { const c = fix([R[k], G[k], B[k]]); lumas.push(0.3 * c[0] + 0.59 * c[1] + 0.11 * c[2]); }
  lumas.sort((a, b) => a - b);
  const gain = AERIAL_LAND_MEDIAN / Math.max(1, lumas[lumas.length >> 1]);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const hx = Math.min(res - 1, Math.floor((x + 0.5) * cell / texel)), hy = Math.min(res - 1, Math.floor((y + 0.5) * cell / texel));
    if (merged.heights[hy * res + hx] / 100 < AERIAL_WATER_BELOW) continue;
    const k = y * W + x, c = fix([R[k], G[k], B[k]]).map(v => Math.min(255, Math.round(v * gain)));
    rgb[k * 3] = c[0] & keep; rgb[k * 3 + 1] = c[1] & keep; rgb[k * 3 + 2] = c[2] & keep;
  }
  return { width: W, height: H, cell, rgb };
}

export function writeTiles(merged, outDir, aerial = null) {
  const { res, tile, size } = GRID, n = res / tile;
  mkdirSync(outDir, { recursive: true });
  for (const f of readdirSync(outDir)) if (/^t_\d+_\d+\.bin$/.test(f) || f === 'index.json' || f === 'aerial.bin') rmSync(join(outDir, f));
  const files = [];
  for (let tj = 0; tj < n; tj++) for (let ti = 0; ti < n; ti++) {
    const t = new Int16Array(tile * tile);
    for (let y = 0; y < tile; y++) t.set(merged.heights.subarray((tj * tile + y) * res + ti * tile, (tj * tile + y) * res + ti * tile + tile), y * tile);
    const le = Buffer.alloc(t.length * 2);
    for (let k = 0; k < t.length; k++) le.writeInt16LE(t[k], k * 2);
    const bin = deflateSync(le, { level: 9, memLevel: 9, strategy: 0 });
    const name = `t_${ti}_${tj}.bin`;
    writeFileSync(join(outDir, name), bin);
    files.push({ name, i: ti, j: tj, sha256: createHash('sha256').update(bin).digest('hex') });
  }
  const index = {
    format: 'bay-terrain/1', size, res, texel: size / res, tile, tiles: n,
    frame: 'BayFrame: x east, z south, origin UTM 10N E 549504 N 4186800; row 0 = north edge',
    heights: 'Int16LE centimetres above local MSL, zlib deflate',
    verticalDatum: `local MSL = NAVD88 + ${merged.msl.toFixed(3)} m (NOAA station 9414290, epoch ${merged.epoch})`,
    sources: ['terrain-3dep.tif (land)', 'bathy-ncei.tif (seabed)', 'noaa-datums-9414290.json (datum)'],
    files,
  };
  if (aerial) {
    const bin = deflateSync(aerial.rgb, { level: 9, memLevel: 9, strategy: 0 });
    writeFileSync(join(outDir, 'aerial.bin'), bin);
    index.aerial = { file: 'aerial.bin', width: aerial.width, height: aerial.height, cell: aerial.cell,
      format: `RGB8 sRGB (${AERIAL_BITS} significant bits), row 0 = north, same square as the heightfield, zlib deflate; 0,0,0 = water`, source: 'naip-bay.tif (haze corrected)',
      sha256: createHash('sha256').update(bin).digest('hex') };
  }
  writeFileSync(join(outDir, 'index.json'), JSON.stringify(index, null, 1) + '\n');
  return index;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const t0 = performance.now();
  const merged = mergeHeights({ rawDir: arg('--raw', RAW) });
  const index = writeTiles(merged, arg('--out', join(root, 'public/terrain')), aerialMap({ rawDir: arg('--raw', RAW), merged }));
  console.log(`terrain: ${index.files.length} tiles, MSL = NAVD88 + ${merged.msl.toFixed(3)} m, ${((performance.now() - t0) / 1000).toFixed(1)} s`);
}
