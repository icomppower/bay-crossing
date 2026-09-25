import * as THREE from '../engine/index.js';
import { FERRY, KNOT } from '../world/FerrySpec.js';

const RHO = 1025;
const GRAV = 9.81;
const clamp = THREE.MathUtils.clamp;

const _F = new THREE.Vector3(), _T = new THREE.Vector3(), _com = new THREE.Vector3(), _p = new THREE.Vector3();
const _r = new THREE.Vector3(), _f = new THREE.Vector3(), _vp = new THREE.Vector3(), _vl = new THREE.Vector3();
const _a = new THREE.Vector3(), _fwd = new THREE.Vector3(), _side = new THREE.Vector3(), _v = new THREE.Vector3();
const _invQ = new THREE.Quaternion(), _dq = new THREE.Quaternion();

// Rigid-body model of the MV Golden Gate-class catamaran (FerrySpec.js), with the public surface of
// BoatController (position, quaternion, velocity, throttle / steer / rpm, driven / moored, toWorld, getYaw,
// sampleWaterAt, queueQueries, setInput, update) so the player, spray, wake and audio systems drive it the same
// way.
//
// Hydrostatics: the hull model's waterplane patches with water heights from the GPU water query (as the lobster
// boat). Heave damping ~0.4 of critical per patch. Manoeuvring: two waterjets (180 kN bollard pull, thrust
// falling to zero at the jet speed), nozzle deflection for steering (works at any speed, as waterjets do),
// reversing buckets astern; resistance R = c1 u + c2 u|u| tuned so full throttle tops out near 36 kn; lateral
// cross-flow and lift at stations along both demihulls (directional stability, turning); air drag.
// Grounding against the shipped terrain; `minDepthUnderHull` records the shallowest water the hull has been
// over (for the G4 draft check).
export class FerryController {

	constructor( { model, query, terrain, berth } ) {

		this.model = model;
		this.query = query;
		this.terrain = terrain;
		const hydro = model.hydro;
		this.mass = hydro.suggestedMass;
		this.com = hydro.centerOfMass.clone();
		this.inertia = hydro.inertia.clone();
		this.samples = model.hullSamples.map( ( s ) => ( { p: s.position.clone(), area: s.area, bottom: s.bottomY } ) );
		this.slot = query.allocate( 'ferryHull', this.samples.length );

		// lateral stations (z, area m^2 of both demihulls' underwater side)
		const L = model.lines;
		this.stations = [];
		for ( let z = L.wlStart + 3; z < L.wlEnd; z += 6 ) this.stations.push( [ z, 2 * 6 * FERRY.draft * L.taper( z ) ] );
		this.hullLift = 0.6;

		this.maxThrust = 180000; // N, both jets, bollard
		this.jetSpeed = 26; // m/s, thrust falls to zero here
		this.reverseFactor = 0.5;
		this.c1 = 2500; // N per m/s
		this.c2 = 152; // N per (m/s)^2
		this.nozzle = 0.5; // rad, full deflection

		this.position = new THREE.Vector3();
		this.quaternion = new THREE.Quaternion();
		this.velocity = new THREE.Vector3();
		this.angular = new THREE.Vector3();
		this.throttle = 0; this.steer = 0; this.rpm = 0; this.thrust = 0;
		this.driven = false;
		this.moored = true;
		this.mooring = { anchor: new THREE.Vector3(), heading: 0 };

		const n = this.samples.length;
		this.waterH = new Float32Array( n ); this.hasWater = false;
		this.wetFraction = 0; this.speed = 0; this.forwardSpeed = 0; this.slam = 0; this.onSlam = null;
		this._acc = 0;
		this.grounded = false; this.groundContacts = 0;
		this.minDepthUnderHull = Infinity; // m of water under the hull footprint (still water, MSL), over the run
		this.bowWorld = new THREE.Vector3(); this.sternWorld = new THREE.Vector3();
		// hull footprint points for the depth / grounding checks: keel of both demihulls, stern to bow
		this.keelPoints = [];
		for ( const side of [ - 1, 1 ] ) for ( const z of [ L.zAft + 0.5, - 10, 0, 10, L.wlEnd - 2 ] ) this.keelPoints.push( new THREE.Vector3( side * FERRY.hullSpacing / 2, - FERRY.draft, z ) );
		if ( berth ) this.setBerth( berth.x, berth.z, berth.heading );
		else this.apply();

	}

	setBerth( x, z, heading ) {

		this.mooring.anchor.set( x, 0, z );
		this.mooring.heading = heading;
		this.position.set( x, 0, z );
		this.quaternion.setFromAxisAngle( new THREE.Vector3( 0, 1, 0 ), heading );
		this.velocity.set( 0, 0, 0 );
		this.angular.set( 0, 0, 0 );
		this.apply();

	}

	toWorld( local, out ) { return out.copy( local ).applyQuaternion( this.quaternion ).add( this.position ); }
	forward( out ) { return out.set( 0, 0, 1 ).applyQuaternion( this.quaternion ); }
	getYaw() { const f = this.forward( _v ); return Math.atan2( f.x, f.z ); }

	setInput( throttle, steer, dt ) {

		this.throttle += ( throttle - this.throttle ) * ( 1 - Math.exp( - dt * 1.5 ) );
		this.steer += ( steer - this.steer ) * ( 1 - Math.exp( - dt * 2.0 ) );

	}

	queueQueries() {

		const q = this.query, lead = q.latency;
		for ( let i = 0; i < this.samples.length; i ++ ) {

			this.toWorld( this.samples[ i ].p, _v ).addScaledVector( this.velocity, lead );
			q.setPoint( this.slot + i, _v.x, _v.z );

		}

	}

	readQueries() {

		const q = this.query;
		if ( ! q.cpuValid || q.version === this._qVersion ) return;
		this._qVersion = q.version;
		for ( let i = 0; i < this.samples.length; i ++ ) {

			const h = q.cpu[ ( this.slot + i ) * 4 ];
			if ( Number.isFinite( h ) ) this.waterH[ i ] = h;

		}

		this.hasWater = true;

	}

	sampleWaterAt( x, z ) {

		let best = 0, bd = Infinity;
		for ( let i = 0; i < this.samples.length; i ++ ) {

			this.toWorld( this.samples[ i ].p, _v );
			const d = ( _v.x - x ) ** 2 + ( _v.z - z ) ** 2;
			if ( d < bd ) { bd = d; best = this.hasWater ? this.waterH[ i ] : 0; }

		}

		return best;

	}

	update( dt ) {

		this.readQueries();
		if ( ! this.hasWater ) { this.apply(); return; }
		const lever = this.driven ? Math.abs( this.throttle ) : 0;
		const target = Math.max( lever, this.driven ? 0.12 : 0 );
		this.rpm += ( target - this.rpm ) * ( 1 - Math.exp( - Math.min( dt, 0.2 ) / ( target > this.rpm ? 2.5 : 2.0 ) ) );
		const h = 1 / 60;
		this._acc += Math.min( dt, 0.2 );
		let steps = 0;
		while ( this._acc >= h && steps < 14 ) { this.step( h ); this._acc -= h; steps ++; }
		if ( ! this.isFinite() ) this.setBerth( this.mooring.anchor.x, this.mooring.anchor.z, this.mooring.heading );
		this.apply();

	}

	step( h ) {

		const m = this.mass;
		const F = _F.set( 0, - m * GRAV, 0 ), T = _T.set( 0, 0, 0 );
		const comW = this.toWorld( this.com, _com );
		const invQ = _invQ.copy( this.quaternion ).invert();
		const addForceAt = ( f, pw ) => { F.add( f ); T.add( _r.copy( pw ).sub( comW ).cross( f ) ); };

		// buoyancy + heave damping per waterplane patch
		let wetArea = 0, totalArea = 0;
		for ( let i = 0; i < this.samples.length; i ++ ) {

			const s = this.samples[ i ], pw = this.toWorld( s.p, _p );
			const depth = this.waterH[ i ] - pw.y;
			totalArea += s.area;
			if ( depth <= 0 ) continue;
			const sub = Math.min( depth, FERRY.deckY + 0.5 );
			wetArea += s.area * Math.min( 1, depth / 0.3 );
			_vp.copy( this.angular ).cross( _r.copy( pw ).sub( comW ) ).add( this.velocity );
			_f.set( 0, RHO * GRAV * s.area * sub - 1900 * s.area * _vp.y, 0 );
			addForceAt( _f, pw );

		}

		const wet = this.wetFraction = totalArea ? wetArea / totalArea : 0;
		const fwd = this.forward( _fwd ), side = _side.set( 1, 0, 0 ).applyQuaternion( this.quaternion );
		_vl.copy( this.velocity ).applyQuaternion( invQ );
		const u = _vl.z, vs = _vl.x;
		this.speed = this.velocity.length();
		this.forwardSpeed = u;
		const aLoc = _a.copy( this.angular ).applyQuaternion( invQ );

		// resistance + air drag
		const R = ( this.c1 * u + this.c2 * u * Math.abs( u ) ) * wet;
		F.addScaledVector( fwd, - R );
		F.addScaledVector( this.velocity, - 50 * this.speed );

		// lateral stations: hull lift ~ |u| v and cross-flow drag ~ v|v|
		for ( const [ sz, A ] of this.stations ) {

			const vk = vs + aLoc.y * sz;
			const Y = - 0.5 * RHO * A * ( this.hullLift * Math.abs( u ) * vk + 1.0 * vk * Math.abs( vk ) ) * wet;
			addForceAt( _f.copy( side ).multiplyScalar( Y ), this.toWorld( _p.set( 0, - FERRY.draft * 0.5, sz ), _p ) );

		}

		// waterjets: thrust along the nozzle, deflected by the steering (both jets, at the transoms)
		const dir = this.driven ? Math.sign( this.throttle ) : 0;
		const n = this.rpm;
		let thrust = 0;
		if ( dir > 0 ) thrust = this.maxThrust * n * n * Math.max( 0, 1 - Math.max( u, 0 ) / this.jetSpeed );
		else if ( dir < 0 ) thrust = - this.reverseFactor * this.maxThrust * n * n * Math.max( 0, 1 - Math.max( - u, 0 ) / ( this.jetSpeed * 0.5 ) );
		else if ( this.driven ) thrust = this.maxThrust * n * n * 0.15 * Math.max( 0, 1 - Math.abs( u ) / 4 ); // idle jets: a little push, full steering authority
		this.thrust = thrust;
		const delta = clamp( this.steer, - 1, 1 ) * this.nozzle;
		const jetForce = Math.abs( thrust ) + ( this.driven ? this.maxThrust * n * n * 0.25 : 0 );
		for ( const j of this.model.jets ) {

			const pw = this.toWorld( j, _p );
			addForceAt( _f.copy( fwd ).multiplyScalar( thrust / 2 ), pw );
			// nozzle deflection: side force toward −x (starboard) for steer > 0 turns the bow to port
			addForceAt( _f.copy( side ).multiplyScalar( - jetForce / 2 * Math.sin( delta ) ), pw );

		}

		// roll / pitch / yaw damping (the buoyancy patches give the restoring moments)
		_v.set( - aLoc.x * 4.5e7, - aLoc.y * 3.0e6, - aLoc.z * 4.7e6 ).multiplyScalar( 0.2 + wet ).applyQuaternion( this.quaternion );
		T.add( _v );

		// mooring at the berth: a spring on position and heading while moored and not driven
		if ( this.moored && ! this.driven ) {

			const a = this.mooring.anchor;
			F.x += ( a.x - this.position.x ) * 2.0e5 - this.velocity.x * 1.6e5;
			F.z += ( a.z - this.position.z ) * 2.0e5 - this.velocity.z * 1.6e5;
			let dy = this.mooring.heading - this.getYaw();
			dy = Math.atan2( Math.sin( dy ), Math.cos( dy ) );
			T.y += dy * 2.2e6 - this.angular.y * 1.1e6;

		}

		// seabed: water depth under the hull footprint, and contact when the keel reaches the bottom
		this.grounded = false;
		for ( const kp of this.keelPoints ) {

			const pw = this.toWorld( kp, _p );
			const bed = this.terrain.heightAt( pw.x, pw.z );
			this.minDepthUnderHull = Math.min( this.minDepthUnderHull, - bed );
			const pen = bed - pw.y;
			if ( pen > 0 ) {

				this.grounded = true;
				this.groundContacts ++;
				_vp.copy( this.angular ).cross( _r.copy( pw ).sub( comW ) ).add( this.velocity );
				_f.set( - _vp.x * 4e5, Math.max( pen * 2e7 - Math.min( _vp.y, 0 ) * 1e6, 0 ), - _vp.z * 4e5 );
				addForceAt( _f, pw );

			}

		}

		// integrate (added mass: surge 10 %, sway 80 %, heave 60 % when wet)
		const fl = _vl.copy( F ).applyQuaternion( invQ );
		fl.x /= m * ( 1 + 0.8 * wet ); fl.y /= m * ( 1 + 0.6 * wet ); fl.z /= m * ( 1 + 0.1 * wet );
		this.velocity.addScaledVector( fl.applyQuaternion( this.quaternion ), h );
		const tl = _a.copy( T ).applyQuaternion( invQ ), I = this.inertia;
		tl.set( tl.x / ( I.x * ( 1 + 0.5 * wet ) ), tl.y / ( I.y * ( 1 + 0.3 * wet ) ), tl.z / ( I.z * ( 1 + 0.2 * wet ) ) );
		this.angular.addScaledVector( tl.applyQuaternion( this.quaternion ), h );
		this.position.addScaledVector( this.velocity, h );
		const w = this.angular.length();
		if ( w > 1e-9 ) {

			_dq.setFromAxisAngle( _v.copy( this.angular ).divideScalar( w ), w * h );
			this.quaternion.premultiply( _dq ).normalize();

		}

	}

	isFinite() {

		return Number.isFinite( this.position.x + this.position.y + this.position.z + this.velocity.x + this.velocity.y + this.velocity.z + this.quaternion.x + this.quaternion.w );

	}

	apply() {

		const g = this.model.group;
		g.position.copy( this.position );
		g.quaternion.copy( this.quaternion );
		g.updateMatrixWorld( true );
		this.toWorld( _v.set( 0, 0, this.model.lines.zBow ), this.bowWorld );
		this.toWorld( _v.set( 0, 0, this.model.lines.zAft ), this.sternWorld );

	}

}

export const FERRY_TOP_SPEED = FERRY.topSpeedKn * KNOT;
