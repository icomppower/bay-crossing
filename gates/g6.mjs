// G6 Look (advisory): headless 1920×1080 screenshots at a fixed view and seed — golden hour, blue hour, night —
// written to shots/ for human review. Times come from sun elevations (+6°, −5°, −15°) solved with the App's
// own sun model (SF latitude, late-September declination). The numbers checked are sanity only (non-blank
// frames, light falling from golden hour to night); the review is human.
// --negative: a sun frozen at noon must fail the ordering.
import { spawnSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { root } from './lib/tiles.mjs';
import { VIEWS, poseFor } from './lib/views.mjs';
import { WORLD } from '../src/world/WorldLayout.js';

const NEG = process.argv.includes( '--negative' );
const SHOTS = [ [ 'golden-hour', 6 ], [ 'blue-hour', - 5 ], [ 'night', - 15 ] ];

// afternoon solar time at which the sun stands `elev` degrees above the horizon
function hoursFor( elev ) {

	const r = Math.PI / 180, phi = WORLD.sun.latitude * r, dec = WORLD.sun.declination * r;
	const cosH = ( Math.sin( elev * r ) - Math.sin( phi ) * Math.sin( dec ) ) / ( Math.cos( phi ) * Math.cos( dec ) );
	return 12 + Math.acos( Math.max( - 1, Math.min( 1, cosH ) ) ) / r / 15;

}

async function shoot( sabotage, outDir ) {

	const { bootApp } = await import( '../tools/headless/app.mjs' );
	const { writePNG } = await import( '../test/headless.mjs' );
	const { Vector3 } = await import( '../src/engine/index.js' );
	const H = await bootApp( { width: 1920, height: 1080, query: '?fly&noAudio&tier=low' } );
	const app = H.app;
	if ( sabotage === 'noon' ) { const f = app.updateSun.bind( app ); app.updateSun = () => { const t = app.settings.timeOfDay; app.settings.timeOfDay = 13; f(); app.settings.timeOfDay = t; }; }
	const p = await poseFor( VIEWS.find( ( v ) => v[ 0 ] === 'ferry-deck-mid-bay' ) );
	const out = [];
	for ( const [ name, elev ] of SHOTS ) {

		app.settings.timeOfDay = hoursFor( elev );
		app.fly.setPose( new Vector3( p.x, p.y, p.z ), p.yaw, p.pitch );
		H.frames( 60, 1 / 30 );
		const px = await H.readPixels();
		if ( outDir ) writePNG( join( outDir, `${ name }.png` ), H.width, H.height, px );
		let s = 0, s2 = 0;
		for ( let k = 0; k < px.length; k += 4 ) { const l = ( px[ k ] + px[ k + 1 ] + px[ k + 2 ] ) / 3; s += l; s2 += l * l; }
		const n = px.length / 4, mean = s / n;
		out.push( { name, hours: app.settings.timeOfDay, mean, std: Math.sqrt( Math.max( 0, s2 / n - mean * mean ) ) } );

	}

	return { shots: out, errors: H.errors.length };

}

if ( process.argv.includes( '--shoot' ) ) {

	const s = ( process.argv.find( ( a ) => a.startsWith( '--sabotage=' ) ) || '' ).split( '=' )[ 1 ];
	const dir = ( process.argv.find( ( a ) => a.startsWith( '--out=' ) ) || '' ).split( '=' )[ 1 ];
	console.log( 'SHOT ' + JSON.stringify( await shoot( s, dir || null ) ) );
	process.exit( 0 );

}

function shootChild( sabotage = '', outDir = '' ) {

	const r = spawnSync( process.execPath, [ fileURLToPath( import.meta.url ), '--shoot', ...( sabotage ? [ '--sabotage=' + sabotage ] : [] ), ...( outDir ? [ '--out=' + outDir ] : [] ) ], { encoding: 'utf8', maxBuffer: 1 << 26 } );
	const line = ( r.stdout || '' ).split( '\n' ).find( ( l ) => l.startsWith( 'SHOT ' ) );
	if ( ! line ) throw new Error( 'shots crashed: ' + ( r.stderr || '' ).slice( - 800 ) );
	return JSON.parse( line.slice( 5 ) );

}

function judge( r ) {

	const fail = [];
	for ( const s of r.shots ) console.log( `${ s.name.padEnd( 12 ) } solar ${ s.hours.toFixed( 2 ) } h  mean ${ s.mean.toFixed( 1 ) }  std ${ s.std.toFixed( 1 ) }` );
	if ( r.errors ) fail.push( `render: ${ r.errors } console/GPU errors` );
	for ( const s of r.shots ) if ( ! ( s.std > 4 && s.mean > 1 ) ) fail.push( `blank: ${ s.name } is a flat frame (mean ${ s.mean.toFixed( 1 ) }, std ${ s.std.toFixed( 1 ) })` );
	const [ g, b, n ] = r.shots.map( ( s ) => s.mean );
	if ( ! ( g > b && b > n ) ) fail.push( `order: brightness should fall golden hour > blue hour > night (${ g.toFixed( 1 ) }, ${ b.toFixed( 1 ) }, ${ n.toFixed( 1 ) })` );
	return fail;

}

if ( ! NEG ) {

	const dir = join( root, 'shots' );
	mkdirSync( dir, { recursive: true } );
	const fail = judge( shootChild( '', dir ) );
	if ( fail.length ) { console.log( 'G6 FAIL (advisory)\n- ' + fail.join( '\n- ' ) ); process.exit( 1 ); }
	console.log( 'G6 PASS (advisory) — shots/golden-hour.png, shots/blue-hour.png, shots/night.png written for review' );
	process.exit( 0 );

}

const fail = judge( shootChild( 'noon' ) ).filter( ( m ) => m.startsWith( 'order:' ) );
console.log( `${ fail.length ? 'caught  ' : 'MISSED  ' } sun frozen at noon${ fail.length ? ' — ' + fail[ 0 ] : '' }` );
process.exit( fail.length ? 1 : 0 );
