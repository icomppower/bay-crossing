// Bay Crossing's raw sources (SOURCES); the engine's fetchSources() downloads them into data/raw/ and writes
// MANIFEST.sha256 + sources.json. Cached files are never re-downloaded unless --force. SOURCES is run 1's list
// (G0); STREET_SOURCES is run 2's (G8); the CLI fetches both.
//   node pipelines/data/fetch.mjs [--force]
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { toUTM } from 'harbor-engine/tools/geo/utm.mjs';
import { fetchSources } from 'harbor-engine/tools/data/fetch.mjs';
import { isMain } from 'harbor-engine/tools/lib/title.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
const slice = JSON.parse(readFileSync(join(root, 'data/slice.json'), 'utf8'));

const { minE, minN, maxE, maxN } = slice.extent;
const W = (maxE - minE) / slice.gridMetres, H = (maxN - minN) / slice.gridMetres;
const sf = slice.boxes.sfBuildings, sa = slice.boxes.sausalito;
const WGS = { west: -122.49, south: 37.785, east: -122.385, north: 37.87 }; // the slice in WGS84

function exportImage(service) {
  const q = new URLSearchParams({
    bbox: `${minE},${minN},${maxE},${maxN}`, bboxSR: '32610', imageSR: '32610', size: `${W},${H}`,
    format: 'tiff', pixelType: 'F32', noDataInterpretation: 'esriNoDataMatchAny',
    interpolation: 'RSP_BilinearInterpolation', compression: 'LZ77', f: 'image',
  });
  return `${service}/exportImage?${q}`;
}

function encQuery(layer) {
  return `https://encdirect.noaa.gov/arcgis/rest/services/encdirect/enc_harbour/MapServer/${layer}/query?` + new URLSearchParams({
    geometry: `${WGS.west},${WGS.south},${WGS.east},${WGS.north}`, geometryType: 'esriGeometryEnvelope', inSR: '4326', outSR: '4326',
    outFields: '*', returnGeometry: 'true', orderByFields: 'OBJECTID', f: 'json',
  });
}

// 1 m NAIP natural colour over a building box (lat/lon), on the UTM 10N grid, whole metres
export function naipBox(box) {
  const c = [[box.south, box.west], [box.south, box.east], [box.north, box.west], [box.north, box.east]].map(([la, lo]) => toUTM(la, lo));
  const minE = Math.floor(Math.min(...c.map(p => p[0]))), maxE = Math.ceil(Math.max(...c.map(p => p[0])));
  const minN = Math.floor(Math.min(...c.map(p => p[1]))), maxN = Math.ceil(Math.max(...c.map(p => p[1])));
  return { minE, minN, maxE, maxN };
}
// the whole terrain domain (the 9.6 km square of map.json `frame`) at 4 m, for the ground colour map
export const NAIP_BAY = { minE: 544704, minN: 4182000, maxE: 554304, maxN: 4191600, cell: 4 };
function naipExport(box, cell = 1) {
  const b = box.minE !== undefined ? box : naipBox(box);
  return 'https://imagery.nationalmap.gov/arcgis/rest/services/USGSNAIPImagery/ImageServer/exportImage?' + new URLSearchParams({
    bbox: `${b.minE},${b.minN},${b.maxE},${b.maxN}`, bboxSR: '32610', imageSR: '32610', size: `${(b.maxE - b.minE) / cell},${(b.maxN - b.minN) / cell}`,
    format: 'tiff', pixelType: 'U8', bandIds: '0,1,2', compression: 'LZ77', interpolation: 'RSP_BilinearInterpolation', f: 'image',
  });
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
  {
    file: 'landmarks-osm.json', key: 'landmarks-osm',
    title: 'OpenStreetMap landmark and waterfront features: Golden Gate Bridge towers, Ferry Building and its ferry gates, Coit Tower, Transamerica Pyramid, Alcatraz buildings and lighthouse, Sausalito ferry terminal, Embarcadero piers (Overpass API)',
    licence: 'ODbL 1.0 — © OpenStreetMap contributors', licenceUrl: 'https://www.openstreetmap.org/copyright',
    url: 'https://overpass-api.de/api/interpreter',
    body: 'data=' + encodeURIComponent(`[out:json][timeout:120];(
  nwr["man_made"="tower"]["tower:type"="bridge"](37.805,-122.485,37.832,-122.470);
  nwr["name"="Ferry Building"](37.79,-122.40,37.80,-122.39);
  way["name"="San Francisco Ferry Building"](37.79,-122.40,37.80,-122.39);
  nwr["building:part"](37.7945,-122.3945,37.7962,-122.3925);
  nwr["name"="Coit Tower"](37.80,-122.41,37.805,-122.40);
  nwr["name"~"Transamerica Pyramid"](37.79,-122.41,37.80,-122.40);
  nwr["building"](37.8250,-122.4260,37.8290,-122.4200);
  nwr["man_made"~"lighthouse|water_tower"](37.8250,-122.4260,37.8290,-122.4200);
  nwr["amenity"="ferry_terminal"](37.85,-122.49,37.86,-122.47);
  nwr["man_made"="pier"](37.79,-122.42,37.815,-122.385);
);out geom tags qt;`),
  },
  {
    file: 'noaa-enc-landmarks.json', key: 'noaa-enc-landmarks',
    title: 'NOAA Electronic Navigational Charts (ENC Direct, harbour scale): charted landmarks — Ferry Tower, Coit Tower, Transamerica, Golden Gate Bridge lights, Alcatraz Light',
    licence: 'Public domain (US Government work, NOAA Office of Coast Survey)', licenceUrl: 'https://nauticalcharts.noaa.gov/data/enc-direct-to-gis.html',
    url: encQuery(26),
  },
  {
    file: 'noaa-enc-pylons.json', key: 'noaa-enc-pylons',
    title: 'NOAA Electronic Navigational Charts (ENC Direct, harbour scale): bridge pylon / support areas (Golden Gate Bridge South Pier)',
    licence: 'Public domain (US Government work, NOAA Office of Coast Survey)', licenceUrl: 'https://nauticalcharts.noaa.gov/data/enc-direct-to-gis.html',
    url: encQuery(149),
  },
  {
    file: 'ggt-gtfs.zip', key: 'ggt-gtfs',
    title: 'Golden Gate Transit / Golden Gate Ferry GTFS schedule feed (stops, ferry trips and stop times, route shapes)',
    licence: 'No licence stated by the publisher (GGBHTD); used only for facts: stop positions and published trip times; not redistributed', licenceUrl: 'https://realtime.goldengate.org/gtfsstatic/GTFSTransitData.zip',
    url: 'https://realtime.goldengate.org/gtfsstatic/GTFSTransitData.zip',
  },
  {
    file: 'naip-sf.tif', key: 'naip-sf',
    title: 'USDA NAIP aerial orthoimagery (natural colour, 1 m resample) over the San Francisco building box (USGS The National Map NAIP ImageServer), for roof colours',
    licence: 'Public domain (US Government work, USDA Farm Service Agency NAIP)', licenceUrl: 'https://naip-usdaonline.hub.arcgis.com/',
    url: naipExport(sf),
  },
  {
    file: 'naip-sausalito.tif', key: 'naip-sausalito',
    title: 'USDA NAIP aerial orthoimagery (natural colour, 1 m resample) over the Sausalito building box (USGS The National Map NAIP ImageServer), for roof colours',
    licence: 'Public domain (US Government work, USDA Farm Service Agency NAIP)', licenceUrl: 'https://naip-usdaonline.hub.arcgis.com/',
    url: naipExport(sa),
  },
  {
    file: 'naip-bay.tif', key: 'naip-bay',
    title: 'USDA NAIP aerial orthoimagery (natural colour, 4 m resample) over the whole 9.6 km terrain square (USGS The National Map NAIP ImageServer), for the ground colour map',
    licence: 'Public domain (US Government work, USDA Farm Service Agency NAIP)', licenceUrl: 'https://naip-usdaonline.hub.arcgis.com/',
    url: naipExport(NAIP_BAY, NAIP_BAY.cell),
  },
  {
    file: 'noaa-datums-9414290.json', key: 'noaa-datums',
    title: 'NOAA CO-OPS tidal datums, San Francisco station 9414290 (MSL relative to NAVD88)',
    licence: 'Public domain (US Government work, NOAA CO-OPS)', licenceUrl: 'https://tidesandcurrents.noaa.gov/datums.html?id=9414290',
    url: 'https://api.tidesandcurrents.noaa.gov/mdapi/prod/webapi/stations/9414290/datums.json?units=metric',
  },
];

// Run 2 (street level, G8): roads, crossings, signals, lamps, rails, storefront categories and trees for the two
// building boxes, plus the DataSF Street Tree List and its licence metadata (checked by G8, D59). The cached file
// is the snapshot (its osm3s.timestamp_osm_base records the date); a dated attic query runs Overpass out of
// memory (D60).
const streetQuery = b => 'data=' + encodeURIComponent(`[out:json][timeout:180];(
  way["highway"](${b.south},${b.west},${b.north},${b.east});
  node["highway"~"^(traffic_signals|crossing|street_lamp|stop|give_way)$"](${b.south},${b.west},${b.north},${b.east});
  way["railway"~"^(tram|light_rail)$"](${b.south},${b.west},${b.north},${b.east});
  nwr["shop"](${b.south},${b.west},${b.north},${b.east});
  nwr["amenity"](${b.south},${b.west},${b.north},${b.east});
  nwr["tourism"](${b.south},${b.west},${b.north},${b.east});
  node["natural"="tree"](${b.south},${b.west},${b.north},${b.east});
);out body geom qt;`);
const ODBL = { licence: 'ODbL 1.0 — © OpenStreetMap contributors', licenceUrl: 'https://www.openstreetmap.org/copyright' };
export const STREET_SOURCES = [
  {
    file: 'osm-streets-sf.json', key: 'osm-streets-sf', ...ODBL, url: 'https://overpass-api.de/api/interpreter', body: streetQuery(sf),
    title: `OpenStreetMap streets over the SF building box: highway ways (lanes, width, sidewalk, oneway, surface, parking), crossings, signals, street lamps, tram rails, shop / amenity / tourism features, trees (Overpass API)`,
  },
  {
    file: 'osm-streets-sausalito.json', key: 'osm-streets-sausalito', ...ODBL, url: 'https://overpass-api.de/api/interpreter', body: streetQuery(sa),
    title: `OpenStreetMap streets over the Sausalito building box: the same features as osm-streets-sf.json (Overpass API)`,
  },
  {
    file: 'datasf-street-trees.json', key: 'datasf-street-trees',
    title: 'San Francisco Street Tree List (DataSF tkzw-k3nq, San Francisco Public Works): tree positions and species inside the SF building box',
    licence: 'ODC PDDL 1.0 (public domain dedication)', licenceUrl: 'http://opendatacommons.org/licenses/pddl/1.0/',
    url: 'https://data.sf.gov/resource/tkzw-k3nq.json?' + new URLSearchParams({
      $select: 'treeid,legalstatus,species,planttype,siteinfo,dbhrange,latitude,longitude',
      $where: `latitude between ${sf.south} and ${sf.north} and longitude between ${sf.west} and ${sf.east}`,
      $order: 'treeid', $limit: '50000',
    }),
  },
  {
    file: 'datasf-street-trees-meta.json', key: 'datasf-street-trees-meta',
    title: 'DataSF dataset metadata for the Street Tree List (tkzw-k3nq): licence, columns, publisher; G8 reads the licence from it',
    licence: 'ODC PDDL 1.0 (public domain dedication)', licenceUrl: 'http://opendatacommons.org/licenses/pddl/1.0/',
    url: 'https://data.sf.gov/api/views/tkzw-k3nq.json',
  },
];

// Overpass answers some failures with HTTP 200 and an empty result plus a "remark" (out of memory, timeout):
// such a cached file is removed so the next run fetches it again.
function dropFailedOverpass() {
  for (const s of STREET_SOURCES) {
    const p = join(root, 'data/raw', s.file);
    if (!s.url.includes('overpass') || !existsSync(p)) continue;
    const j = JSON.parse(readFileSync(p, 'utf8'));
    if (j.remark && /error/i.test(j.remark) || !(j.elements?.length)) { console.warn(`${s.file}: Overpass failed (${j.remark || 'no elements'}), refetching`); rmSync(p); }
  }
}

if (isMain(import.meta.url)) {
  dropFailedOverpass();
  await fetchSources([...SOURCES, ...STREET_SOURCES], { userAgent: 'bay-crossing-data-fetch/1.0' });
  dropFailedOverpass();
}
