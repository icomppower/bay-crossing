// G4 Ferry: the Ferry Building → Sausalito crossing completes in the real App (FerryController physics, the
// helmsman on public/ferry/route.json); its duration lies within the cited range — from the geodesic terminal
// distance at MV Golden Gate's published top speed (38 kn) to the published timetable (GTFS, 30 min); and the hull
// is never over water shallower than its draft (1.5 m) on the way.
// --negative: a shoal on the route, a slow helmsman, and an unreachable berth must each fail.
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { root } from './lib/tiles.mjs';
import { FERRY, KNOT } from '../src/world/FerrySpec.js';
import { planRoute } from '../tools/ferry/route.mjs';

const NEG = process.argv.includes( '--negative' );
const schedule = JSON.parse( readFileSync( join( root, 'public/ferry/schedule.json' ), 'utf8' ) );
const route = JSON.parse( readFileSync( join( root, 'public/ferry/route.json' ), 'utf8' ) );

// the cited range, independent of the scene frame: haversine between the GTFS terminals
const from = [ ...schedule.terminals.sanFrancisco ].find( ( t ) => t.stopId === route.from.stopId ), to = schedule.terminals.sausalito[ 0 ];
const R = 6371008.8, rad = Math.PI / 180;
const hav = 2 * R * Math.asin( Math.sqrt( Math.sin( ( to.lat - from.lat ) * rad / 2 ) ** 2 + Math.cos( from.lat * rad ) * Math.cos( to.lat * rad ) * Math.sin( ( to.lon - from.lon ) * rad / 2 ) ** 2 ) );
const T_MIN = hav / ( FERRY.topSpeedKn * KNOT ) / 60, T_MAX = Math.max( ...schedule.publishedMinutes.toSausalito );

// ---- the crossing (child process: one App per process)
async function sail( sabotage ) {

	const { bootApp } = await import( '../tools/headless/app.mjs' );
	const H = await bootApp( { width: 320, height: 180, query: '?fly&noAudio' } );
	const app = H.app, b = app.boatCtl;
	app.renderEnabled = false;
	if ( sabotage === 'shoal' ) {

		// a 1 m deep bank 300 m across on the open-water leg, halfway along the route
		const [ a, c ] = [ route.waypoints[ 1 ], route.waypoints[ 2 ] ], mx = ( a[ 0 ] + c[ 0 ] ) / 2, mz = ( a[ 1 ] + c[ 1 ] ) / 2;
		const T = app.terrainData, n = T.res;
		for ( let j = 0; j < n; j ++ ) for ( let i = 0; i < n; i ++ ) {

			const x = T.origin + ( i + 0.5 ) * T.texel, z = T.origin + ( j + 0.5 ) * T.texel;
			if ( Math.hypot( x - mx, z - mz ) < 150 ) T.heights[ j * n + i ] = Math.max( T.heights[ j * n + i ], - 1.0 );

		}

	}

	H.frames( 30, 0.1 );
	await H.settle();
	b.minDepthUnderHull = Infinity; b.groundContacts = 0; // count from the departure
	app.setAutopilot( true );
	if ( sabotage === 'slow' ) { app.autopilot.cruise = 5 * KNOT; app.autopilot.harbour = 5 * KNOT; }
	if ( sabotage === 'unreachable' ) { const e = app.autopilot.pts.at( - 1 ); e[ 0 ] -= 350; e[ 1 ] -= 250; }
	let t = 0, k = 0;
	while ( t < 45 * 60 && ! app.autopilot.arrived ) {

		H.frames( 1, 0.1 ); t += 0.1;
		if ( ++ k % 50 === 0 ) await H.settle();

	}

	const end = route.waypoints.at( - 1 );
	return {
		arrived: app.autopilot.arrived, minutes: t / 60, endDistance: Math.hypot( b.position.x - end[ 0 ], b.position.z - end[ 1 ] ),
		minDepth: b.minDepthUnderHull, contacts: b.groundContacts, errors: H.errors.length,
	};

}

if ( process.argv.includes( '--sail' ) ) {

	const s = ( process.argv.find( ( a ) => a.startsWith( '--sabotage=' ) ) || '' ).split( '=' )[ 1 ];
	console.log( 'SAIL ' + JSON.stringify( await sail( s ) ) );
	process.exit( 0 );

}

function sailChild( sabotage = '' ) {

	const r = spawnSync( process.execPath, [ fileURLToPath( import.meta.url ), '--sail', ...( sabotage ? [ '--sabotage=' + sabotage ] : [] ) ], { encoding: 'utf8', maxBuffer: 1 << 26 } );
	const line = ( r.stdout || '' ).split( '\n' ).find( ( l ) => l.startsWith( 'SAIL ' ) );
	if ( ! line ) throw new Error( 'crossing crashed: ' + ( r.stderr || '' ).slice( - 800 ) );
	return JSON.parse( line.slice( 5 ) );

}

function judge( s ) {

	const fail = [];
	console.log( `crossing: arrived ${ s.arrived }, ${ s.minutes.toFixed( 2 ) } min (range ${ T_MIN.toFixed( 2 ) }–${ T_MAX } min), ${ s.endDistance.toFixed( 1 ) } m from the berth, min depth under the hull ${ s.minDepth.toFixed( 2 ) } m (draft ${ FERRY.draft } m), keel contacts ${ s.contacts }` );
	if ( s.errors ) fail.push( `render: ${ s.errors } console/GPU errors` );
	if ( ! s.arrived || s.endDistance > 30 ) fail.push( `arrival: the crossing did not complete (${ s.endDistance.toFixed( 0 ) } m from the Sausalito berth after ${ s.minutes.toFixed( 1 ) } min)` );
	// past the published timetable is a duration failure whether or not the ferry got there
	if ( s.minutes > T_MAX || ( s.arrived && s.minutes < T_MIN ) ) fail.push( `duration: ${ s.arrived ? '' : 'still sailing after ' }${ s.minutes.toFixed( 2 ) } min, outside ${ T_MIN.toFixed( 2 ) }–${ T_MAX } min` );
	if ( ! ( s.minDepth >= FERRY.draft ) || s.contacts > 0 ) fail.push( `draft: the hull was over ${ s.minDepth.toFixed( 2 ) } m of water (draft ${ FERRY.draft } m), ${ s.contacts } keel contacts` );
	return fail;

}

function staticChecks() {

	const fail = [];
	// D3: the hull is built from the cited dimensions of MV Golden Gate
	const cited = { length: 43.7, beam: 12.0, draft: 1.5, topSpeedKn: 38 };
	for ( const [ k, v ] of Object.entries( cited ) ) if ( FERRY[ k ] !== v ) fail.push( `hull: FERRY.${ k } = ${ FERRY[ k ] }, cited ${ v }` );
	// the shipped route is exactly what the planner makes from the current data
	const out = join( root, '.verify', 'g4-route.json' );
	mkdirSync( join( root, '.verify' ), { recursive: true } );
	writeFileSync( out, JSON.stringify( planRoute(), null, 1 ) + '\n' );
	if ( readFileSync( out, 'utf8' ) !== readFileSync( join( root, 'public/ferry/route.json' ), 'utf8' ) ) fail.push( 'route: public/ferry/route.json differs from a fresh plan (run node tools/ferry/route.mjs)' );
	rmSync( out, { force: true } );
	if ( ! ( route.minDepthAlong >= FERRY.draft ) ) fail.push( `route: planned legs cross ${ route.minDepthAlong } m of water (draft ${ FERRY.draft } m)` );
	return fail;

}

if ( ! NEG ) {

	const fail = [ ...staticChecks(), ...judge( sailChild() ) ];
	if ( fail.length ) { console.log( 'G4 FAIL\n- ' + fail.join( '\n- ' ) ); process.exit( 1 ); }
	console.log( 'G4 PASS — Ferry Building → Sausalito crossing completes within the cited range, never over water shallower than the draft' );
	process.exit( 0 );

}

const MUTATIONS = [
	[ 'a 1 m shoal on the route', 'draft:', 'shoal' ],
	[ 'a helmsman at 5 kn', 'duration:', 'slow' ],
	[ 'the berth moved ashore (unreachable)', 'arrival:', 'unreachable' ],
];
let missed = 0;
for ( const [ name, label, sabotage ] of MUTATIONS ) {

	const fail = judge( sailChild( sabotage ) ).filter( ( m ) => m.startsWith( label ) );
	console.log( `${ fail.length ? 'caught  ' : 'MISSED  ' } ${ name }${ fail.length ? ' — ' + fail[ 0 ] : '' }` );
	if ( ! fail.length ) missed ++;

}

console.log( `NEGATIVE ${ MUTATIONS.length - missed }/${ MUTATIONS.length }` ); // verify.sh requires every mutation caught
process.exit( missed ? 0 : 1 );
