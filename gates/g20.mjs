// G20 Facade budget (run 3, D83): with the facade pass on (it is part of the street layer since run 3), G13's
// measurement on the M4 — the street-level path and the G5 path at low tier, 1920×1080 — must still meet G5's frozen
// floor and cap (p95 ≥ G5.fpsFloor fps, GPU memory ≤ G5.gpuMemoryMB, no swap); and the facade near band adds at most
// the calibrated number of triangles at any point of the street path (instances streamed within 150 m, as
// src/facades/Detail.js; ×2 for the shadow pass of the types that cast shadows).
// --negative: G13's own negative fixtures (4K path, leaked GPU memory, swap) and the near band at twice its density
// must each be caught.
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { readThresholds, freeze } from 'harbor-engine/gates/lib/thresholds.mjs';
import { facadeModel, PATH, negativeSummary, root } from './lib/facades.mjs';
import { tileInstances, DETAIL_TYPES } from '../src/facades/model.js';
import { templateTriangles } from '../src/facades/Detail.js';

const NEG = process.argv.includes( '--negative' );
const NO_SHADOW = new Set( [ 'fireEscape', 'balcony' ] );

function nearBandMax( detail, density = 1 ) {

	const tris = templateTriangles();
	const tiled = Object.fromEntries( DETAIL_TYPES.map( ( t ) => [ t, tileInstances( detail[ t ] ) ] ) );
	let max = 0, at = null;
	for ( let i = 1; i < PATH.length; i ++ ) {

		const [ ax, az ] = PATH[ i - 1 ], [ bx, bz ] = PATH[ i ], L = Math.hypot( bx - ax, bz - az );
		for ( let s = 0; s <= L; s += 20 ) {

			const px = ax + ( bx - ax ) * s / L, pz = az + ( bz - az ) * s / L;
			let sum = 0;
			for ( const [ type, d ] of Object.entries( tiled ) ) for ( const [ tx, tz, , count ] of d.tiles ) {

				const cx = ( tx + 0.5 ) * d.tile, cz = ( tz + 0.5 ) * d.tile, h = d.tile / 2;
				const dx = Math.max( 0, Math.abs( px - cx ) - h ), dz = Math.max( 0, Math.abs( pz - cz ) - h );
				if ( dx * dx + dz * dz < 150 * 150 ) sum += count * density * tris[ type ] * ( NO_SHADOW.has( type ) ? 1 : 2 );

			}

			if ( sum > max ) { max = sum; at = [ px, pz ]; }

		}

	}

	return { max, at };

}

const model = facadeModel();
const run13 = ( args ) => spawnSync( process.execPath, [ join( root, 'gates/g13.mjs' ), ...args ], { cwd: root, encoding: 'utf8' } );
const t = readThresholds();
if ( NEG ) {

	let caught = 0;
	const cap = t[ 'G20.facadeNearTriangles' ];
	const dbl = nearBandMax( model.detail, 2 ).max;
	const ok = cap !== undefined && dbl > cap;
	console.log( 'near band ×2:', ok ? `${ dbl } > cap ${ cap }` : 'NOT CAUGHT (or no cap frozen yet: run G20 once)' ); if ( ok ) caught ++;
	const g13 = run13( [ '--negative' ] );
	const line = ( g13.stdout.match( /^NEGATIVE (\d+)\/(\d+)$/m ) || [] );
	const all = line.length && line[ 1 ] === line[ 2 ] && g13.status !== 0;
	console.log( 'G13 fixtures with the facade pass:', all ? line[ 0 ] : `not caught (${ ( g13.stdout + g13.stderr ).trim().split( '\n' ).slice( - 2 ).join( ' / ' ) })` ); if ( all ) caught ++;
	negativeSummary( caught, 2 );

}

const fails = [];
const { max, at } = nearBandMax( model.detail );
const cap = t[ 'G20.facadeNearTriangles' ] ?? freeze( 'G20.facadeNearTriangles', Math.ceil( max * 1.25 ), `facade near-band triangles (all passes: shadow-casting types counted twice) streamed within 150 m of any point of the street path, sampled every 20 m; measured max ${ max } on ${ new Date().toISOString().slice( 0, 10 ) }; cap = 1.25 × measured` );
console.log( `facade near band: max ${ max } triangles along the path (at ${ at.map( ( v ) => v.toFixed( 0 ) ).join( ', ' ) }), cap ${ cap }` );
if ( max > cap ) fails.push( `facade near band ${ max } triangles > cap ${ cap }` );
const g13 = run13( [] );
console.log( ( g13.stdout + g13.stderr ).trim().split( '\n' ).slice( - 6 ).join( '\n' ) );
if ( g13.status !== 0 ) fails.push( 'G13 measurement with the facade pass did not pass (needs the M4: headless Dawn → Metal)' );
for ( const x of fails ) console.log( 'FAIL ' + x );
console.log( fails.length ? 'G20 FAIL' : 'G20 PASS' );
process.exit( fails.length ? 1 : 0 );
