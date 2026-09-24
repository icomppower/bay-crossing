// G0 Data check: building heights, terrain and bathymetry for the slice are cached in data/raw/,
// checksummed, plausible, and their licences are recorded in CREDITS.md.
// --negative runs every mutation below against a temp copy; each one must be caught.
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readTiff } from '../tools/geo/tiff.mjs';
import { toUTM } from '../tools/geo/utm.mjs';
import { SOURCES } from '../tools/data/fetch.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const slice = JSON.parse(readFileSync(join(root, 'data/slice.json'), 'utf8'));
const { minE, minN, maxE, maxN } = slice.extent;
const G = slice.gridMetres, W = (maxE - minE) / G, H = (maxN - minN) / G;

// Licence keywords CREDITS.md must pair with each cached file.
const LICENCE_WORD = { 'sf-buildings.geojson': 'PDDL', 'sausalito-osm.json': 'ODbL', 'terrain-3dep.tif': 'Public domain', 'bathy-ncei.tif': 'Public domain' };

function check(dir, credits) {
  const fail = [];
  const req = (ok, msg) => { if (!ok) fail.push(msg); return ok; };

  // 1. Cache + checksum manifest.
  const manPath = join(dir, 'MANIFEST.sha256');
  if (!req(existsSync(manPath), 'MANIFEST.sha256 missing')) return fail;
  const manifest = Object.fromEntries(readFileSync(manPath, 'utf8').trim().split('\n').map(l => l.split(/\s+/).reverse()));
  for (const s of SOURCES) {
    const p = join(dir, s.file);
    if (!req(existsSync(p), `${s.file} missing from cache`)) continue;
    const sha = createHash('sha256').update(readFileSync(p)).digest('hex');
    req(manifest[s.file] === sha, `${s.file} checksum does not match MANIFEST`);
  }
  if (fail.length) return fail;

  // 2. Licences: sources.json records one per file, and CREDITS.md names the file with its licence.
  const sources = JSON.parse(readFileSync(join(dir, 'sources.json'), 'utf8'));
  for (const s of SOURCES) {
    req(sources[s.file]?.licence, `${s.file} has no licence in sources.json`);
    const line = credits.split('\n').find(l => l.includes(s.file));
    req(line && line.includes(LICENCE_WORD[s.file]), `CREDITS.md does not record ${s.file} with its ${LICENCE_WORD[s.file]} licence`);
  }

  // 3. SF building footprints with heights.
  const sf = JSON.parse(readFileSync(join(dir, 'sf-buildings.geojson'), 'utf8'));
  const feats = sf.features || [];
  req(feats.length >= 5000, `SF buildings: ${feats.length} footprints, expected ≥ 5000`);
  const withH = feats.filter(f => Number.isFinite(parseFloat(f.properties?.hgt_median_m)) && parseFloat(f.properties.hgt_median_m) >= 0);
  req(withH.length >= 0.99 * feats.length, `SF buildings: only ${withH.length}/${feats.length} have a height`);
  const tallest = Math.max(...feats.map(f => parseFloat(f.properties?.peak_1st_m) - parseFloat(f.properties?.gnd_min_m)).filter(Number.isFinite));
  req(tallest >= 200 && tallest <= 340, `SF buildings: tallest ${tallest.toFixed(1)} m, expected 200–340 (Transamerica ~260 m)`);
  const b = slice.boxes.sfBuildings, e = 1e-5; // ~1 m: the portal's within_box has float slack
  const outside = feats.filter(f => f.geometry?.coordinates.flat(2).some(([lon, lat]) => lon < b.west - e || lon > b.east + e || lat < b.south - e || lat > b.north + e));
  req(outside.length === 0, `SF buildings: ${outside.length} footprints fall outside the slice box`);

  // 4. Sausalito OSM buildings.
  const osm = JSON.parse(readFileSync(join(dir, 'sausalito-osm.json'), 'utf8'));
  const ways = (osm.elements || []).filter(e => e.type === 'way' && e.tags?.building && e.geometry?.length >= 4);
  req(ways.length >= 300, `Sausalito: ${ways.length} OSM building ways, expected ≥ 300`);
  const sa = slice.boxes.sausalito, tol = 0.005;
  req(ways.every(w => w.geometry.some(p => p.lon >= sa.west - tol && p.lon <= sa.east + tol && p.lat >= sa.south - tol && p.lat <= sa.north + tol)),
    'Sausalito: OSM buildings outside the slice box');

  // 5/6. Terrain + bathymetry grids.
  const probe = (t, lat, lon) => { const [E, N] = toUTM(lat, lon); return t.data[Math.floor((maxN - N) / G) * t.width + Math.floor((E - minE) / G)]; };
  const grids = {};
  for (const file of ['terrain-3dep.tif', 'bathy-ncei.tif']) {
    const t = readTiff(readFileSync(join(dir, file)));
    grids[file] = t;
    req(t.width === W && t.height === H, `${file}: ${t.width}×${t.height}, expected ${W}×${H}`);
    const tie = t.tags[33922], scale = t.tags[33550];
    req(tie?.[3] === minE && tie?.[4] === maxN && scale?.[0] === G && scale?.[1] === G, `${file}: georeference does not match the slice extent`);
    let bad = 0; for (const v of t.data) if (!Number.isFinite(v) || Math.abs(v) > 1e4 || (t.noData !== null && v === t.noData)) bad++;
    req(bad === 0, `${file}: ${bad} no-data / non-finite cells`);
    const coit = probe(t, 37.80239, -122.40582), angel = probe(t, 37.8617, -122.4318);
    req(coit >= 60 && coit <= 110, `${file}: Telegraph Hill ${coit?.toFixed(1)} m, expected 60–110`);
    req(angel >= 190 && angel <= 260, `${file}: Angel Island summit ${angel?.toFixed(1)} m, expected 190–260`);
  }
  const bt = grids['bathy-ncei.tif'];
  const gg = probe(bt, 37.8175, -122.4770), mid = probe(bt, 37.8200, -122.4400), fb = probe(bt, 37.79555, -122.39365);
  req(gg < -60, `bathymetry: Golden Gate channel ${gg.toFixed(1)} m, expected < −60`);
  req(mid >= -30 && mid <= -5, `bathymetry: mid-bay ${mid.toFixed(1)} m, expected −30 to −5`);
  req(fb >= -5 && fb <= 10, `bathymetry: Ferry Building ${fb.toFixed(1)} m, expected −5 to 10`);
  let wet = 0; for (const v of bt.data) if (v < 0) wet++;
  req(wet / bt.data.length >= 0.4, `bathymetry: only ${(100 * wet / bt.data.length).toFixed(0)}% of cells below datum, expected ≥ 40%`);
  return fail;
}

const credits = readFileSync(join(root, 'CREDITS.md'), 'utf8');
const rawDir = join(root, 'data/raw');

if (!process.argv.includes('--negative')) {
  const fail = check(rawDir, credits);
  if (fail.length) { console.log('G0 FAIL\n- ' + fail.join('\n- ')); process.exit(1); }
  console.log('G0 PASS — 4 sources cached, checksummed, plausible, licences recorded');
  process.exit(0);
}

// Negative fixtures: each mutation of a temp copy must be caught.
function fixture(mutate) {
  const d = mkdtempSync(join(tmpdir(), 'g0neg-'));
  for (const f of ['MANIFEST.sha256', 'sources.json', ...SOURCES.map(s => s.file)]) symlinkSync(join(rawDir, f), join(d, f));
  const reManifest = () => {
    rmSync(join(d, 'MANIFEST.sha256'));
    writeFileSync(join(d, 'MANIFEST.sha256'), SOURCES.map(s => `${createHash('sha256').update(readFileSync(join(d, s.file))).digest('hex')}  ${s.file}`).join('\n') + '\n');
  };
  const own = f => { rmSync(join(d, f)); cpSync(join(rawDir, f), join(d, f)); };
  let c = credits;
  const out = mutate({ d, own, reManifest, setCredits: v => { c = v; } });
  return { d, credits: c, ...out };
}
const MUTATIONS = {
  'corrupted terrain byte': ({ d, own }) => { own('terrain-3dep.tif'); const p = join(d, 'terrain-3dep.tif'); const b = readFileSync(p); b[b.length >> 1] ^= 0xff; writeFileSync(p, b); },
  'missing bathymetry file': ({ d }) => { rmSync(join(d, 'bathy-ncei.tif')); },
  'SF heights stripped': ({ d, reManifest }) => {
    const p = join(d, 'sf-buildings.geojson'); const j = JSON.parse(readFileSync(p, 'utf8'));
    for (const f of j.features) { delete f.properties.hgt_median_m; delete f.properties.peak_1st_m; }
    rmSync(p); writeFileSync(p, JSON.stringify(j)); reManifest();
  },
  'land-only terrain used as bathymetry': ({ d, reManifest }) => { rmSync(join(d, 'bathy-ncei.tif')); cpSync(join(rawDir, 'terrain-3dep.tif'), join(d, 'bathy-ncei.tif')); reManifest(); },
  'licences missing from CREDITS': ({ setCredits }) => setCredits(credits.replace(/PDDL|ODbL|Public domain/g, 'unknown')),
};
// A mutation counts as caught only if it adds a failure the unmutated cache doesn't already have.
const baseline = new Set(check(rawDir, credits));
let uncaught = 0;
for (const [name, mutate] of Object.entries(MUTATIONS)) {
  const fx = fixture(mutate);
  const fresh = check(fx.d, fx.credits).filter(m => !baseline.has(m));
  rmSync(fx.d, { recursive: true, force: true });
  console.log(`${fresh.length ? 'caught  ' : 'MISSED  '} ${name}${fresh.length ? ' — ' + fresh[0] : ''}`);
  if (!fresh.length) uncaught++;
}
// Exit non-zero = the gate failed on its negative fixture (what verify.sh expects).
process.exit(uncaught ? 0 : 1);
