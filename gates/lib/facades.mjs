// Shared by the run-3 facade gates: the facade model over the shipped tiles exactly as the browser runs it
// (src/facades/index.js buildFacades + details), and the street path used for "near the path" measures.
import { readFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { readAll } from '../../pipelines/facades/tiles.mjs';
import { streetFacingFrom, facadeAttributes, details } from '../../src/facades/model.js';
import { toLocal } from '../../src/facades/geo.js';
import { root } from './street.mjs';

export { root };

export function readModules( dir = join( root, 'public/street' ) ) {

	const body = inflateSync( readFileSync( join( dir, 'stores.bin.deflate' ) ) );
	return new Float32Array( body.buffer.slice( body.byteOffset, body.byteOffset + body.byteLength ) );

}

export function facadeModel( { buildingsDir = join( root, 'public/buildings' ), modules = readModules() } = {} ) {

	const m = readAll( buildingsDir );
	const sf = streetFacingFrom( modules );
	for ( const t of m.tiles ) {

		const { aWall, aStyle } = facadeAttributes( t.buildings, t.lod0.pos.length / 3, sf );
		t.aWall = aWall; t.aStyle = aStyle;

	}

	const d = details( m.buildings );
	return { ...m, detail: d.out, detailLog: d.log };

}

// a stable digest of what the browser would draw from the model (classification, colours, attributes, detail)
export function digest( model ) {

	const h = createHash( 'sha256' );
	for ( const b of model.buildings ) h.update( `${ b.id }:${ b.arch }:${ b.colour.join( ',' ) }:${ b.seed.toFixed( 6 ) };` );
	for ( const t of model.tiles ) { h.update( Buffer.from( t.aWall.buffer ) ); h.update( Buffer.from( t.aStyle.buffer ) ); }
	for ( const [ k, list ] of Object.entries( model.detail ) ) { h.update( k ); h.update( Buffer.from( new Float32Array( list.flat() ).buffer ) ); }
	return h.digest( 'hex' );

}

// the street-level path of G13 (Ferry Building → Pier 39 along the Embarcadero), as waypoints along the promenade
export const PATH = [ [ 37.79555, - 122.39350 ], [ 37.79750, - 122.39560 ], [ 37.79980, - 122.39760 ], [ 37.80220, - 122.39980 ], [ 37.80440, - 122.40220 ], [ 37.80640, - 122.40470 ], [ 37.80780, - 122.40720 ], [ 37.80860, - 122.40960 ] ].map( ( [ la, lo ] ) => toLocal( la, lo ) );

export function distanceToPath( x, z ) {

	let d = Infinity;
	for ( let i = 1; i < PATH.length; i ++ ) {

		const [ ax, az ] = PATH[ i - 1 ], [ bx, bz ] = PATH[ i ];
		const dx = bx - ax, dz = bz - az, L2 = dx * dx + dz * dz;
		const t = Math.max( 0, Math.min( 1, ( ( x - ax ) * dx + ( z - az ) * dz ) / L2 ) );
		d = Math.min( d, Math.hypot( x - ax - dx * t, z - az - dz * t ) );

	}

	return d;

}

export const nearPath = ( b, r = 150 ) => b.walls.some( ( w ) => distanceToPath( w.ax, w.az ) < r );

// verify.sh contract for the negative run
export function negativeSummary( caught, total ) {

	console.log( `NEGATIVE ${ caught }/${ total }` );
	process.exit( caught === total ? 1 : 0 );

}
