import * as THREE from '../engine/index.js';

// Free-fly debug camera: drag (or pointer lock) to look, WASD + QE to move, Shift = fast.
export class FlyCamera {

	constructor( camera, dom, input ) {

		this.camera = camera;
		this.dom = dom;
		this.input = input;
		this.yaw = 0;
		this.pitch = 0;
		this.speed = 8;
		this.enabled = true;
		this.velocity = new THREE.Vector3();
		this.flight = null; // flyTo() in progress
		this.groundAt = null; // ( x, z ) -> ground / roof height: flights keep clear of it
		this._fwd = new THREE.Vector3();
		this._right = new THREE.Vector3();

	}

	setPose( position, yaw, pitch ) {

		this.camera.position.copy( position );
		this.yaw = yaw;
		this.pitch = pitch;
		this.apply();

	}

	// Glide to a pose over `duration` s: ease in / out, arcing up with the distance (a crossing of the bay climbs
	// ~500 m). Any move key takes the controls back.
	flyTo( position, yaw, pitch, duration = null ) {

		const from = this.camera.position.clone(), dist = from.distanceTo( position );
		// the shorter way round
		let dyaw = ( yaw - this.yaw ) % ( 2 * Math.PI );
		if ( dyaw > Math.PI ) dyaw -= 2 * Math.PI;
		if ( dyaw < - Math.PI ) dyaw += 2 * Math.PI;
		this.flight = {
			from, to: position.clone(), yaw0: this.yaw, dyaw, pitch0: this.pitch, pitch1: pitch,
			t: 0, duration: duration ?? Math.min( 5, 1.5 + dist / 2500 ), arc: Math.min( 500, dist * 0.12 ),
		};
		this.velocity.set( 0, 0, 0 );

	}

	_fly( dt ) {

		const f = this.flight;
		f.t = Math.min( 1, f.t + dt / f.duration );
		const e = f.t * f.t * ( 3 - 2 * f.t ); // smoothstep
		const p = this.camera.position.lerpVectors( f.from, f.to, e );
		p.y += Math.sin( Math.PI * e ) * f.arc;
		if ( this.groundAt && f.t < 1 ) p.y = Math.max( p.y, this.groundAt( p.x, p.z ) + 15 * Math.sin( Math.PI * e ) );
		this.yaw = f.yaw0 + f.dyaw * e;
		this.pitch = f.pitch0 + ( f.pitch1 - f.pitch0 ) * e;
		this.apply();
		if ( f.t >= 1 ) this.flight = null;

	}

	apply() {

		this.camera.rotation.set( this.pitch, this.yaw, 0, 'YXZ' );

	}

	update( dt ) {

		if ( ! this.enabled ) return;
		const inp = this.input;
		if ( this.flight ) {

			const move = [ 'KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyE', 'KeyQ', 'Space', 'KeyC' ].some( ( k ) => inp.down( k ) );
			if ( ! move ) {

				inp.consumeLook();
				this._fly( dt );
				return;

			}

			this.flight = null;

		}

		const look = inp.consumeLook();
		this.yaw -= look.x * 0.0022;
		this.pitch -= look.y * 0.0022;
		this.pitch = Math.max( - 1.55, Math.min( 1.55, this.pitch ) );
		this.apply();

		const fast = inp.down( 'ShiftLeft' ) || inp.down( 'ShiftRight' );
		const speed = this.speed * ( fast ? 6 : 1 );
		this.camera.getWorldDirection( this._fwd );
		this._right.crossVectors( this._fwd, this.camera.up ).normalize();
		const move = new THREE.Vector3();
		if ( inp.down( 'KeyW' ) ) move.add( this._fwd );
		if ( inp.down( 'KeyS' ) ) move.sub( this._fwd );
		if ( inp.down( 'KeyD' ) ) move.add( this._right );
		if ( inp.down( 'KeyA' ) ) move.sub( this._right );
		if ( inp.down( 'KeyE' ) || inp.down( 'Space' ) ) move.y += 1;
		if ( inp.down( 'KeyQ' ) || inp.down( 'KeyC' ) ) move.y -= 1;
		if ( move.lengthSq() > 0 ) move.normalize().multiplyScalar( speed );
		this.velocity.lerp( move, 1 - Math.exp( - dt * 8 ) );
		this.camera.position.addScaledVector( this.velocity, dt );

	}

}
