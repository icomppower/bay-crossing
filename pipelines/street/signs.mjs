// Storefront sign vocabulary (D49, D50): generic category text only, never a business name, brand or logo.
// Shared by the street pipeline (which picks the text), the runtime sign atlas (which draws it) and G11 (which
// checks every baked sign against this list). Chinatown signs add one Chinese character for the category.

// category → English sign texts (one is picked per storefront, seeded)
export const SIGN_TEXT = {
  restaurant: ['RESTAURANT', 'DINER', 'KITCHEN', 'GRILL'],
  chinese: ['DIM SUM', 'NOODLES', 'RESTAURANT', 'BBQ'],
  seafood: ['SEAFOOD', 'CRAB', 'OYSTERS', 'CHOWDER'],
  cafe: ['CAFE', 'COFFEE', 'ESPRESSO'],
  fastfood: ['BURGERS', 'TACOS', 'PIZZA', 'SANDWICHES'],
  icecream: ['ICE CREAM', 'GELATO'],
  bar: ['BAR', 'COCKTAILS', 'TAVERN', 'SALOON'],
  bank: ['BANK', 'ATM'],
  pharmacy: ['PHARMACY', 'DRUGS'],
  theatre: ['THEATRE', 'CINEMA'],
  clinic: ['CLINIC', 'DENTIST'],
  bakery: ['BAKERY', 'PASTRY', 'BREAD'],
  books: ['BOOKS', 'NEWS'],
  clothing: ['CLOTHING', 'SHOES', 'BOUTIQUE'],
  jewelry: ['JEWELRY', 'WATCHES'],
  grocery: ['GROCERY', 'MARKET', 'DELI', 'PRODUCE'],
  fishmarket: ['FISH MARKET', 'SEAFOOD'],
  tea: ['TEA', 'TEA HOUSE'],
  wine: ['WINE', 'LIQUORS'],
  gifts: ['GIFTS', 'SOUVENIRS', 'ART', 'TOYS'],
  flowers: ['FLOWERS', 'FLORIST'],
  salon: ['SALON', 'BARBER', 'NAILS'],
  herbs: ['HERBS', 'TEA'],
  electronics: ['ELECTRONICS', 'PHONES', 'CAMERAS'],
  sports: ['BIKES', 'SPORTS', 'OUTDOOR'],
  shop: ['SHOP', 'STORE', 'GOODS'],
  hotel: ['HOTEL', 'INN'],
  gallery: ['GALLERY', 'ART'],
  lobby: ['LOBBY'],
};

// the one Chinese character a Chinatown sign adds for its category (no character → English only)
export const SIGN_ZH = {
  restaurant: '食', chinese: '食', seafood: '魚', fishmarket: '魚', cafe: '茶', tea: '茶', herbs: '草', bakery: '包',
  books: '書', clothing: '衣', jewelry: '玉', grocery: '市', gifts: '品', flowers: '花', bar: '酒', wine: '酒',
  bank: '金', salon: '美', shop: '店', hotel: '店', icecream: '冰', fastfood: '食',
};

// every string a sign may show
export const GENERIC = new Set([...Object.values(SIGN_TEXT).flat(), ...Object.values(SIGN_ZH)]);

// district defaults for storefronts with no OSM category in their footprint (weights)
export const DISTRICT_MIX = {
  embarcadero: { cafe: 4, restaurant: 3, lobby: 4, bank: 1, shop: 2, salon: 1, fastfood: 2, books: 1, pharmacy: 1 },
  wharf: { seafood: 5, gifts: 4, icecream: 2, restaurant: 2, fastfood: 2, clothing: 1, fishmarket: 1 },
  chinatown: { chinese: 4, grocery: 3, gifts: 3, jewelry: 2, herbs: 2, tea: 1, bakery: 2, shop: 1 },
  northbeach: { cafe: 4, restaurant: 4, bar: 3, bakery: 1, books: 1, shop: 1 },
  sausalito: { gallery: 3, gifts: 3, cafe: 2, restaurant: 3, icecream: 1, clothing: 2, wine: 1 },
};

// District areas (lat / lon boxes, first match wins); everything else in SF is `embarcadero` commercial, and the
// Sausalito box is `sausalito`.
export const DISTRICTS = [
  { name: 'chinatown', south: 37.7905, north: 37.7975, west: -122.4090, east: -122.4045 },
  { name: 'wharf', south: 37.8055, north: 37.8110, west: -122.4235, east: -122.4080 },
  { name: 'northbeach', south: 37.7975, north: 37.8045, west: -122.4130, east: -122.4045 },
];

// Business categories as numbers for the storefront data (run 3, D94): module palette = board + ink·8 + awning·64 +
// category·512 (0 = no business: an unlabelled or residential frontage). Order is part of the data format: append only.
export const CATEGORIES = Object.keys(SIGN_TEXT);
export const CATEGORY_ID = Object.fromEntries(CATEGORIES.map((c, i) => [c, i + 1]));
// one business's look, shared by the pipeline (what is baked) and the runtime (older data): awning or not, blade
// sign / neon likelihood. Awnings on food, hotels, grocers, florists and Chinatown shops; none on banks, clinics,
// pharmacies, bars, galleries, jewellers, electronics or lobbies.
export const AWNING = new Set(['cafe', 'restaurant', 'chinese', 'seafood', 'fishmarket', 'bakery', 'icecream', 'grocery', 'hotel', 'flowers', 'tea', 'wine', 'gifts', 'fastfood']);
export const NEON = new Set(['bar', 'theatre', 'chinese', 'fastfood']);
// typical frontage of one business (m) — a POI claims about this much of its building's street face
export const FRONTAGE = { restaurant: 9, chinese: 9, seafood: 10, cafe: 6, fastfood: 7, icecream: 5, bar: 8, bank: 10, pharmacy: 10, theatre: 14, clinic: 7, bakery: 6, books: 7, clothing: 7, jewelry: 5, grocery: 14, fishmarket: 8, tea: 5, wine: 6, gifts: 6, flowers: 5, salon: 5, herbs: 5, electronics: 6, sports: 9, shop: 6, hotel: 9, gallery: 8, lobby: 5 };
