// Landmark signs (ui/Signs.js) in the real App, headless Dawn: anchors sit above the models / ground, every
// waypoint shows its own landmark's sign (in view, unblocked), the aerial view shows many, Angel Island hides
// Alcatraz from the north, flights to the other places land clear of the ground with a clear view, and the numpad
// keys fly to waypoints too. (The DOM half is checked in a browser; this is the maths.)
//   node test/signs.mjs
import { bootApp } from '../tools/headless/app.mjs';
import { WAYPOINTS, waypointPose } from '../src/world/Waypoints.js';
import { PLACES } from '../src/world/Places.js';
import { signAnchors, blocked, layout } from '../src/ui/Signs.js';

const W = 1280, H = 720;
const T = await bootApp( { width: W, height: H, query: '?noAudio&tier=low' } );
const app = T.app, fail = [];
const ok = ( c, msg ) => { if ( ! c ) fail.push( msg ); };
const groundAt = ( x, z ) => Math.max( app.terrainData.heightAt( x, z ), app.roofs.heightAt( x, z, 0 ) );
const A = signAnchors( app.terrainData, app.roofs );
const byName = ( n ) => A.findIndex( ( a ) => a.name === n );
const visible = () => {

	app.camera.updateMatrixWorld();
	const occ = A.map( ( a ) => blocked( app.camera.position, a, groundAt ) );
	return layout( A, app.camera, W, H, occ, A.map( ( a ) => [ a.name.length * 8 + 24, 34 ] ) ).map( ( v ) => A[ v.i ].name );

};
T.frames( 3 );

ok( A[ byName( 'Golden Gate Bridge' ) ].y > 227, `bridge sign at ${ A[ byName( 'Golden Gate Bridge' ) ].y.toFixed( 0 ) } m, under the towers` );
ok( A[ byName( 'Transamerica Pyramid' ) ].y > 250, `pyramid sign at ${ A[ byName( 'Transamerica Pyramid' ) ].y.toFixed( 0 ) } m` );
ok( A[ byName( 'Angel Island' ) ].ground > 150, `Angel Island ground ${ A[ byName( 'Angel Island' ) ].ground.toFixed( 0 ) } m (Mount Livermore is 240 m)` );
for ( const a of A ) ok( a.y > a.ground && a.y < 400, `${ a.name }: sign at ${ a.y.toFixed( 0 ) } m over ground ${ a.ground.toFixed( 0 ) } m` );

// each waypoint shows its own landmark
for ( const p of PLACES.filter( ( q ) => q.waypoint !== undefined ) ) {

	const w = WAYPOINTS[ p.waypoint ], pose = waypointPose( w );
	app.setFreeCam( true );
	app.fly.setPose( pose.position, pose.yaw, pose.pitch );
	T.frames( 1 );
	const v = visible();
	ok( v.includes( p.name ), `from waypoint "${ w.name }" the ${ p.name } sign is not shown (shown: ${ v.join( ', ' ) })` );
	console.log( `${ w.name.padEnd( 22 ) } ${ v.length } signs: ${ v.join( ', ' ) }` );

}

// the aerial shows much of the city; a street canyon downtown hides the far bridge
{

	const pose = waypointPose( WAYPOINTS[ 7 ] );
	app.fly.setPose( pose.position, pose.yaw, pose.pitch );
	T.frames( 1 );
	ok( visible().length >= 5, `city from above shows only ${ visible().length } signs` );
	// north of Angel Island at sea level: the island (240 m) stands between the camera and Alcatraz
	const y = Math.max( app.terrainData.heightAt( 476, - 4700 ), 0 ) + 3;
	app.fly.setPose( new ( app.camera.position.constructor )( 476, y, - 4700 ), Math.PI, 0 );
	T.frames( 1 );
	ok( blocked( app.camera.position, A[ byName( 'Alcatraz' ) ], groundAt ), 'Angel Island does not hide the Alcatraz sign from the north' );
	ok( ! visible().includes( 'Alcatraz' ), 'the Alcatraz sign is laid out behind Angel Island' );

}

// flights to the places that have no waypoint
for ( const a of A.filter( ( q ) => q.waypoint === undefined ) ) {

	app.fly.setPose( new ( app.camera.position.constructor )( 2000, 60, 1000 ), 0, 0 );
	app.goToPlace( a );
	let t = 0;
	while ( app.fly.flight && t < 8 ) { T.frames( 1, 1 / 30 ); t += 1 / 30; }
	const c = app.camera.position, clear = c.y - groundAt( c.x, c.z ), d = Math.hypot( c.x - a.x, c.z - a.z );
	ok( ! app.fly.flight && clear > 20 && Math.abs( d - 350 ) < 1, `${ a.name }: landed ${ clear.toFixed( 0 ) } m up, ${ d.toFixed( 0 ) } m away` );
	const v = visible();
	ok( v.includes( a.name ), `${ a.name }: its sign is not shown after flying there` );

}

// numpad keys fly to waypoints too
app.input.pressed.add( 'Numpad4' );
T.frames( 1, 1 / 30 );
ok( app.waypoint === 3 && app.fly.flight, 'Numpad4 did not start the flight to Alcatraz' );
ok( T.errors.length === 0, `${ T.errors.length } console errors: ${ T.errors[ 0 ] }` );

for ( const f of fail ) console.log( 'FAIL ' + f );
console.log( fail.length ? `signs: ${ fail.length } failures` : `signs: PASS (${ A.length } signs)` );
process.exit( fail.length ? 1 : 0 );
