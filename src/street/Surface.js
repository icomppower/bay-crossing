import { BufferGeometry, BufferAttribute, Mesh } from 'harbor-engine/src/engine/index.js';
import { Material } from 'harbor-engine/src/engine/render/Material.js';
import { noiseModule } from './wgsl.js';

// The street surface (public/street/, pipelines/street/build.mjs): roads, markings, rails, trackway, sidewalks
// and curbs in one mesh and one draw. Vertices are grouped in 100 m tiles; the index buffer holds only the
// tiles within `radius` of the camera and is rewritten when that set changes. Materials are procedural
// (data.x = material id; pipelines/street/roads.mjs MAT).
export function surfaceMaterial() {

	return new Material( {
		name: 'street-surface',
		modules: [ noiseModule ],
		attributes: { aNrm: 'vec4f', aData: 'vec4u' },
		varyings: { vData: 'vec4f' },
		// lift with distance so the coarser far terrain LODs never poke through
		vertex: /* wgsl */`
	v.normal = v.aNrm.xyz;
	o.vData = vec4f( v.aData );
	let d = distance( v.position, frame.cameraPos );
	v.position.y += max( 0.0, d - 40.0 ) * 0.0012;
`,
		surface: /* wgsl */`
	let mat = i32( in.vs.vData.x + 0.5 );
	let q = in.P.xz - floor( in.P.xz / 512.0 ) * 512.0;
	let n1 = stFbm( q * 0.35 );
	let n2 = stNoise( q * 3.7 );
	var alb = vec3f( 0.09 );
	var rough = 0.9;
	var metal = 0.0;
	// asphalt underneath every road material (paint wears through to it)
	let patchCell = floor( q / vec2f( 9.0, 5.0 ) );
	let patchOn = step( 0.8, stHash21( patchCell ) ) * step( 0.35, stNoise( q * 0.4 ) );
	var asph = vec3f( 0.068, 0.069, 0.072 ) * ( 0.82 + 0.36 * n1 ) * ( 0.92 + 0.16 * n2 );
	asph = mix( asph, vec3f( 0.1, 0.1, 0.1 ) * ( 0.9 + 0.2 * n2 ), patchOn * 0.7 );
	// hairline cracks, only in patches of worn road
	let crackLine = 1.0 - smoothstep( 0.0, 0.006, abs( stNoise( q * 0.35 + 3.0 ) - 0.5 ) );
	let crackZone = smoothstep( 0.62, 0.7, stNoise( q * 0.045 + 11.0 ) );
	asph *= 1.0 - 0.45 * crackLine * crackZone;
	let wear = smoothstep( 0.25, 0.6, stNoise( q * 1.3 + 7.0 ) * 0.7 + n2 * 0.3 );
	if ( mat == 0 ) {
		alb = asph; rough = 0.9;
	} else if ( mat == 1 ) {
		alb = mix( asph, vec3f( 0.62, 0.42, 0.05 ), 0.35 + 0.65 * wear ); rough = 0.65;
	} else if ( mat == 2 ) {
		alb = mix( asph, vec3f( 0.68, 0.68, 0.66 ), 0.35 + 0.65 * wear ); rough = 0.6;
	} else if ( mat == 3 ) {
		alb = vec3f( 0.32, 0.3, 0.29 ) * ( 0.8 + 0.4 * n2 ); rough = 0.3; metal = 0.85;
	} else if ( mat == 4 ) {
		alb = vec3f( 0.3, 0.29, 0.27 ) * ( 0.8 + 0.35 * n1 ); rough = 0.85;
	} else if ( mat == 5 || mat == 6 ) {
		// concrete with scoring lines every 1.5 m, square to the nearest road (data.y = angle)
		let a = in.vs.vData.y / 255.0 * 6.2831853 - 3.1415927;
		let r = vec2f( cos( a ) * q.x + sin( a ) * q.y, - sin( a ) * q.x + cos( a ) * q.y );
		let g = abs( fract( r / 1.5 ) - 0.5 ) * 1.5;
		let joint = 1.0 - ( 1.0 - smoothstep( 0.0, 0.012, g.x ) ) * 0.5 - ( 1.0 - smoothstep( 0.0, 0.012, g.y ) ) * 0.5;
		let slab = stHash21( floor( r / 1.5 ) );
		alb = vec3f( 0.31, 0.31, 0.3 ) * ( 0.86 + 0.18 * n1 ) * ( 0.94 + 0.12 * slab ) * joint;
		if ( mat == 6 ) {
			// pavers: brick-sized, warm grey / terracotta
			let b = r / vec2f( 0.2, 0.1 );
			let row = floor( b.y );
			let bb = vec2f( b.x + 0.5 * ( row - 2.0 * floor( row / 2.0 ) ), b.y );
			let e = abs( fract( bb ) - 0.5 );
			let mortar = smoothstep( 0.44, 0.48, max( e.x * 1.0, e.y ) );
			let tone = stHash21( floor( bb ) );
			alb = mix( mix( vec3f( 0.33, 0.27, 0.23 ), vec3f( 0.42, 0.4, 0.37 ), tone ), vec3f( 0.22 ), mortar ) * ( 0.85 + 0.2 * n1 );
		}
		rough = 0.85;
	} else {
		// curb faces: grey concrete, or painted (8 red, 9 yellow, 10 green, 11 white, 12 blue)
		var paint = vec3f( 0.42, 0.41, 0.39 );
		if ( mat == 8 ) { paint = vec3f( 0.55, 0.06, 0.04 ); }
		if ( mat == 9 ) { paint = vec3f( 0.7, 0.52, 0.05 ); }
		if ( mat == 10 ) { paint = vec3f( 0.1, 0.4, 0.12 ); }
		if ( mat == 11 ) { paint = vec3f( 0.75, 0.75, 0.72 ); }
		if ( mat == 12 ) { paint = vec3f( 0.08, 0.2, 0.55 ); }
		alb = paint * ( 0.85 + 0.25 * n2 );
		rough = select( 0.85, 0.6, mat >= 8 );
	}
	s.albedo = alb;
	s.roughness = rough;
	s.metalness = metal;
`,
	} );

}

export class StreetSurface {

	constructor( { index, pos, nrm, dat, indices } ) {

		this.index = index;
		this.all = indices;
		const g = this.geometry = new BufferGeometry();
		g.setAttribute( 'position', new BufferAttribute( pos, 3 ) );
		g.setAttribute( 'aNrm', new BufferAttribute( nrm, 4, true ) );
		g.setAttribute( 'aData', new BufferAttribute( dat, 4 ) );
		this.live = new Uint32Array( Math.max( 3, indices.length ) );
		this.liveAttr = new BufferAttribute( this.live, 1 );
		g.setIndex( this.liveAttr );
		g.setDrawRange( 0, 0 );
		this.material = surfaceMaterial();
		this.mesh = new Mesh( g, this.material );
		this.mesh.name = 'street-surface';
		this.mesh.frustumCulled = false;
		this.mesh.castShadow = false;
		this.mesh.receiveShadow = true;
		this.radius = 450;
		this.key = '';
		this.tiles = index.tiles.map( ( [ tx, tz, v0, vn, i0, in_ ] ) => ( { tx, tz, i0, n: in_, cx: ( tx + 0.5 ) * index.tile, cz: ( tz + 0.5 ) * index.tile } ) );

	}

	update( camera ) {

		const p = camera.position, T = this.index.tile, half = T / 2;
		// only tiles whose nearest point is within radius (and not when far above the city)
		const r = this.radius - Math.max( 0, p.y - 60 ) * 0.5;
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
		for ( const k of sel ) { const t = this.tiles[ k ]; this.live.set( this.all.subarray( t.i0, t.i0 + t.n ), n ); n += t.n; }
		this.liveAttr.clearUpdateRanges();
		this.liveAttr.addUpdateRange( 0, n );
		this.liveAttr.needsUpdate = true;
		this.geometry.setDrawRange( 0, n );
		this.selected = sel.length;
		this.triangles = n / 3;

	}

}
