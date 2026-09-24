// Fetches every raw source for the slice into data/raw/ and writes MANIFEST.sha256 + sources.json.
// Cached files are never re-downloaded unless --force; pipelines read only from data/raw/.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
const raw = join(root, 'data/raw');
const slice = JSON.parse(readFileSync(join(root, 'data/slice.json'), 'utf8'));
const force = process.argv.includes('--force');
mkdirSync(raw, { recursive: true });

const { minE, minN, maxE, maxN } = slice.extent;
const W = (maxE - minE) / slice.gridMetres, H = (maxN - minN) / slice.gridMetres;
const sf = slice.boxes.sfBuildings, sa = slice.boxes.sausalito;

function exportImage(service) {
  const q = new URLSearchParams({
    bbox: `${minE},${minN},${maxE},${maxN}`, bboxSR: '32610', imageSR: '32610', size: `${W},${H}`,
    format: 'tiff', pixelType: 'F32', noDataInterpretation: 'esriNoDataMatchAny',
    interpolation: 'RSP_BilinearInterpolation', compression: 'LZ77', f: 'image',
  });
  return `${service}/exportImage?${q}`;
}

export const SOURCES = [
  {
    file: 'sf-buildings.geojson', key: 'sf-buildings',
    title: 'San Francisco Building Footprints (DataSF ynuv-fyni), LiDAR-derived heights',
    licence: 'ODC PDDL 1.0 (public domain dedication)', licenceUrl: 'http://opendatacommons.org/licenses/pddl/1.0/',
    url: 'https://data.sf.gov/resource/ynuv-fyni.geojson?' + new URLSearchParams({
      $select: 'sf16_bldgid,mblr,gnd_min_m,median_1st_m,hgt_median_m,peak_1st_m,shape',
      $where: `within_box(shape, ${sf.north}, ${sf.west}, ${sf.south}, ${sf.east})`,
      $order: 'sf16_bldgid', $limit: '50000',
    }),
  },
  {
    file: 'sausalito-osm.json', key: 'sausalito-osm',
    title: 'OpenStreetMap buildings, Sausalito waterfront (Overpass API)',
    licence: 'ODbL 1.0 — © OpenStreetMap contributors', licenceUrl: 'https://www.openstreetmap.org/copyright',
    url: 'https://overpass-api.de/api/interpreter',
    body: 'data=' + encodeURIComponent(`[out:json][timeout:120];(way["building"](${sa.south},${sa.west},${sa.north},${sa.east});relation["building"](${sa.south},${sa.west},${sa.north},${sa.east}););out geom tags qt;`),
  },
  {
    file: 'terrain-3dep.tif', key: 'terrain-3dep',
    title: `USGS 3DEP elevation, ${slice.gridMetres} m resample over the slice (3DEPElevation ImageServer)`,
    licence: 'Public domain (US Government work, USGS)', licenceUrl: 'https://www.usgs.gov/information-policies-and-instructions/copyrights-and-credits',
    url: exportImage('https://elevation.nationalmap.gov/arcgis/rest/services/3DEPElevation/ImageServer'),
  },
  {
    file: 'bathy-ncei.tif', key: 'bathy-ncei',
    title: `NOAA NCEI DEM mosaic (topobathy), ${slice.gridMetres} m resample over the slice (DEM_mosaics/DEM_all ImageServer)`,
    licence: 'Public domain (US Government work, NOAA NCEI)', licenceUrl: 'https://www.ncei.noaa.gov/access/metadata/landing-page/bin/iso?id=gov.noaa.ngdc.mgg.dem:999919',
    url: exportImage('https://gis.ngdc.noaa.gov/arcgis/rest/services/DEM_mosaics/DEM_all/ImageServer'),
  },
];

async function download(s) {
  const opts = s.body
    ? { method: 'POST', body: s.body, headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
    : {};
  opts.headers = { ...opts.headers, 'User-Agent': 'bay-crossing-data-fetch/1.0 (research build)' };
  for (let attempt = 1; attempt <= 3; attempt++) {
    const res = await fetch(s.url, opts);
    if (res.ok) {
      const buf = Buffer.from(await res.arrayBuffer());
      const ct = res.headers.get('content-type') || '';
      if (s.file.endsWith('.tif') && !ct.includes('tiff')) throw new Error(`${s.file}: got ${ct}: ${buf.subarray(0, 200)}`);
      return buf;
    }
    console.warn(`${s.file}: HTTP ${res.status}, attempt ${attempt}`);
    await new Promise(r => setTimeout(r, 5000 * attempt));
  }
  throw new Error(`${s.file}: download failed`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const sources = existsSync(join(raw, 'sources.json')) ? JSON.parse(readFileSync(join(raw, 'sources.json'), 'utf8')) : {};
  for (const s of SOURCES) {
    const path = join(raw, s.file);
    if (existsSync(path) && !force) { console.log(`cached  ${s.file}`); continue; }
    const t = Date.now();
    const buf = await download(s);
    writeFileSync(path, buf);
    sources[s.file] = { key: s.key, title: s.title, licence: s.licence, licenceUrl: s.licenceUrl, url: s.url,
      fetched: new Date().toISOString(), bytes: buf.length };
    console.log(`fetched ${s.file} ${(buf.length / 1e6).toFixed(1)} MB in ${((Date.now() - t) / 1000).toFixed(1)} s`);
  }
  writeFileSync(join(raw, 'sources.json'), JSON.stringify(sources, null, 2) + '\n');
  const lines = SOURCES.map(s => `${createHash('sha256').update(readFileSync(join(raw, s.file))).digest('hex')}  ${s.file}`);
  writeFileSync(join(raw, 'MANIFEST.sha256'), lines.join('\n') + '\n');
  console.log(lines.join('\n'));
}
