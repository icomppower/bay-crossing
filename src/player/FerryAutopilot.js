import { KNOT } from '../world/FerrySpec.js';

// Helmsman for the ferry (public/ferry/route.json): pure-pursuit steering along the route legs and a speed
// plan — harbour speed near the terminals, cruise speed on the open bay, braking to a stop at the berth.
// Drives the FerryController through the same setInput( throttle, steer ) the player uses.
export class FerryAutopilot {

	constructor( route, { cruiseKn = 22, harbourKn = 8, harbourZone = 400 } = {} ) {

		this.route = route;
		this.pts = route.waypoints;
		this.cruise = cruiseKn * KNOT;
		this.harbour = harbourKn * KNOT;
		this.harbourZone = harbourZone;
		this.cum = [ 0 ];
		for ( let k = 1; k < this.pts.length; k ++ ) this.cum.push( this.cum[ k - 1 ] + Math.hypot( this.pts[ k ][ 0 ] - this.pts[ k - 1 ][ 0 ], this.pts[ k ][ 1 ] - this.pts[ k - 1 ][ 1 ] ) );
		this.total = this.cum.at( - 1 );
		this.progress = 0;
		this.arrived = false;
		this._i = 0;

	}

	// distance along the route of the point nearest (x, z), searched forward from the last progress
	project( x, z ) {

		let best = Infinity, s = this.progress;
		for ( let k = Math.max( 0, this._seg || 0 ); k + 1 < this.pts.length; k ++ ) {

			const [ ax, az ] = this.pts[ k ], [ bx, bz ] = this.pts[ k + 1 ];
			const dx = bx - ax, dz = bz - az, L2 = dx * dx + dz * dz;
			const t = Math.max( 0, Math.min( 1, ( ( x - ax ) * dx + ( z - az ) * dz ) / L2 ) );
			const d = Math.hypot( ax + t * dx - x, az + t * dz - z );
			if ( d < best ) { best = d; s = this.cum[ k ] + t * Math.sqrt( L2 ); this._segCand = k; }

		}

		this._seg = this._segCand;
		return Math.max( s, this.progress );

	}

	pointAt( s ) {

		s = Math.min( s, this.total );
		let k = 0;
		while ( k + 2 < this.pts.length && this.cum[ k + 1 ] < s ) k ++;
		const t = ( s - this.cum[ k ] ) / ( this.cum[ k + 1 ] - this.cum[ k ] );
		return [ this.pts[ k ][ 0 ] + ( this.pts[ k + 1 ][ 0 ] - this.pts[ k ][ 0 ] ) * t, this.pts[ k ][ 1 ] + ( this.pts[ k + 1 ][ 1 ] - this.pts[ k ][ 1 ] ) * t ];

	}

	update( boat, dt ) {

		const p = boat.position;
		this.progress = this.project( p.x, p.z );
		const remaining = this.total - this.progress;
		const end = this.pts.at( - 1 ), toEnd = Math.hypot( end[ 0 ] - p.x, end[ 1 ] - p.z );
		const u = boat.forwardSpeed;
		if ( toEnd < 25 && Math.abs( u ) < 0.6 ) this.arrived = true;
		if ( this.arrived ) { boat.setInput( 0, 0, dt ); return; }

		// speed plan: harbour speed within the zone around either terminal; brake at ~0.18 m/s² to the berth
		let v = this.cruise;
		if ( this.progress < this.harbourZone || remaining < this.harbourZone ) v = this.harbour;
		v = Math.min( v, Math.sqrt( 2 * 0.18 * Math.max( 0, Math.min( remaining, toEnd ) - 8 ) ) + 0.3 );
		// throttle: feed-forward for the resistance at v plus a proportional term (reverse to stop)
		const ff = Math.sqrt( Math.max( 0, ( 2500 * v + 152 * v * v ) / 180000 ) / Math.max( 0.05, 1 - v / 26 ) );
		const throttle = Math.max( - 1, Math.min( 1, ff + 0.35 * ( v - u ) ) );

		// steering: pure pursuit toward a point ahead on the route
		const look = Math.max( 50, 5 * Math.abs( u ) );
		const [ tx, tz ] = remaining < look ? end : this.pointAt( this.progress + look );
		const want = Math.atan2( tx - p.x, tz - p.z );
		let e = want - boat.getYaw();
		e = Math.atan2( Math.sin( e ), Math.cos( e ) );
		const steer = Math.max( - 1, Math.min( 1, 2.2 * e - 6 * boat.angular.y ) );
		boat.setInput( throttle, steer, dt );

	}

}
