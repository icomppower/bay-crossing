// The run-3 building material (F3–F8, F13): replaces harbor-engine's flat window-grid facade on every building tile
// LOD. Per wall it knows (attributes from src/facades/model.js) where the wall starts on the ring, its length, the
// building height and SF archetype, whether it faces a street, the building seed, the bay width and the floor
// heights — so window rows sit on whole floors and windows in whole bays with corner piers (G17).
//
// Windows are recessed openings (the reveal is found by tracing the view ray to the glass plane) with interior-mapped
// rooms behind the glass (back wall, side walls, floor and ceiling of a box room per window, traced in the wall's
// tangent space), blinds, sky-lit interiors by day and a seeded share of lit rooms at night. Walls are drawn by code:
// lap siding (Victorian), stucco, running-bond brick with soldier-course heads and segmental arches (warehouse, some
// mid-rises), ashlar stone with a rusticated base and belt course (early office), curtain wall with mullions and
// spandrels (tower), shingle / clapboard (Sausalito), the pier sheds' arched bulkheads — then weathered (grime at the
// base, streaks under sills, staining under the top band) and faded to their average with distance.
import { Material } from 'harbor-engine/src/engine/render/Material.js';
import { ShaderModule } from 'harbor-engine/src/engine/gpu/Shader.js';
import { noiseModule } from '../street/wgsl.js';

export const facadeModule = new ShaderModule( { name: 'facade', code: /* wgsl */`
// archetypes: 0 victorian, 1 midrise, 2 warehouse, 3 office, 4 tower, 5 pier, 6 sausalito, 7 chinatown
struct FacadeWin { x0: f32, x1: f32, y0: f32, y1: f32, depth: f32, arch: f32 };

// window opening per archetype, in fractions of the bay (x) and of the floor (y); depth = reveal (m); arch = segmental
// arch rise as a fraction of the floor height
fn faWindow( a: u32, brick: bool ) -> FacadeWin {
	switch a {
		case 0u: { return FacadeWin( 0.19, 0.81, 0.2, 0.86, 0.14, 0.0 ); }
		case 1u: { return FacadeWin( 0.22, 0.78, 0.27, 0.8, select( 0.18, 0.24, brick ), select( 0.0, 0.05, brick ) ); }
		case 2u: { return FacadeWin( 0.2, 0.8, 0.2, 0.8, 0.28, 0.07 ); }
		case 3u: { return FacadeWin( 0.24, 0.76, 0.26, 0.8, 0.24, 0.0 ); }
		case 4u: { return FacadeWin( 0.02, 0.98, 0.24, 0.98, 0.04, 0.0 ); }
		case 5u: { return FacadeWin( 0.12, 0.88, 0.12, 0.62, 0.3, 0.12 ); }
		case 6u: { return FacadeWin( 0.22, 0.78, 0.28, 0.8, 0.1, 0.0 ); }
		default: { return FacadeWin( 0.2, 0.8, 0.25, 0.78, 0.18, 0.0 ); }
	}
}
fn faPier( a: u32 ) -> f32 {
	switch a { case 0u: { return 0.3; } case 1u: { return 0.4; } case 2u: { return 0.6; } case 3u: { return 0.7; } case 4u: { return 0.0; } case 5u: { return 0.8; } case 6u: { return 0.25; } default: { return 0.4; } }
}
fn faTop( a: u32 ) -> f32 {
	switch a { case 0u: { return 0.9; } case 1u: { return 1.0; } case 2u: { return 1.1; } case 3u: { return 1.6; } case 4u: { return 2.4; } case 5u: { return 1.2; } case 6u: { return 0.4; } default: { return 1.1; } }
}
// inside the opening (x, y in metres relative to the opening's lower-left; w, h its size; rise the arch rise)
fn faInOpening( x: f32, y: f32, w: f32, h: f32, rise: f32 ) -> bool {
	if ( x < 0.0 || x > w || y < 0.0 ) { return false; }
	let t = x / w * 2.0 - 1.0;
	return y < h + rise * ( 1.0 - t * t );
}
// running-bond brick: returns ( mortar 0..1, per-brick tone )
fn faBrick( u: f32, y: f32 ) -> vec2f {
	let row = floor( y / 0.075 );
	let x = u / 0.225 + select( 0.0, 0.5, ( i32( row ) & 1 ) == 1 );
	let fx = fract( x ); let fy = fract( y / 0.075 );
	let m = max( 1.0 - smoothstep( 0.0, 0.045, min( fx, 1.0 - fx ) ), 1.0 - smoothstep( 0.0, 0.14, min( fy, 1.0 - fy ) ) );
	return vec2f( m, stHash21( vec2f( floor( x ), row ) ) );
}
// luminance-preserving tint
fn faLum( c: vec3f ) -> f32 { return dot( c, vec3f( 0.2126, 0.7152, 0.0722 ) ); }
` } );

const VERTEX = /* wgsl */`
	o.vWall = v.aWall;
	o.vStyle = v.aStyle;
`;

const SURFACE = /* wgsl */`
	let tint = in.color.rgb;
	let N0 = normalize( in.N );
	let isWall = abs( N0.y ) < 0.5;
	let a = u32( floor( in.vs.vWall.w + 0.01 ) );
	let street = fract( in.vs.vWall.w ) > 0.05;
	let seed = in.vs.vStyle.x;
	// wall tangent along uv.x (from the screen derivatives of the world position and the uv), in uniform control flow
	let T = normalize( cross( vec3f( 0.0, 1.0, 0.0 ), select( vec3f( 0.0, 0.0, 1.0 ), N0, isWall ) ) );
	let du = dpdx( in.uv.x ) * dot( dpdx( in.P ), T ) + dpdy( in.uv.x ) * dot( dpdy( in.P ), T );
	let sgn = select( - 1.0, 1.0, du >= 0.0 );
	let fw = length( fwidth( in.uv ) ); // metres per pixel on the wall: detail fades with it
	let fineFade = 1.0 - smoothstep( 0.012, 0.05, fw );
	let midFade = 1.0 - smoothstep( 0.08, 0.35, fw );

	var albedo = tint;
	var rough = 0.85;
	var metal = 0.0;
	var emit = vec3f( 0.0 );
	var nrm = N0;
	var ao = 1.0;
	var spec = 1.0;

	if ( isWall ) {

		let u = in.uv.x - in.vs.vWall.x;
		let L = in.vs.vWall.y;
		let H = in.vs.vWall.z;
		let y = in.uv.y;
		let bw = in.vs.vStyle.y;
		let f = in.vs.vStyle.z;
		let g = in.vs.vStyle.w;
		let pier = faPier( a );
		let upper = select( 0.0, floor( ( H - g ) / max( f, 0.5 ) + 0.001 ), f > 0.0 );
		let topY = select( H, g + upper * f, f > 0.0 );
		let brickWall = a == 2u || ( a == 1u && seed > 0.62 ) || ( a == 7u && seed > 0.8 );
		let win = faWindow( a, brickWall );
		let trim = select( select( vec3f( 0.78, 0.76, 0.72 ), vec3f( 0.92, 0.91, 0.87 ), a == 0u || a == 6u ), tint * 0.62, a == 0u && seed > 0.7 );

		// ---- wall material (base colour, by archetype)
		var wallC = tint;
		var lineC = 0.0; // mortar / siding / joint darkening
		if ( a == 0u || ( a == 6u && seed < 0.55 ) ) {
			// lap siding (0.15 m boards) with a shadow line under each board
			let fy = fract( y / 0.15 );
			lineC = ( 1.0 - smoothstep( 0.0, 0.18, fy ) ) * 0.35 * fineFade;
		} else if ( a == 6u ) {
			// shingles: staggered 0.18 × 0.13 m
			let row = floor( y / 0.13 );
			let sx = fract( u / 0.18 + stHash11( row ) );
			lineC = max( ( 1.0 - smoothstep( 0.0, 0.2, fract( y / 0.13 ) ) ) * 0.4, ( 1.0 - smoothstep( 0.0, 0.08, min( sx, 1.0 - sx ) ) ) * 0.3 ) * fineFade;
			wallC = wallC * ( 0.88 + 0.24 * stHash21( vec2f( floor( u / 0.18 + stHash11( row ) ), row ) ) * fineFade );
		} else if ( brickWall ) {
			let b = faBrick( u, y );
			wallC = wallC * mix( 1.0, 0.82 + 0.3 * b.y, fineFade );
			wallC = mix( wallC, vec3f( 0.55, 0.52, 0.48 ) * 0.8, b.x * 0.75 * fineFade );
		} else if ( a == 3u ) {
			// ashlar: 1.2 × 0.6 m blocks; rusticated base (deep joints every 0.5 m) up to the second floor
			let base = y < g + f;
			let by = select( 0.6, 0.5, base );
			let row = floor( y / by );
			let bx = fract( u / 1.2 + select( 0.0, 0.5, ( i32( row ) & 1 ) == 1 ) );
			let jy = 1.0 - smoothstep( 0.0, select( 0.03, 0.09, base ), min( fract( y / by ), 1.0 - fract( y / by ) ) );
			let jx = select( 1.0 - smoothstep( 0.0, 0.02, min( bx, 1.0 - bx ) ), 0.0, base );
			lineC = max( jy * select( 0.18, 0.45, base ), jx * 0.15 ) * midFade;
			wallC = wallC * select( 1.0, 0.86, base );
		} else if ( a == 4u ) {
			wallC = tint;
		} else {
			// stucco / painted concrete
			wallC = wallC * ( 0.93 + 0.12 * stFbm( vec2f( u, y ) * 1.7 + seed * 31.0 ) * midFade );
		}
		albedo = wallC * ( 1.0 - lineC );

		// ---- floors, bays and the opening this pixel belongs to
		let inUpper = y >= g && y < topY && f > 0.0;
		let ground = y < g;
		let fl = select( 0.0, floor( ( y - g ) / max( f, 0.5 ) ), inUpper );
		let floorBase = select( 0.0, g + fl * f, inUpper );
		let floorH = select( g, f, inUpper );
		let bayOk = bw > 0.0 && u > pier && u < L - pier;
		let bi = floor( ( u - pier ) / max( bw, 0.01 ) );
		let bayX = pier + bi * bw;
		// the ground floor of a street face is the storefront band (run 2 modules stand in front of it)
		let groundWindows = ground && ! street && a != 5u && a != 4u;
		var wx0 = bayX + win.x0 * bw; var wx1 = bayX + win.x1 * bw;
		var wy0 = floorBase + win.y0 * floorH; var wy1 = floorBase + win.y1 * floorH;
		var rise = win.arch * floorH;
		var depth = win.depth;
		if ( a == 5u && ground ) { wy0 = 0.0; wy1 = g * 0.62; rise = g * 0.22; }
		if ( a == 5u && inUpper ) { wy0 = floorBase + 0.45 * floorH; wy1 = floorBase + 0.8 * floorH; rise = 0.0; } // clerestory
		let hasOpening = bayOk && ( inUpper || groundWindows || ( a == 5u && ground ) );
		let ow = wx1 - wx0; let oh = wy1 - wy0;
		let inOpen = hasOpening && faInOpening( u - wx0, y - wy0, ow, oh, rise );

		// ---- top band: cornice frieze / parapet zone, belt course, sills, window trim
		if ( y >= topY ) {
			albedo = select( mix( wallC, trim, 0.55 ), wallC * 0.92, a == 4u || a == 2u );
			if ( a == 0u || a == 3u ) {
				// dentils under the frieze
				let d = fract( u / 0.22 );
				if ( y < topY + 0.18 && d < 0.5 ) { albedo = albedo * 0.72; }
			}
		}
		if ( a == 3u && abs( y - ( g + f ) ) < 0.22 ) { albedo = trim * 1.05; } // belt course over the base
		if ( a == 4u && inUpper ) {
			// curtain wall: spandrel band at each slab, mullions every bay
			let fy = ( y - floorBase ) / floorH;
			let mull = abs( fract( ( u - pier ) / max( bw, 0.01 ) + 0.5 ) - 0.5 ) * bw < 0.05;
			if ( fy < win.y0 ) { albedo = tint * 0.55 + vec3f( 0.04 ); rough = 0.35; metal = 0.5; }
			if ( mull ) { albedo = vec3f( 0.22, 0.23, 0.25 ); rough = 0.35; metal = 0.8; }
		}
		if ( hasOpening && ! inOpen && a != 4u ) {
			// window surround (trim) and sill
			let tw = select( 0.1, 0.16, a == 0u || a == 3u );
			let surround = faInOpening( u - wx0 + tw, y - wy0 + tw * 0.6, ow + 2.0 * tw, oh + tw * 1.6, rise );
			let sill = u > wx0 - tw - 0.06 && u < wx1 + tw + 0.06 && y < wy0 && y > wy0 - 0.12;
			if ( surround && ( a == 0u || a == 3u || a == 6u || ( a == 1u && ! brickWall ) || a == 7u ) ) { albedo = trim; }
			if ( brickWall && surround && y > wy1 - 0.02 ) { albedo = wallC * 0.78; } // soldier-course head
			if ( sill ) { albedo = trim * 0.95; nrm = normalize( N0 + vec3f( 0.0, 0.7, 0.0 ) ); }
		}

		// ---- weathering: grime at the base, streaks under sills, staining under the top band, large-scale variation
		let grime = 1.0 - 0.28 * ( 1.0 - smoothstep( 0.0, 1.6, y ) );
		let col = select( 0.0, 1.0, bayOk && u > wx0 - 0.05 && u < wx1 + 0.05 && ( inUpper || groundWindows ) && y < wy0 );
		let streak = col * ( 0.55 * stNoise( vec2f( u * 9.0, y * 0.6 + seed * 13.0 ) ) ) * ( 1.0 - smoothstep( 0.0, 1.1, wy0 - y ) ) * 0.22;
		let topStain = select( 0.0, 0.14 * ( 1.0 - smoothstep( 0.0, 1.8, topY - y ) ) * stNoise( vec2f( u * 3.0, seed * 7.0 ) ), y < topY && a != 4u );
		let big = 0.9 + 0.2 * stFbm( vec2f( u, y ) * 0.09 + seed * 11.0 );
		albedo = albedo * grime * ( 1.0 - streak * midFade - topStain ) * mix( 1.0, big, select( 1.0, 0.3, a == 4u ) );

		// ---- the opening: reveal or glass + room behind
		if ( inOpen ) {
			let V = normalize( frame.cameraPos - in.P );
			let rt = - dot( V, T ) * sgn;   // along the wall (uv.x), per unit of ray
			let ry = - V.y;
			let rn = max( dot( V, N0 ), 0.06 ); // into the wall
			// where the ray meets the glass plane (depth = reveal)
			let gu = u + rt / rn * depth;
			let gy = y + ry / rn * depth;
			let onGlass = faInOpening( gu - wx0, gy - wy0, ow, oh, rise );
			if ( ! onGlass ) {
				// reveal: jamb / head / sill side of the recess
				albedo = select( wallC * 0.62, trim * 0.7, a == 0u || a == 3u );
				rough = 0.9; metal = 0.0;
				let side = select( select( 0.0, - 1.0, gy > wy1 ), 1.0, gy < wy0 );
				nrm = normalize( N0 * 0.4 + T * sgn * sign( rt ) * select( 0.9, 0.0, abs( side ) > 0.5 ) + vec3f( 0.0, side * 0.9, 0.0 ) );
				ao = 0.7;
			} else {
				// glass: dark base, reflections from the engine (smooth dielectric); the room shows through by emission
				let wid = vec2f( floor( ( u - pier ) / max( bw, 0.01 ) ), select( - 1.0, fl, inUpper ) ) + vec2f( seed * 97.0, seed * 61.0 );
				let h1 = stHash21( wid ); let h2 = stHash21( wid + 7.3 ); let h3 = stHash21( wid + 19.1 );
				albedo = select( vec3f( 0.025, 0.03, 0.034 ), mix( vec3f( 0.03, 0.035, 0.04 ), tint * 0.3, 0.6 ), a == 4u );
				rough = 0.04; metal = select( 0.0, 0.5, a == 4u );
				spec = select( 0.55, 1.0, a == 4u ); // punched windows: less sky in the glass, more room
				// muntins: Victorian / Sausalito double-hung sash (meeting rail + 2 lites), warehouse multi-pane
				let lx = ( gu - wx0 ) / ow; let ly = ( gy - wy0 ) / oh;
				var bar = false;
				if ( a == 0u || a == 6u ) { bar = abs( ly - 0.52 ) < 0.025 || lx < 0.04 || lx > 0.96; }
				if ( a == 2u || ( a == 1u && brickWall ) || a == 5u ) { bar = abs( fract( lx * 3.0 ) - 0.5 ) > 0.47 || abs( fract( ly * 4.0 ) - 0.5 ) > 0.46; }
				if ( a == 3u || a == 7u ) { bar = abs( lx - 0.5 ) < 0.02 || abs( ly - 0.66 ) < 0.02; }
				if ( bar ) {
					albedo = select( trim * 0.9, vec3f( 0.08 ), a == 2u || a == 5u ); rough = 0.6; metal = 0.0;
				} else {
					// interior box: x across the bay (the room spans the bay), y the floor, depth D
					let D = select( 4.5, 3.2, a == 0u || a == 6u );
					let rx0 = bayX; let rx1 = bayX + bw;
					let ry0 = select( floorBase, 0.0, ! inUpper ) + 0.02; let ry1 = select( floorBase + floorH, g, ! inUpper ) - 0.25;
					let tb = D / rn;
					let tx = select( ( rx0 - gu ) / min( rt, - 1e-4 ), ( rx1 - gu ) / max( rt, 1e-4 ), rt > 0.0 );
					let ty = select( ( ry0 - gy ) / min( ry, - 1e-4 ), ( ry1 - gy ) / max( ry, 1e-4 ), ry > 0.0 );
					let t = min( tb, min( tx, ty ) );
					let hu = gu + rt * t; let hy = gy + ry * t; let hd = rn * t;
					let roomTone = mix( vec3f( 0.62, 0.58, 0.52 ), vec3f( 0.75, 0.72, 0.66 ), h1 );
					var rc = roomTone;
					if ( t == ty ) { rc = select( mix( vec3f( 0.32, 0.22, 0.14 ), vec3f( 0.45, 0.42, 0.38 ), h2 ), vec3f( 0.82 ), ry > 0.0 ); }
					else if ( t == tx ) { rc = roomTone * 0.82; }
					else {
						// back wall: a door or a picture / shelf, skirting
						let bx = ( hu - rx0 ) / bw;
						if ( abs( bx - h2 ) < 0.12 && hy - ry0 < 2.1 ) { rc = roomTone * 0.6; }
						if ( abs( bx - fract( h2 + 0.5 ) ) < 0.1 && abs( hy - ry0 - 1.6 ) < 0.3 ) { rc = mix( vec3f( 0.2, 0.25, 0.3 ), vec3f( 0.5, 0.3, 0.2 ), h3 ); }
					}
					if ( hy - ry0 < 0.12 && t != ty ) { rc = rc * 0.7; }
					// day: lit by the sky through the window, darker with depth; night: a seeded share of rooms lit
					let office = a == 3u || a == 4u;
					let litShare = select( 0.4, 0.46, office );
					let lit = step( 1.0 - litShare, h3 ) * frame.night;
					let fall = exp( - hd * 0.3 );
					let lampC = select( vec3f( 1.0, 0.72, 0.42 ), vec3f( 0.85, 0.9, 1.0 ), office );
					let lamp = lampC * 1.0 * ( 0.45 + 0.55 * select( exp( - hd * 0.12 ), 1.0, t == ty && ry > 0.0 ) );
					// day: the room is seen through the glass as a darker, depth-faded version of itself (part of the
					// albedo, so it is lit with the facade whatever the exposure); night: lit rooms glow
					var roomAlb = rc * ( 0.18 + 0.32 * fall );
					var roomEmit = rc * lamp * lit;
					// blinds / curtains on some windows, at the glass
					let blind = h2 < 0.38 && ly > 1.0 - ( 0.25 + 0.6 * h1 );
					if ( blind ) {
						let fab = select( vec3f( 0.86, 0.84, 0.78 ), vec3f( 0.75, 0.62, 0.5 ), h1 > 0.6 );
						roomAlb = fab * 0.7;
						roomEmit = fab * lampC * 0.7 * lit;
						if ( abs( fract( ly * 18.0 ) - 0.5 ) < 0.08 && office ) { roomAlb = roomAlb * 0.75; }
					}
					// Fresnel: grazing views show more reflection, less room
					let fr = 0.04 + 0.96 * pow( 1.0 - rn, 5.0 );
					let see = ( 1.0 - fr ) * select( 1.0, 0.4, a == 4u );
					albedo = mix( albedo, roomAlb, see );
					emit = roomEmit * see;
					albedo = mix( vec3f( faLum( albedo ) ), albedo, midFade );
				}
			}
		}

	} else {

		// roofs: the run-1 roof colour (aerial imagery or palette) with gravel / membrane breakup
		albedo = tint * ( 0.9 + 0.18 * stNoise( in.P.xz * 1.3 ) * midFade );
		rough = 0.92;

	}

	s.albedo = albedo;
	s.roughness = rough;
	s.metalness = metal;
	s.emissive = emit;
	s.normal = nrm;
	s.ao = ao;
	s.specularIntensity = s.specularIntensity * spec;
`;

export function facadeMaterial() {

	return new Material( {
		name: 'bay-facades',
		modules: [ noiseModule, facadeModule ],
		vertexColors: true,
		roughness: 0.85,
		attributes: { aWall: 'vec4f', aStyle: 'vec4f' },
		varyings: { vWall: 'vec4f', vStyle: 'vec4f' },
		vertex: VERTEX,
		surface: SURFACE,
	} );

}
