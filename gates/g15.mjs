// G15 Heights frozen (run 3, D78): every building tile file in public/buildings/ is byte-identical to run 2 (the
// checksums in gates/fixtures/buildings-run2.sha256, taken from main at de9fec8 before run 3 began), and the facade
// model reads back the same buildings: 10,309, each with its run-2 top and base.
// --negative: a building raised 1 m in a copied tile, and a missing tile, must each be caught.
import { readFileSync, readdirSync, mkdtempSync, cpSync, writeFileSync, rmSync } from 'node:fs';
import { inflateSync, deflateSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { root } from './lib/facades.mjs';
import { negativeSummary } from './lib/facades.mjs';
import { readAll } from '../pipelines/facades/tiles.mjs';

const NEG = process.argv.includes( '--negative' );
const FIX = join( root, 'gates/fixtures/buildings-run2.sha256' );

function check( dir ) {

	const fails = [];
	const want = new Map( readFileSync( FIX, 'utf8' ).trim().split( '\n' ).map( ( l ) => l.split( /\s+/ ) ).map( ( [ h, f ] ) => [ f, h ] ) );
	const have = new Set( readdirSync( dir ) );
	for ( const [ f, h ] of want ) {

		if ( ! have.has( f ) ) { fails.push( `${ f } missing` ); continue; }
		const got = createHash( 'sha256' ).update( readFileSync( join( dir, f ) ) ).digest( 'hex' );
		if ( got !== h ) fails.push( `${ f } changed since run 2` );

	}

	for ( const f of have ) if ( ! want.has( f ) ) fails.push( `${ f } is new` );
	if ( ! fails.length ) {

		const { buildings } = readAll( dir );
		if ( buildings.length !== 10309 ) fails.push( `${ buildings.length } buildings read back, run 2 had 10,309` );

	}

	return fails;

}

// raise the first building of a tile by `dy` (its wall tops and roof)
function raise( dir, name, dy ) {

	const path = join( dir, name ), raw = inflateSync( readFileSync( path ) );
	const dv = new DataView( raw.buffer, raw.byteOffset, raw.byteLength );
	const jlen = dv.getUint32( 12, true ), json = JSON.parse( raw.subarray( 20, 20 + jlen ).toString() ), bin = 20 + jlen + 8;
	const acc = json.accessors[ json.meshes[ 0 ].primitives[ 0 ].attributes.POSITION ], bv = json.bufferViews[ acc.bufferView ];
	const pos = new Float32Array( raw.buffer, raw.byteOffset + bin + ( bv.byteOffset || 0 ) + ( acc.byteOffset || 0 ), acc.count * 3 );
	const top = pos[ 2 * 3 + 1 ];
	for ( let i = 0; i < 64; i ++ ) if ( Math.abs( pos[ i * 3 + 1 ] - top ) < 1e-4 ) pos[ i * 3 + 1 ] += dy;
	writeFileSync( path, deflateSync( raw ) );

}

const dir = join( root, 'public/buildings' );
if ( NEG ) {

	let caught = 0;
	const t1 = mkdtempSync( join( tmpdir(), 'g15-' ) ); cpSync( dir, t1, { recursive: true } );
	const first = readdirSync( t1 ).filter( ( f ) => f.endsWith( '.deflate' ) ).sort()[ 0 ];
	raise( t1, first, 1 );
	const f1 = check( t1 ); console.log( 'raised 1 m:', f1[ 0 ] || 'NOT CAUGHT' ); if ( f1.length ) caught ++;
	const t2 = mkdtempSync( join( tmpdir(), 'g15-' ) ); cpSync( dir, t2, { recursive: true } ); rmSync( join( t2, first ) );
	const f2 = check( t2 ); console.log( 'missing tile:', f2[ 0 ] || 'NOT CAUGHT' ); if ( f2.length ) caught ++;
	rmSync( t1, { recursive: true } ); rmSync( t2, { recursive: true } );
	negativeSummary( caught, 2 );

}

const fails = check( dir );
for ( const f of fails.slice( 0, 20 ) ) console.log( 'FAIL ' + f );
console.log( fails.length ? 'G15 FAIL' : `G15 PASS — ${ readFileSync( FIX, 'utf8' ).trim().split( '\n' ).length } files byte-identical to run 2; 10,309 buildings read back` );
process.exit( fails.length ? 1 : 0 );
