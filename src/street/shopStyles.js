// Shopfront look per kind of business (run 3, D95). The storefront module carries its business category
// (pipelines/street/signs.mjs CATEGORY_ID, packed as palette·512); this module turns it into a look: sign board and
// lettering, awning (plain or striped), frame material, pilasters and bulkhead, frosted glass, and what shows through
// the window — shelves (grocers, pharmacies, bookshops), tables under pendant lamps (food and drink), lit displays
// (fashion, jewellers, galleries), or a counter (banks, clinics, hotels, salons) — and its light at night.
// Category 0 (no business: unlabelled frontage) keeps the run-2 seeded palette and a dim, empty interior.
import { ShaderModule } from 'harbor-engine/src/engine/gpu/Shader.js';

export const shopModule = new ShaderModule( { name: 'shop-styles', code: /* wgsl */`
struct ShopStyle {
	board: vec3f, ink: vec3f, awnA: vec3f, awnB: vec3f, stripe: f32,
	frame: vec3f, frameMetal: f32, pilaster: vec3f, bulkhead: vec3f,
	inside: vec3f, day: f32, pattern: u32, frost: f32, nightC: vec3f, nightK: f32,
};
// pattern: 0 empty, 1 shelves, 2 tables + pendant lamps, 3 lit displays, 4 counter, 5 dark bar
fn shopStyle( cat: u32 ) -> ShopStyle {
	var s = ShopStyle( vec3f( 0.05 ), vec3f( 0.9, 0.88, 0.8 ), vec3f( 0.3 ), vec3f( 0.3 ), 0.0,
		vec3f( 0.06, 0.06, 0.065 ), 0.7, vec3f( 0.4, 0.38, 0.35 ), vec3f( 0.3, 0.3, 0.3 ),
		vec3f( 0.8, 0.75, 0.68 ), 0.06, 0u, 0.0, vec3f( 1.0, 0.8, 0.55 ), 1.6 );
	let warm = vec3f( 1.0, 0.74, 0.45 ); let cool = vec3f( 0.86, 0.93, 1.0 ); let neutral = vec3f( 1.0, 0.92, 0.8 );
	switch cat {
		case 1u: { // restaurant: burgundy awning, gold letters, warm dim room
			s.board = vec3f( 0.18, 0.03, 0.04 ); s.ink = vec3f( 0.92, 0.75, 0.32 ); s.awnA = vec3f( 0.35, 0.04, 0.06 ); s.awnB = s.awnA;
			s.frame = vec3f( 0.08, 0.05, 0.03 ); s.frameMetal = 0.0; s.bulkhead = vec3f( 0.2, 0.08, 0.06 );
			s.inside = vec3f( 0.75, 0.55, 0.38 ); s.day = 0.05; s.pattern = 2u; s.nightC = warm; s.nightK = 1.4; }
		case 2u: { // Chinese restaurant: red and gold
			s.board = vec3f( 0.5, 0.03, 0.02 ); s.ink = vec3f( 0.95, 0.78, 0.25 ); s.awnA = vec3f( 0.55, 0.04, 0.03 ); s.awnB = vec3f( 0.75, 0.55, 0.1 ); s.stripe = 0.0;
			s.frame = vec3f( 0.45, 0.05, 0.04 ); s.frameMetal = 0.0; s.pilaster = vec3f( 0.5, 0.06, 0.04 ); s.bulkhead = vec3f( 0.12, 0.3, 0.18 );
			s.inside = vec3f( 0.85, 0.6, 0.4 ); s.day = 0.07; s.pattern = 2u; s.nightC = vec3f( 1.0, 0.6, 0.4 ); s.nightK = 1.8; }
		case 3u, 17u: { // seafood restaurant / fish market: navy and white stripes
			s.board = vec3f( 0.85, 0.85, 0.82 ); s.ink = vec3f( 0.04, 0.1, 0.3 ); s.awnA = vec3f( 0.05, 0.12, 0.35 ); s.awnB = vec3f( 0.85, 0.85, 0.82 ); s.stripe = 1.0;
			s.frame = vec3f( 0.75, 0.75, 0.72 ); s.frameMetal = 0.0; s.bulkhead = vec3f( 0.05, 0.12, 0.3 );
			s.inside = vec3f( 0.8, 0.85, 0.88 ); s.day = 0.08; s.pattern = select( 2u, 1u, cat == 17u ); s.nightC = cool; s.nightK = 1.6; }
		case 4u: { // café: dark green and cream stripes, black board, warm wood, small tables
			s.board = vec3f( 0.03, 0.03, 0.03 ); s.ink = vec3f( 0.92, 0.88, 0.76 ); s.awnA = vec3f( 0.06, 0.2, 0.12 ); s.awnB = vec3f( 0.86, 0.82, 0.7 ); s.stripe = 1.0;
			s.frame = vec3f( 0.25, 0.15, 0.08 ); s.frameMetal = 0.0; s.bulkhead = vec3f( 0.22, 0.13, 0.07 );
			s.inside = vec3f( 0.82, 0.62, 0.42 ); s.day = 0.08; s.pattern = 2u; s.nightC = warm; s.nightK = 1.6; }
		case 5u: { // fast food: bright, red board, white light
			s.board = vec3f( 0.6, 0.06, 0.04 ); s.ink = vec3f( 0.98, 0.9, 0.3 ); s.awnA = vec3f( 0.6, 0.06, 0.04 ); s.awnB = s.awnA;
			s.frame = vec3f( 0.7, 0.7, 0.7 ); s.frameMetal = 0.8; s.inside = vec3f( 0.92, 0.9, 0.85 ); s.day = 0.16; s.pattern = 4u; s.nightC = cool; s.nightK = 2.2; }
		case 6u: { // ice cream: pastel pink and mint
			s.board = vec3f( 0.92, 0.7, 0.75 ); s.ink = vec3f( 0.3, 0.12, 0.2 ); s.awnA = vec3f( 0.92, 0.62, 0.7 ); s.awnB = vec3f( 0.7, 0.9, 0.8 ); s.stripe = 1.0;
			s.frame = vec3f( 0.9, 0.9, 0.88 ); s.frameMetal = 0.0; s.inside = vec3f( 0.95, 0.88, 0.88 ); s.day = 0.14; s.pattern = 4u; s.nightC = neutral; s.nightK = 1.8; }
		case 7u: { // bar: black front, small dark windows, neon does the talking
			s.board = vec3f( 0.02, 0.02, 0.02 ); s.ink = vec3f( 0.9, 0.85, 0.75 ); s.frame = vec3f( 0.02, 0.02, 0.025 ); s.frameMetal = 0.0;
			s.pilaster = vec3f( 0.05, 0.05, 0.06 ); s.bulkhead = vec3f( 0.04, 0.03, 0.03 );
			s.inside = vec3f( 0.5, 0.25, 0.15 ); s.day = 0.015; s.pattern = 5u; s.nightC = vec3f( 1.0, 0.45, 0.25 ); s.nightK = 0.9; }
		case 8u: { // bank: stone pilasters, bronze frame, navy board with gold letters, no awning
			s.board = vec3f( 0.03, 0.05, 0.14 ); s.ink = vec3f( 0.9, 0.75, 0.35 ); s.frame = vec3f( 0.45, 0.32, 0.16 ); s.frameMetal = 0.9;
			s.pilaster = vec3f( 0.62, 0.6, 0.55 ); s.bulkhead = vec3f( 0.3, 0.3, 0.3 );
			s.inside = vec3f( 0.85, 0.83, 0.78 ); s.day = 0.1; s.pattern = 4u; s.frost = 0.0; s.nightC = neutral; s.nightK = 1.0; }
		case 9u: { // pharmacy: white board, green letters, bright shelves
			s.board = vec3f( 0.92, 0.92, 0.9 ); s.ink = vec3f( 0.05, 0.45, 0.2 ); s.frame = vec3f( 0.8, 0.8, 0.8 ); s.frameMetal = 0.5;
			s.inside = vec3f( 0.95, 0.95, 0.95 ); s.day = 0.2; s.pattern = 1u; s.nightC = cool; s.nightK = 2.0; }
		case 10u: { // theatre / cinema: dark board ringed with bulbs, deep red
			s.board = vec3f( 0.08, 0.02, 0.03 ); s.ink = vec3f( 0.98, 0.92, 0.7 ); s.frame = vec3f( 0.5, 0.38, 0.15 ); s.frameMetal = 0.9;
			s.pilaster = vec3f( 0.3, 0.04, 0.05 ); s.inside = vec3f( 0.6, 0.2, 0.2 ); s.day = 0.04; s.pattern = 4u; s.nightC = warm; s.nightK = 1.4; }
		case 11u: { // clinic / dentist: white, teal letters, frosted glass to 1.8 m, cool light
			s.board = vec3f( 0.94, 0.95, 0.95 ); s.ink = vec3f( 0.0, 0.42, 0.45 ); s.frame = vec3f( 0.85, 0.86, 0.86 ); s.frameMetal = 0.3;
			s.pilaster = vec3f( 0.85, 0.85, 0.84 ); s.bulkhead = vec3f( 0.8, 0.8, 0.8 );
			s.inside = vec3f( 0.92, 0.95, 0.95 ); s.day = 0.12; s.pattern = 4u; s.frost = 1.8; s.nightC = cool; s.nightK = 1.2; }
		case 12u: { // bakery: cream and brown, warm display counter
			s.board = vec3f( 0.88, 0.8, 0.62 ); s.ink = vec3f( 0.3, 0.16, 0.06 ); s.awnA = vec3f( 0.42, 0.24, 0.1 ); s.awnB = vec3f( 0.9, 0.84, 0.68 ); s.stripe = 1.0;
			s.frame = vec3f( 0.3, 0.18, 0.08 ); s.frameMetal = 0.0; s.inside = vec3f( 0.95, 0.8, 0.55 ); s.day = 0.12; s.pattern = 4u; s.nightC = warm; s.nightK = 1.6; }
		case 13u: { // books: bottle green and gold, wood, warm shelves
			s.board = vec3f( 0.03, 0.15, 0.08 ); s.ink = vec3f( 0.9, 0.75, 0.35 ); s.frame = vec3f( 0.2, 0.11, 0.05 ); s.frameMetal = 0.0;
			s.inside = vec3f( 0.75, 0.55, 0.35 ); s.day = 0.07; s.pattern = 1u; s.nightC = warm; s.nightK = 1.4; }
		case 14u, 28u: { // fashion / gallery: white or black board, white walls, spot-lit displays
			s.board = select( vec3f( 0.02 ), vec3f( 0.95 ), cat == 28u ); s.ink = select( vec3f( 0.95 ), vec3f( 0.03 ), cat == 28u );
			s.frame = vec3f( 0.04 ); s.frameMetal = 0.6; s.pilaster = select( vec3f( 0.08 ), vec3f( 0.9 ), cat == 28u );
			s.inside = vec3f( 0.97, 0.96, 0.94 ); s.day = select( 0.14, 0.22, cat == 28u ); s.pattern = 3u; s.nightC = neutral; s.nightK = 2.0; }
		case 15u: { // jeweller: dark board, gold letters, bright little display cases
			s.board = vec3f( 0.02, 0.06, 0.04 ); s.ink = vec3f( 0.92, 0.78, 0.4 ); s.frame = vec3f( 0.5, 0.4, 0.18 ); s.frameMetal = 1.0;
			s.inside = vec3f( 0.3, 0.28, 0.25 ); s.day = 0.06; s.pattern = 3u; s.nightC = neutral; s.nightK = 2.2; }
		case 16u: { // grocery / market: green awning, produce shelves, bright
			s.board = vec3f( 0.04, 0.3, 0.12 ); s.ink = vec3f( 0.98, 0.95, 0.85 ); s.awnA = vec3f( 0.06, 0.3, 0.12 ); s.awnB = vec3f( 0.92, 0.9, 0.85 ); s.stripe = 1.0;
			s.inside = vec3f( 0.92, 0.92, 0.88 ); s.day = 0.18; s.pattern = 1u; s.nightC = cool; s.nightK = 2.0; }
		case 18u, 23u: { // tea / herbs: dark wood, jars on shelves
			s.board = vec3f( 0.15, 0.08, 0.04 ); s.ink = vec3f( 0.9, 0.8, 0.5 ); s.awnA = vec3f( 0.15, 0.25, 0.12 ); s.awnB = s.awnA;
			s.frame = vec3f( 0.18, 0.09, 0.04 ); s.frameMetal = 0.0; s.inside = vec3f( 0.7, 0.55, 0.35 ); s.day = 0.06; s.pattern = 1u; s.nightC = warm; s.nightK = 1.3; }
		case 19u: { // wine / liquor: deep plum, bottles on shelves
			s.board = vec3f( 0.22, 0.03, 0.08 ); s.ink = vec3f( 0.92, 0.85, 0.7 ); s.awnA = vec3f( 0.25, 0.03, 0.08 ); s.awnB = s.awnA;
			s.inside = vec3f( 0.55, 0.35, 0.3 ); s.day = 0.06; s.pattern = 1u; s.nightC = warm; s.nightK = 1.5; }
		case 20u: { // gifts / souvenirs: bright, busy displays
			s.board = vec3f( 0.05, 0.25, 0.5 ); s.ink = vec3f( 0.98, 0.9, 0.3 ); s.awnA = vec3f( 0.05, 0.25, 0.5 ); s.awnB = vec3f( 0.95, 0.9, 0.85 ); s.stripe = 1.0;
			s.inside = vec3f( 0.92, 0.88, 0.8 ); s.day = 0.16; s.pattern = 1u; s.nightC = neutral; s.nightK = 2.0; }
		case 21u: { // florist: green frame, buckets of flowers low in the window
			s.board = vec3f( 0.08, 0.25, 0.12 ); s.ink = vec3f( 0.98, 0.95, 0.9 ); s.awnA = vec3f( 0.08, 0.25, 0.12 ); s.awnB = s.awnA;
			s.frame = vec3f( 0.08, 0.22, 0.1 ); s.frameMetal = 0.0; s.inside = vec3f( 0.85, 0.8, 0.75 ); s.day = 0.12; s.pattern = 3u; s.nightC = neutral; s.nightK = 1.5; }
		case 22u: { // salon / barber: black and blush, mirror band
			s.board = vec3f( 0.02 ); s.ink = vec3f( 0.95, 0.65, 0.72 ); s.frame = vec3f( 0.02 ); s.frameMetal = 0.4;
			s.inside = vec3f( 0.95, 0.92, 0.9 ); s.day = 0.14; s.pattern = 4u; s.frost = 0.9; s.nightC = neutral; s.nightK = 1.8; }
		case 24u, 25u: { // electronics / sports: blue board, cool bright displays
			s.board = vec3f( 0.04, 0.12, 0.4 ); s.ink = vec3f( 0.98 ); s.frame = vec3f( 0.6, 0.62, 0.65 ); s.frameMetal = 0.9;
			s.inside = vec3f( 0.9, 0.92, 0.95 ); s.day = 0.18; s.pattern = 3u; s.nightC = cool; s.nightK = 2.0; }
		case 26u: { // general shop
			s.board = vec3f( 0.12, 0.12, 0.13 ); s.ink = vec3f( 0.95 ); s.inside = vec3f( 0.88, 0.86, 0.82 ); s.day = 0.1; s.pattern = 1u; s.nightC = neutral; s.nightK = 1.6; }
		case 27u: { // hotel: navy canopy, brass, warm lobby
			s.board = vec3f( 0.03, 0.05, 0.14 ); s.ink = vec3f( 0.92, 0.8, 0.45 ); s.awnA = vec3f( 0.04, 0.06, 0.18 ); s.awnB = s.awnA;
			s.frame = vec3f( 0.55, 0.42, 0.2 ); s.frameMetal = 1.0; s.pilaster = vec3f( 0.6, 0.58, 0.52 );
			s.inside = vec3f( 0.9, 0.75, 0.55 ); s.day = 0.1; s.pattern = 4u; s.nightC = warm; s.nightK = 1.8; }
		default: { }
	}
	return s;
}
// what shows through the window at (x, y) metres in the module; seed varies goods and lamps
fn shopInside( st: ShopStyle, x: f32, y: f32, Lw: f32, seed: f32 ) -> vec3f {
	var c = st.inside * ( 0.75 + 0.25 * smoothstep( 0.4, 2.6, y ) );
	switch st.pattern {
		case 1u: { // shelves of goods
			let band = fract( ( y - 0.3 ) / 0.42 );
			let cell = floor( vec2f( x / 0.13, ( y - 0.3 ) / 0.42 ) );
			let h = stHash21( cell + seed * 31.0 );
			let goods = mix( vec3f( 0.8, 0.25, 0.2 ), mix( vec3f( 0.2, 0.45, 0.75 ), vec3f( 0.9, 0.8, 0.3 ), step( 0.5, h ) ), step( 0.33, h ) );
			if ( y > 0.3 && y < 2.2 ) { c = select( mix( c * 0.6, goods, 0.65 ), c * 0.35, band < 0.12 ); }
		}
		case 2u: { // tables at seat height, pendant lamps along the ceiling
			c = c * 0.55;
			let tx = fract( x / 1.3 + seed );
			if ( y < 0.78 && y > 0.7 && abs( tx - 0.5 ) < 0.3 ) { c = st.inside * 0.25; }
			if ( y < 0.7 && abs( tx - 0.5 ) < 0.04 ) { c = st.inside * 0.2; }
			if ( y > 0.85 && y < 1.15 && abs( tx - 0.5 ) > 0.3 && abs( tx - 0.5 ) < 0.42 ) { c = st.inside * 0.3; } // diners
			let lamp = length( vec2f( ( tx - 0.5 ) * 1.3, ( y - 2.45 ) * 1.6 ) );
			c = c + st.nightC * 2.5 * ( 1.0 - smoothstep( 0.05, 0.12, lamp ) );
		}
		case 3u: { // white walls, spot-lit pieces on plinths
			let px = fract( x / 1.6 + seed * 0.3 );
			let piece = abs( px - 0.5 ) < 0.12 && y > 0.6 && y < 1.9;
			if ( piece ) { c = mix( vec3f( 0.25, 0.2, 0.22 ), vec3f( 0.55, 0.3, 0.25 ), stHash11( floor( x / 1.6 ) + seed ) ); }
			if ( abs( px - 0.5 ) < 0.18 && y > 0.4 && y < 0.6 ) { c = vec3f( 0.92 ); }
			let spot = 1.0 - smoothstep( 0.1, 0.45, length( vec2f( ( px - 0.5 ) * 1.6, ( y - 1.6 ) * 0.7 ) ) );
			c = c * ( 0.7 + 0.6 * spot );
		}
		case 4u: { // a counter, a lit back wall
			if ( y > 0.45 && y < 1.05 ) { c = st.inside * 0.45 + vec3f( 0.04 ); }
			if ( y > 1.05 && y < 1.12 ) { c = vec3f( 0.6 ); }
			if ( y > 1.6 && y < 2.2 && abs( fract( x / 2.2 ) - 0.5 ) < 0.25 ) { c = c * 1.15; }
		}
		case 5u: { // a dark bar: back-bar shelf glow, little else
			c = st.inside * 0.15;
			if ( y > 1.3 && y < 1.9 ) { c = st.inside * ( 0.4 + 0.4 * stHash21( floor( vec2f( x / 0.1, y / 0.2 ) ) + seed ) ); }
		}
		default: { c = c * 0.35; }
	}
	return c;
}
` } );
