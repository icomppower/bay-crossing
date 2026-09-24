// Shared helpers for tile gates: hash a directory, run a pipeline offline, decode terrain tiles.
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export const root = join( dirname( fileURLToPath( import.meta.url ) ), '../..' );

export function hashDir( dir ) {

	const out = {};
	if ( ! existsSync( dir ) ) return out;
	for ( const f of readdirSync( dir ).sort() ) out[ f ] = createHash( 'sha256' ).update( readFileSync( join( dir, f ) ) ).digest( 'hex' );
	return out;

}

export function compareDirs( a, b, label ) {

	const A = hashDir( a ), B = hashDir( b ), fail = [];
	const names = [ ...new Set( [ ...Object.keys( A ), ...Object.keys( B ) ] ) ].sort();
	if ( ! names.length ) fail.push( `${ label }: no files` );
	const diff = names.filter( ( n ) => A[ n ] !== B[ n ] );
	if ( diff.length ) fail.push( `${ label }: ${ diff.length } file(s) differ, e.g. ${ diff.slice( 0, 3 ).join( ', ' ) }` );
	return fail;

}

// run a pipeline script as a child with all network access blocked
export function runOffline( script, args ) {

	return spawnSync( process.execPath, [ '--import', join( root, 'gates/lib/no-network.mjs' ), join( root, script ), ...args ], { cwd: root, encoding: 'utf8', maxBuffer: 1 << 26 } );

}

export function decodeTerrain( dir ) {

	const index = JSON.parse( readFileSync( join( dir, 'index.json' ), 'utf8' ) );
	const { res, tile } = index;
	const h = new Float32Array( res * res );
	for ( const f of index.files ) {

		const b = inflateSync( readFileSync( join( dir, f.name ) ) );
		for ( let y = 0; y < tile; y ++ ) for ( let x = 0; x < tile; x ++ ) h[ ( f.j * tile + y ) * res + f.i * tile + x ] = b.readInt16LE( ( y * tile + x ) * 2 ) / 100;

	}

	return { index, h };

}
