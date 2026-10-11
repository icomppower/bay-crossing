// Fewer repeated signs (run 3 fix). The storefront pipeline gives every module on a building the category of that
// building's OSM tag and seeds a text per module, so one clinic, bank or hotel put its boards over a whole block face
// ("CLINIC DENTIST CLINIC DENTIST…"). Here a module keeps its sign only if no module already kept within a radius has
// a sign of the same category: 30 m for the one-per-block kinds (clinic, bank, pharmacy, hotel, theatre…), 12 m for
// shops and food, which do cluster on real streets. The rest show a blank board (sign −1) with no blade sign or neon.
// Deterministic (module order), in place on the module array (12 floats: x0 z0 y0 H | x1 z1 y1 seed | kind flags sign palette).
import { SIGN_TEXT, CATEGORY_ID, AWNING } from '../../pipelines/street/signs.mjs';

const CATEGORY = new Map();
for ( const [ cat, list ] of Object.entries( SIGN_TEXT ) ) for ( const t of list ) if ( ! CATEGORY.has( t ) ) CATEGORY.set( t, cat );
const WIDE = new Set( [ 'clinic', 'bank', 'pharmacy', 'hotel', 'theatre', 'books', 'electronics', 'sports', 'jewelry', 'lobby' ] );

export function thinSignRuns( m, texts ) {

	const C = 30, grid = new Map();
	let kept = 0, blanked = 0;
	for ( let o = 0; o < m.length; o += 12 ) {

		const s = m[ o + 10 ];
		if ( s < 0 ) continue;
		const cat = CATEGORY.get( english( texts[ s ] ) ) ?? texts[ s ];
		const R = WIDE.has( cat ) ? 30 : 12;
		const x = ( m[ o ] + m[ o + 4 ] ) / 2, z = ( m[ o + 1 ] + m[ o + 5 ] ) / 2, gx = Math.floor( x / C ), gz = Math.floor( z / C );
		let near = false;
		for ( let a = gx - 1; a <= gx + 1 && ! near; a ++ ) for ( let b = gz - 1; b <= gz + 1 && ! near; b ++ ) for ( const [ px, pz, pc ] of grid.get( a * 100003 + b ) || [] ) if ( pc === cat && Math.hypot( px - x, pz - z ) < R ) { near = true; break; }
		if ( near ) { m[ o + 10 ] = - 1; m[ o + 9 ] = m[ o + 9 ] & ~( 2 | 8 ); blanked ++; continue; }
		const k = gx * 100003 + gz;
		if ( ! grid.has( k ) ) grid.set( k, [] );
		grid.get( k ).push( [ x, z, cat ] );
		kept ++;

	}

	return { kept, blanked };

}

const english = ( t ) => t.replace( /^[⺀-鿿]\s+/, '' );

// Storefront data baked before D94 has no business category: give each signed module the category its sign names
// (palette += id·512) and that category's awning, so the shop looks per business (D95) work on it too. Call before
// thinSignRuns, so the modules whose repeated sign goes blank keep their business look.
export function categorizeOldStores( m, texts ) {

	let n = 0;
	for ( let o = 0; o < m.length; o += 12 ) {

		const s = m[ o + 10 ];
		if ( s < 0 || m[ o + 11 ] >= 512 ) continue;
		const cat = CATEGORY.get( english( texts[ s ] ) );
		if ( ! cat ) continue;
		m[ o + 11 ] += CATEGORY_ID[ cat ] * 512;
		m[ o + 9 ] = AWNING.has( cat ) ? ( m[ o + 9 ] | 1 ) : ( m[ o + 9 ] & ~ 1 );
		n ++;

	}

	return n;

}
