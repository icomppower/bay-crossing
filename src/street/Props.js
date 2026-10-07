import { InstancedBufferGeometry, BufferAttribute, InstancedInterleavedBuffer, InterleavedBufferAttribute, Mesh } from 'harbor-engine/src/engine/index.js';
import { Material } from 'harbor-engine/src/engine/render/Material.js';
import { Texture } from 'harbor-engine/src/engine/gpu/Texture.js';
import { noiseModule } from './wgsl.js';
import { mipChain } from './signDraw.js';

// Street props (D52, D56; public/street/props.*, pipelines/street/props.mjs): one instanced draw per prop type
// (trees twice: the near ones cast shadows), each instance [ x, y, z, yaw, scale, variant, a, b ] (wires:
// [ ax, ay, az, bx, by, bz, radius, kind ]). Templates are built here from boxes, cylinders and blobs; colours and
// detail come from the shaders. Each type streams the instances of the 100 m tiles within its radius.

// ---- template building: positions, normals and a part id (f32) per vertex, non-indexed triangles
class T {

	constructor() { this.p = []; this.n = []; this.k = []; }
	tri( a, b, c, part ) {

		const u = [ b[ 0 ] - a[ 0 ], b[ 1 ] - a[ 1 ], b[ 2 ] - a[ 2 ] ], v = [ c[ 0 ] - a[ 0 ], c[ 1 ] - a[ 1 ], c[ 2 ] - a[ 2 ] ];
		const n = [ u[ 1 ] * v[ 2 ] - u[ 2 ] * v[ 1 ], u[ 2 ] * v[ 0 ] - u[ 0 ] * v[ 2 ], u[ 0 ] * v[ 1 ] - u[ 1 ] * v[ 0 ] ];
		const l = Math.hypot( ...n ) || 1;
		for ( const q of [ a, b, c ] ) { this.p.push( ...q ); this.n.push( n[ 0 ] / l, n[ 1 ] / l, n[ 2 ] / l ); this.k.push( part ); }

	}
	quad( a, b, c, d, part ) { this.tri( a, b, c, part ); this.tri( a, c, d, part ); }
	// wind the triangles added since vertex `from` to face away from centre( triangle midpoint )
	orient( from, centre ) {

		const p = this.p, n = this.n;
		for ( let o = from * 3; o < p.length; o += 9 ) {

			const m = [ ( p[ o ] + p[ o + 3 ] + p[ o + 6 ] ) / 3, ( p[ o + 1 ] + p[ o + 4 ] + p[ o + 7 ] ) / 3, ( p[ o + 2 ] + p[ o + 5 ] + p[ o + 8 ] ) / 3 ];
			const c = centre( m );
			if ( ( m[ 0 ] - c[ 0 ] ) * n[ o ] + ( m[ 1 ] - c[ 1 ] ) * n[ o + 1 ] + ( m[ 2 ] - c[ 2 ] ) * n[ o + 2 ] >= 0 ) continue;
			for ( let k = 0; k < 3; k ++ ) { const sw = p[ o + 3 + k ]; p[ o + 3 + k ] = p[ o + 6 + k ]; p[ o + 6 + k ] = sw; }
			for ( let k = 0; k < 9; k ++ ) n[ o + k ] = - n[ o + k ];

		}

	}
	// axis-aligned box (x0..x1, y0..y1, z0..z1), outward faces
	box( x0, y0, z0, x1, y1, z1, part, faces = 'all' ) {

		const from = this.p.length / 3, cen = [ ( x0 + x1 ) / 2, ( y0 + y1 ) / 2, ( z0 + z1 ) / 2 ];
		const P = ( x, y, z ) => [ x, y, z ];
		const f = faces === 'all' ? 'xXyYzZ' : faces;
		if ( f.includes( 'Z' ) ) this.quad( P( x0, y0, z1 ), P( x1, y0, z1 ), P( x1, y1, z1 ), P( x0, y1, z1 ), part );
		if ( f.includes( 'z' ) ) this.quad( P( x1, y0, z0 ), P( x0, y0, z0 ), P( x0, y1, z0 ), P( x1, y1, z0 ), part );
		if ( f.includes( 'X' ) ) this.quad( P( x1, y0, z1 ), P( x1, y0, z0 ), P( x1, y1, z0 ), P( x1, y1, z1 ), part );
		if ( f.includes( 'x' ) ) this.quad( P( x0, y0, z0 ), P( x0, y0, z1 ), P( x0, y1, z1 ), P( x0, y1, z0 ), part );
		if ( f.includes( 'Y' ) ) this.quad( P( x0, y1, z1 ), P( x1, y1, z1 ), P( x1, y1, z0 ), P( x0, y1, z0 ), part );
		if ( f.includes( 'y' ) ) this.quad( P( x0, y0, z0 ), P( x1, y0, z0 ), P( x1, y0, z1 ), P( x0, y0, z1 ), part );
		this.orient( from, () => cen );

	}
	// cylinder along y (open), from y0 to y1, radius r0 → r1, centred at (cx, cz)
	cyl( cx, cz, y0, y1, r0, r1, sides, part, cap = false ) {

		const from = this.p.length / 3;

		for ( let i = 0; i < sides; i ++ ) {

			const a0 = i / sides * Math.PI * 2, a1 = ( i + 1 ) / sides * Math.PI * 2;
			const p = ( a, r, y ) => [ cx + Math.cos( a ) * r, y, cz + Math.sin( a ) * r ];
			this.quad( p( a0, r0, y0 ), p( a0, r1, y1 ), p( a1, r1, y1 ), p( a1, r0, y0 ), part );
			if ( cap ) this.tri( [ cx, y1, cz ], p( a1, r1, y1 ), p( a0, r1, y1 ), part );

		}

		this.orient( from, ( m ) => Math.abs( m[ 1 ] - y1 ) < 1e-6 && cap ? [ cx, y1 - 1, cz ] : [ cx, m[ 1 ], cz ] );

	}
	// a lumpy blob (octahedron subdivided once, pushed to a sphere): crowns, lanterns
	blob( cx, cy, cz, rx, ry, rz, part, subdiv = 1 ) {

		const from = this.p.length / 3;

		let faces = [ [ [ 1, 0, 0 ], [ 0, 1, 0 ], [ 0, 0, 1 ] ], [ [ 0, 0, 1 ], [ 0, 1, 0 ], [ - 1, 0, 0 ] ], [ [ - 1, 0, 0 ], [ 0, 1, 0 ], [ 0, 0, - 1 ] ], [ [ 0, 0, - 1 ], [ 0, 1, 0 ], [ 1, 0, 0 ] ],
			[ [ 0, 0, 1 ], [ 0, - 1, 0 ], [ 1, 0, 0 ] ], [ [ - 1, 0, 0 ], [ 0, - 1, 0 ], [ 0, 0, 1 ] ], [ [ 0, 0, - 1 ], [ 0, - 1, 0 ], [ - 1, 0, 0 ] ], [ [ 1, 0, 0 ], [ 0, - 1, 0 ], [ 0, 0, - 1 ] ] ];
		const nrm = ( v ) => { const l = Math.hypot( ...v ); return v.map( ( c ) => c / l ); };
		for ( let s = 0; s < subdiv; s ++ ) {

			const next = [];
			for ( const [ a, b, c ] of faces ) {

				const ab = nrm( a.map( ( v, i ) => v + b[ i ] ) ), bc = nrm( b.map( ( v, i ) => v + c[ i ] ) ), ca = nrm( c.map( ( v, i ) => v + a[ i ] ) );
				next.push( [ a, ab, ca ], [ ab, b, bc ], [ ca, bc, c ], [ ab, bc, ca ] );

			}

			faces = next;

		}

		const at = ( v ) => [ cx + v[ 0 ] * rx, cy + v[ 1 ] * ry, cz + v[ 2 ] * rz ];
		for ( const [ a, b, c ] of faces ) {

			const base = this.p.length / 3;
			this.tri( at( a ), at( b ), at( c ), part );
			// smooth normals: the sphere direction
			for ( const [ k, v ] of [ a, b, c ].entries() ) { const n = nrm( [ v[ 0 ] / rx, v[ 1 ] / ry, v[ 2 ] / rz ] ); this.n.splice( ( base + k ) * 3, 3, ...n ); }

		}

		this.orient( from, () => [ cx, cy, cz ] );

	}
	// convex = true: wind every face away from the whole template's centre (bay windows, the wire tube); otherwise the
	// primitives have oriented their own faces
	build( convex = false ) {

		if ( convex ) {

			let cx = 0, cy = 0, cz = 0;
			const nv = this.p.length / 3;
			for ( let i = 0; i < nv; i ++ ) { cx += this.p[ i * 3 ]; cy += this.p[ i * 3 + 1 ]; cz += this.p[ i * 3 + 2 ]; }
			cx /= nv; cy /= nv; cz /= nv;
			for ( let t = 0; t < nv; t += 3 ) {

				const o = t * 3, p = this.p, n = this.n;
				const mx = ( p[ o ] + p[ o + 3 ] + p[ o + 6 ] ) / 3 - cx, my = ( p[ o + 1 ] + p[ o + 4 ] + p[ o + 7 ] ) / 3 - cy, mz = ( p[ o + 2 ] + p[ o + 5 ] + p[ o + 8 ] ) / 3 - cz;
				if ( mx * n[ o ] + my * n[ o + 1 ] + mz * n[ o + 2 ] >= 0 ) continue;
				for ( let k = 0; k < 3; k ++ ) { const sw = p[ o + 3 + k ]; p[ o + 3 + k ] = p[ o + 6 + k ]; p[ o + 6 + k ] = sw; }
				for ( let v = 0; v < 3; v ++ ) for ( let k = 0; k < 3; k ++ ) n[ o + v * 3 + k ] = - n[ o + v * 3 + k ];

			}

		}

		return { position: new Float32Array( this.p ), normal: new Float32Array( this.n ), part: new Float32Array( this.k ) };

	}

}

// templates in metres, +y up, facing -z ("forward" of yaw 0 is -z; props stand at the kerb facing the road)
const TEMPLATES = {
	tree() { const t = new T(); t.cyl( 0, 0, - 0.3, 3.2, 0.16, 0.12, 6, 0 ); t.blob( 0, 5.2, 0, 2.6, 2.3, 2.6, 1, 2 ); t.blob( 0.9, 4.2, 0.5, 1.6, 1.4, 1.6, 1, 1 ); return t.build(); },
	palm() {

		const t = new T();
		t.cyl( 0, 0, - 0.3, 11, 0.32, 0.26, 6, 0 );
		t.blob( 0, 10.6, 0, 0.55, 0.9, 0.55, 2, 1 );
		for ( let i = 0; i < 9; i ++ ) {

			const a = i / 9 * Math.PI * 2, dx = Math.cos( a ), dz = Math.sin( a ), px = - dz * 0.35, pz = dx * 0.35;
			const P = ( r, y, w ) => [ dx * r + px * w, y, dz * r + pz * w ];
			t.quad( P( 0.2, 11, - 1 ), P( 2.4, 11.7, - 1 ), P( 2.4, 11.7, 1 ), P( 0.2, 11, 1 ), 3 );
			t.quad( P( 2.4, 11.7, - 1 ), P( 4.6, 10.4, - 0.6 ), P( 4.6, 10.4, 0.6 ), P( 2.4, 11.7, 1 ), 3 );

		}

		return t.build();

	},
	car() {

		const t = new T();
		// body (x across, z along: front at -z), cabin above, four wheels
		t.box( - 0.88, 0.32, - 2.2, 0.88, 0.95, 2.2, 0 );
		t.box( - 0.8, 0.95, - 1.0, 0.8, 1.45, 1.2, 1, 'xXYzZ' );
		for ( const [ x, z ] of [ [ - 0.82, - 1.35 ], [ 0.82, - 1.35 ], [ - 0.82, 1.35 ], [ 0.82, 1.35 ] ] ) {

			for ( let i = 0; i < 6; i ++ ) {

				const a0 = i / 6 * Math.PI * 2, a1 = ( i + 1 ) / 6 * Math.PI * 2, P = ( a, s ) => [ x + s * 0.11, 0.33 + Math.sin( a ) * 0.33, z + Math.cos( a ) * 0.33 ];
				t.quad( P( a0, - 1 ), P( a1, - 1 ), P( a1, 1 ), P( a0, 1 ), 2 );
				t.tri( [ x + Math.sign( x ) * 0.11, 0.33, z ], P( a0, Math.sign( x ) ), P( a1, Math.sign( x ) ), 2 );

			}

		}

		return t.build();

	},
	lamp() { const t = new T(); t.cyl( 0, 0, 0, 8.2, 0.11, 0.07, 6, 0 ); t.box( - 0.04, 7.95, - 1.9, 0.04, 8.1, 0, 0 ); t.box( - 0.2, 7.75, - 2.5, 0.2, 7.98, - 1.7, 1 ); return t.build(); },
	muni() { const t = new T(); t.cyl( 0, 0, 0, 9.5, 0.17, 0.11, 6, 0 ); t.box( - 0.05, 7.6, - 1.4, 0.05, 7.7, 0, 0 ); t.box( - 0.18, 7.35, - 1.9, 0.18, 7.55, - 1.4, 1 ); return t.build(); },
	hydrant() { const t = new T(); t.cyl( 0, 0, 0, 0.62, 0.15, 0.14, 8, 0 ); t.blob( 0, 0.66, 0, 0.17, 0.12, 0.17, 1, 1 ); t.box( - 0.28, 0.38, - 0.06, 0.28, 0.5, 0.06, 0 ); t.box( - 0.06, 0.36, - 0.25, 0.06, 0.52, 0, 1 ); return t.build(); },
	meter() { const t = new T(); t.cyl( 0, 0, 0, 1.15, 0.035, 0.035, 5, 0 ); t.box( - 0.12, 1.15, - 0.09, 0.12, 1.5, 0.09, 1 ); return t.build(); },
	blade() { const t = new T(); t.cyl( 0, 0, 0, 3.4, 0.045, 0.045, 6, 0 ); t.box( - 0.01, 3.0, - 0.75, 0.01, 3.18, 0.75, 1 ); t.box( - 0.75, 3.2, - 0.01, 0.75, 3.38, 0.01, 2 ); return t.build(); },
	bench() { const t = new T(); t.box( - 0.9, 0.42, - 0.22, 0.9, 0.47, 0.22, 0 ); t.box( - 0.9, 0.5, 0.18, 0.9, 0.9, 0.22, 0 ); for ( const x of [ - 0.8, 0.8 ] ) t.box( x - 0.04, 0, - 0.2, x + 0.04, 0.42, 0.2, 1 ); return t.build(); },
	lantern() { const t = new T(); t.blob( 0, 0, 0, 0.26, 0.34, 0.26, 0, 1 ); t.box( - 0.13, 0.3, - 0.13, 0.13, 0.4, 0.13, 1, 'xXzZY' ); t.box( - 0.13, - 0.42, - 0.13, 0.13, - 0.32, 0.13, 1, 'xXzZy' ); return t.build(); },
	fireEscape() {

		// one storey: a slatted platform out from the wall, rails, and the ladder to the next one (x along the wall)
		const t = new T();
		t.box( - 1.6, 0, - 0.95, 1.6, 0.06, 0, 0 );
		t.box( - 1.6, 0.06, - 0.97, 1.6, 1.0, - 0.93, 1, 'zZ' );
		for ( const x of [ - 1.6, 1.6 ] ) t.box( x - 0.02, 0.06, - 0.95, x + 0.02, 1.0, 0, 1, 'xX' );
		t.quad( [ 0.5, 0.06, - 0.55 ], [ 1.3, 0.06, - 0.55 ], [ 1.3, 3.0, - 0.25 ], [ 0.5, 3.0, - 0.25 ], 2 );
		t.quad( [ 1.3, 0.06, - 0.55 ], [ 0.5, 0.06, - 0.55 ], [ 0.5, 3.0, - 0.25 ], [ 1.3, 3.0, - 0.25 ], 2 );
		return t.build();

	},
	bayWindow() {

		// a three-sided bay, 3.4 m wide at the wall, 0.75 m deep, one storey
		const t = new T();
		const P = ( x, y, z ) => [ x, y, z ];
		for ( const [ y0, y1, part ] of [ [ 0, 0.7, 0 ], [ 0.7, 2.3, 1 ], [ 2.3, 2.75, 0 ] ] ) {

			t.quad( P( - 1.7, y0, 0 ), P( - 1.2, y0, - 0.75 ), P( - 1.2, y1, - 0.75 ), P( - 1.7, y1, 0 ), part );
			t.quad( P( - 1.2, y0, - 0.75 ), P( 1.2, y0, - 0.75 ), P( 1.2, y1, - 0.75 ), P( - 1.2, y1, - 0.75 ), part );
			t.quad( P( 1.2, y0, - 0.75 ), P( 1.7, y0, 0 ), P( 1.7, y1, 0 ), P( 1.2, y1, - 0.75 ), part );

		}

		t.quad( P( - 1.7, 2.75, 0 ), P( 1.7, 2.75, 0 ), P( 1.2, 2.75, - 0.75 ), P( - 1.2, 2.75, - 0.75 ), 0 );
		t.quad( P( - 1.2, 0, - 0.75 ), P( 1.2, 0, - 0.75 ), P( 1.7, 0, 0 ), P( - 1.7, 0, 0 ), 0 );
		return t.build( true );

	},
	// unit segment along +x (0..1), a thin square tube; the vertex shader stretches it from A to B
	wire() { const t = new T(); const P = ( x, a ) => [ x, Math.sin( a ), Math.cos( a ) ]; for ( let i = 0; i < 4; i ++ ) { const a0 = i * Math.PI / 2 + 0.785, a1 = a0 + Math.PI / 2; t.quad( P( 0, a0 ), P( 1, a0 ), P( 1, a1 ), P( 0, a1 ), 0 ); } return t.build( true ); },
};

// per type: radius (m), shadows, shading (WGSL surface body; in.vs.vK = part, vV = (variant, a, b, scale), vL = local position)
const SHADE = {
	tree: /* wgsl */`
	let crown = vK > 0.5;
	let g = stNoise( in.P.xz * 1.7 + in.P.y * 1.3 ) * 0.6 + stNoise( in.P.xz * 5.0 - in.P.y * 4.0 ) * 0.4;
	let tone = vV.y;
	let leaf = mix( mix( vec3f( 0.045, 0.075, 0.03 ), vec3f( 0.07, 0.1, 0.04 ), tone ), vec3f( 0.1, 0.11, 0.06 ), step( 0.85, tone ) );
	alb = select( vec3f( 0.14, 0.11, 0.08 ) * ( 0.8 + 0.4 * stNoise( in.P.xz * 9.0 + in.P.y * 3.0 ) ), leaf * ( 0.5 + 0.9 * g ), crown );
	rough = 0.9;
	if ( crown ) { s.translucency = vec3f( 0.04, 0.06, 0.02 ); s.ao = 0.55 + 0.45 * clamp( ( in.vs.vL.y - 3.0 ) / 4.5, 0.0, 1.0 ); }`,
	palm: /* wgsl */`
	alb = select( select( vec3f( 0.3, 0.24, 0.17 ) * ( 0.75 + 0.35 * step( 0.5, fract( in.vs.vL.y * 2.2 ) ) ), vec3f( 0.3, 0.26, 0.15 ), vK > 1.5 ), vec3f( 0.07, 0.12, 0.04 ) * ( 0.7 + 0.5 * stNoise( in.vs.vL.xz * 6.0 ) ), vK > 2.5 );
	rough = 0.85;
	if ( vK > 2.5 ) { s.translucency = vec3f( 0.03, 0.05, 0.015 ); }`,
	car: /* wgsl */`
	let paints = array<vec3f, 12>( vec3f( 0.6, 0.6, 0.62 ), vec3f( 0.05, 0.05, 0.06 ), vec3f( 0.75, 0.74, 0.72 ), vec3f( 0.35, 0.03, 0.03 ), vec3f( 0.04, 0.08, 0.2 ),
		vec3f( 0.2, 0.2, 0.22 ), vec3f( 0.75, 0.74, 0.72 ), vec3f( 0.05, 0.05, 0.06 ), vec3f( 0.45, 0.42, 0.36 ), vec3f( 0.08, 0.2, 0.12 ), vec3f( 0.6, 0.6, 0.62 ), vec3f( 0.3, 0.32, 0.36 ) );
	let paint = paints[ u32( vV.y ) % 12u ];
	alb = paint; rough = 0.3; metal = 0.4;
	if ( vK > 0.5 && vK < 1.5 ) {
		// cabin: glass with a body-colour roof and pillars
		let roof = in.vs.vL.y > 1.42;
		let pillar = abs( in.vs.vL.z - 0.1 ) > 1.0 && abs( in.vs.vL.x ) < 0.79;
		if ( ! roof && ! pillar ) { alb = vec3f( 0.04, 0.05, 0.06 ); rough = 0.05; metal = 0.2; }
	}
	if ( vK > 1.5 ) { alb = select( vec3f( 0.03 ), vec3f( 0.4 ), length( in.vs.vL.yz - vec2f( 0.33, round( in.vs.vL.z / 1.35 ) * 1.35 ) ) < 0.17 ); rough = 0.7; metal = 0.0; }
	// lights: amber / red ends, lit at night
	let endZ = in.vs.vL.z;
	if ( vK < 0.5 && in.vs.vL.y > 0.6 && in.vs.vL.y < 0.85 && abs( in.vs.vL.x ) > 0.55 && abs( endZ ) > 2.17 ) {
		let front = endZ < 0.0;
		alb = select( vec3f( 0.5, 0.05, 0.03 ), vec3f( 0.8, 0.78, 0.7 ), front );
		emit = select( vec3f( 2.0, 0.1, 0.05 ), vec3f( 0.0 ), front ) * frame.night;
	}`,
	lamp: /* wgsl */`
	alb = vec3f( 0.22, 0.23, 0.24 ); rough = 0.5; metal = 0.6;
	if ( vK > 0.5 ) { alb = vec3f( 0.6, 0.6, 0.55 ); emit = select( vec3f( 0.0 ), vec3f( 9.0, 7.2, 4.5 ) * frame.night, in.vs.vL.y < 7.8 ); }`,
	muni: /* wgsl */`
	alb = vec3f( 0.13, 0.16, 0.14 ) * ( 0.8 + 0.3 * stNoise( in.vs.vL.xy * 4.0 ) ); rough = 0.6; metal = 0.5;
	if ( vK > 0.5 ) { alb = vec3f( 0.6, 0.6, 0.55 ); emit = select( vec3f( 0.0 ), vec3f( 8.0, 6.8, 4.6 ) * frame.night, in.vs.vL.y < 7.4 ); }`,
	hydrant: /* wgsl */`
	// SF hydrants: white with a coloured bonnet (blue: high-pressure system, else red / yellow)
	alb = vec3f( 0.75, 0.74, 0.7 ); rough = 0.5;
	if ( vK > 0.5 ) { alb = select( vec3f( 0.6, 0.08, 0.05 ), vec3f( 0.05, 0.15, 0.55 ), vV.x > 0.5 ); }`,
	meter: /* wgsl */`
	alb = select( vec3f( 0.25, 0.26, 0.27 ), vec3f( 0.12, 0.13, 0.15 ), vK > 0.5 ); rough = 0.5; metal = 0.6;
	if ( vK > 0.5 && in.vs.vL.y > 1.33 && in.vs.vL.y < 1.42 && in.vs.vL.z < -0.085 ) { alb = vec3f( 0.1, 0.6, 0.3 ); emit = vec3f( 0.05, 0.4, 0.15 ); }`,
	blade: /* wgsl */`
	alb = vec3f( 0.3, 0.31, 0.3 ); rough = 0.5; metal = 0.6;
	if ( vK > 0.5 ) {
		// green street-name blade: white name from the name atlas, both faces
		let along = select( in.vs.vL.z, in.vs.vL.x, vK > 1.5 );
		let up = in.vs.vL.y - select( 3.0, 3.2, vK > 1.5 );
		let id = select( vV.y, vV.z, vK > 1.5 );
		let cell = vec2f( id % mat.nameCols, floor( id / mat.nameCols ) );
		let uv = ( cell + vec2f( clamp( along / 1.5 + 0.5, 0.0, 1.0 ), 1.0 - clamp( up / 0.18, 0.0, 1.0 ) ) ) / vec2f( mat.nameCols, mat.nameRows );
		let txt = textureSampleLevel( nameAtlas, smpLinearClamp, uv, 0.0 ).r;
		alb = mix( vec3f( 0.02, 0.22, 0.08 ), vec3f( 0.85 ), txt ); rough = 0.4; metal = 0.0;
		emit = vec3f( 0.85 ) * txt * frame.night * 0.4;
	}`,
	bench: /* wgsl */`
	alb = select( vec3f( 0.32, 0.22, 0.13 ) * ( 0.8 + 0.3 * stNoise( in.vs.vL.xz * 20.0 ) ), vec3f( 0.1, 0.1, 0.11 ), vK > 0.5 ); rough = select( 0.8, 0.4, vK > 0.5 ); metal = select( 0.0, 0.7, vK > 0.5 );`,
	lantern: /* wgsl */`
	alb = select( vec3f( 0.6, 0.04, 0.03 ), vec3f( 0.5, 0.4, 0.1 ), vK > 0.5 ); rough = 0.6;
	if ( vK < 0.5 ) { emit = vec3f( 1.0, 0.25, 0.08 ) * ( 0.08 + 3.5 * frame.night ); s.translucency = vec3f( 0.5, 0.1, 0.05 ); }`,
	fireEscape: /* wgsl */`
	alb = vec3f( 0.06, 0.06, 0.065 ); rough = 0.6; metal = 0.6;`,
	bayWindow: /* wgsl */`
	alb = vec3f( 0.82, 0.8, 0.75 ) * ( 0.85 + 0.2 * vV.y ); rough = 0.7;
	if ( vK > 0.5 ) {
		let mull = abs( fract( ( in.vs.vL.x + 1.7 ) / 0.85 ) - 0.5 ) * 0.85;
		if ( mull > 0.06 && in.vs.vL.y > 0.8 && in.vs.vL.y < 2.2 ) { alb = vec3f( 0.03, 0.035, 0.04 ); rough = 0.05; metal = 0.2; emit = vec3f( 1.0, 0.8, 0.55 ) * frame.night * step( 0.45, vV.y ) * 0.9; }
	}`,
	wire: /* wgsl */`
	alb = select( vec3f( 0.05 ), vec3f( 0.15, 0.1, 0.05 ), vV.w > 0.5 ); rough = 0.5; metal = 0.5;`,
};

export const PROP_TYPES = {
	tree: { template: 'tree', radius: 260, near: 70 },
	palm: { template: 'palm', radius: 320, shadows: true },
	car: { template: 'car', radius: 150, shadows: true },
	lamp: { template: 'lamp', radius: 220 },
	muni: { template: 'muni', radius: 260 },
	hydrant: { template: 'hydrant', radius: 80 },
	meter: { template: 'meter', radius: 80 },
	blade: { template: 'blade', radius: 140 },
	bench: { template: 'bench', radius: 100 },
	lantern: { template: 'lantern', radius: 160 },
	fireEscape: { template: 'fireEscape', radius: 160 },
	bayWindow: { template: 'bayWindow', radius: 200 },
	wire: { template: 'wire', radius: 220 },
};

function propMaterial( type, extra = {} ) {

	const wire = type === 'wire';
	return new Material( {
		name: 'street-' + type,
		modules: [ noiseModule ],
		underwaterLighting: 'none',
		side: type === 'palm' || type === 'fireEscape' ? 'double' : 'front',
		attributes: { aPart: 'f32', iA: 'vec4f', iB: 'vec4f' },
		varyings: { vL: 'vec3f', vI: 'vec4f', vKind: 'f32' },
		textures: extra.textures || {},
		uniforms: extra.uniforms || {},
		vertex: wire ? /* wgsl */`
	// stretch the unit tube from A to B, radius iB.z
	let A = v.iA.xyz;
	let B = vec3f( v.iA.w, v.iB.x, v.iB.y );
	let d = B - A;
	let L = max( length( d ), 1e-4 );
	let ax = d / L;
	let side = normalize( select( cross( ax, vec3f( 0.0, 1.0, 0.0 ) ), vec3f( 1.0, 0.0, 0.0 ), abs( ax.y ) > 0.99 ) );
	let up2 = cross( side, ax );
	let r = v.iB.z;
	v.position = A + ax * ( v.position.x * L ) + up2 * ( v.position.y * r ) + side * ( v.position.z * r );
	v.normal = normalize( up2 * v.normal.y + side * v.normal.z );
	o.vL = vec3f( v.position.x, 0.0, 0.0 );
	o.vI = vec4f( 0.0, 0.0, 0.0, v.iB.w );
	o.vKind = v.aPart;
` : /* wgsl */`
	let c = cos( v.iA.w ); let sn = sin( v.iA.w );
	var q = v.position * v.iB.x;
	${ type === 'tree' ? `
	// crown shape by variant: 1 columnar, 3 small ornamental; crowns lump by the instance seed
	let shape = u32( v.iB.y + 0.5 );
	if ( v.aPart > 0.5 ) {
		let crownC = vec3f( 0.0, 5.0 * v.iB.x, 0.0 );
		var rel = q - crownC;
		if ( shape == 1u ) { rel = rel * vec3f( 0.55, 1.35, 0.55 ); }
		if ( shape == 3u ) { rel = rel * vec3f( 0.75, 0.7, 0.75 ); }
		let lump = 1.0 + 0.18 * sin( v.position.x * 3.1 + v.iB.z * 40.0 ) * sin( v.position.z * 2.7 + v.iB.z * 17.0 ) + 0.12 * sin( v.position.y * 4.3 + v.iB.z * 9.0 );
		q = crownC * select( 1.0, select( 1.15, 0.75, shape == 3u ), shape == 1u || shape == 3u ) + rel * lump;
	}` : '' }
	let rot = vec3f( c * q.x + sn * q.z, q.y, - sn * q.x + c * q.z );
	o.vL = v.position;
	v.position = v.iA.xyz + rot;
	v.normal = vec3f( c * v.normal.x + sn * v.normal.z, v.normal.y, - sn * v.normal.x + c * v.normal.z );
	o.vI = vec4f( v.iB.y, v.iB.z, v.iB.w, v.iB.x );
	o.vKind = v.aPart;
`,
		surface: /* wgsl */`
	let vK = in.vs.vKind;
	let vV = in.vs.vI;
	var alb = vec3f( 0.5 ); var rough = 0.8; var metal = 0.0; var emit = vec3f( 0.0 );
	${ SHADE[ type ] }
	s.albedo = alb; s.roughness = rough; s.metalness = metal; s.emissive = emit;
`,
	} );

}

class PropLayer {

	constructor( type, cfg, data, extra ) {

		this.type = type;
		this.cfg = cfg;
		this.all = data.instances;
		this.tile = data.tile;
		this.tiles = data.tiles.map( ( [ tx, tz, start, count ] ) => ( { start, count, cx: ( tx + 0.5 ) * data.tile, cz: ( tz + 0.5 ) * data.tile } ) );
		const t = TEMPLATES[ cfg.template ]();
		const make = ( shadows ) => {

			const g = new InstancedBufferGeometry();
			g.setAttribute( 'position', new BufferAttribute( t.position, 3 ) );
			g.setAttribute( 'normal', new BufferAttribute( t.normal, 3 ) );
			g.setAttribute( 'aPart', new BufferAttribute( t.part, 1 ) );
			const live = new Float32Array( Math.max( 8, this.all.length ) );
			const ib = new InstancedInterleavedBuffer( live, 8, 1 );
			g.setAttribute( 'iA', new InterleavedBufferAttribute( ib, 4, 0 ) );
			g.setAttribute( 'iB', new InterleavedBufferAttribute( ib, 4, 4 ) );
			g.instanceCount = 0;
			const mesh = new Mesh( g, this.material || ( this.material = propMaterial( type, extra ) ) );
			mesh.name = 'street-' + type + ( shadows ? '-near' : '' );
			mesh.frustumCulled = false;
			mesh.castShadow = shadows;
			mesh.receiveShadow = true;
			return { mesh, g, live, ib, n: 0 };

		};
		this.main = make( !! cfg.shadows );
		// trees: the ones within `near` m cast shadows (a second draw), the rest do not
		this.near = cfg.near ? make( true ) : null;
		this.meshes = [ this.main.mesh, ...( this.near ? [ this.near.mesh ] : [] ) ];
		this.key = '';
		this.lastPos = null;
		this.radiusScale = 1;

	}

	update( camera ) {

		const p = camera.position, half = this.tile / 2, cfg = this.cfg;
		const r = cfg.radius * this.radiusScale - Math.max( 0, p.y - 40 ) * 0.7;
		const sel = [];
		if ( r > 0 ) for ( let k = 0; k < this.tiles.length; k ++ ) {

			const t = this.tiles[ k ];
			const dx = Math.max( 0, Math.abs( p.x - t.cx ) - half ), dz = Math.max( 0, Math.abs( p.z - t.cz ) - half );
			if ( dx * dx + dz * dz < r * r ) sel.push( k );

		}

		const key = sel.join( ',' );
		// near / far split of trees follows the camera within the tile set
		const moved = this.near && ( ! this.lastPos || Math.hypot( p.x - this.lastPos[ 0 ], p.z - this.lastPos[ 1 ] ) > 4 );
		if ( key === this.key && ! moved ) return;
		this.key = key;
		this.lastPos = [ p.x, p.z ];
		const fill = ( set, n ) => { set.ib.clearUpdateRanges(); set.ib.addUpdateRange( 0, n * 8 ); set.ib.needsUpdate = true; set.g.instanceCount = n; set.n = n; };
		if ( ! this.near ) {

			let n = 0;
			for ( const k of sel ) { const t = this.tiles[ k ]; this.main.live.set( this.all.subarray( t.start * 8, ( t.start + t.count ) * 8 ), n * 8 ); n += t.count; }
			fill( this.main, n );
			return;

		}

		let nf = 0, nn = 0;
		const r2 = cfg.near * cfg.near;
		for ( const k of sel ) {

			const t = this.tiles[ k ];
			for ( let i = t.start; i < t.start + t.count; i ++ ) {

				const o = i * 8, dx = this.all[ o ] - p.x, dz = this.all[ o + 2 ] - p.z;
				if ( dx * dx + dz * dz < r2 ) { this.near.live.set( this.all.subarray( o, o + 8 ), nn * 8 ); nn ++; } else { this.main.live.set( this.all.subarray( o, o + 8 ), nf * 8 ); nf ++; }

			}

		}

		fill( this.main, nf );
		fill( this.near, nn );

	}

	get count() { return this.main.n + ( this.near ? this.near.n : 0 ); }

}

// data: { index: props.json, all: Float32Array (8 per instance, all types) }; names: the street-name atlas image
export class StreetProps {

	constructor( { index, all }, namesImage ) {

		const levels = 3;
		const atlas = new Texture( { label: 'street names', width: namesImage.width, height: namesImage.height, format: 'r8unorm', mips: levels } );
		mipChain( namesImage, levels ).forEach( ( l, k ) => atlas.upload( l.data, { mip: k, width: l.width, height: l.height } ) );
		this.layers = {};
		for ( const [ type, cfg ] of Object.entries( PROP_TYPES ) ) {

			// palms are the tree list's shape 2: their own template and draw
			const src = type === 'palm' || type === 'tree' ? index.types.tree : index.types[ type ];
			if ( ! src ) continue;
			let instances = all.subarray( src.offset * 8, ( src.offset + src.count ) * 8 ), tiles = src.tiles;
			if ( type === 'tree' || type === 'palm' ) ( { instances, tiles } = splitTrees( instances, tiles, type === 'palm' ) );
			if ( type === 'fireEscape' ) ( { instances, tiles } = expandFloors( instances, tiles ) );
			const extra = type === 'blade' ? { textures: { nameAtlas: atlas }, uniforms: { nameCols: [ 'f32', namesImage.cols ], nameRows: [ 'f32', namesImage.rows ] } } : {};
			this.layers[ type ] = new PropLayer( type, cfg, { instances, tiles, tile: index.tile }, extra );

		}

	}

	get meshes() { return Object.values( this.layers ).flatMap( ( l ) => l.meshes ); }

	// light heads of the lamps and trolley poles drawn now (world positions), and a key that changes with the set
	lampHeads() {

		const out = [];
		for ( const [ type, head ] of [ [ 'lamp', [ - 2.1, 7.86 ] ], [ 'muni', [ - 1.65, 7.45 ] ] ] ) {

			const l = this.layers[ type ];
			if ( ! l ) continue;
			const live = l.main.live;
			for ( let i = 0; i < l.main.n; i ++ ) {

				const o = i * 8, c = Math.cos( live[ o + 3 ] ), sn = Math.sin( live[ o + 3 ] );
				out.push( [ live[ o ] + sn * head[ 0 ], live[ o + 1 ] + head[ 1 ], live[ o + 2 ] + c * head[ 0 ] ] );

			}

		}

		return out;

	}

	get lampKey() { return ( this.layers.lamp ? this.layers.lamp.key : '' ) + '|' + ( this.layers.muni ? this.layers.muni.key : '' ); }

	update( camera ) { for ( const l of Object.values( this.layers ) ) l.update( camera ); }

}

// palms (shape 2) apart from the other trees, keeping the tile grouping
function splitTrees( inst, tiles, palms ) {

	const out = [], outTiles = [];
	for ( const [ tx, tz, start, count ] of tiles ) {

		const first = out.length / 8;
		for ( let i = start; i < start + count; i ++ ) if ( ( Math.round( inst[ i * 8 + 5 ] ) === 2 ) === palms ) out.push( ...inst.subarray( i * 8, i * 8 + 8 ) );
		const n = out.length / 8 - first;
		if ( n ) outTiles.push( [ tx, tz, first, n ] );

	}

	return { instances: new Float32Array( out ), tiles: outTiles };

}

// a fire escape instance (a = width, b = storeys) → one instance per storey, 3 m apart, from 3.2 m up
function expandFloors( inst, tiles ) {

	const out = [], outTiles = [];
	for ( const [ tx, tz, start, count ] of tiles ) {

		const first = out.length / 8;
		for ( let i = start; i < start + count; i ++ ) {

			const r = inst.subarray( i * 8, i * 8 + 8 );
			for ( let f = 0; f < r[ 7 ]; f ++ ) out.push( r[ 0 ], r[ 1 ] + 3.2 + f * 3.0, r[ 2 ], r[ 3 ], 1, r[ 5 ], r[ 6 ], f );

		}

		const n = out.length / 8 - first;
		if ( n ) outTiles.push( [ tx, tz, first, n ] );

	}

	return { instances: new Float32Array( out ), tiles: outTiles };

}
