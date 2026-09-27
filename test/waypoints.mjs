// Waypoints in the real App (headless Dawn): each key 1–8 flies the free camera to its viewpoint; the flight lands
// exactly on the pose, never dips below terrain or a roof, the eye sees its target (no terrain / building in the
// way), and the frame is not blank. N goes to the next waypoint (wrapping), a move key cancels a flight, F leaves
// the free camera. Writes shots/waypoints.png (a contact sheet) for review.
//   node test/waypoints.mjs
import 'harbor-engine/tools/lib/configured.mjs';
import { join } from 'node:path';
import { bootApp } from 'harbor-engine/tools/headless/app.mjs';
import { writePNG } from './headless.mjs';
import { WAYPOINTS } from 'harbor-engine/src/world/Waypoints.js';

const W = 480, H0 = 270;
const T = await bootApp( { width: W, height: H0, query: '?noAudio&tier=low' } );
const app = T.app, fail = [];
const ok = ( c, msg ) => { if ( ! c ) fail.push( msg ); };
const press = ( code ) => app.input.pressed.add( code );
const ground = ( x, z, r ) => Math.max( app.terrainData.heightAt( x, z ), app.roofs.heightAt( x, z, r ), 0 );
app.settings.timeOfDay = 17.2;
T.frames( 5 );

// the roof grid holds the city: something over 200 m downtown (towers), nothing out on the bay
ok( app.roofs.heightAt( 3076, 3543, 0 ) > 200, `roof grid: Transamerica ${ app.roofs.heightAt( 3076, 3543, 0 ).toFixed( 0 ) } m` );
ok( app.roofs.heightAt( 1984, 1017, 40 ) === - Infinity, 'roof grid: roofs out on the bay' );

const sheet = new Uint8Array( W * 4 * H0 * 2 * 4 );
for ( let i = 0; i < WAYPOINTS.length; i ++ ) {

	const w = WAYPOINTS[ i ];
	press( 'Digit' + ( i + 1 ) );
	T.frames( 1, 1 / 30 );
	ok( app.freeCam && app.waypoint === i && app.fly.flight, `${ w.name }: key ${ i + 1 } did not start a flight` );
	let t = 0, minClear = Infinity;
	while ( app.fly.flight && t < 8 ) {

		T.frames( 1, 1 / 30 );
		t += 1 / 30;
		const p = app.camera.position;
		if ( app.fly.flight ) minClear = Math.min( minClear, p.y - ground( p.x, p.z, 0 ) );

	}

	const p = app.camera.position, [ ex, ey, ez ] = w.eye;
	ok( ! app.fly.flight, `${ w.name }: flight still running after ${ t.toFixed( 1 ) } s` );
	ok( Math.hypot( p.x - ex, p.y - ey, p.z - ez ) < 0.01, `${ w.name }: landed ${ Math.hypot( p.x - ex, p.y - ey, p.z - ez ).toFixed( 2 ) } m off` );
	ok( minClear > 0, `${ w.name }: flight dipped ${ ( - minClear ).toFixed( 1 ) } m into terrain / a roof` );
	const eyeClear = ey - ground( ex, ez, 20 );
	ok( eyeClear > 3, `${ w.name }: eye only ${ eyeClear.toFixed( 1 ) } m above ground / roofs` );
	// line of sight, stopping 150 m short of the target (the landmark itself is in the roof grid)
	const [ ax, ay, az ] = w.at, d = Math.hypot( ax - ex, az - ez );
	let blocked = 0;
	for ( let k = 1; k < 60; k ++ ) {

		const f = k / 60;
		if ( ( 1 - f ) * d < 150 ) break;
		const x = ex + ( ax - ex ) * f, y = ey + ( ay - ey ) * f, z = ez + ( az - ez ) * f;
		if ( y < ground( x, z, 0 ) ) blocked ++;

	}

	ok( blocked === 0, `${ w.name }: ${ blocked } samples of the sight line blocked` );
	T.frames( 20, 1 / 30 );
	const px = await T.readPixels();
	let s = 0, s2 = 0;
	for ( let k = 0; k < px.length; k += 4 ) { const l = ( px[ k ] + px[ k + 1 ] + px[ k + 2 ] ) / 3; s += l; s2 += l * l; }
	const n = px.length / 4, mean = s / n, std = Math.sqrt( s2 / n - mean * mean );
	ok( mean > 10 && std > 5, `${ w.name }: flat frame (mean ${ mean.toFixed( 1 ) }, std ${ std.toFixed( 1 ) })` );
	const ox = ( i % 4 ) * W, oy = Math.floor( i / 4 ) * H0;
	for ( let y = 0; y < H0; y ++ ) sheet.set( px.subarray( y * W * 4, ( y + 1 ) * W * 4 ), ( ( oy + y ) * W * 4 + ox ) * 4 );
	console.log( `${ i + 1 } ${ w.name.padEnd( 22 ) } flight ${ t.toFixed( 1 ) } s, min clearance ${ minClear === Infinity ? '-' : minClear.toFixed( 0 ) } m, eye ${ eyeClear.toFixed( 0 ) } m up, frame mean ${ mean.toFixed( 0 ) } std ${ std.toFixed( 0 ) }` );

}

writePNG( join( import.meta.dirname, '../shots/waypoints.png' ), W * 4, H0 * 2, sheet );

// N wraps from the last waypoint to the first
press( 'KeyN' );
T.frames( 1, 1 / 30 );
ok( app.waypoint === 0 && app.fly.flight, `N after the last waypoint went to ${ app.waypoint }` );
// a move key takes the controls back
app.input.keys.add( 'KeyW' );
T.frames( 2, 1 / 30 );
app.input.keys.delete( 'KeyW' );
ok( ! app.fly.flight, 'W did not cancel the flight' );
// F leaves the free camera for the walker
press( 'KeyF' );
T.frames( 2, 1 / 30 );
ok( ! app.freeCam, 'F did not leave the free camera' );
ok( T.errors.length === 0, `${ T.errors.length } console errors: ${ T.errors[ 0 ] }` );

for ( const f of fail ) console.log( 'FAIL ' + f );
console.log( fail.length ? `waypoints: ${ fail.length } failures` : `waypoints: PASS (${ WAYPOINTS.length } waypoints)` );
process.exit( fail.length ? 1 : 0 );
