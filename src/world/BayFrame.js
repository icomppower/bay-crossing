// The world frame of the bay (DECISIONS D14): metres, y up, x east, z south, origin at the centre of the
// slice extent in UTM zone 10N (EPSG:32610). Heights are NAVD88 metres; sea level is y = 0.
// Must match data/slice.json (G1 checks it).
export const FRAME = {
	originE: 549504, // (544800 + 554208) / 2
	originN: 4186800, // (4182000 + 4191600) / 2
	size: 9600, // square world domain side (m), covers the 9408 x 9600 m extent
};

export const toLocal = ( E, N ) => ( { x: E - FRAME.originE, z: FRAME.originN - N } );
export const toUTM = ( x, z ) => ( { E: x + FRAME.originE, N: FRAME.originN - z } );
