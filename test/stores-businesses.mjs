// D94 storefronts: real businesses only. A synthetic block (no OSM cache needed): one street, two buildings; the first
// holds a clinic and a café (OSM-style POIs), the second none. Expect: one sign per POI, each business on contiguous
// modules of about its frontage, one look per business, and no sign or category on frontage no POI claims.
import { buildStores, KIND } from '../pipelines/street/stores.mjs';
import { bufferLine, toPath } from '../pipelines/street/geom.mjs';
import { CATEGORY_ID, FRONTAGE } from '../pipelines/street/signs.mjs';

const ctx = {
  local: (lat, lon) => [lon, lat], // lat = z, lon = x (metres) for this test
  boxes: [{ name: 'sausalito', ring: [[5000, 5000], [5100, 5000], [5100, 5100], [5000, 5100]] }],
  buildings: [
    { id: 'A', h: 12, polys: [[[[0, -15], [40, -15], [40, 0], [0, 0]]]] },
    { id: 'B', h: 12, polys: [[[[42, -15], [80, -15], [80, 0], [42, 0]]]] },
  ],
  elements: [
    { type: 'node', id: 1, lat: -2, lon: 9, tags: { amenity: 'dentist' } },
    { type: 'node', id: 2, lat: -2, lon: 31, tags: { amenity: 'cafe' } },
  ],
};
const roads = { R: bufferLine([[-50, 7], [130, 7]], 5), T: [], ways: [{ pts: [[-50, 7], [130, 7]], tags: { highway: 'primary' } }] };
const walks = { walkAll: bufferLine([[-50, 1], [130, 1]], 1, 'butt') };
const { modules, texts, log } = buildStores(ctx, roads, walks);
const fail = [];
const street = modules.filter(m => Math.abs(m.z0) < 0.01 && Math.abs(m.z1) < 0.01);
const signed = modules.filter(m => m.sign >= 0);
if (signed.length !== 2) fail.push(`${signed.length} signs, want 2 (one per POI)`);
for (const [cat, x] of [['clinic', 9], ['cafe', 31]]) {
  const mine = street.filter(m => m.catId === CATEGORY_ID[cat]).sort((p, q) => Math.min(p.x0, p.x1) - Math.min(q.x0, q.x1));
  if (!mine.length) { fail.push(`no ${cat} frontage`); continue; }
  const len = mine.reduce((s, m) => s + m.len, 0);
  if (Math.abs(len - FRONTAGE[cat]) > 3) fail.push(`${cat} frontage ${len.toFixed(1)} m, want about ${FRONTAGE[cat]}`);
  for (let i = 1; i < mine.length; i++) if (Math.abs(Math.min(mine[i].x0, mine[i].x1) - Math.max(mine[i - 1].x0, mine[i - 1].x1)) > 0.01) fail.push(`${cat} frontage not contiguous`);
  if (new Set(mine.map(m => m.board + ',' + m.awning + ',' + (m.flags & 1))).size !== 1) fail.push(`${cat} modules do not share one look`);
  const s = mine.filter(m => m.sign >= 0);
  if (s.length !== 1) fail.push(`${cat}: ${s.length} signs`);
  else if (Math.abs((s[0].x0 + s[0].x1) / 2 - x) > 5) fail.push(`${cat} sign ${((s[0].x0 + s[0].x1) / 2).toFixed(1)} m from its POI at ${x}`);
  if (cat === 'cafe' && !(mine[0].flags & 1)) fail.push('café has no awning');
  if (cat === 'clinic' && (mine[0].flags & 1)) fail.push('clinic has an awning');
}
const other = street.filter(m => Math.min(m.x0, m.x1) >= 42);
if (!other.length) fail.push('building B has no street modules');
if (other.some(m => m.catId || m.sign >= 0)) fail.push('building B (no POI) got an invented business');
if (other.some(m => m.kind === KIND.garage || m.kind === KIND.home)) fail.push('commercial frontage turned residential');
console.log(JSON.stringify({ modules: modules.length, street: street.length, texts, businesses: log.businesses, unlabelled: log.unlabelled }));
for (const f of fail) console.log('FAIL ' + f);
console.log(fail.length ? 'stores-businesses FAIL' : 'stores-businesses PASS');
process.exit(fail.length ? 1 : 0);
