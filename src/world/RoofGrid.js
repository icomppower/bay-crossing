import * as THREE from '../engine/index.js';

// Highest building / landmark point per 20 m cell, from the full-detail meshes: buildings are not colliders, and
// a waypoint flight (FlyCamera.flyTo) must not cut through a tower. heightAt() is -Infinity where nothing stands.
const CELL = 20;

export class RoofGrid {

	constructor( roots, size ) {

		this.n = Math.ceil( size / CELL );
		this.half = this.n * CELL / 2;
		this.h = new Float32Array( this.n * this.n ).fill( - Infinity );
		const v = new THREE.Vector3();
		for ( const root of roots ) {

			root.updateWorldMatrix( true, true );
			root.traverse( ( m ) => {

				const pos = m.isMesh && m.geometry.getAttribute( 'position' );
				if ( ! pos ) return;
				for ( let k = 0; k < pos.count; k ++ ) {

					v.set( pos.array[ k * 3 ], pos.array[ k * 3 + 1 ], pos.array[ k * 3 + 2 ] ).applyMatrix4( m.matrixWorld );
					const c = this.cell( v.x, v.z );
					if ( c >= 0 && v.y > this.h[ c ] ) this.h[ c ] = v.y;

				}

			} );

		}

	}

	cell( x, z ) {

		const i = Math.floor( ( x + this.half ) / CELL ), j = Math.floor( ( z + this.half ) / CELL );
		return i < 0 || j < 0 || i >= this.n || j >= this.n ? - 1 : j * this.n + i;

	}

	// the highest roof within `r` metres (whole cells) of x, z
	heightAt( x, z, r = CELL ) {

		let best = - Infinity;
		for ( let dz = - r; dz <= r; dz += CELL ) for ( let dx = - r; dx <= r; dx += CELL ) {

			const c = this.cell( x + dx, z + dz );
			if ( c >= 0 && this.h[ c ] > best ) best = this.h[ c ];

		}

		return best;

	}

}
