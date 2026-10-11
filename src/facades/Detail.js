// Near-band facade detail (F6, F9, F13): real geometry within 150 m of the camera (60 m on mobile) — cornices,
// parapets with coping, Victorian stacked bay windows, fire escapes, Chinatown balconies, rooftop boxes and stair
// penthouses, wooden water tanks, Sausalito gables. One instanced draw per type; instances come from
// src/facades/model.js details() and stream by 100 m tile like the street props.
import { InstancedBufferGeometry, BufferAttribute, InstancedInterleavedBuffer, InterleavedBufferAttribute, Mesh } from 'harbor-engine/src/engine/index.js';
import { Material } from 'harbor-engine/src/engine/render/Material.js';
import { T } from '../street/Props.js';
import { noiseModule } from '../street/wgsl.js';
import { ShaderModule } from 'harbor-engine/src/engine/gpu/Shader.js';

// unit templates: x along the wall 0..1, y up 0..1, z out of the wall 0..1 (parapet and gable: z −1..0, into the roof)
const TEMPLATES = {
	cornice() {

		const t = new T();
		t.box( 0, 0, 0, 1, 0.22, 0.38, 0 );        // bed moulding
		t.box( 0, 0.22, 0, 1, 0.74, 0.58, 1 );     // frieze with brackets (shader)
		t.box( 0, 0.74, 0, 1, 1, 1, 2 );           // corona / crown
		return t.build();

	},
	parapet() {

		const t = new T();
		t.box( 0, 0, - 1, 1, 0.86, 0, 0 );
		t.box( 0, 0.86, - 1.2, 1, 1, 0.16, 1 );    // coping
		return t.build();

	},
	bay() {

		// angled (45°) three-sided bay: wall side 0..1, front 0.2..0.8 at z = 1; floors are banded in the shader
		const t = new T();
		const P = ( x, y, z ) => [ x, y, z ];
		t.quad( P( 0, 0, 0 ), P( 0.2, 0, 1 ), P( 0.2, 1, 1 ), P( 0, 1, 0 ), 1 );
		t.quad( P( 0.2, 0, 1 ), P( 0.8, 0, 1 ), P( 0.8, 1, 1 ), P( 0.2, 1, 1 ), 1 );
		t.quad( P( 0.8, 0, 1 ), P( 1, 0, 0 ), P( 1, 1, 0 ), P( 0.8, 1, 1 ), 1 );
		t.quad( P( 0, 1, 0 ), P( 0.2, 1, 1 ), P( 0.8, 1, 1 ), P( 1, 1, 0 ), 0 ); // top
		t.quad( P( 0, 0, 0 ), P( 1, 0, 0 ), P( 0.8, 0, 1 ), P( 0.2, 0, 1 ), 0 ); // soffit
		return t.build( true );

	},
	fireEscape() {

		// one storey (y in storeys): slatted platform, rails, the ladder to the next platform
		const t = new T();
		t.box( 0, 0, 0, 1, 0.02, 1, 0 );
		t.box( 0, 0.02, 0.97, 1, 0.33, 1, 1, 'zZ' );
		for ( const x of [ 0, 0.99 ] ) t.box( x, 0.02, 0, x + 0.01, 0.33, 1, 1, 'xX' );
		t.quad( [ 0.62, 0.02, 0.55 ], [ 0.86, 0.02, 0.55 ], [ 0.86, 1.0, 0.3 ], [ 0.62, 1.0, 0.3 ], 2 );
		t.quad( [ 0.86, 0.02, 0.55 ], [ 0.62, 0.02, 0.55 ], [ 0.62, 1.0, 0.3 ], [ 0.86, 1.0, 0.3 ], 2 );
		return t.build();

	},
	roofBox() { const t = new T(); t.box( 0, 0, 0, 1, 1, 1, 0, 'xXYzZ' ); t.box( - 0.02, 0.96, - 0.02, 1.02, 1.0, 1.02, 1, 'xXYzZy' ); return t.build(); },
	tank() {

		const t = new T();
		for ( const [ x, z ] of [ [ - 0.32, - 0.32 ], [ 0.32, - 0.32 ], [ - 0.32, 0.32 ], [ 0.32, 0.32 ] ] ) t.cyl( x, z, 0, 0.36, 0.03, 0.03, 4, 0 );
		t.box( - 0.42, 0.34, - 0.42, 0.42, 0.38, 0.42, 0 );
		t.cyl( 0, 0, 0.38, 0.88, 0.5, 0.5, 12, 1 );
		t.cyl( 0, 0, 0.88, 1.0, 0.52, 0.0, 12, 2, false );
		return t.build();

	},
	balcony() {

		const t = new T();
		t.box( 0, 0, 0, 1, 0.1, 1, 0 );
		t.box( 0, 0.1, 0.96, 1, 1, 1, 1, 'zZY' );
		t.box( 0, 0.1, 0, 0.01, 1, 1, 1, 'xXY' );
		t.box( 0.99, 0.1, 0, 1, 1, 1, 1, 'xXY' );
		return t.build();

	},
	gable() {

		// a ridge roof over the footprint: slopes from the eaves (z = 0 and z = −1, y = 0) to the ridge (z = −0.5, y = 1)
		const t = new T();
		const e = 0.06; // eave overhang, in units of the depth
		t.quad( [ - 0.02, - 0.08, e ], [ 1.02, - 0.08, e ], [ 1.02, 1, - 0.5 ], [ - 0.02, 1, - 0.5 ], 0 );
		t.quad( [ 1.02, - 0.08, - 1 - e ], [ - 0.02, - 0.08, - 1 - e ], [ - 0.02, 1, - 0.5 ], [ 1.02, 1, - 0.5 ], 0 );
		t.tri( [ 0, 0, 0 ], [ 0, 1, - 0.5 ], [ 0, 0, - 1 ], 1 );
		t.tri( [ 1, 0, 0 ], [ 1, 0, - 1 ], [ 1, 1, - 0.5 ], 1 );
		return t.build( true );

	},
};

// triangles per instance, by type (gates)
export const templateTriangles = () => Object.fromEntries( Object.entries( TEMPLATES ).map( ( [ k, f ] ) => [ k, f().position.length / 9 ] ) );

// shading per type: vL = local position in metres (x along, y up, z out), vS = ( len, h, depth, variant ), vK = part
const COMMON = new ShaderModule( { name: 'facade-detail', code: /* wgsl */`
fn fdColour( v: f32 ) -> vec3f {
	let c = u32( v ) & 32767u;
	let srgb = vec3f( f32( ( c >> 10u ) & 31u ), f32( ( c >> 5u ) & 31u ), f32( c & 31u ) ) / 31.0;
	return pow( srgb, vec3f( 2.2 ) );
}
` } );
const SHADE = {
	cornice: /* wgsl */`
	let arch = u32( vS.w ) >> 15u;
	let wallC = fdColour( vS.w );
	let trim = select( vec3f( 0.84, 0.82, 0.76 ), wallC * 0.85, arch == 2u );
	alb = select( trim, mix( trim, vec3f( 0.3, 0.12, 0.1 ), 0.0 ), arch == 0u );
	if ( arch == 0u && seed > 0.6 ) { alb = wallC * 0.7; }  // painted accent cornice on some Victorians
	if ( vK > 0.5 && vK < 1.5 ) {
		// brackets: paired consoles every ~1.1 m (Victorian, office), dentils (others)
		let spacing = select( 0.45, 1.1, arch == 0u || arch == 3u );
		let fx = fract( vL.x / spacing );
		if ( fx < select( 0.35, 0.16, arch == 0u || arch == 3u ) && abs( vL.z - vS.z * 0.58 ) < 0.02 ) { alb = alb * 0.72; }
		if ( fx >= select( 0.35, 0.16, arch == 0u || arch == 3u ) && abs( vL.z - vS.z * 0.58 ) < 0.02 ) { alb = alb * 0.92; }
	}
	if ( vK > 1.5 && vL.y > vS.y * 0.9 ) { alb = alb * 0.9; }
	if ( arch == 2u ) { let b = fract( vL.x / 0.225 + select( 0.0, 0.5, fract( vL.y / 0.15 ) > 0.5 ) ); alb = alb * ( 0.85 + 0.25 * step( 0.08, b ) ); }
	rough = 0.8;`,
	parapet: /* wgsl */`
	alb = fdColour( vS.w ) * 0.9 * ( 0.9 + 0.15 * stNoise( vec2f( vL.x, vL.y ) * 2.0 + seed * 9.0 ) );
	if ( vK > 0.5 ) { alb = vec3f( 0.62, 0.6, 0.56 ); }
	rough = 0.9;`,
	bay: /* wgsl */`
	let wallC = fdColour( vS.w );
	let floorH = f32( u32( vS.w ) >> 15u ) / 100.0;
	let trim = vec3f( 0.88, 0.87, 0.83 );
	alb = wallC; rough = 0.8;
	if ( vK > 0.5 ) {
		let fy = fract( vL.y / max( floorH, 2.0 ) );
		// window band per floor (tall sash), panels below; corner posts
		let along = vL.x / vS.x;
		let post = abs( along - 0.2 ) < 0.025 || abs( along - 0.8 ) < 0.025 || along < 0.02 || along > 0.98;
		if ( fy > 0.22 && fy < 0.86 && ! post ) {
			let meet = abs( fy - 0.55 ) < 0.012;
			if ( meet ) { alb = trim; }
			else {
				let h = stHash21( vec2f( floor( vL.y / max( floorH, 2.0 ) ), seed * 91.0 + floor( along * 3.0 ) ) );
				let lit = step( 0.58, h ) * frame.night;
				// the room behind (darker by day, lit at night), seen through glass with a soft reflection
				alb = mix( vec3f( 0.62, 0.58, 0.52 ), vec3f( 0.72, 0.68, 0.6 ), h ) * ( 0.2 + 0.15 * fy ); rough = 0.05;
				emit = vec3f( 1.0, 0.72, 0.42 ) * 0.85 * lit;
				if ( h < 0.3 && fy > 0.6 ) { alb = vec3f( 0.84, 0.82, 0.76 ) * 0.7; rough = 0.8; emit = emit * 0.6; } // blind
			}
		} else if ( fy < 0.22 ) {
			alb = select( wallC * 0.92, trim * 0.9, fy < 0.05 || fy > 0.18 );
		} else { alb = trim; }
	}`,
	fireEscape: /* wgsl */`
	alb = vec3f( 0.055, 0.055, 0.06 ) * ( 0.8 + 0.4 * stNoise( vL.xy * 3.0 ) ); rough = 0.65; metal = 0.6;
	if ( vK < 0.5 && fract( vL.x / 0.08 ) < 0.35 ) { alb = alb * 0.4; }`,
	roofBox: /* wgsl */`
	let pent = vS.w > 0.5;
	alb = select( vec3f( 0.6, 0.6, 0.58 ), vec3f( 0.7, 0.68, 0.62 ), pent ) * ( 0.85 + 0.2 * stNoise( vL.xy * 1.5 + seed * 5.0 ) );
	if ( ! pent && abs( vL.z - vS.z ) < 0.01 && fract( vL.y / 0.12 ) < 0.4 ) { alb = alb * 0.6; } // louvres
	if ( pent && abs( vL.z - vS.z ) < 0.01 && abs( vL.x - vS.x * 0.5 ) < 0.45 && vL.y < 2.1 ) { alb = vec3f( 0.25, 0.27, 0.3 ); metal = 0.5; } // door
	if ( vK > 0.5 ) { alb = vec3f( 0.5 ); }
	rough = 0.75;`,
	tank: /* wgsl */`
	// redwood staves with iron hoops, a shingled conical lid, timber legs
	let wood = vec3f( 0.32, 0.2, 0.13 ) * ( 0.7 + 0.5 * stHash21( vec2f( floor( atan2( vL.z, vL.x ) * 12.0 ), seed ) ) );
	alb = wood; rough = 0.85;
	if ( vK > 0.5 && vK < 1.5 && abs( fract( vL.y / 0.9 ) - 0.5 ) < 0.03 ) { alb = vec3f( 0.08 ); metal = 0.6; rough = 0.5; }
	if ( vK > 1.5 ) { alb = vec3f( 0.22, 0.17, 0.13 ); }`,
	balcony: /* wgsl */`
	alb = vec3f( 0.7, 0.7, 0.68 ); rough = 0.8;
	if ( vK > 0.5 ) { alb = select( vec3f( 0.08, 0.3, 0.2 ), vec3f( 0.45, 0.08, 0.06 ), seed > 0.5 ); metal = 0.5; rough = 0.5; if ( fract( vL.x / 0.12 ) > 0.3 && vL.y < vS.y * 0.92 ) { alb = alb * 0.25; } }`,
	gable: /* wgsl */`
	alb = select( fdColour( vS.w ), vec3f( 0.86, 0.84, 0.8 ), vK > 0.5 );
	if ( vK < 0.5 ) { alb = alb * ( 0.8 + 0.25 * step( 0.5, fract( vL.y / 0.2 + 0.5 * step( 0.5, fract( vL.x / 0.4 ) ) ) ) ); rough = 0.9; }`,
};

function detailMaterial( type ) {

	return new Material( {
		name: 'facade-' + type,
		modules: [ noiseModule, COMMON ],
		underwaterLighting: 'none',
		side: type === 'fireEscape' || type === 'balcony' ? 'double' : 'front',
		attributes: { aPart: 'f32', iA: 'vec4f', iB: 'vec4f' },
		varyings: { vL: 'vec3f', vS: 'vec4f', vKind: 'f32', vSeed: 'f32' },
		vertex: /* wgsl */`
	let c = cos( v.iA.w ); let sn = sin( v.iA.w );
	let q = v.position * vec3f( v.iB.x, v.iB.y, v.iB.z );
	// local x along ( c, sn ), local z outward ( −sn, c )
	o.vL = q;
	v.position = v.iA.xyz + vec3f( c * q.x - sn * q.z, q.y, sn * q.x + c * q.z );
	let n = v.normal / vec3f( v.iB.x, v.iB.y, v.iB.z );
	let nn = normalize( n );
	v.normal = vec3f( c * nn.x - sn * nn.z, nn.y, sn * nn.x + c * nn.z );
	o.vS = v.iB;
	o.vKind = v.aPart;
	o.vSeed = fract( sin( dot( v.iA.xz, vec2f( 12.9898, 78.233 ) ) ) * 43758.5453 );
`,
		surface: /* wgsl */`
	let vK = in.vs.vKind;
	let vL = in.vs.vL;
	let vS = in.vs.vS;
	let seed = in.vs.vSeed;
	var alb = vec3f( 0.5 ); var rough = 0.8; var metal = 0.0; var emit = vec3f( 0.0 );
	${ SHADE[ type ] }
	s.albedo = alb; s.roughness = rough; s.metalness = metal; s.emissive = emit;
`,
	} );

}

class DetailLayer {

	constructor( type, data, radius ) {

		this.type = type;
		this.all = data.instances;
		this.tile = data.tile;
		this.tiles = data.tiles.map( ( [ tx, tz, start, count ] ) => ( { start, count, cx: ( tx + 0.5 ) * data.tile, cz: ( tz + 0.5 ) * data.tile } ) );
		this.radius = radius;
		const t = TEMPLATES[ type ]();
		const g = new InstancedBufferGeometry();
		g.setAttribute( 'position', new BufferAttribute( t.position, 3 ) );
		g.setAttribute( 'normal', new BufferAttribute( t.normal, 3 ) );
		g.setAttribute( 'aPart', new BufferAttribute( t.part, 1 ) );
		this.live = new Float32Array( Math.max( 8, this.all.length ) );
		this.ib = new InstancedInterleavedBuffer( this.live, 8, 1 );
		g.setAttribute( 'iA', new InterleavedBufferAttribute( this.ib, 4, 0 ) );
		g.setAttribute( 'iB', new InterleavedBufferAttribute( this.ib, 4, 4 ) );
		g.instanceCount = 0;
		this.g = g;
		this.trianglesPerInstance = t.position.length / 9;
		this.mesh = new Mesh( g, detailMaterial( type ) );
		this.mesh.name = 'facade-' + type;
		this.mesh.frustumCulled = false;
		this.mesh.castShadow = type !== 'fireEscape' && type !== 'balcony';
		this.mesh.receiveShadow = true;
		this.key = '';
		this.n = 0;

	}

	update( camera ) {

		const p = camera.position, half = this.tile / 2;
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
		for ( const k of sel ) { const t = this.tiles[ k ]; this.live.set( this.all.subarray( t.start * 8, ( t.start + t.count ) * 8 ), n * 8 ); n += t.count; }
		this.ib.clearUpdateRanges(); this.ib.addUpdateRange( 0, Math.max( 8, n * 8 ) ); this.ib.needsUpdate = true;
		this.g.instanceCount = n;
		this.n = n;

	}

	get triangles() { return this.n * this.trianglesPerInstance; }

}

export class FacadeDetail {

	// tiled: { type: { instances, tiles, tile } }
	constructor( tiled, { radius = 150 } = {} ) {

		this.layers = Object.entries( tiled ).filter( ( [ , d ] ) => d.instances.length ).map( ( [ type, d ] ) => new DetailLayer( type, d, radius ) );

	}

	get meshes() { return this.layers.map( ( l ) => l.mesh ); }
	get triangles() { return this.layers.reduce( ( s, l ) => s + l.triangles, 0 ); }
	update( camera ) { for ( const l of this.layers ) l.update( camera ); }

}
