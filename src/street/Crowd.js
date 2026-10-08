import { InstancedBufferGeometry, BufferAttribute, InstancedInterleavedBuffer, InterleavedBufferAttribute, Mesh, Frustum, Matrix4, Sphere, Vector3 } from 'harbor-engine/src/engine/index.js';
import { Material } from 'harbor-engine/src/engine/render/Material.js';
import { noiseModule } from './wgsl.js';

// The crowd (D54, G12b): a seeded population walks the pedestrian lanes (public/street/crowd.*, pipelines/street/
// crowd.mjs) — along the sidewalks, now and then stopping, and across the street at crosswalks after waiting at the
// kerb (so people gather there) — denser at the Ferry Building and Pier 39. No collision avoidance beyond staying on
// the walkable lanes. The nearest MAX are drawn as one instanced figure, vertex-animated (walk and idle cycles) with
// body and clothing variants (in view first: the frustum, plus everyone within 15 m); the ones within NEAR m also cast
// shadows (a second draw). Instance slot 0 can carry
// the player (D57, over-the-shoulder camera).

const STEP = 2; // m between lane points (pipeline)
const _frustum = new Frustum(), _vp = new Matrix4(), _sphere = new Sphere(), _c = new Vector3();
export const MAX = 360, NEAR = 30, RADIUS = 170;
const WALK = 0, WAIT = 1, CROSS = 2, IDLE = 3;

// mulberry32
export function rng( seed ) {

	let a = seed >>> 0;
	return () => { a = ( a + 0x6D2B79F5 ) >>> 0; let t = a; t = Math.imul( t ^ ( t >>> 15 ), t | 1 ); t ^= t + Math.imul( t ^ ( t >>> 7 ), t | 61 ); return ( ( t ^ ( t >>> 14 ) ) >>> 0 ) / 4294967296; };

}

export class CrowdSim {

	// data: { index: crowd.json, pts: Float32Array [x, z, half-width, …] }
	constructor( { index, pts }, { seed = 1975, population = index.population } = {} ) {

		this.pts = pts;
		this.lanes = index.lanes; // [ start, count, weight ]
		this.cross = new Map(); // "lane:point" → [ crossing… ]
		for ( const c of index.crossings ) {

			const [ la, ia, lb, ib ] = c;
			for ( const [ l, i, other ] of [ [ la, ia, [ lb, ib, c[ 4 ], c[ 5 ], c[ 6 ], c[ 7 ] ] ], [ lb, ib, [ la, ia, c[ 6 ], c[ 7 ], c[ 4 ], c[ 5 ] ] ] ] ) {

				const k = l + ':' + i;
				if ( ! this.cross.has( k ) ) this.cross.set( k, [] );
				this.cross.get( k ).push( other );

			}

		}

		const N = this.N = population;
		this.lane = new Int32Array( N ); this.s = new Float32Array( N ); this.dir = new Int8Array( N ); this.speed = new Float32Array( N );
		this.side = new Float32Array( N ); this.state = new Uint8Array( N ); this.timer = new Float32Array( N ); this.variant = new Float32Array( N );
		this.phase = new Float32Array( N ); this.x = new Float32Array( N ); this.z = new Float32Array( N ); this.yaw = new Float32Array( N );
		this.path = new Array( N ).fill( null ); // crossing: { p: [[x, z]…], t, lane, i }
		this.seed( seed );

	}

	seed( seed ) {

		const r = this.r = rng( seed );
		// lanes by weight × length
		const cum = [];
		let tot = 0;
		for ( const [ , count, w ] of this.lanes ) { tot += w * ( count - 1 ); cum.push( tot ); }
		for ( let a = 0; a < this.N; a ++ ) {

			const u = r() * tot;
			let lo = 0, hi = cum.length - 1;
			while ( lo < hi ) { const m = ( lo + hi ) >> 1; if ( cum[ m ] < u ) lo = m + 1; else hi = m; }
			this.lane[ a ] = lo;
			this.s[ a ] = r() * ( this.lanes[ lo ][ 1 ] - 1 );
			this.dir[ a ] = r() < 0.5 ? 1 : - 1;
			this.speed[ a ] = 1.05 + r() * 0.55;
			this.side[ a ] = r() * 2 - 1; // across the lane's clear width (scaled when placed)
			this.state[ a ] = r() < 0.12 ? IDLE : WALK;
			this.timer[ a ] = r() * 20;
			this.variant[ a ] = Math.floor( r() * 4096 );
			this.phase[ a ] = r() * 6.283;
			this.path[ a ] = null;

		}

		this.time = 0;
		this.place();

	}

	// lane point i of lane l
	P( l, i ) { const k = ( this.lanes[ l ][ 0 ] + i ) * 3; return [ this.pts[ k ], this.pts[ k + 1 ] ]; }
	// the clear half-width of the segment from lane point i
	W( l, i ) { return this.pts[ ( this.lanes[ l ][ 0 ] + i ) * 3 + 2 ]; }

	update( dt ) {

		this.time += dt;
		const r = this.r;
		for ( let a = 0; a < this.N; a ++ ) {

			const st = this.state[ a ];
			if ( st === WAIT || st === IDLE ) {

				this.timer[ a ] -= dt;
				if ( this.timer[ a ] > 0 ) continue;
				if ( st === WAIT ) { this.state[ a ] = CROSS; continue; }
				this.state[ a ] = WALK; this.timer[ a ] = 10 + r() * 40;
				continue;

			}

			const v = this.speed[ a ] * dt;
			this.phase[ a ] += v * 1.75; // ~ one stride (two steps) every 3.6 m
			if ( st === CROSS ) {

				const c = this.path[ a ];
				c.t += v;
				if ( c.t >= c.len ) { this.lane[ a ] = c.lane; this.s[ a ] = c.i; this.dir[ a ] = r() < 0.5 ? 1 : - 1; this.state[ a ] = WALK; this.path[ a ] = null; }
				continue;

			}

			// walking along the lane
			const n = this.lanes[ this.lane[ a ] ][ 1 ];
			const before = Math.floor( this.s[ a ] );
			this.s[ a ] += this.dir[ a ] * v / STEP;
			if ( this.s[ a ] <= 0 || this.s[ a ] >= n - 1 ) { this.s[ a ] = Math.min( n - 1, Math.max( 0, this.s[ a ] ) ); this.dir[ a ] = - this.dir[ a ]; }
			const after = Math.floor( this.s[ a ] );
			// passing a lane point with a crossing: sometimes cross (after waiting at the kerb)
			if ( after !== before ) {

				const at = this.dir[ a ] > 0 ? after : before;
				const cs = this.cross.get( this.lane[ a ] + ':' + at );
				if ( cs && r() < 0.35 ) {

					const [ l2, i2, ex, ez, fx, fz ] = cs[ Math.floor( r() * cs.length ) ];
					const p0 = this.P( this.lane[ a ], at ), p3 = this.P( l2, i2 );
					const p = [ p0, [ ex, ez ], [ fx, fz ], p3 ];
					let len = 0; const seg = [ 0 ];
					for ( let k = 1; k < 4; k ++ ) { len += Math.hypot( p[ k ][ 0 ] - p[ k - 1 ][ 0 ], p[ k ][ 1 ] - p[ k - 1 ][ 1 ] ); seg.push( len ); }
					this.path[ a ] = { p, seg, len, t: 0, lane: l2, i: i2 };
					this.s[ a ] = at;
					this.state[ a ] = WAIT;
					this.timer[ a ] = 2 + r() * 14;
					continue;

				}

			}

			// now and then stop a while (window shopping, a phone, a view)
			this.timer[ a ] -= dt;
			if ( this.timer[ a ] < 0 ) { this.state[ a ] = IDLE; this.timer[ a ] = 3 + r() * 12; }

		}

		this.place();

	}

	// world x, z, yaw of every agent
	place() {

		for ( let a = 0; a < this.N; a ++ ) {

			if ( this.state[ a ] === CROSS || ( this.state[ a ] === WAIT && this.path[ a ] ) ) {

				const c = this.path[ a ];
				const t = this.state[ a ] === WAIT ? 0 : c.t;
				let k = 1; while ( k < 3 && c.seg[ k ] < t ) k ++;
				const u = Math.min( 1, ( t - c.seg[ k - 1 ] ) / Math.max( 1e-6, c.seg[ k ] - c.seg[ k - 1 ] ) );
				const [ ax, az ] = c.p[ k - 1 ], [ bx, bz ] = c.p[ k ];
				this.x[ a ] = ax + ( bx - ax ) * u; this.z[ a ] = az + ( bz - az ) * u;
				this.yaw[ a ] = Math.atan2( - ( bx - ax ), - ( bz - az ) );
				continue;

			}

			const l = this.lane[ a ], n = this.lanes[ l ][ 1 ], s = this.s[ a ];
			const i = Math.min( n - 2, Math.floor( s ) ), u = s - i;
			const [ ax, az ] = this.P( l, i ), [ bx, bz ] = this.P( l, i + 1 );
			const dx = bx - ax, dz = bz - az, L = Math.hypot( dx, dz ) || 1;
			// spread across the walkway (its clear half-width less 0.3 m); the sign keeps two-way walkers apart
			const off = this.side[ a ] * this.dir[ a ] * Math.max( 0.25, this.W( l, i ) - 0.3 );
			this.x[ a ] = ax + dx * u + dz / L * off; this.z[ a ] = az + dz * u - dx / L * off;
			this.yaw[ a ] = Math.atan2( - dx * this.dir[ a ], - dz * this.dir[ a ] );

		}

	}

}

// ---- the figure, with a bone id per vertex (pivots in the shader: hips 0.9, knees 0.47, shoulders 1.45, elbows 1.17;
// forward is -z). detail = true: the near figure, smooth lofted limbs, a rounded head, shaped torso, hands and calves;
// false: tapered boxes on the same joints for the far crowd.
function figure( detail ) {

	const P = [], N = [], B = [];
	const quad = ( a, b, c, d, n, bone ) => { for ( const p of [ a, b, c, a, c, d ] ) { P.push( ...p ); N.push( ...n ); B.push( bone ); } };
	// a tapered box from y0 (half sizes w0, d0) to y1 (w1, d1), centred on (cx, cz)
	const seg = ( cx, cz, y0, y1, w0, d0, w1, d1, bone, caps = true ) => {

		const c = [ [ - 1, - 1 ], [ 1, - 1 ], [ 1, 1 ], [ - 1, 1 ] ];
		const lo = c.map( ( [ sx, sz ] ) => [ cx + sx * w0, y0, cz + sz * d0 ] ), hi = c.map( ( [ sx, sz ] ) => [ cx + sx * w1, y1, cz + sz * d1 ] );
		const ns = [ [ 0, 0, - 1 ], [ 1, 0, 0 ], [ 0, 0, 1 ], [ - 1, 0, 0 ] ];
		for ( let k = 0; k < 4; k ++ ) quad( lo[ k ], lo[ ( k + 1 ) % 4 ], hi[ ( k + 1 ) % 4 ], hi[ k ], ns[ k ], bone );
		if ( caps ) { quad( hi[ 0 ], hi[ 1 ], hi[ 2 ], hi[ 3 ], [ 0, 1, 0 ], bone ); quad( lo[ 3 ], lo[ 2 ], lo[ 1 ], lo[ 0 ], [ 0, - 1, 0 ], bone ); }

	};
	// a smooth loft through elliptical rings [ y, half width, half depth, cx, cz ] (bottom to top); a ring of zero size
	// closes the end to a point, open ends get a flat cap
	const loft = ( rings, sides, bone ) => {

		const R = rings.map( ( [ y, w, d, cx = 0, cz = 0 ] ) => ( { y, w, d, cx, cz } ) );
		const vtx = ( i, k ) => {

			const r = R[ i ], a = k / sides * Math.PI * 2, ca = Math.cos( a ), sa = Math.sin( a );
			const lo = R[ Math.max( 0, i - 1 ) ], hi = R[ Math.min( R.length - 1, i + 1 ) ];
			let nx = ca * r.d, nz = sa * r.w, l = Math.hypot( nx, nz ) || 1; nx /= l; nz /= l;
			const ny = - ( ( hi.w + hi.d ) - ( lo.w + lo.d ) ) / 2 / ( ( hi.y - lo.y ) || 1 );
			let n = [ nx, ny, nz ];
			if ( r.w + r.d < 1e-6 ) n = [ 0, i === 0 ? - 1 : 1, 0 ];
			l = Math.hypot( ...n ); n = n.map( c => c / l );
			return { p: [ r.cx + ca * r.w, r.y, r.cz + sa * r.d ], n };

		};
		const tri = ( ...v ) => { for ( const { p, n } of v ) { P.push( ...p ); N.push( ...n ); B.push( bone ); } };
		for ( let i = 0; i + 1 < R.length; i ++ ) for ( let k = 0; k < sides; k ++ ) {

			const a = vtx( i, k ), b = vtx( i, k + 1 ), c = vtx( i + 1, k + 1 ), d = vtx( i + 1, k );
			if ( R[ i ].w + R[ i ].d > 1e-6 ) tri( a, b, c );
			if ( R[ i + 1 ].w + R[ i + 1 ].d > 1e-6 ) tri( a, c, d );

		}

		for ( const [ i, up ] of [ [ 0, - 1 ], [ R.length - 1, 1 ] ] ) {

			const r = R[ i ];
			if ( r.w + r.d < 1e-6 ) continue;
			const c = { p: [ r.cx, r.y, r.cz ], n: [ 0, up, 0 ] };
			for ( let k = 0; k < sides; k ++ ) { const a = vtx( i, k ), b = vtx( i, k + 1 ); tri( c, { p: a.p, n: c.n }, { p: b.p, n: c.n } ); }

		}

	};

	if ( ! detail ) {

		seg( 0, 0, 0.86, 1.02, 0.16, 0.1, 0.16, 0.1, 0 );               // 0 hips
		seg( 0, 0, 1.0, 1.47, 0.15, 0.1, 0.19, 0.11, 1 );                // 1 torso
		seg( 0, 0, 1.47, 1.55, 0.045, 0.045, 0.045, 0.045, 2, false );   // 2 neck
		seg( 0, 0, 1.55, 1.78, 0.075, 0.095, 0.08, 0.1, 2 );             // 2 head
		for ( const [ sx, up, lo ] of [ [ - 1, 3, 4 ], [ 1, 5, 6 ] ] ) {

			seg( sx * 0.215, 0, 1.17, 1.45, 0.04, 0.045, 0.048, 0.052, up ); // upper arm
			seg( sx * 0.22, 0, 0.76, 1.17, 0.025, 0.035, 0.04, 0.042, lo );   // forearm + hand

		}

		for ( const [ sx, th, sh, ft ] of [ [ - 1, 7, 8, 9 ], [ 1, 10, 11, 12 ] ] ) {

			seg( sx * 0.09, 0, 0.47, 0.92, 0.05, 0.055, 0.075, 0.08, th );    // thigh
			seg( sx * 0.09, 0, 0.07, 0.47, 0.035, 0.04, 0.05, 0.055, sh );   // shin
			seg( sx * 0.09, - 0.06, 0.0, 0.08, 0.045, 0.13, 0.04, 0.1, ft ); // foot

		}

	} else {

		// pelvis and torso: hips, waist, chest, shoulders sloping to the neck
		loft( [ [ 0.8, 0, 0 ], [ 0.83, 0.11, 0.08 ], [ 0.9, 0.165, 0.105 ], [ 1.02, 0.158, 0.1 ] ], 8, 0 );
		loft( [ [ 1.0, 0.158, 0.1 ], [ 1.1, 0.148, 0.095 ], [ 1.24, 0.172, 0.11, 0, - 0.008 ], [ 1.35, 0.19, 0.115, 0, - 0.01 ], [ 1.43, 0.195, 0.1 ], [ 1.48, 0.14, 0.075 ], [ 1.51, 0.06, 0.05 ] ], 8, 1 );
		loft( [ [ 1.48, 0.05, 0.052 ], [ 1.59, 0.045, 0.047 ] ], 6, 2 );
		// head: jaw and chin forward and narrow, the skull rounder and set back
		loft( [ [ 1.545, 0, 0, 0, - 0.02 ], [ 1.565, 0.045, 0.05, 0, - 0.025 ], [ 1.6, 0.07, 0.085, 0, - 0.01 ], [ 1.65, 0.08, 0.1 ], [ 1.7, 0.082, 0.102, 0, 0.005 ], [ 1.75, 0.07, 0.088, 0, 0.008 ], [ 1.78, 0.042, 0.055, 0, 0.008 ], [ 1.792, 0, 0, 0, 0.008 ] ], 8, 2 );
		seg( 0, - 0.1, 1.61, 1.67, 0.013, 0.012, 0.009, 0.006, 2 );   // nose
		for ( const [ sx, up, lo ] of [ [ - 1, 3, 4 ], [ 1, 5, 6 ] ] ) {

			const x = sx * 0.205;
			loft( [ [ 1.17, 0.04, 0.043, x ], [ 1.31, 0.046, 0.05, x ], [ 1.42, 0.054, 0.056, x ], [ 1.48, 0, 0, x ] ], 6, up );
			loft( [ [ 0.885, 0.026, 0.03, x * 1.04 ], [ 0.96, 0.03, 0.033, x * 1.03 ], [ 1.09, 0.041, 0.043, x * 1.01 ], [ 1.18, 0.04, 0.043, x ] ], 6, lo );
			loft( [ [ 0.72, 0, 0, x * 1.06, - 0.005 ], [ 0.75, 0.016, 0.03, x * 1.06, - 0.005 ], [ 0.83, 0.02, 0.042, x * 1.05 ], [ 0.89, 0.024, 0.03, x * 1.04 ] ], 6, lo ); // hand

		}

		for ( const [ sx, th, sh, ft ] of [ [ - 1, 7, 8, 9 ], [ 1, 10, 11, 12 ] ] ) {

			const x = sx * 0.09;
			loft( [ [ 0.46, 0.046, 0.05, x ], [ 0.6, 0.056, 0.062, x ], [ 0.78, 0.07, 0.076, x ], [ 0.93, 0.078, 0.085, x ] ], 6, th );
			loft( [ [ 0.07, 0.032, 0.036, x ], [ 0.2, 0.036, 0.041, x, 0.004 ], [ 0.36, 0.05, 0.056, x, 0.01 ], [ 0.48, 0.046, 0.05, x ] ], 6, sh );
			seg( x, - 0.045, 0.0, 0.075, 0.04, 0.115, 0.035, 0.075, ft ); // shoe

		}

	}

	// orient every triangle counter-clockwise seen along its normal
	for ( let i = 0; i < P.length; i += 9 ) {

		const ax = P[ i + 3 ] - P[ i ], ay = P[ i + 4 ] - P[ i + 1 ], az = P[ i + 5 ] - P[ i + 2 ], bx = P[ i + 6 ] - P[ i ], by = P[ i + 7 ] - P[ i + 1 ], bz = P[ i + 8 ] - P[ i + 2 ];
		const cx = ay * bz - az * by, cy = az * bx - ax * bz, cz = ax * by - ay * bx;
		if ( cx * N[ i ] + cy * N[ i + 1 ] + cz * N[ i + 2 ] < 0 ) for ( let k = 0; k < 3; k ++ ) { const t = P[ i + 3 + k ]; P[ i + 3 + k ] = P[ i + 6 + k ]; P[ i + 6 + k ] = t; }

	}

	return { position: new Float32Array( P ), normal: new Float32Array( N ), bone: new Float32Array( B ) };

}

export function crowdMaterial() {

	return new Material( {
		name: 'crowd',
		modules: [ noiseModule ],
		underwaterLighting: 'none',
		attributes: { aBone: 'f32', iA: 'vec4f', iB: 'vec4f' },
		varyings: { vBone: 'f32', vVar: 'f32', vY: 'f32', vNz: 'f32' },
		vertex: /* wgsl */`
	// instance: iA = (x, y, z, yaw), iB = (phase, stride 0..1 (0 = standing), variant, scale)
	let bone = u32( v.aBone + 0.5 );
	let ph = v.iB.x;
	let walk = v.iB.y;
	let vr = v.iB.z;
	var p = v.position;
	var n = v.normal;
	let sw = sin( ph );
	// body proportions by variant: height, girth
	let tall = 0.92 + 0.16 * fract( vr * 0.0731 );
	let wide = 0.9 + 0.25 * fract( vr * 0.0517 );
	// legs: hip swing (hipA > 0 swings the leg back), knee bend (the shin folds back, most while the leg swings
	// forward); arms: swing against the leg on the same side, the forearm bent forward at the elbow
	let left = p.x < 0.0;
	let legS = select( - 1.0, 1.0, left ) * sw;
	let hipA = 0.4 * legS * walk;
	let kneeA = ( 0.08 + 0.75 * max( 0.0, - cos( ph + select( 3.1416, 0.0, left ) ) ) ) * walk;
	let armA = 0.3 * legS * walk;
	let elbowA = 0.12 + 0.2 * walk + 0.12 * max( 0.0, legS ) * walk;
	// limbs rotate about x (pitch) round their joints: knees, then hips; elbows, then shoulders. A rotation by a
	// positive angle carries a point below the joint forward (-z)
	if ( bone >= 7u ) {
		let hip = vec3f( p.x, 0.9, 0.0 ); let knee = vec3f( p.x, 0.47, 0.0 );
		if ( bone == 8u || bone == 9u || bone == 11u || bone == 12u ) {
			let d = p - knee; let c = cos( - kneeA ); let s2 = sin( - kneeA );
			p = knee + vec3f( d.x, c * d.y - s2 * d.z, s2 * d.y + c * d.z );
			n = vec3f( n.x, c * n.y - s2 * n.z, s2 * n.y + c * n.z );
		}
		let d = p - hip; let c = cos( - hipA ); let s2 = sin( - hipA );
		p = hip + vec3f( d.x, c * d.y - s2 * d.z, s2 * d.y + c * d.z );
		n = vec3f( n.x, c * n.y - s2 * n.z, s2 * n.y + c * n.z );
	} else if ( bone >= 3u ) {
		let sh = vec3f( p.x, 1.45, 0.0 ); let el = vec3f( p.x, 1.17, 0.0 );
		if ( bone == 4u || bone == 6u ) {
			let d = p - el; let c = cos( elbowA ); let s2 = sin( elbowA );
			p = el + vec3f( d.x, c * d.y - s2 * d.z, s2 * d.y + c * d.z );
			n = vec3f( n.x, c * n.y - s2 * n.z, s2 * n.y + c * n.z );
		}
		let d = p - sh; let c = cos( armA ); let s2 = sin( armA );
		p = sh + vec3f( d.x, c * d.y - s2 * d.z, s2 * d.y + c * d.z );
		n = vec3f( n.x, c * n.y - s2 * n.z, s2 * n.y + c * n.z );
	}
	// the upper body leans a little into the walk and the shoulders turn against the hips
	if ( bone >= 1u && bone <= 6u ) {
		let lean = 0.02 + 0.05 * walk;
		let d = p - vec3f( 0.0, 1.0, 0.0 ); let c = cos( - lean ); let s2 = sin( - lean );
		p = vec3f( 0.0, 1.0, 0.0 ) + vec3f( d.x, c * d.y - s2 * d.z, s2 * d.y + c * d.z );
		n = vec3f( n.x, c * n.y - s2 * n.z, s2 * n.y + c * n.z );
		let tw = - 0.1 * sw * walk; let ct = cos( tw ); let st = sin( tw );
		p = vec3f( ct * p.x + st * p.z, p.y, - st * p.x + ct * p.z );
		n = vec3f( ct * n.x + st * n.z, n.y, - st * n.x + ct * n.z );
	}
	// bob while walking (lowest as the feet pass), a slow sway while standing
	p.y += 0.03 * abs( cos( ph ) ) * walk;
	p.x += 0.015 * sin( frame.time * 0.7 + vr ) * ( 1.0 - walk ) * step( 0.9, p.y );
	p = vec3f( p.x * wide, p.y * tall, p.z * wide ) * v.iB.w;
	let cy = cos( v.iA.w ); let sy = sin( v.iA.w );
	o.vY = v.position.y;
	o.vNz = v.normal.z;
	v.position = v.iA.xyz + vec3f( cy * p.x + sy * p.z, p.y, - sy * p.x + cy * p.z );
	v.normal = vec3f( cy * n.x + sy * n.z, n.y, - sy * n.x + cy * n.z );
	o.vBone = v.aBone;
	o.vVar = vr;
`,
		surface: /* wgsl */`
	let bone = u32( in.vs.vBone + 0.5 );
	let vr = in.vs.vVar;
	let y = in.vs.vY;
	let skins = array<vec3f, 6>( vec3f( 0.62, 0.45, 0.35 ), vec3f( 0.45, 0.3, 0.22 ), vec3f( 0.3, 0.19, 0.13 ), vec3f( 0.7, 0.55, 0.43 ), vec3f( 0.55, 0.4, 0.28 ), vec3f( 0.2, 0.13, 0.09 ) );
	let tops = array<vec3f, 12>( vec3f( 0.05, 0.05, 0.06 ), vec3f( 0.6, 0.6, 0.62 ), vec3f( 0.08, 0.12, 0.25 ), vec3f( 0.45, 0.08, 0.06 ), vec3f( 0.15, 0.25, 0.15 ), vec3f( 0.55, 0.45, 0.3 ),
		vec3f( 0.75, 0.74, 0.7 ), vec3f( 0.25, 0.25, 0.27 ), vec3f( 0.6, 0.35, 0.1 ), vec3f( 0.3, 0.12, 0.3 ), vec3f( 0.1, 0.3, 0.35 ), vec3f( 0.7, 0.55, 0.15 ) );
	let bottoms = array<vec3f, 8>( vec3f( 0.06, 0.08, 0.15 ), vec3f( 0.04, 0.04, 0.05 ), vec3f( 0.35, 0.32, 0.25 ), vec3f( 0.18, 0.2, 0.24 ), vec3f( 0.08, 0.1, 0.18 ), vec3f( 0.45, 0.42, 0.35 ), vec3f( 0.1, 0.1, 0.1 ), vec3f( 0.25, 0.15, 0.1 ) );
	let hairs = array<vec3f, 5>( vec3f( 0.02, 0.015, 0.01 ), vec3f( 0.15, 0.08, 0.04 ), vec3f( 0.35, 0.25, 0.12 ), vec3f( 0.45, 0.42, 0.4 ), vec3f( 0.05, 0.035, 0.025 ) );
	let iv = u32( vr );
	let skin = skins[ iv % 6u ];
	let top = tops[ ( iv / 6u ) % 12u ];
	let bottom = bottoms[ ( iv / 72u ) % 8u ];
	let hair = hairs[ ( iv / 576u ) % 5u ];
	let jacket = ( ( iv / 2880u ) % 2u ) == 1u;
	var alb = top; var rough = 0.85;
	if ( bone == 2u ) { alb = select( skin, hair, y > 1.72 || ( y > 1.6 && in.vs.vNz > 0.3 ) || ( y > 1.69 && abs( in.vs.vNz ) < 0.5 ) ); }
	else if ( bone == 4u || bone == 6u ) { alb = select( select( top, skin, y < 0.895 ), skin, ! jacket && y < 1.1 ); }
	else if ( bone == 0u ) { alb = bottom; }
	else if ( bone >= 7u ) { alb = select( bottom, vec3f( 0.05, 0.045, 0.04 ), bone == 9u || bone == 12u || y < 0.09 ); rough = select( 0.85, 0.5, bone == 9u || bone == 12u ); }
	s.albedo = alb * ( 0.85 + 0.25 * stNoise( vec2f( vr, y * 12.0 ) ) );
	s.roughness = rough;
`,
	} );

}

export class CrowdView {

	constructor() {

		const make = ( shadows ) => {

			const t = figure( shadows );
			const g = new InstancedBufferGeometry();
			g.setAttribute( 'position', new BufferAttribute( t.position, 3 ) );
			g.setAttribute( 'normal', new BufferAttribute( t.normal, 3 ) );
			g.setAttribute( 'aBone', new BufferAttribute( t.bone, 1 ) );
			const live = new Float32Array( ( MAX + 1 ) * 8 );
			const ib = new InstancedInterleavedBuffer( live, 8, 1 );
			g.setAttribute( 'iA', new InterleavedBufferAttribute( ib, 4, 0 ) );
			g.setAttribute( 'iB', new InterleavedBufferAttribute( ib, 4, 4 ) );
			g.instanceCount = 0;
			const mesh = new Mesh( g, this.material || ( this.material = crowdMaterial() ) );
			mesh.name = shadows ? 'crowd-near' : 'crowd';
			mesh.frustumCulled = false;
			mesh.castShadow = shadows;
			mesh.receiveShadow = true;
			return { mesh, g, live, ib };

		};
		this.far = make( false );
		this.near = make( true );
		this.meshes = [ this.near.mesh, this.far.mesh ];
		this.drawn = 0;
		this.order = new Int32Array( 0 );

	}

	// the MAX agents nearest the camera among those in view within RADIUS or within KEEP m (shadows, the edge of the
	// view), and the player, if given: { x, y, z, yaw, phase, walk }
	update( sim, camera, groundY, player = null ) {

		const p = camera.position, R2 = RADIUS * RADIUS, K2 = 15 * 15;
		if ( this.order.length !== sim.N ) { this.order = new Int32Array( sim.N ); this.d2 = new Float32Array( sim.N ); }
		camera.updateMatrixWorld();
		_vp.multiplyMatrices( camera.projectionMatrix, camera.matrixWorldInverse );
		_frustum.setFromProjectionMatrix( _vp, camera.reversedDepth !== false );
		let n = 0;
		for ( let a = 0; a < sim.N; a ++ ) {

			const dx = sim.x[ a ] - p.x, dz = sim.z[ a ] - p.z, d = dx * dx + dz * dz;
			if ( d >= R2 ) continue;
			// in view: a 3 m sphere round the figure (its height is not looked up yet)
			if ( d >= K2 && ! _frustum.intersectsSphere( _sphere.set( _c.set( sim.x[ a ], p.y - 1, sim.z[ a ] ), 4 ) ) ) continue;
			this.order[ n ] = a; this.d2[ a ] = d; n ++;

		}

		let list = this.order.subarray( 0, n );
		if ( n > MAX ) list = Array.from( list ).sort( ( u, w ) => this.d2[ u ] - this.d2[ w ] ).slice( 0, MAX );
		let nn = 0, nf = 0;
		const put = ( set, k, x, y, z, yaw, ph, walk, vr, sc ) => { set.live.set( [ x, y, z, yaw, ph, walk, vr, sc ], k * 8 ); };
		if ( player ) put( this.near, nn ++, player.x, player.y, player.z, player.yaw, player.phase, player.walk, 1234, 1 );
		const near2 = NEAR * NEAR;
		for ( const a of list ) {

			const y = groundY( sim.x[ a ], sim.z[ a ] );
			const moving = sim.state[ a ] === 0 || sim.state[ a ] === 2 ? 1 : 0;
			if ( this.d2[ a ] < near2 && nn < MAX ) put( this.near, nn ++, sim.x[ a ], y, sim.z[ a ], sim.yaw[ a ], sim.phase[ a ], moving, sim.variant[ a ], 1 );
			else put( this.far, nf ++, sim.x[ a ], y, sim.z[ a ], sim.yaw[ a ], sim.phase[ a ], moving, sim.variant[ a ], 1 );

		}

		for ( const [ set, k ] of [ [ this.near, nn ], [ this.far, nf ] ] ) { set.ib.clearUpdateRanges(); set.ib.addUpdateRange( 0, k * 8 ); set.ib.needsUpdate = true; set.g.instanceCount = k; }
		this.drawn = nn + nf - ( player ? 1 : 0 );
		this.list = list;

	}

}
