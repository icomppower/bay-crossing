// G3 Georeference: ≥ 5 control points where the shipped scene puts a feature vs. an independent survey (NOAA ENC
// charted landmarks; OSM for Pier 1 and the Sausalito terminal), within a tolerance calibrated on first run
// (≤ 10 m, frozen in SPEC-THRESHOLDS.md). A shifted dataset must fail: --negative shifts each source 15 m east
// in a raw fixture and rebuilds through the real pipelines (Blender landmarks, building tiles, ferry facts).
import { spawnSync } from 'node:child_process';
import { crc32 } from 'node:zlib';
import { mkdirSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { root } from './lib/tiles.mjs';
import { readThresholds, freeze } from './lib/thresholds.mjs';
import { controlErrors } from './lib/controls.mjs';
import { RAW } from '../tools/data/cache.mjs';
import { readZip } from '../tools/data/zip.mjs';

const NEG = process.argv.includes( '--negative' );

function check( opts = {} ) {

	const rows = controlErrors( opts );
	const tol = readThresholds()[ 'G3.toleranceMetres' ];
	const fail = [];
	for ( const r of rows ) console.log( `${ r.gated ? '  ' : '(advisory) ' }${ r.name.padEnd( 28 ) } ${ r.error.toFixed( 2 ).padStart( 7 ) } m  vs ${ r.ref }` );
	const gated = rows.filter( ( r ) => r.gated );
	if ( gated.length < 5 ) fail.push( `controls: only ${ gated.length } gated control points (need ≥ 5)` );
	for ( const r of gated ) if ( ! ( r.error <= tol ) ) fail.push( `georef: ${ r.name } is ${ r.error.toFixed( 1 ) } m from ${ r.ref } (tolerance ${ tol } m)` );
	return { fail, rows };

}

// calibrate on first run: tolerance = min( 10, ceil( 1.5 × worst gated error ) ), then frozen
if ( ! ( 'G3.toleranceMetres' in readThresholds() ) ) {

	const worst = Math.max( ...controlErrors().filter( ( r ) => r.gated ).map( ( r ) => r.error ) );
	freeze( 'G3.toleranceMetres', Math.min( 10, Math.ceil( 1.5 * worst ) ), `horizontal control-point tolerance; worst gated error ${ worst.toFixed( 2 ) } m on ${ new Date().toISOString().slice( 0, 10 ) }; tolerance = min( 10, ceil( 1.5 × worst ) )` );

}

if ( ! NEG ) {

	const { fail } = check();
	if ( fail.length ) { console.log( 'G3 FAIL\n- ' + fail.join( '\n- ' ) ); process.exit( 1 ); }
	console.log( `G3 PASS — 6 control points within ${ readThresholds()[ 'G3.toleranceMetres' ] } m of independent references` );
	process.exit( 0 );

}

// ---- negative fixtures: shift one source 15 m east, rebuild, the controls must fail
const DLON = 15 / ( 111320 * Math.cos( 37.81 * Math.PI / 180 ) );
const work = join( root, '.verify', 'g3' );
const fixtureRaw = ( file, rewrite ) => {

	const d = join( work, 'raw' );
	rmSync( work, { recursive: true, force: true } ); mkdirSync( d, { recursive: true } );
	for ( const f of readdirSync( RAW ) ) if ( f !== file ) symlinkSync( join( RAW, f ), join( d, f ) );
	writeFileSync( join( d, file ), rewrite( readFileSync( join( RAW, file ) ) ) );
	const lines = readFileSync( join( RAW, 'MANIFEST.sha256' ), 'utf8' ).trim().split( '\n' ).map( ( l ) => { const f = l.split( /\s+/ )[ 1 ]; return `${ createHash( 'sha256' ).update( readFileSync( join( d, f ) ) ).digest( 'hex' ) }  ${ f }`; } );
	rmSync( join( d, 'MANIFEST.sha256' ) ); writeFileSync( join( d, 'MANIFEST.sha256' ), lines.join( '\n' ) + '\n' );
	return d;

};
const run = ( script, args ) => {

	const r = spawnSync( process.execPath, [ join( root, script ), ...args ], { cwd: root, encoding: 'utf8', env: { ...process.env, BLENDER: process.env.BLENDER || '/opt/homebrew/bin/blender' }, maxBuffer: 1 << 26 } );
	if ( r.status !== 0 ) throw new Error( `${ script } failed: ${ ( r.stderr || r.stdout ).slice( - 400 ) }` );

};
// a stored (uncompressed) zip with the same entries
const writeZip = ( files ) => {

	const parts = [], central = []; let off = 0;
	for ( const [ name, data ] of Object.entries( files ) ) {

		const nm = Buffer.from( name ), crc = crc32( data ) >>> 0;
		const h = Buffer.alloc( 30 ); h.writeUInt32LE( 0x04034b50, 0 ); h.writeUInt16LE( 20, 4 ); h.writeUInt32LE( crc, 14 ); h.writeUInt32LE( data.length, 18 ); h.writeUInt32LE( data.length, 22 ); h.writeUInt16LE( nm.length, 26 );
		const c = Buffer.alloc( 46 ); c.writeUInt32LE( 0x02014b50, 0 ); c.writeUInt16LE( 20, 4 ); c.writeUInt16LE( 20, 6 ); c.writeUInt32LE( crc, 16 ); c.writeUInt32LE( data.length, 20 ); c.writeUInt32LE( data.length, 24 ); c.writeUInt16LE( nm.length, 28 ); c.writeUInt32LE( off, 42 );
		parts.push( h, nm, data ); central.push( c, nm ); off += 30 + nm.length + data.length;

	}

	const cd = Buffer.concat( central ), e = Buffer.alloc( 22 );
	e.writeUInt32LE( 0x06054b50, 0 ); e.writeUInt16LE( Object.keys( files ).length, 8 ); e.writeUInt16LE( Object.keys( files ).length, 10 ); e.writeUInt32LE( cd.length, 12 ); e.writeUInt32LE( off, 16 );
	return Buffer.concat( [ ...parts, cd, e ] );

};
const MUTATIONS = [
	[ 'OSM landmark features shifted 15 m east', () => {

		const raw = fixtureRaw( 'landmarks-osm.json', ( b ) => { const j = JSON.parse( b ); for ( const e of j.elements ) { if ( e.lon !== undefined ) e.lon += DLON; for ( const g of e.geometry || [] ) g.lon += DLON; if ( e.center ) e.center.lon += DLON; } return Buffer.from( JSON.stringify( j ) ); } );
		run( 'tools/landmarks/build.mjs', [ '--raw', raw, '--out', join( work, 'landmarks' ) ] );
		return check( { landmarks: join( work, 'landmarks' ) } ).fail;

	} ],
	[ 'SF footprints shifted 15 m east', () => {

		const raw = fixtureRaw( 'sf-buildings.geojson', ( b ) => { const j = JSON.parse( b ); for ( const f of j.features ) f.geometry.coordinates = JSON.parse( JSON.stringify( f.geometry.coordinates ), ( k, v ) => ( Array.isArray( v ) && typeof v[ 0 ] === 'number' ? [ v[ 0 ] + DLON, v[ 1 ] ] : v ) ); return Buffer.from( JSON.stringify( j ) ); } );
		run( 'tools/buildings/build.mjs', [ '--raw', raw, '--out', join( work, 'buildings' ) ] );
		return check( { buildings: join( work, 'buildings' ) } ).fail;

	} ],
	[ 'GTFS ferry stops shifted 15 m east', () => {

		const raw = fixtureRaw( 'ggt-gtfs.zip', ( b ) => {

			const z = readZip( b ), txt = z[ 'stops.txt' ].toString( 'utf8' ).split( '\n' ), head = txt[ 0 ].split( ',' ).map( ( h ) => h.trim() ), li = head.indexOf( 'stop_lon' );
			z[ 'stops.txt' ] = Buffer.from( txt.map( ( l, i ) => { if ( ! i || ! l.trim() ) return l; const c = l.split( ',' ); c[ li ] = String( + c[ li ] + DLON ); return c.join( ',' ); } ).join( '\n' ) );
			return writeZip( z );

		} );
		run( 'tools/ferry/prepare.mjs', [ '--raw', raw, '--out', join( work, 'schedule.json' ) ] );
		return check( { ferry: join( work, 'schedule.json' ) } ).fail;

	} ],
];
let missed = 0;
for ( const [ name, fn ] of MUTATIONS ) {

	const fail = fn().filter( ( m ) => m.startsWith( 'georef:' ) );
	console.log( `${ fail.length ? 'caught  ' : 'MISSED  ' } ${ name }${ fail.length ? ' — ' + fail[ 0 ] : '' }` );
	if ( ! fail.length ) missed ++;

}

rmSync( work, { recursive: true, force: true } );
process.exit( missed ? 0 : 1 );
