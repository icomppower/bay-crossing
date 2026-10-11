// WGS84 lat/lon → UTM zone 10N → Bay Crossing local metres (x east, z south; map.json frame origin).
// Snyder's transverse Mercator series (sub-millimetre at this latitude) — only used to place the district boxes.
const A = 6378137, F = 1 / 298.257223563, K0 = 0.9996, E2 = F * ( 2 - F ), EP2 = E2 / ( 1 - E2 );
const ORIGIN_E = 549504, ORIGIN_N = 4186800, LON0 = - 123 * Math.PI / 180; // zone 10 central meridian

export function toUTM10( lat, lon ) {

	const phi = lat * Math.PI / 180, lam = lon * Math.PI / 180;
	const N = A / Math.sqrt( 1 - E2 * Math.sin( phi ) ** 2 ), T = Math.tan( phi ) ** 2, C = EP2 * Math.cos( phi ) ** 2;
	const a = Math.cos( phi ) * ( lam - LON0 );
	const M = A * ( ( 1 - E2 / 4 - 3 * E2 ** 2 / 64 - 5 * E2 ** 3 / 256 ) * phi - ( 3 * E2 / 8 + 3 * E2 ** 2 / 32 + 45 * E2 ** 3 / 1024 ) * Math.sin( 2 * phi )
		+ ( 15 * E2 ** 2 / 256 + 45 * E2 ** 3 / 1024 ) * Math.sin( 4 * phi ) - ( 35 * E2 ** 3 / 3072 ) * Math.sin( 6 * phi ) );
	const E = K0 * N * ( a + ( 1 - T + C ) * a ** 3 / 6 + ( 5 - 18 * T + T * T + 72 * C - 58 * EP2 ) * a ** 5 / 120 ) + 500000;
	const Nn = K0 * ( M + N * Math.tan( phi ) * ( a * a / 2 + ( 5 - T + 9 * C + 4 * C * C ) * a ** 4 / 24 + ( 61 - 58 * T + T * T + 600 * C - 330 * EP2 ) * a ** 6 / 720 ) );
	return [ E, Nn ];

}

export function toLocal( lat, lon ) {

	const [ E, N ] = toUTM10( lat, lon );
	return [ E - ORIGIN_E, ORIGIN_N - N ];

}

// a lat/lon box → local { x0, x1, z0, z1 }
export function localBox( south, west, north, east ) {

	const [ x0, z1 ] = toLocal( south, west ), [ x1, z0 ] = toLocal( north, east );
	return { x0: Math.min( x0, x1 ), x1: Math.max( x0, x1 ), z0: Math.min( z0, z1 ), z1: Math.max( z0, z1 ) };

}
