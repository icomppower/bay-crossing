// G2a Terrain + bathymetry pipeline: cached 3DEP + NCEI → terrain/seabed tiles, byte-identical across two
// offline runs; the shipped tiles (public/terrain) are exactly that output; heights are plausible, the
// land/sea seam adds no cliffs, and the in-app loader reproduces the grid.
// --negative: each mutation must trip the check it targets.
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync, readdirSync } from 'node:fs';
import { deflateSync, inflateSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { root, compareDirs, runOffline, decodeTerrain } from './lib/tiles.mjs';
import { readTiff, writeTiff } from '../tools/geo/tiff.mjs';
import { toUTM } from '../tools/geo/utm.mjs';
import { RAW } from '../tools/data/cache.mjs';

const NEG = process.argv.includes( '--negative' );
const work = join( root, '.verify', 'g2a' );
const SHIPPED = join( root, 'public/terrain' );
const size = 9600, res = 3200, texel = size / res, originE = 549504, originN = 4186800;

function build( rawDir, outDir ) {

	const r = runOffline( 'tools/terrain/build.mjs', [ '--raw', rawDir, '--out', outDir ] );
	return r.status === 0 ? [] : [ `pipeline: build failed — ${ ( r.stderr || '' ).trim().split( '\n' ).find( ( l ) => /^\w*Error:/.test( l.trim() ) ) || r.status }` ];

}

function plausibility( dir, rawDir = RAW ) {

	const { h } = decodeTerrain( dir );
	const at = ( lat, lon ) => { const [ E, N ] = toUTM( lat, lon ); const i = Math.floor( ( E - originE + size / 2 ) / texel ), j = Math.floor( ( originN + size / 2 - N ) / texel ); return h[ j * res + i ]; };
	const fail = [];
	const want = ( name, v, lo, hi ) => { if ( ! ( v >= lo && v <= hi ) ) fail.push( `heights: ${ name } ${ v.toFixed( 1 ) } m, expected ${ lo }…${ hi }` ); };
	want( 'Telegraph Hill (Coit Tower)', at( 37.80239, - 122.40582 ), 70, 100 );
	want( 'Ferry Building', at( 37.79555, - 122.39365 ), - 1, 6 );
	want( 'Golden Gate channel', at( 37.8175, - 122.4770 ), - 130, - 80 );
	want( 'Alcatraz', at( 37.8267, - 122.4230 ), 20, 45 );
	want( 'mid-bay', at( 37.8200, - 122.4400 ), - 25, - 5 );
	want( 'Sausalito ferry landing', at( 37.8565, - 122.4787 ), - 2, 6 );
	want( 'Angel Island summit', at( 37.8617, - 122.4318 ), 190, 260 );
	let wet = 0; for ( const v of h ) if ( v < 0 ) wet ++;
	want( 'water fraction %', 100 * wet / h.length, 40, 80 );

	// seam: 3 m steps over 15 m that neither source has at that cell
	const land = readTiff( readFileSync( join( rawDir, 'terrain-3dep.tif' ) ) ), sea = readTiff( readFileSync( join( rawDir, 'bathy-ncei.tif' ) ) );
	const src = ( t, i, j ) => { const c = Math.min( t.width - 1, Math.max( 0, i - 32 ) ); return t.data[ Math.min( t.height - 1, j ) * t.width + c ]; };
	let seams = 0;
	for ( let j = 0; j < res - 1; j ++ ) for ( let i = 0; i < res - 1; i ++ ) for ( const [ di, dj ] of [ [ 1, 0 ], [ 0, 1 ] ] ) {

		const step = Math.abs( h[ j * res + i ] - h[ ( j + dj ) * res + i + di ] );
		if ( step <= 15 ) continue;
		const sL = Math.abs( src( land, i, j ) - src( land, i + di, j + dj ) ), sS = Math.abs( src( sea, i, j ) - src( sea, i + di, j + dj ) );
		if ( step > Math.max( sL, sS ) + 5 ) seams ++;

	}

	if ( seams > 0 ) fail.push( `seam: ${ seams } cliff steps (> 15 m) introduced by the land/sea merge` );

	// ground colour map (D39): covers the land, zero over deeper water, median land brightness at the target
	const idx = JSON.parse( readFileSync( join( dir, 'index.json' ), 'utf8' ) ), A = idx.aerial;
	if ( ! A || ! existsSync( join( dir, A.file || 'aerial.bin' ) ) ) fail.push( 'aerial: no ground colour map in the terrain tiles' );
	else {

		const rgb = inflateSync( readFileSync( join( dir, A.file ) ) );
		if ( rgb.length !== A.width * A.height * 3 || A.width * A.cell !== size ) fail.push( `aerial: ${ A.width }×${ A.height } at ${ A.cell } m does not cover the ${ size } m square` );
		else {

			let land = 0, landLit = 0, deep = 0, deepLit = 0; const lumas = [];
			for ( let y = 0; y < A.height; y += 3 ) for ( let x = 0; x < A.width; x += 3 ) {

				const hh = h[ Math.min( res - 1, Math.floor( ( y + 0.5 ) * A.cell / texel ) ) * res + Math.min( res - 1, Math.floor( ( x + 0.5 ) * A.cell / texel ) ) ];
				const k = ( y * A.width + x ) * 3, sum = rgb[ k ] + rgb[ k + 1 ] + rgb[ k + 2 ];
				if ( hh > 2 ) { land ++; if ( sum > 0 ) { landLit ++; lumas.push( 0.3 * rgb[ k ] + 0.59 * rgb[ k + 1 ] + 0.11 * rgb[ k + 2 ] ); } }
				if ( hh < - 3 ) { deep ++; if ( sum > 0 ) deepLit ++; }

			}

			lumas.sort( ( a, b ) => a - b );
			const med = lumas[ lumas.length >> 1 ] || 0;
			if ( ! ( landLit >= 0.98 * land ) ) fail.push( `aerial: only ${ ( 100 * landLit / land ).toFixed( 1 ) } % of land has colour` );
			if ( deepLit > 0.001 * deep ) fail.push( `aerial: ${ deepLit } deep-water pixels carry colour (should be zero)` );
			if ( ! ( med >= 95 && med <= 115 ) ) fail.push( `aerial: median land brightness ${ med.toFixed( 0 ) }, expected 95–115 (urban albedo ~0.15)` );
			console.log( `aerial: ${ A.width }×${ A.height } at ${ A.cell } m, land coloured ${ ( 100 * landLit / land ).toFixed( 1 ) } %, median land luma ${ med.toFixed( 0 ) }` );

		}

	}

	return { fail, h };

}

// the runtime loader (src/world/BayTerrain.js) must reproduce the decoded grid exactly
async function loaderMatches( dir, h ) {

	const netFetch = globalThis.fetch;
	globalThis.fetch = async ( u ) => new Response( readFileSync( join( dir, String( u ).replace( /^\/?terrain\//, '' ) ) ) );
	try {

		const { loadBayHeightField } = await import( '../src/world/BayTerrain.js' );
		const hf = await loadBayHeightField( '/' );
		let bad = 0;
		for ( let k = 0; k < h.length; k += 997 ) if ( hf.heights[ k ] !== h[ k ] ) bad ++;
		const A = JSON.parse( readFileSync( join( dir, 'index.json' ), 'utf8' ) ).aerial;
		if ( A && existsSync( join( dir, A.file ) ) ) {

			const rgb = inflateSync( readFileSync( join( dir, A.file ) ) );
			if ( ! hf.aerial ) bad ++;
			else for ( let k = 0; k < A.width * A.height; k += 1009 ) for ( let c = 0; c < 3; c ++ ) if ( hf.aerial.data[ k * 4 + c ] !== rgb[ k * 3 + c ] ) bad ++;

		}

		return bad ? [ `loader: ${ bad } sampled heights / colours differ between BayTerrain.js and the tiles` ] : [];

	} catch ( e ) {

		return [ `loader: BayTerrain.js failed on these tiles — ${ String( e.message || e ).split( '\n' )[ 0 ] }` ];

	} finally { globalThis.fetch = netFetch; }

}

async function check( { rawDir = RAW, shipped = SHIPPED, tamperRun2 = null, dropAerial = false } = {} ) {

	rmSync( work, { recursive: true, force: true } );
	const a = join( work, 'run1' ), b = join( work, 'run2' );
	const fail = [ ...build( rawDir, a ), ...build( rawDir, b ) ];
	if ( fail.length ) return fail;
	if ( tamperRun2 ) tamperRun2( b );
	if ( dropAerial ) for ( const d of [ a, b ] ) rmSync( join( d, 'aerial.bin' ) );
	fail.push( ...compareDirs( a, b, 'determinism (run1 vs run2)' ) );
	fail.push( ...compareDirs( a, shipped, 'shipped tiles (public/terrain vs pipeline)' ) );
	const p = plausibility( a, rawDir );
	fail.push( ...p.fail, ...await loaderMatches( a, p.h ) );
	return fail;

}

if ( ! NEG ) {

	const fail = await check();
	rmSync( work, { recursive: true, force: true } );
	if ( fail.length ) { console.log( 'G2a FAIL\n- ' + fail.join( '\n- ' ) ); process.exit( 1 ); }
	console.log( 'G2a PASS — 256 tiles, byte-identical across two offline runs, match public/terrain, plausible, seamless, loader exact' );
	process.exit( 0 );

}

// ---- negative fixtures
const fxRaw = join( root, '.verify', 'g2a-raw' ), fxShip = join( root, '.verify', 'g2a-ship' );
const rawFixture = ( mutate ) => {

	rmSync( fxRaw, { recursive: true, force: true } ); mkdirSync( fxRaw, { recursive: true } );
	for ( const f of readdirSync( RAW ) ) symlinkSync( join( RAW, f ), join( fxRaw, f ) );
	mutate( fxRaw );
	return fxRaw;

};
const reManifest = ( d ) => {

	const lines = readFileSync( join( RAW, 'MANIFEST.sha256' ), 'utf8' ).trim().split( '\n' ).map( ( l ) => { const f = l.split( /\s+/ )[ 1 ]; return `${ createHash( 'sha256' ).update( readFileSync( join( d, f ) ) ).digest( 'hex' ) }  ${ f }`; } );
	rmSync( join( d, 'MANIFEST.sha256' ) ); writeFileSync( join( d, 'MANIFEST.sha256' ), lines.join( '\n' ) + '\n' );

};
const MUTATIONS = [
	[ 'second run encodes a tile differently', 'determinism', () => check( { tamperRun2: ( b ) => { const p = join( b, 't_3_3.bin' ); writeFileSync( p, deflateSync( inflateSync( readFileSync( p ) ), { level: 1 } ) ); } } ) ],
	[ 'cached bathymetry tampered (checksum)', 'pipeline:', () => check( { rawDir: rawFixture( ( d ) => { rmSync( join( d, 'bathy-ncei.tif' ) ); const b = readFileSync( join( RAW, 'bathy-ncei.tif' ) ); b[ 5000 ] ^= 1; writeFileSync( join( d, 'bathy-ncei.tif' ), b ); } ) } ) ],
	[ 'cached file missing (no network fallback)', 'pipeline:', () => check( { rawDir: rawFixture( ( d ) => rmSync( join( d, 'noaa-datums-9414290.json' ) ) ) } ) ],
	[ 'shipped tiles stale', 'shipped tiles', () => { rmSync( fxShip, { recursive: true, force: true } ); cpSync( SHIPPED, fxShip, { recursive: true } ); const p = join( fxShip, 't_8_8.bin' ); const t = inflateSync( readFileSync( p ) ); t[ 100 ] ^= 4; writeFileSync( p, deflateSync( t, { level: 9, memLevel: 9 } ) ); return check( { shipped: fxShip } ); } ],
	[ 'ground colour map missing', 'aerial:', () => check( { tamperRun2: null, shipped: SHIPPED, dropAerial: true } ) ],
	[ 'land DEM 20 m too high (seam cliffs)', 'seam:', () => check( { rawDir: rawFixture( ( d ) => {

		const t = readTiff( readFileSync( join( RAW, 'terrain-3dep.tif' ) ) );
		const data = Float32Array.from( t.data, ( v ) => v + 20 );
		rmSync( join( d, 'terrain-3dep.tif' ) );
		writeFileSync( join( d, 'terrain-3dep.tif' ), writeTiff( { width: t.width, height: t.height, data, tie: t.tags[ 33922 ], scale: t.tags[ 33550 ] } ) );
		reManifest( d );

	} ) } ) ],
	[ 'land-only DEM used as seabed', 'heights:', () => check( { rawDir: rawFixture( ( d ) => { rmSync( join( d, 'bathy-ncei.tif' ) ); cpSync( join( RAW, 'terrain-3dep.tif' ), join( d, 'bathy-ncei.tif' ) ); reManifest( d ); } ) } ) ],
];
let missed = 0;
for ( const [ name, label, run ] of MUTATIONS ) {

	const fail = ( await run() ).filter( ( m ) => m.startsWith( label ) );
	console.log( `${ fail.length ? 'caught  ' : 'MISSED  ' } ${ name }${ fail.length ? ' — ' + fail[ 0 ] : '' }` );
	if ( ! fail.length ) missed ++;

}

for ( const d of [ work, fxRaw, fxShip ] ) rmSync( d, { recursive: true, force: true } );
console.log( `NEGATIVE ${ MUTATIONS.length - missed }/${ MUTATIONS.length }` ); // verify.sh requires every mutation caught
process.exit( missed ? 0 : 1 );
