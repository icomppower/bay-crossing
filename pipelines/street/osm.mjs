// Street-level reading of the cached OSM street files (run 2): which ways are roads, how wide they are (D45),
// which sides carry a sidewalk and how wide (D47). Shared by the street pipeline and gates G8–G12b.
//
// Drivable (G9's coverage base): public road classes and their links, busways and service roads, at ground
// level. Tunnels and bridges / raised layers are left out of the ground mesh (they are not on the terrain);
// D58 logs the choice.
export const DRIVABLE = new Set(['motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'unclassified', 'residential',
  'motorway_link', 'trunk_link', 'primary_link', 'secondary_link', 'tertiary_link', 'living_street', 'service', 'busway']);

// D45 default carriageway width per class (m), used when a way tags neither width nor lanes
export const CLASS_WIDTH = {
  motorway: 11, trunk: 10, primary: 10, secondary: 9, tertiary: 8, unclassified: 6.5, residential: 7,
  motorway_link: 5, trunk_link: 5, primary_link: 5, secondary_link: 5, tertiary_link: 5,
  living_street: 5.5, service: 4, busway: 4,
};
export const LANE_WIDTH = 3.3;

// D47 default sidewalk width per class (m), used when a way tags no sidewalk:width
export const CLASS_SIDEWALK = {
  primary: 3.5, secondary: 3.2, tertiary: 3, unclassified: 2.5, residential: 2.5, living_street: 2,
  trunk: 3, busway: 3, primary_link: 2.5, secondary_link: 2.5, tertiary_link: 2.5,
};
export const CURB = 0.15; // m (D47)

const num = v => { const m = /^\s*([0-9]+(?:\.[0-9]+)?)\s*(m|ft|')?\s*$/.exec(String(v ?? '')); if (!m) return NaN; return m[2] === 'ft' || m[2] === "'" ? +m[1] * 0.3048 : +m[1]; };

// Drivable at ground level?
export function isGroundRoad(t) {
  if (!DRIVABLE.has(t.highway)) return false;
  if (t.area === 'yes') return false;
  if (t.tunnel && t.tunnel !== 'no') return false;
  if (t.bridge && t.bridge !== 'no') return false;
  if (+t.layer >= 1 || +t.layer <= -1) return false;
  if (t.service === 'parking_aisle' || t.service === 'drive-through') return false;
  if (t.indoor === 'yes' || t.level && +t.level !== 0) return false;
  return true;
}

// Carriageway width (D45): `width`, else `lanes` × 3.3 m, else the class default (reported as a default).
export function roadWidth(t) {
  const w = num(t.width);
  if (w >= 2 && w <= 40) return { width: w, source: 'width' };
  let lanes = parseInt(t.lanes, 10);
  if (!(lanes >= 1 && lanes <= 10)) {
    const f = parseInt(t['lanes:forward'], 10), b = parseInt(t['lanes:backward'], 10);
    if (f >= 1 || b >= 1) lanes = (f || 0) + (b || 0);
  }
  if (lanes >= 1 && lanes <= 10) return { width: lanes * LANE_WIDTH, source: 'lanes' };
  return { width: CLASS_WIDTH[t.highway] ?? 6, source: 'default' };
}

// Sidewalk sides (D47): explicit tags first (sidewalk / sidewalk:both|left|right, `separate` = drawn here too,
// since the separately mapped footway runs alongside), else both sides on classes in CLASS_SIDEWALK,
// none on motorways, service roads and busways.
export function sidewalkSides(t) {
  const side = { left: null, right: null };
  const v = t.sidewalk;
  const yes = s => s === 'yes' || s === 'separate';
  if (v === 'both' || v === 'separate' || v === 'yes') side.left = side.right = true;
  else if (v === 'left') { side.left = true; side.right = false; }
  else if (v === 'right') { side.left = false; side.right = true; }
  else if (v === 'no' || v === 'none') side.left = side.right = false;
  if (t['sidewalk:both']) side.left = side.right = yes(t['sidewalk:both']);
  if (t['sidewalk:left']) side.left = yes(t['sidewalk:left']);
  if (t['sidewalk:right']) side.right = yes(t['sidewalk:right']);
  const dflt = CLASS_SIDEWALK[t.highway] !== undefined;
  const explicit = side.left !== null || side.right !== null;
  if (side.left === null) side.left = explicit ? false : dflt;
  if (side.right === null) side.right = explicit ? false : dflt;
  const w = num(t['sidewalk:width']) || num(t['sidewalk:both:width']);
  const width = w >= 1 && w <= 12 ? w : CLASS_SIDEWALK[t.highway] ?? 2.5;
  return { ...side, width, source: w >= 1 && w <= 12 ? 'sidewalk:width' : 'default', tagged: explicit };
}

// Parked cars allowed along a side (D52): parking / parking:lane tags; a logged default otherwise.
export function parkingSides(t) {
  const get = s => t[`parking:${s}`] ?? t[`parking:lane:${s}`];
  const val = s => { const v = get(s) ?? get('both'); return v === undefined ? null : !/^(no|no_stopping|no_parking|fire_lane|separate)$/.test(v); };
  return { left: val('left'), right: val('right') };
}

// Storefront category (D49 style + D50 sign text) from shop / amenity / tourism. null = not a storefront.
export function storeCategory(t) {
  const a = t.amenity, s = t.shop, tr = t.tourism;
  if (a) {
    if (/^(restaurant|food_court)$/.test(a)) return /seafood|fish/i.test(t.cuisine || '') ? 'seafood' : /chinese|cantonese|dim_sum/i.test(t.cuisine || '') ? 'chinese' : 'restaurant';
    if (a === 'cafe') return 'cafe';
    if (a === 'fast_food') return 'fastfood';
    if (a === 'ice_cream') return 'icecream';
    if (/^(bar|pub|nightclub|biergarten)$/.test(a)) return 'bar';
    if (/^(bank|bureau_de_change)$/.test(a)) return 'bank';
    if (a === 'pharmacy') return 'pharmacy';
    if (/^(theatre|cinema|arts_centre)$/.test(a)) return 'theatre';
    if (/^(dentist|clinic|doctors)$/.test(a)) return 'clinic';
    return null;
  }
  if (s) {
    if (/^(bakery|pastry|confectionery|chocolate)$/.test(s)) return 'bakery';
    if (/^(books|stationery|newsagent)$/.test(s)) return 'books';
    if (/^(clothes|fashion|boutique|shoes|bag|fabric|tailor)$/.test(s)) return 'clothing';
    if (/^(jewelry|watches)$/.test(s)) return 'jewelry';
    if (/^(convenience|supermarket|grocery|greengrocer|deli|butcher|seafood|alcohol|wine|beverages|tea|coffee)$/.test(s)) return s === 'seafood' ? 'fishmarket' : s === 'tea' ? 'tea' : /^(alcohol|wine|beverages)$/.test(s) ? 'wine' : 'grocery';
    if (/^(gift|souvenir|art|craft|antiques|frame|toys|games)$/.test(s)) return 'gifts';
    if (/^(florist|garden_centre)$/.test(s)) return 'flowers';
    if (/^(hairdresser|beauty|cosmetics|massage|nails|tattoo)$/.test(s)) return 'salon';
    if (/^(chemist|herbalist|medical_supply|optician)$/.test(s)) return s === 'herbalist' ? 'herbs' : 'pharmacy';
    if (/^(electronics|mobile_phone|computer|camera|hifi)$/.test(s)) return 'electronics';
    if (/^(bicycle|sports|outdoor)$/.test(s)) return 'sports';
    return 'shop';
  }
  if (tr) {
    if (/^(hotel|hostel|motel|guest_house)$/.test(tr)) return 'hotel';
    if (/^(museum|gallery)$/.test(tr)) return 'gallery';
    if (/^(information)$/.test(tr)) return null;
    return null;
  }
  return null;
}
