import { BufferAttribute, BufferGeometry, Group, Mesh, Vector3 } from '../engine/index.js';
import { Material } from '../engine/render/Material.js';
import { FERRY } from './FerrySpec.js';

const RHO = 1025;

// Hull lines of the catamaran in the boat frame (+Z forward, +Y up, +X port; y = 0 the design waterline, z = 0
// amidships), with the accessors the spray, wake and player systems read from a hull (see HullLines).
class FerryLines {

	constructor() {

		const L = FERRY.length;
		this.zAft = - L / 2;
		this.zBow = L / 2;
		this.wlStart = - L / 2 + 0.6;
		this.wlEnd = L / 2 - 1.2;
		this.deckY = FERRY.deckY;
		this.shell = 0.05;
		this.bowTaper = 11; // m over which each demihull narrows to the stem

	}

	// fraction of full demihull width at z (1 aft of the bow taper, → 0.1 at the stem)
	taper( z ) {

		const t = ( this.wlEnd - z ) / this.bowTaper;
		return z > this.wlEnd ? 0 : Math.max( 0.1, Math.min( 1, t ) );

	}

	// half of the overall waterline beam (outer side of the demihulls)
	halfBeamAt( z ) {

		if ( z < this.wlStart || z > this.wlEnd ) return 0;
		return FERRY.hullSpacing / 2 + FERRY.hullWidth / 2 * this.taper( z );

	}

	tAtSheerZ( z ) { return Math.min( 1, Math.max( 0, ( z - this.zAft ) / ( this.zBow - this.zAft ) ) ); }
	sheerY( t ) { return this.deckY + 0.9 + 0.4 * t * t; }
	sheerX( t ) { return FERRY.beam / 2 * ( t > 0.85 ? Math.max( 0.3, 1 - ( t - 0.85 ) / 0.15 * 0.7 ) : 1 ); }
	halfBreadth( t ) { return this.sheerX( t ); }
	bottomAt( x, z ) {

		const off = Math.abs( Math.abs( x ) - FERRY.hullSpacing / 2 );
		return off < FERRY.hullWidth / 2 * this.taper( z ) ? - FERRY.draft : 1.2; // demihull keel, or the wet deck

	}

}

// Procedural MV Golden Gate-class passenger catamaran (FerrySpec.js): two demihulls, wet deck, main and upper
// cabins with window bands, wheelhouse, mast. One mesh, vertex-coloured. Implements the hull interface the
// boat systems use (lines, hydro, hullSamples, anchors, lights, hull volume); helmOnly: boarding goes straight
// to the helm (no deck walking on the ferry in run 1, D35).
export class FerryModel {

	constructor() {

		const lines = this.lines = new FerryLines();
		this.helmOnly = true;
		this.group = new Group();
		this.group.name = 'Ferry';

		const P = [], N = [], C = [], I = [];
		const col = {
			hull: [ 0.86, 0.86, 0.84 ], stripe: [ 0.55, 0.06, 0.04 ], white: [ 0.9, 0.9, 0.88 ], glass: [ 0.05, 0.07, 0.09 ],
			deck: [ 0.35, 0.36, 0.37 ], dark: [ 0.12, 0.12, 0.13 ],
		};
		const quad = ( a, b, c, d, color ) => {

			const n = new Vector3().subVectors( b, a ).cross( new Vector3().subVectors( d, a ) ).normalize();
			const o = P.length / 3;
			for ( const v of [ a, b, c, d ] ) { P.push( v.x, v.y, v.z ); N.push( n.x, n.y, n.z ); C.push( ...color, 1 ); }
			I.push( o, o + 1, o + 2, o, o + 2, o + 3 );

		};
		const box = ( x0, x1, y0, y1, z0, z1, color ) => {

			const v = ( x, y, z ) => new Vector3( x, y, z );
			quad( v( x0, y0, z1 ), v( x1, y0, z1 ), v( x1, y1, z1 ), v( x0, y1, z1 ), color ); // front (+z)
			quad( v( x1, y0, z0 ), v( x0, y0, z0 ), v( x0, y1, z0 ), v( x1, y1, z0 ), color ); // back
			quad( v( x1, y0, z1 ), v( x1, y0, z0 ), v( x1, y1, z0 ), v( x1, y1, z1 ), color ); // +x
			quad( v( x0, y0, z0 ), v( x0, y0, z1 ), v( x0, y1, z1 ), v( x0, y1, z0 ), color ); // −x
			quad( v( x0, y1, z1 ), v( x1, y1, z1 ), v( x1, y1, z0 ), v( x0, y1, z0 ), color ); // top
			quad( v( x0, y0, z0 ), v( x1, y0, z0 ), v( x1, y0, z1 ), v( x0, y0, z1 ), color ); // bottom

		};

		// demihulls: lofted sections, flat-ish bottom with chines, narrowing and rising to the stem
		const zs = [];
		for ( let z = lines.zAft; z < lines.wlEnd - lines.bowTaper; z += 4 ) zs.push( z );
		for ( let k = 0; k <= 8; k ++ ) zs.push( lines.wlEnd - lines.bowTaper + lines.bowTaper * k / 8 );
		zs.push( lines.zBow );
		const section = ( z, side ) => {

			const t = z > lines.wlEnd ? 0.05 : lines.taper( z ), w = FERRY.hullWidth / 2 * t;
			const cx = side * FERRY.hullSpacing / 2, bottom = - FERRY.draft + ( 1 - t ) * ( FERRY.draft + 0.6 ) * ( z > 0 ? 1 : 0 );
			const top = FERRY.deckY;
			return [ new Vector3( cx - w, top, z ), new Vector3( cx - w * 1.05, 0.2, z ), new Vector3( cx - w * 0.7, bottom, z ),
				new Vector3( cx + w * 0.7, bottom, z ), new Vector3( cx + w * 1.05, 0.2, z ), new Vector3( cx + w, top, z ) ];

		};
		for ( const side of [ - 1, 1 ] ) {

			for ( let k = 0; k + 1 < zs.length; k ++ ) {

				const a = section( zs[ k ], side ), b = section( zs[ k + 1 ], side );
				for ( let s = 0; s < 5; s ++ ) {

					const stripe = s === 0 || s === 4;
					quad( a[ s + 1 ], b[ s + 1 ], b[ s ], a[ s ], stripe ? col.hull : col.hull );

				}

			}

			const st = section( zs[ 0 ], side ); // transom
			quad( st[ 5 ], st[ 4 ], st[ 1 ], st[ 0 ], col.hull );
			quad( st[ 4 ], st[ 3 ], st[ 2 ], st[ 1 ], col.hull );
			// the stripe along each hull's outer side
			const sx = side * ( FERRY.hullSpacing / 2 + FERRY.hullWidth / 2 * 1.01 );
			box( Math.min( sx, sx + side * 0.05 ), Math.max( sx, sx + side * 0.05 ), 1.5, 1.9, lines.zAft + 0.3, lines.wlEnd - lines.bowTaper * 0.5, col.stripe );

		}

		// wet deck / cross structure, main deck, cabins, wheelhouse, mast
		const hb = FERRY.beam / 2;
		box( - hb + 0.3, hb - 0.3, 1.2, FERRY.deckY, lines.zAft + 0.5, lines.wlEnd - 4, col.hull );
		box( - hb, hb, FERRY.deckY, FERRY.deckY + 0.15, lines.zAft + 0.3, lines.wlEnd - 3, col.deck );
		const cabin = ( w, y0, y1, z0, z1, win0, win1 ) => {

			box( - w, w, y0, y1, z0, z1, col.white );
			box( - w - 0.03, w + 0.03, y0 + win0, y0 + win1, z0 + 0.8, z1 - 0.8, col.glass );

		};
		cabin( hb - 0.4, FERRY.deckY + 0.15, FERRY.deckY + 2.8, - 15, 14, 0.9, 2.1 );
		cabin( hb - 1.2, FERRY.deckY + 2.8, FERRY.deckY + 5.3, - 8, 9, 0.8, 2.0 );
		cabin( 3.2, FERRY.deckY + 5.3, FERRY.deckY + 7.6, 3, 8.5, 0.9, 2.0 );
		box( - 0.12, 0.12, FERRY.deckY + 7.6, FERRY.deckY + 11.5, 5.5, 5.8, col.dark );

		const g = new BufferGeometry();
		g.setAttribute( 'position', new BufferAttribute( new Float32Array( P ), 3 ) );
		g.setAttribute( 'normal', new BufferAttribute( new Float32Array( N ), 3 ) );
		g.setAttribute( 'color', new BufferAttribute( new Float32Array( C ), 4 ) );
		g.setIndex( new BufferAttribute( new Uint32Array( I ), 1 ) );
		this.material = new Material( { name: 'ferry', vertexColors: true, roughness: 0.55 } );
		this.mesh = new Mesh( g, this.material );
		this.mesh.name = 'ferry-hull';
		this.mesh.castShadow = true;
		this.mesh.receiveShadow = true;
		this.group.add( this.mesh );
		this.triangles = I.length / 3;

		// ---- anchors (boat frame)
		this.helmEye = new Vector3( 0, FERRY.deckY + 7.3, 7.6 );
		this.boardPoint = new Vector3( 0, FERRY.deckY + 0.15, lines.zAft + 1.5 );
		this.exitPoints = [ this.boardPoint.clone() ];
		this.colliders = [];
		this.propeller = new Vector3( 0, - 0.9, lines.zAft + 0.2 ); // between the two waterjet nozzles
		this.rudder = { z: lines.zAft + 0.2 };
		this.jets = [ new Vector3( FERRY.hullSpacing / 2, - 0.9, lines.zAft ), new Vector3( - FERRY.hullSpacing / 2, - 0.9, lines.zAft ) ];

		// ---- hydrostatics: 2 demihulls × 8 waterplane patches; patch depth chosen so the samples float the
		// design displacement on y = 0 (sum area × depth × rho = mass)
		const samples = [];
		const n = 8, dz = ( lines.wlEnd - lines.wlStart ) / n;
		let area = 0;
		for ( const side of [ - 1, 1 ] ) for ( let k = 0; k < n; k ++ ) {

			const z = lines.wlStart + ( k + 0.5 ) * dz, a = FERRY.hullWidth * lines.taper( z ) * dz;
			samples.push( { position: new Vector3( side * FERRY.hullSpacing / 2, 0, z ), area: a, bottomY: - FERRY.draft } );
			area += a;

		}

		const depth = FERRY.mass / ( RHO * area );
		for ( const s of samples ) s.position.y = - depth;
		this.hullSamples = samples;
		const m = FERRY.mass, kRoll = 3.6, kPitch = FERRY.length * 0.26, kYaw = FERRY.length * 0.27;
		this.hydro = {
			suggestedMass: m, waterplaneArea: area, meanPatchDepth: depth,
			centerOfMass: new Vector3( 0, 1.6, 0 ), centerOfBuoyancy: new Vector3( 0, - depth / 2, 0 ),
			inertia: new Vector3( m * kPitch * kPitch, m * kYaw * kYaw, m * kRoll * kRoll ), // x pitch, y yaw, z roll
		};

		// navigation + cabin lights (boat frame): red port (+x), green starboard, masthead, stern, cabins
		const y = FERRY.deckY;
		this.lightDefs = [
			{ p: [ 3.3, y + 6.8, 8.6 ], color: [ 1.0, 0.06, 0.03 ], intensity: 3, range: 14, kind: 'boatNav', side: [ 1, 0, 0 ] },
			{ p: [ - 3.3, y + 6.8, 8.6 ], color: [ 0.05, 1.0, 0.3 ], intensity: 3, range: 14, kind: 'boatNav', side: [ - 1, 0, 0 ] },
			{ p: [ 0, y + 11.4, 5.65 ], color: [ 1.0, 0.95, 0.85 ], intensity: 3, range: 16, kind: 'boatNav' },
			{ p: [ 0, y + 2.2, lines.zAft + 0.4 ], color: [ 1.0, 0.95, 0.85 ], intensity: 2, range: 12, kind: 'boatNav' },
			{ p: [ 0, y + 2.0, - 2 ], color: [ 1.0, 0.86, 0.66 ], intensity: 5, range: 18, kind: 'boatDome' },
			{ p: [ 0, y + 4.5, 1 ], color: [ 1.0, 0.86, 0.66 ], intensity: 4, range: 14, kind: 'boatDome' },
		];

	}

	// visual hooks the boat controller drives (waterjets have no visible propeller / rudder)
	setThrottle() {}
	setSteering() {}
	setPropellerRPM() {}
	update() {}

	// the volume the sea must not be drawn inside: the two demihulls up to the deck
	createHullVolumeGeometry() {

		const P = [], I = [];
		const L = this.lines;
		for ( const side of [ - 1, 1 ] ) {

			const cx = side * FERRY.hullSpacing / 2, w = FERRY.hullWidth / 2, o = P.length / 3;
			for ( const [ x, y, z ] of [ [ - w, - FERRY.draft, L.zAft ], [ w, - FERRY.draft, L.zAft ], [ w, FERRY.deckY, L.zAft ], [ - w, FERRY.deckY, L.zAft ],
				[ - 0.2, - FERRY.draft, L.zBow ], [ 0.2, - FERRY.draft, L.zBow ], [ 0.2, FERRY.deckY, L.zBow ], [ - 0.2, FERRY.deckY, L.zBow ] ] ) P.push( cx + x, y, z );
			for ( const f of [ [ 0, 3, 2, 1 ], [ 4, 5, 6, 7 ], [ 0, 1, 5, 4 ], [ 1, 2, 6, 5 ], [ 2, 3, 7, 6 ], [ 3, 0, 4, 7 ] ] ) I.push( o + f[ 0 ], o + f[ 1 ], o + f[ 2 ], o + f[ 0 ], o + f[ 2 ], o + f[ 3 ] );

		}

		const g = new BufferGeometry();
		g.setAttribute( 'position', new BufferAttribute( new Float32Array( P ), 3 ) );
		g.setIndex( new BufferAttribute( new Uint32Array( I ), 1 ) );
		return g;

	}

}
