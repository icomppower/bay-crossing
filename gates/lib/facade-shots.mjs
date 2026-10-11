// Facade shots (G21 and development): one headless App, several street-level views.
//   node gates/lib/facade-shots.mjs <outDir> [--before] [--w 1280 --h 720] [--only name,name] [--times midday,golden,night]
// --before: the run-2 facades (?facades=0). Crowd off (the shots are about buildings); eye 1.7 m above the walkway.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { bootApp } from 'harbor-engine/tools/headless/app.mjs';
import { writePNG } from 'harbor-engine/test/headless.mjs';
import { toLocal } from 'harbor-engine/src/world/Frame.js';
import { toUTM } from 'harbor-engine/tools/geo/utm.mjs';
import { Vector3 } from 'harbor-engine/src/engine/index.js';
import { attachStreet } from '../../src/street/index.js';

import { VIEWS, TIMES } from './facade-shots-views.mjs';
export { VIEWS, TIMES };

const a = process.argv.slice( 2 );
const val = ( k, d ) => a.includes( k ) ? a[ a.indexOf( k ) + 1 ] : d;
const out = a[ 0 ];
const before = a.includes( '--before' );
const W = + val( '--w', 1280 ), Hh = + val( '--h', 720 );
const only = val( '--only', '' ).split( ',' ).filter( Boolean );
const times = val( '--times', 'midday,golden,night' ).split( ',' );
// extra views: --view name,lat,lon,lookLat,lookLon,lookHeight (repeatable; replaces the fixed list)
const extra = a.map( ( s, i ) => a[ i - 1 ] === '--view' ? s.split( ',' ) : null ).filter( Boolean ).map( ( [ n, ...v ] ) => [ n, ...v.map( Number ) ] );
mkdirSync( out, { recursive: true } );
const H = await bootApp( { width: W, height: Hh, query: `?fly&noAudio&tier=low&crowd=0&seed=1975${ before ? '&facades=0' : '' }` } );
const app = H.app;
const st = await attachStreet( app );
const stats = [];
if ( a.includes( '--budget' ) ) {

	// the G2c / G12 fixed views: draws and triangles per frame with the facade pass (compare with SPEC-THRESHOLDS)
	const { VIEWS: FIXED, poseFor } = await import( './views.mjs' );
	for ( const v of FIXED ) {

		const p = await poseFor( v );
		app.settings.timeOfDay = 16;
		app.fly.setPose( new Vector3( p.x, p.y, p.z ), p.yaw, p.pitch );
		for ( let i = 0; i < 6; i ++ ) { app.frame( 1 / 30 ); await H.settle(); }
		app.frame( 1 / 30 );
		const rs = app.engine.meshRenderer.stats;
		let facade = 0;
		app.scene.traverse( ( o ) => { if ( o.isMesh && /^facade-/.test( o.name ) ) { const g = o.geometry; facade += g.attributes.position.count / 3 * ( g.instanceCount ?? 0 ) * ( 1 + ( o.castShadow ? 3 : 0 ) ); } } );
		console.log( JSON.stringify( { view: v[ 0 ], draws: rs.draws, triangles: rs.triangles, facadeTriangles: facade } ) );

	}

	process.exit( 0 );

}
for ( const [ name, lat, lon, tlat, tlon, ty ] of extra.length ? extra : VIEWS ) {

	if ( only.length && ! only.includes( name ) ) continue;
	const p = toLocal( ...toUTM( lat, lon ) ), q = toLocal( ...toUTM( tlat, tlon ) );
	let x = p.x, z = p.z, y0 = null;
	for ( let r = 0; r <= 15 && y0 === null; r += 0.5 ) for ( let k = 0; k < 16; k ++ ) { const px = p.x + Math.cos( k / 16 * 6.283 ) * r, pz = p.z + Math.sin( k / 16 * 6.283 ) * r, g = st.ground.at( px, pz ); if ( g && g.walkable ) { x = px; z = pz; y0 = g.y; break; } }
	if ( y0 === null ) y0 = app.terrainData.heightAt( x, z );
	const eye = y0 + 1.7, ly = st.ground.heightAt( q.x, q.z ) ?? app.terrainData.heightAt( q.x, q.z );
	for ( const tn of times ) {

		const t = TIMES[ tn ];
		app.settings.timeOfDay = t.hour;
		if ( app.haze ) app.haze.density.value = t.fog || 1.6;
		app.fly.setPose( new Vector3( x, eye, z ), Math.atan2( - ( q.x - x ), - ( q.z - z ) ), Math.atan2( ly + ty - eye, Math.hypot( q.x - x, q.z - z ) ) );
		for ( let i = 0; i < + val( '--frames', 16 ); i ++ ) { app.frame( 1 / 30 ); if ( i % 4 === 3 ) await H.settle(); }
		const px = await H.readPixels();
		const file = join( out, `${ before ? 'before-' : '' }${ name }-${ tn }.png` );
		writePNG( file, W, Hh, px );
		const rs = app.engine.meshRenderer.stats;
		stats.push( { name, time: tn, file, detailTriangles: st.facades ? st.facades.detail.triangles : 0, draws: rs.draws, triangles: rs.triangles } );
		console.log( JSON.stringify( stats[ stats.length - 1 ] ) );

	}

}

writeFileSync( join( out, before ? 'before.json' : 'after.json' ), JSON.stringify( { stats, errors: H.errors.slice( 0, 20 ), facadeLog: st.facades ? { ...st.facades.log, detail: st.facades.detailLog } : null }, null, 1 ) );
console.log( JSON.stringify( { errors: H.errors.length, firstErrors: H.errors.slice( 0, 5 ) } ) );
process.exit( 0 );
