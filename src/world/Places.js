// Signs over the main San Francisco landmarks inside the slice (DECISIONS D43). World frame metres (BayFrame);
// the modelled landmarks use their anchors (public/landmarks/index.json), the rest were converted from WGS84
// (lat / lon in the comments) with tools/geo/utm.mjs; the conversion puts Coit Tower and the Transamerica Pyramid
// within 1 m of their model anchors. Left out: Bay Bridge (its span is east of the slice), Oracle Park, Treasure
// Island and Tiburon (outside), Salesforce Tower (not in the 2016 building heights).
// `model`: a landmark mesh stands there (the sign goes above its top, the highest point within `r` m, default
// 80); `waypoint`: WAYPOINTS index to fly to.
export const PLACES = [
	{ name: 'Golden Gate Bridge', x: - 3611, z: 855, model: true, r: 700, waypoint: 4 }, // mid-span; r takes in the towers
	{ name: 'Ferry Building', x: 3884, z: 3507, model: true, waypoint: 0 },
	{ name: 'Transamerica Pyramid', x: 3076, z: 3543, model: true, waypoint: 1 },
	{ name: 'Coit Tower', x: 2802, z: 2745, model: true, waypoint: 2 },
	{ name: 'Alcatraz', x: 1337, z: 105, model: true, waypoint: 3 },
	{ name: 'Sausalito', x: - 3544, z: - 3185, waypoint: 5 }, // ferry landing (public/ferry/route.json)
	{ name: 'Pier 39', x: 2449, z: 2046 }, // 37.8087, -122.4098
	{ name: 'Fisherman\'s Wharf', x: 1754, z: 2128 }, // 37.8080, -122.4177
	{ name: 'Ghirardelli Square', x: 1297, z: 2375 }, // 37.8058, -122.4229
	{ name: 'Lombard Street', x: 1670, z: 2783 }, // 37.8021, -122.4187
	{ name: 'Fort Mason', x: 496, z: 2346 }, // 37.8061, -122.4320
	{ name: 'Palace of Fine Arts', x: - 945, z: 2710 }, // 37.8029, -122.4484
	{ name: 'Crissy Field', x: - 2408, z: 2541 }, // 37.8045, -122.4650
	{ name: 'Presidio', x: - 2510, z: 3163 }, // 37.7989, -122.4662
	{ name: 'Fort Point', x: - 3477, z: 1881 }, // 37.8105, -122.4771
	{ name: 'Angel Island', x: 476, z: - 3823 }, // Mount Livermore, 37.8617, -122.4318
	{ name: 'Exploratorium', x: 3536, z: 2838 }, // Pier 15, 37.8015, -122.3975
	{ name: 'Chinatown', x: 2813, z: 4029 }, // Dragon Gate, 37.7908, -122.4058
];
