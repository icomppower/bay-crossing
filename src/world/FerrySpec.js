// The ferry: dimensions of MV Golden Gate (ex-Chinook), a Golden Gate Ferry catamaran on the fleet that serves
// the Sausalito route (Wikipedia, "MV Golden Gate": 143 ft 3 in / 43.7 m long, 39 ft 4 in / 12.0 m beam,
// 5 ft / 1.5 m draft, waterjets, 38 kn, 350 passengers). See DECISIONS.md D33.
export const FERRY = {
	name: 'MV Golden Gate',
	length: 43.7, // m overall
	beam: 12.0, // m overall
	draft: 1.5, // m, hull bottom below the design waterline
	topSpeedKn: 38,
	hullWidth: 3.1, // m, each demihull at the waterline
	hullSpacing: 8.6, // m, demihull centreline to centreline
	deckY: 2.4, // m, main deck above the waterline
	mass: 120000, // kg, loaded displacement
};

export const KNOT = 0.514444; // m/s
