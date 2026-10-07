import { InstancedBufferGeometry, BufferAttribute, InstancedInterleavedBuffer, InterleavedBufferAttribute, Mesh } from 'harbor-engine/src/engine/index.js';
import { Material } from 'harbor-engine/src/engine/render/Material.js';
import { Texture } from 'harbor-engine/src/engine/gpu/Texture.js';
import { noiseModule } from './wgsl.js';
import { drawSigns, mipChain, CELL_W, CELL_H, COLS } from './signDraw.js';

// The storefront band (D49, D50, D57): one instanced draw of a module template over every ground-floor module near
// the camera (public/street/stores.bin, pipelines/street/stores.mjs). A module is a glass shopfront / lobby door /
// roller shutter / garage / front door (drawn in the shader), pilasters, a sign board, and optionally an awning and
// a blade sign. Signs come from a code-drawn atlas (signDraw.js). Shop windows light up at dusk and night.
//
// Instance (12 floats): x0 z0 y0 H | x1 z1 y1 seed | kind flags sign palette
//   flags: 1 awning, 2 blade sign, 4 window lettering, 8 neon, 16 outward is left of x0→x1
//   palette: board + ink·8 + awning·64

// template: quads / triangles in module space (u along the wall 0..1, v up in units of H, w outward in metres)
function template() {

	const P = [], N = [], part = [];
	const quad = ( id, a, b, c, d, n ) => { for ( const p of [ a, b, c, a, c, d ] ) { P.push( ...p ); N.push( ...n ); part.push( id ); } };
	const tri = ( id, a, b, c, n ) => { for ( const p of [ a, b, c ] ) { P.push( ...p ); N.push( ...n ); part.push( id ); } };
	const out = [ 0, 0, 1 ], up = [ 0, 1, 0 ], down = [ 0, - 1, 0 ], pu = [ 1, 0, 0 ], nu = [ - 1, 0, 0 ];
	// 0 shopfront panel, 1 plinth
	quad( 0, [ 0.04, 0, 0.02 ], [ 0.96, 0, 0.02 ], [ 0.96, 0.78, 0.02 ], [ 0.04, 0.78, 0.02 ], out );
	quad( 1, [ 0, - 0.14, 0.03 ], [ 1, - 0.14, 0.03 ], [ 1, 0, 0.03 ], [ 0, 0, 0.03 ], out );
	// 2 pilasters (front + inner reveal)
	quad( 2, [ 0, 0, 0.09 ], [ 0.04, 0, 0.09 ], [ 0.04, 0.8, 0.09 ], [ 0, 0.8, 0.09 ], out );
	quad( 2, [ 0.04, 0, 0.09 ], [ 0.04, 0, 0.0 ], [ 0.04, 0.8, 0.0 ], [ 0.04, 0.8, 0.09 ], pu );
	quad( 2, [ 0.96, 0, 0.09 ], [ 1, 0, 0.09 ], [ 1, 0.8, 0.09 ], [ 0.96, 0.8, 0.09 ], out );
	quad( 2, [ 0.96, 0, 0.0 ], [ 0.96, 0, 0.09 ], [ 0.96, 0.8, 0.09 ], [ 0.96, 0.8, 0.0 ], nu );
	// 3 sign board: front, soffit, top, ends
	quad( 3, [ 0, 0.8, 0.16 ], [ 1, 0.8, 0.16 ], [ 1, 0.97, 0.16 ], [ 0, 0.97, 0.16 ], out );
	quad( 3, [ 0, 0.8, 0 ], [ 1, 0.8, 0 ], [ 1, 0.8, 0.16 ], [ 0, 0.8, 0.16 ], down );
	quad( 3, [ 0, 0.97, 0.16 ], [ 1, 0.97, 0.16 ], [ 1, 0.97, 0 ], [ 0, 0.97, 0 ], up );
	quad( 3, [ 1, 0.8, 0.16 ], [ 1, 0.8, 0 ], [ 1, 0.97, 0 ], [ 1, 0.97, 0.16 ], pu );
	quad( 3, [ 0, 0.8, 0 ], [ 0, 0.8, 0.16 ], [ 0, 0.97, 0.16 ], [ 0, 0.97, 0 ], nu );
	// 4 awning: sloped canvas (top and underside) and its two sides
	const sl = [ 0, 0.95, 0.31 ];
	quad( 4, [ 0.02, 0.79, 0.16 ], [ 0.98, 0.79, 0.16 ], [ 0.98, 0.6, 1.35 ], [ 0.02, 0.6, 1.35 ], sl );
	quad( 4, [ 0.02, 0.6, 1.35 ], [ 0.98, 0.6, 1.35 ], [ 0.98, 0.79, 0.16 ], [ 0.02, 0.79, 0.16 ], [ 0, - 0.95, - 0.31 ] );
	tri( 4, [ 0.02, 0.79, 0.16 ], [ 0.02, 0.6, 1.35 ], [ 0.02, 0.6, 0.16 ], nu );
	tri( 4, [ 0.02, 0.6, 0.16 ], [ 0.02, 0.6, 1.35 ], [ 0.02, 0.79, 0.16 ], pu );
	tri( 4, [ 0.98, 0.79, 0.16 ], [ 0.98, 0.6, 0.16 ], [ 0.98, 0.6, 1.35 ], pu );
	tri( 4, [ 0.98, 0.6, 1.35 ], [ 0.98, 0.6, 0.16 ], [ 0.98, 0.79, 0.16 ], nu );
	// 5 blade sign: a board standing out from the wall, both faces
	quad( 5, [ 0.9, 0.6, 0.95 ], [ 0.9, 0.6, 0.25 ], [ 0.9, 0.92, 0.25 ], [ 0.9, 0.92, 0.95 ], pu );
	quad( 5, [ 0.9, 0.6, 0.25 ], [ 0.9, 0.6, 0.95 ], [ 0.9, 0.92, 0.95 ], [ 0.9, 0.92, 0.25 ], nu );
	return { position: new Float32Array( P ), normal: new Float32Array( N ), part: new Float32Array( part ) };

}

// fix winding: every triangle counter-clockwise seen along its normal (module space: x = u, y = v, z = w)
function orient( t ) {

	const p = t.position, n = t.normal;
	for ( let i = 0; i < p.length; i += 9 ) {

		const ax = p[ i + 3 ] - p[ i ], ay = p[ i + 4 ] - p[ i + 1 ], az = p[ i + 5 ] - p[ i + 2 ];
		const bx = p[ i + 6 ] - p[ i ], by = p[ i + 7 ] - p[ i + 1 ], bz = p[ i + 8 ] - p[ i + 2 ];
		const cx = ay * bz - az * by, cy = az * bx - ax * bz, cz = ax * by - ay * bx;
		if ( cx * n[ i ] + cy * n[ i + 1 ] + cz * n[ i + 2 ] < 0 ) for ( let k = 0; k < 3; k ++ ) { const s = p[ i + 3 + k ]; p[ i + 3 + k ] = p[ i + 6 + k ]; p[ i + 6 + k ] = s; }

	}

	return t;

}

export function storesMaterial( atlas, rows ) {

	return new Material( {
		name: 'street-stores',
		modules: [ noiseModule ],
		attributes: { aPart: 'f32', iA: 'vec4f', iB: 'vec4f', iC: 'vec4f' },
		varyings: { vL: 'vec4f', vI: 'vec4f', vS: 'vec4f' },
		textures: { signAtlas: atlas },
		uniforms: { atlasRows: [ 'f32', rows ] },
		vertex: /* wgsl */`
	// keep (along, up, outward) right-handed: with the outside on the left of x0→x1, run the module from x1 to x0
	let leftOut = ( u32( v.iC.y + 0.5 ) & 16u ) != 0u;
	let A = select( vec3f( v.iA.x, v.iA.z, v.iA.y ), vec3f( v.iB.x, v.iB.z, v.iB.y ), leftOut );
	let B = select( vec3f( v.iB.x, v.iB.z, v.iB.y ), vec3f( v.iA.x, v.iA.z, v.iA.y ), leftOut );
	let H = v.iA.w;
	let flags = u32( v.iC.y + 0.5 );
	let kind = u32( v.iC.x + 0.5 );
	let part = u32( v.aPart + 0.5 );
	let along = vec3f( B.x - A.x, 0.0, B.z - A.z );
	let Lw = length( along );
	let t = along / max( Lw, 1e-4 );
	// outward = right of t (x east, z south): ( -t.z, 0, t.x )
	let ow = vec3f( - t.z, 0.0, t.x );
	// parts this module does not have collapse
	var keep = true;
	if ( part == 4u && ( flags & 1u ) == 0u ) { keep = false; }
	if ( part == 5u && ( flags & 2u ) == 0u ) { keep = false; }
	if ( ( part == 2u || part == 3u ) && kind >= 3u ) { keep = false; }
	let q = v.position;
	let base = mix( A, B, q.x );
	var P = base + vec3f( 0.0, q.y * H, 0.0 ) + ow * q.z;
	// the blade sign keeps a fixed size (0.7 × 1.2 m) whatever the module height
	if ( part == 5u ) { P = base + vec3f( 0.0, 2.9 + ( q.y - 0.6 ) / 0.32 * 1.2, 0.0 ) + ow * q.z; }
	if ( ! keep ) { P = A; }
	v.position = P;
	v.normal = normalize( t * v.normal.x + vec3f( 0.0, v.normal.y, 0.0 ) + ow * v.normal.z );
	o.vL = vec4f( q.x * Lw, select( q.y * H, 2.9 + ( q.y - 0.6 ) / 0.32 * 1.2, part == 5u ), q.z, f32( part ) );
	o.vI = v.iC;
	o.vS = vec4f( v.iB.w, H, Lw, 0.0 );
`,
		surface: /* wgsl */`
	let part = u32( in.vs.vL.w + 0.5 );
	let x = in.vs.vL.x;      // metres along the module
	let y = in.vs.vL.y;      // metres above the sidewalk
	let Lw = in.vs.vS.z;
	let H = in.vs.vS.y;
	let seed = in.vs.vS.x;
	let kind = u32( in.vs.vI.x + 0.5 );
	let flags = u32( in.vs.vI.y + 0.5 );
	let sign = in.vs.vI.z;
	let pal = u32( in.vs.vI.w + 0.5 );
	let boardC = pal & 7u;
	let inkC = ( pal >> 3u ) & 7u;
	let awnC = ( pal >> 6u ) & 7u;

	// sign atlas lookup (once, in uniform control flow): the board front, the blade (text runs down it) or the
	// window lettering band
	let cell = vec2f( sign % ${ COLS.toFixed( 1 ) }, floor( sign / ${ COLS.toFixed( 1 ) } ) );
	var su = clamp( x / max( Lw, 0.1 ), 0.0, 1.0 );
	var sv = clamp( ( y - 0.8 * H ) / ( 0.17 * H ), 0.0, 1.0 );
	if ( part == 5u ) { su = clamp( ( 4.1 - y ) / 1.2, 0.0, 1.0 ); sv = clamp( ( in.vs.vL.z - 0.25 ) / 0.7, 0.0, 1.0 ); }
	if ( part == 0u ) { su = clamp( ( x - 0.3 ) / max( Lw * 0.65, 0.5 ), 0.0, 1.0 ); sv = clamp( ( y - 1.55 ) / 0.6, 0.0, 1.0 ); }
	let auv = ( cell + vec2f( su, 1.0 - sv ) ) / vec2f( ${ COLS.toFixed( 1 ) }, mat.atlasRows );
	let ink = textureSample( signAtlas, smpLinearClamp, auv ).r * select( 0.0, 1.0, sign >= 0.0 );

	let boards = array<vec3f, 8>( vec3f( 0.04, 0.05, 0.06 ), vec3f( 0.45, 0.04, 0.03 ), vec3f( 0.03, 0.12, 0.06 ), vec3f( 0.02, 0.05, 0.2 ),
		vec3f( 0.7, 0.68, 0.62 ), vec3f( 0.5, 0.35, 0.12 ), vec3f( 0.12, 0.12, 0.13 ), vec3f( 0.6, 0.45, 0.05 ) );
	let inks = array<vec3f, 8>( vec3f( 0.9, 0.88, 0.8 ), vec3f( 0.95, 0.75, 0.25 ), vec3f( 0.95, 0.95, 0.95 ), vec3f( 0.85, 0.1, 0.08 ),
		vec3f( 0.1, 0.1, 0.1 ), vec3f( 0.9, 0.85, 0.3 ), vec3f( 0.9, 0.88, 0.8 ), vec3f( 0.95, 0.95, 0.95 ) );
	let neonC = array<vec3f, 8>( vec3f( 1.0, 0.2, 0.35 ), vec3f( 0.2, 0.8, 1.0 ), vec3f( 1.0, 0.55, 0.1 ), vec3f( 0.4, 1.0, 0.4 ),
		vec3f( 1.0, 0.3, 0.9 ), vec3f( 1.0, 0.9, 0.3 ), vec3f( 0.3, 0.5, 1.0 ), vec3f( 1.0, 0.25, 0.2 ) );
	let awns = array<vec3f, 8>( vec3f( 0.45, 0.05, 0.05 ), vec3f( 0.05, 0.2, 0.1 ), vec3f( 0.05, 0.08, 0.25 ), vec3f( 0.6, 0.5, 0.35 ),
		vec3f( 0.12, 0.12, 0.12 ), vec3f( 0.55, 0.25, 0.05 ), vec3f( 0.45, 0.05, 0.05 ), vec3f( 0.05, 0.2, 0.1 ) );
	let walls = array<vec3f, 4>( vec3f( 0.42, 0.4, 0.37 ), vec3f( 0.32, 0.18, 0.13 ), vec3f( 0.55, 0.52, 0.47 ), vec3f( 0.2, 0.2, 0.21 ) );
	let wallC = walls[ u32( seed * 37.0 ) % 4u ] * ( 0.85 + 0.25 * stNoise( vec2f( x, y ) * 3.0 ) );
	let night = frame.night;
	// shop interiors: warm, varied, lit after dusk (D57)
	let lit = step( 0.25, fract( seed * 13.7 ) );
	let interior = mix( vec3f( 1.0, 0.78, 0.5 ), vec3f( 0.85, 0.92, 1.0 ), step( 0.7, fract( seed * 7.3 ) ) ) * ( 0.6 + 0.4 * stNoise( vec2f( x * 1.3, y * 2.0 ) ) );

	var alb = wallC; var rough = 0.85; var metal = 0.0; var emit = vec3f( 0.0 );
	if ( part == 0u ) {
		if ( kind == 0u ) {
			// shopfront: painted bulkhead, glass with mullions and a transom, a door near one end
			let doorLeft = fract( seed * 3.1 ) < 0.5;
			let dx = select( Lw - 1.35 - x, x - 0.25, doorLeft );
			let inDoor = dx >= 0.0 && dx <= 1.1 && y < 2.4;
			let mull = abs( fract( x / max( Lw / max( floor( Lw / 1.6 ), 1.0 ), 0.5 ) + 0.5 ) - 0.5 ) * max( Lw / max( floor( Lw / 1.6 ), 1.0 ), 0.5 );
			let frameLine = min( min( mull, abs( y - 2.9 ) ), select( 9.0, min( abs( dx ), abs( dx - 1.1 ) ), y < 2.4 ) );
			let glass = y > 0.45 && frameLine > 0.05;
			if ( glass ) {
				alb = vec3f( 0.03, 0.035, 0.04 ); rough = 0.05; metal = 0.1;
				emit = interior * ( 0.06 + 1.6 * night * lit ) * select( 1.0, 0.7, inDoor );
				// painted window lettering (gold)
				if ( ( flags & 4u ) != 0u && ! inDoor ) { alb = mix( alb, vec3f( 0.75, 0.55, 0.15 ), ink ); rough = mix( rough, 0.4, ink ); metal = mix( metal, 0.8, ink ); emit *= 1.0 - ink; }
			} else if ( y <= 0.45 ) {
				alb = boards[ boardC ] * 0.8 + 0.05;
				rough = 0.6;
			} else {
				alb = vec3f( 0.06, 0.06, 0.065 ); rough = 0.4; metal = 0.7;
			}
		} else if ( kind == 1u ) {
			// lobby: stone surround, a glass double door in the middle
			let dx = abs( x - Lw * 0.5 );
			if ( dx < 1.2 && y < 2.7 && y > 0.05 ) {
				alb = vec3f( 0.03, 0.035, 0.04 ); rough = 0.05; metal = 0.1;
				emit = vec3f( 1.0, 0.9, 0.75 ) * ( 0.08 + 1.2 * night );
				if ( abs( dx ) < 0.03 || abs( dx - 1.2 ) < 0.05 ) { alb = vec3f( 0.5, 0.45, 0.35 ); metal = 0.9; rough = 0.3; emit = vec3f( 0.0 ); }
			} else {
				alb = vec3f( 0.36, 0.34, 0.32 ) * ( 0.85 + 0.25 * stNoise( vec2f( x, y ) * 6.0 ) ) * ( 1.0 - 0.15 * step( 0.97, fract( y / 0.6 ) ) );
				rough = 0.45;
			}
		} else if ( kind == 2u ) {
			// roller shutter: corrugated steel
			let rib = 0.5 + 0.5 * sin( y * 78.0 );
			alb = mix( vec3f( 0.32, 0.33, 0.33 ), vec3f( 0.2, 0.3, 0.25 ), step( 0.6, fract( seed * 5.0 ) ) ) * ( 0.8 + 0.25 * rib );
			alb *= 0.8 + 0.4 * stNoise( vec2f( x * 0.7, y * 0.7 ) + seed * 50.0 );
			rough = 0.5; metal = 0.6;
		} else if ( kind == 3u ) {
			// garage door: sectional panels below 2.3 m, stucco above
			if ( y < 2.3 && x > 0.4 && x < Lw - 0.4 ) {
				let g = abs( fract( y / 0.575 ) - 0.5 );
				alb = mix( vec3f( 0.75, 0.73, 0.68 ), vec3f( 0.35, 0.33, 0.3 ), step( 0.47, g ) ) * ( 0.9 + 0.1 * fract( seed * 11.0 ) );
				rough = 0.6;
			} else { alb = wallC * 1.2; }
		} else {
			// front door + window, stucco
			let dx = x - Lw * 0.25;
			if ( dx > 0.0 && dx < 1.0 && y < 2.2 ) { alb = mix( vec3f( 0.25, 0.08, 0.05 ), vec3f( 0.05, 0.12, 0.2 ), step( 0.5, fract( seed * 9.0 ) ) ); rough = 0.4; }
			else if ( x > Lw * 0.5 && x < Lw - 0.4 && y > 0.9 && y < 2.4 ) { alb = vec3f( 0.04 ); rough = 0.05; emit = vec3f( 1.0, 0.8, 0.55 ) * night * lit * 0.8; }
			else { alb = wallC * 1.25; }
		}
	} else if ( part == 1u ) {
		alb = wallC * 0.7; rough = 0.9;
	} else if ( part == 2u ) {
		alb = wallC; rough = 0.8;
	} else if ( part == 3u || part == 5u ) {
		let board = boards[ boardC ];
		let neon = ( flags & 8u ) != 0u;
		alb = mix( board, select( inks[ inkC ], neonC[ inkC ] * 0.35, neon ), ink );
		rough = mix( 0.5, 0.35, ink );
		if ( neon ) { emit = neonC[ inkC ] * ink * ( 0.4 + 6.0 * night ); }
		else { emit = inks[ inkC ] * ink * 0.6 * night; }
	} else {
		// awning canvas, striped on some
		let stripe = step( 0.5, fract( x / 0.45 ) ) * step( 0.55, fract( seed * 17.0 ) );
		alb = mix( awns[ awnC ], vec3f( 0.8, 0.78, 0.72 ), stripe );
		rough = 0.95;
		s.translucency = vec3f( 0.3 );
	}
	s.albedo = alb;
	s.roughness = rough;
	s.metalness = metal;
	s.emissive = emit;
`,
	} );

}

export class StreetStores {

	// data: { index: stores.json, modules: Float32Array (12 per module) }
	constructor( { index, modules }, atlasImage ) {

		this.index = index;
		this.all = modules;
		const levels = 4;
		const atlas = new Texture( { label: 'sign atlas', width: atlasImage.width, height: atlasImage.height, format: 'r8unorm', mips: levels } );
		const chain = mipChain( atlasImage, levels );
		chain.forEach( ( l, k ) => atlas.upload( l.data, { mip: k, width: l.width, height: l.height } ) );
		this.atlas = atlas;
		const t = orient( template() );
		const g = this.geometry = new InstancedBufferGeometry();
		g.setAttribute( 'position', new BufferAttribute( t.position, 3 ) );
		g.setAttribute( 'normal', new BufferAttribute( t.normal, 3 ) );
		g.setAttribute( 'aPart', new BufferAttribute( t.part, 1 ) );
		this.live = new Float32Array( Math.max( 12, modules.length ) );
		const ib = this.liveBuffer = new InstancedInterleavedBuffer( this.live, 12, 1 );
		g.setAttribute( 'iA', new InterleavedBufferAttribute( ib, 4, 0 ) );
		g.setAttribute( 'iB', new InterleavedBufferAttribute( ib, 4, 4 ) );
		g.setAttribute( 'iC', new InterleavedBufferAttribute( ib, 4, 8 ) );
		g.instanceCount = 0;
		this.material = storesMaterial( atlas, atlasImage.rows );
		this.mesh = new Mesh( g, this.material );
		this.mesh.name = 'street-stores';
		this.mesh.frustumCulled = false;
		this.mesh.castShadow = true;
		this.mesh.receiveShadow = true;
		this.radius = 300;
		this.key = '';
		this.tiles = index.tiles.map( ( [ tx, tz, start, count ] ) => ( { start, count, cx: ( tx + 0.5 ) * index.tile, cz: ( tz + 0.5 ) * index.tile } ) );

	}

	update( camera ) {

		const p = camera.position, half = this.index.tile / 2;
		const r = this.radius - Math.max( 0, p.y - 60 ) * 0.6;
		const sel = [];
		if ( r > 0 ) for ( let k = 0; k < this.tiles.length; k ++ ) {

			const t = this.tiles[ k ];
			const dx = Math.max( 0, Math.abs( p.x - t.cx ) - half ), dz = Math.max( 0, Math.abs( p.z - t.cz ) - half );
			if ( dx * dx + dz * dz < r * r ) sel.push( k );

		}

		const key = sel.join( ',' );
		if ( key === this.key ) return;
		this.key = key;
		let n = 0;
		for ( const k of sel ) { const t = this.tiles[ k ]; this.live.set( this.all.subarray( t.start * 12, ( t.start + t.count ) * 12 ), n * 12 ); n += t.count; }
		this.liveBuffer.clearUpdateRanges();
		this.liveBuffer.addUpdateRange( 0, n * 12 );
		this.liveBuffer.needsUpdate = true;
		this.geometry.instanceCount = n;
		this.count = n;

	}

}

// the sign atlas image for a list of strings: in a worker (OffscreenCanvas) in the browser, on this thread with a
// Canvas 2D implementation in Node (headless gates)
export async function signAtlasImage( texts ) {

	if ( typeof OffscreenCanvas !== 'undefined' && typeof Worker !== 'undefined' ) {

		const w = new Worker( new URL( './signWorker.js', import.meta.url ), { type: 'module' } );
		const img = await new Promise( ( resolve, reject ) => { w.onmessage = ( e ) => resolve( e.data ); w.onerror = reject; w.postMessage( { texts } ); } );
		w.terminate();
		return img;

	}

	const name = '@napi-rs/canvas';
	const { createCanvas } = await import( /* @vite-ignore */ name );
	return drawSigns( texts, ( w, h ) => createCanvas( w, h ) );

}

export { CELL_W, CELL_H };
