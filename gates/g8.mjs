// G8 Street data: OSM roads + storefront categories and the DataSF Street Tree List for the slice are fetched by
// script (pipelines/data/fetch.mjs STREET_SOURCES), cached in data/raw/, checksummed, plausible, and their
// licences are recorded in CREDITS.md. The DataSF licence is read from the dataset's own metadata (D59).
// --negative runs every mutation below against a temp copy; each one must be caught.
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { STREET_SOURCES } from '../pipelines/data/fetch.mjs';
import { DRIVABLE } from '../pipelines/street/osm.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const slice = JSON.parse(readFileSync(join(root, 'data/slice.json'), 'utf8'));
const LICENCE_WORD = { 'osm-streets-sf.json': 'ODbL', 'osm-streets-sausalito.json': 'ODbL', 'datasf-street-trees.json': 'PDDL', 'datasf-street-trees-meta.json': 'PDDL' };

function check(dir, credits) {
  const fail = [];
  const req = (ok, msg) => { if (!ok) fail.push(msg); return ok; };

  // 1. Cache + checksum manifest.
  const manPath = join(dir, 'MANIFEST.sha256');
  if (!req(existsSync(manPath), 'MANIFEST.sha256 missing')) return fail;
  const manifest = Object.fromEntries(readFileSync(manPath, 'utf8').trim().split('\n').map(l => l.split(/\s+/).reverse()));
  for (const s of STREET_SOURCES) {
    const p = join(dir, s.file);
    if (!req(existsSync(p), `${s.file} missing from cache`)) continue;
    const sha = createHash('sha256').update(readFileSync(p)).digest('hex');
    req(manifest[s.file] === sha, `${s.file} checksum does not match MANIFEST`);
  }
  if (fail.length) return fail;

  // 2. Licences: sources.json records one per file, CREDITS.md names the file with its licence.
  const sources = JSON.parse(readFileSync(join(dir, 'sources.json'), 'utf8'));
  for (const s of STREET_SOURCES) {
    req(sources[s.file]?.licence, `${s.file} has no licence in sources.json`);
    const line = credits.split('\n').find(l => l.includes(s.file));
    req(line && line.includes(LICENCE_WORD[s.file]), `CREDITS.md does not record ${s.file} with its ${LICENCE_WORD[s.file]} licence`);
  }
  // DataSF licence verified from the publisher's metadata, not assumed
  const meta = JSON.parse(readFileSync(join(dir, 'datasf-street-trees-meta.json'), 'utf8'));
  req(meta.id === 'tkzw-k3nq', `DataSF metadata is for ${meta.id}, expected tkzw-k3nq`);
  req(meta.licenseId === 'PDDL' && /Public Domain Dedication/i.test(meta.license?.name || ''),
    `DataSF Street Tree List licence is "${meta.license?.name}" (${meta.licenseId}), expected ODC PDDL`);

  // 3. OSM streets: plausible for each box.
  const read = f => JSON.parse(readFileSync(join(dir, f), 'utf8')).elements || [];
  for (const [file, box, need] of [
    ['osm-streets-sf.json', slice.boxes.sfBuildings, { drivable: 1500, named: ['The Embarcadero', 'Bay Street', 'Grant Avenue', 'Columbus Avenue'], poi: 1500, crossings: 800, rails: 20, lamps: 100 }],
    ['osm-streets-sausalito.json', slice.boxes.sausalito, { drivable: 60, named: ['Bridgeway'], poi: 60, crossings: 10, rails: 0, lamps: 0 }],
  ]) {
    const els = read(file);
    const ways = els.filter(e => e.type === 'way' && e.tags?.highway && e.geometry?.length >= 2);
    const drivable = ways.filter(w => DRIVABLE.has(w.tags.highway));
    req(drivable.length >= need.drivable, `${file}: ${drivable.length} drivable ways, expected ≥ ${need.drivable}`);
    for (const n of need.named) req(drivable.some(w => w.tags.name === n), `${file}: no drivable way named ${n}`);
    const lanesOrWidth = drivable.filter(w => w.tags.lanes || w.tags.width).length;
    req(lanesOrWidth >= 0.15 * drivable.length, `${file}: only ${lanesOrWidth}/${drivable.length} drivable ways tag lanes or width`);
    const poi = els.filter(e => e.tags?.shop || e.tags?.amenity || e.tags?.tourism).length;
    req(poi >= need.poi, `${file}: ${poi} shop/amenity/tourism features, expected ≥ ${need.poi}`);
    const crossings = els.filter(e => e.type === 'node' && /^(crossing|traffic_signals)$/.test(e.tags?.highway)).length;
    req(crossings >= need.crossings, `${file}: ${crossings} crossing / signal nodes, expected ≥ ${need.crossings}`);
    const rails = els.filter(e => e.type === 'way' && /^(tram|light_rail)$/.test(e.tags?.railway)).length;
    req(rails >= need.rails, `${file}: ${rails} tram / light-rail ways, expected ≥ ${need.rails}`);
    const lamps = els.filter(e => e.tags?.highway === 'street_lamp').length;
    req(lamps >= need.lamps, `${file}: ${lamps} street lamps, expected ≥ ${need.lamps}`);
    // Overpass returns whole ways that cross the box: each must touch it
    const tol = 0.0005;
    const touches = w => w.geometry.some(p => p.lat >= box.south - tol && p.lat <= box.north + tol && p.lon >= box.west - tol && p.lon <= box.east + tol);
    const out = ways.filter(w => !touches(w)).length;
    req(out === 0, `${file}: ${out} highway ways do not touch the box`);
  }

  // 4. DataSF trees: positions inside the SF box, unique IDs, enough of them.
  const trees = JSON.parse(readFileSync(join(dir, 'datasf-street-trees.json'), 'utf8'));
  const sb = slice.boxes.sfBuildings;
  req(Array.isArray(trees) && trees.length >= 5000, `DataSF trees: ${trees.length} records, expected ≥ 5000`);
  if (Array.isArray(trees)) {
    const ids = new Set(trees.map(t => t.treeid));
    req(ids.size === trees.length, `DataSF trees: ${trees.length - ids.size} duplicate tree IDs`);
    const bad = trees.filter(t => { const la = +t.latitude, lo = +t.longitude; return !(la >= sb.south && la <= sb.north && lo >= sb.west && lo <= sb.east); }).length;
    req(bad === 0, `DataSF trees: ${bad} records outside the SF box or without a position`);
    const isTree = trees.filter(t => t.planttype === 'Tree').length;
    req(isTree >= 0.8 * trees.length, `DataSF trees: only ${isTree}/${trees.length} have plant type Tree`);
  }
  return fail;
}

const credits = readFileSync(join(root, 'CREDITS.md'), 'utf8');
const rawDir = join(root, 'data/raw');

if (!process.argv.includes('--negative')) {
  const fail = check(rawDir, credits);
  if (fail.length) { console.log('G8 FAIL\n- ' + fail.join('\n- ')); process.exit(1); }
  const n = JSON.parse(readFileSync(join(rawDir, 'datasf-street-trees.json'), 'utf8')).length;
  console.log(`G8 PASS — ${STREET_SOURCES.length} street sources cached, checksummed, plausible (${n} DataSF trees), licences recorded; DataSF PDDL read from its metadata`);
  process.exit(0);
}

// Negative fixtures: each mutation of a temp copy must be caught.
function fixture(mutate) {
  const d = mkdtempSync(join(tmpdir(), 'g8neg-'));
  for (const f of ['MANIFEST.sha256', 'sources.json', ...STREET_SOURCES.map(s => s.file)]) symlinkSync(join(rawDir, f), join(d, f));
  const reManifest = () => {
    rmSync(join(d, 'MANIFEST.sha256'));
    writeFileSync(join(d, 'MANIFEST.sha256'), STREET_SOURCES.map(s => `${createHash('sha256').update(readFileSync(join(d, s.file))).digest('hex')}  ${s.file}`).join('\n') + '\n');
  };
  const own = f => { rmSync(join(d, f)); cpSync(join(rawDir, f), join(d, f)); };
  const rewrite = (f, fn) => { const p = join(d, f); const j = JSON.parse(readFileSync(p, 'utf8')); rmSync(p); writeFileSync(p, JSON.stringify(fn(j))); reManifest(); };
  let c = credits;
  mutate({ d, own, rewrite, setCredits: v => { c = v; } });
  return { d, credits: c };
}
const MUTATIONS = {
  'corrupted cache byte (OSM SF streets)': ({ d, own }) => { own('osm-streets-sf.json'); const p = join(d, 'osm-streets-sf.json'); const b = readFileSync(p); b[b.length >> 1] ^= 0x20; writeFileSync(p, b); },
  'missing tree file': ({ d }) => { rmSync(join(d, 'datasf-street-trees.json')); },
  'DataSF licence changed to a non-open one': ({ rewrite }) => rewrite('datasf-street-trees-meta.json', m => ({ ...m, licenseId: 'CC_BY_NC', license: { name: 'Creative Commons Attribution-NonCommercial' } })),
  'licences missing from CREDITS': ({ setCredits }) => setCredits(credits.replace(/osm-streets-\w+\.json|datasf-street-trees(-meta)?\.json/g, 'x.json')),
  'roads stripped from the OSM SF file': ({ rewrite }) => rewrite('osm-streets-sf.json', j => ({ ...j, elements: j.elements.filter(e => !e.tags?.highway) })),
  'trees truncated to 100 records': ({ rewrite }) => rewrite('datasf-street-trees.json', t => t.slice(0, 100)),
  'trees from the wrong city': ({ rewrite }) => rewrite('datasf-street-trees.json', t => t.map(r => ({ ...r, latitude: String(+r.latitude - 0.5) }))),
};
const baseline = new Set(check(rawDir, credits));
let uncaught = 0;
for (const [name, mutate] of Object.entries(MUTATIONS)) {
  const fx = fixture(mutate);
  const fresh = check(fx.d, fx.credits).filter(m => !baseline.has(m));
  rmSync(fx.d, { recursive: true, force: true });
  console.log(`${fresh.length ? 'caught  ' : 'MISSED  '} ${name}${fresh.length ? ' — ' + fresh[0] : ''}`);
  if (!fresh.length) uncaught++;
}
console.log(`NEGATIVE ${Object.keys(MUTATIONS).length - uncaught}/${Object.keys(MUTATIONS).length}`);
process.exit(uncaught ? 0 : 1);
