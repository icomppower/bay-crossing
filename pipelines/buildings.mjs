// Bay Crossing's building sources for the engine's building pipeline (hooks.js → collectBuildings):
// SF (DataSF, PDDL): roof = LiDAR median first-return elevation (median_1st_m, NAVD88) → local MSL.
// Sausalito (OSM, ODbL): OSM `height`, else `building:levels` × 3 m, else a logged 6 m default.
// Styles: SF walls typed by class (tower / mid / house, pier sheds over water), city roofs; Sausalito wood
// shingle and white clapboard walls, Sausalito roofs (map.json `palettes`, D38).
export function collectBuildings(kit) {
  const { local, cleanRing, inside, area2, finish, msl, DEFAULT_HEIGHT, LEVEL_HEIGHT } = kit;
  const log = { sfLidar: 0, sfFallback: 0, osmHeight: 0, osmLevels: 0, osmDefault: 0, skipped: 0 };
  const sfStyle = { walls: null, roofs: 'city', naip: kit.naip('naip-sf.tif'), src: 'sf' };
  const osmStyle = { walls: 'sausalito', roofs: 'sausalito', naip: kit.naip('naip-sausalito.tif'), src: 'osm' };
  // footprints replaced by a landmark model (data/landmarks.json, D4 / G2c)
  const anchors = kit.landmarkAnchors();
  const excluded = [];

  const sf = kit.readJSON('sf-buildings.geojson');
  for (const f of sf.features) {
    const p = f.properties, geom = f.geometry;
    const polys = (geom.type === 'MultiPolygon' ? geom.coordinates : [geom.coordinates])
      .map(poly => poly.map(ring => cleanRing(ring.map(([lon, lat]) => local(lat, lon)))).filter(Boolean))
      .filter(poly => poly.length && Math.abs(area2(poly[0])) > 1);
    if (!polys.length) { log.skipped++; continue; }
    const lm = anchors.find(a => polys.some(poly => inside(poly[0], a.p[0], a.p[1])));
    if (lm) { excluded.push({ landmark: lm.name, id: 'sf' + p.sf16_bldgid }); continue; }
    const roofAbs = parseFloat(p.median_1st_m), above = parseFloat(p.hgt_median_m);
    if (Number.isFinite(roofAbs) && Number.isFinite(above) && above > 1) { log.sfLidar++; finish('sf' + p.sf16_bldgid, polys, above, roofAbs - msl, sfStyle); }
    else { log.sfFallback++; finish('sf' + p.sf16_bldgid, polys, Number.isFinite(above) && above > 0 ? above : DEFAULT_HEIGHT, null, sfStyle); }
  }

  const osm = kit.readJSON('sausalito-osm.json');
  const ways = osm.elements.filter(e => e.type === 'way' && e.tags?.building && e.geometry?.length >= 4).sort((a, b) => a.id - b.id);
  for (const w of ways) {
    const ring = cleanRing(w.geometry.map(g => local(g.lat, g.lon)));
    if (!ring || Math.abs(area2(ring)) < 2) { log.skipped++; continue; }
    const hTag = parseFloat(String(w.tags.height || '').replace(/[^\d.]/g, '')), lv = parseFloat(w.tags['building:levels']);
    let above;
    if (Number.isFinite(hTag) && hTag > 0) { above = hTag; log.osmHeight++; }
    else if (Number.isFinite(lv) && lv > 0) { above = lv * LEVEL_HEIGHT; log.osmLevels++; }
    else { above = DEFAULT_HEIGHT; log.osmDefault++; }
    finish('osm' + w.id, [[ring]], above, null, osmStyle);
  }
  return { log, excluded };
}
