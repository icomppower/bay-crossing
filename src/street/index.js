// Street level (run 2): attaches the baked street data (public/street/) to a running App — the street surface,
// and (later gates) storefronts, props and the crowd. main.js calls it from boot()'s onReady; headless gates call
// it after bootApp(). The per-frame update rides on the App's game hook (after the player and camera update).
import { StreetSurface } from './Surface.js';
import { StreetGround, streetTerrain } from './Ground.js';
import { StreetStores, signAtlasImage } from './Stores.js';
import { patchBuildingFacades } from './Facades.js';
import { StreetProps } from './Props.js';
import { Vector3, Color } from 'harbor-engine/src/engine/index.js';
import { CrowdSim, CrowdView } from './Crowd.js';
import { PlayerView } from './PlayerView.js';

const BASE = ( typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.BASE_URL ) || '/';

async function inflate( r ) {

	return new Response( r.body.pipeThrough( new DecompressionStream( 'deflate' ) ) ).arrayBuffer();

}

export async function loadStreet( base = BASE ) {

	const index = await ( await fetch( base + 'street/street.json' ) ).json();
	const r = await fetch( base + 'street/surface.bin.deflate' );
	if ( ! r.ok ) throw new Error( `street: surface HTTP ${ r.status }` );
	const buf = await inflate( r );
	// layout: pipelines/street/build.mjs writeStreet
	const n = index.vertices;
	const pos = new Float32Array( buf, 0, n * 3 ), nrm = new Int8Array( buf, n * 12, n * 4 ), dat = new Uint8Array( buf, n * 16, n * 4 );
	const indices = new Uint32Array( buf, n * 20, index.indices );
	return { index, pos, nrm, dat, indices };

}

export async function loadProps( base = BASE ) {

	const index = await ( await fetch( base + 'street/props.json' ) ).json();
	const r = await fetch( base + 'street/props.bin.deflate' );
	if ( ! r.ok ) throw new Error( `street: props HTTP ${ r.status }` );
	return { index, all: new Float32Array( await inflate( r ) ) };

}

export async function loadCrowd( base = BASE ) {

	const index = await ( await fetch( base + 'street/crowd.json' ) ).json();
	const r = await fetch( base + 'street/crowd.bin.deflate' );
	if ( ! r.ok ) throw new Error( `street: crowd HTTP ${ r.status }` );
	return { index, pts: new Float32Array( await inflate( r ) ) };

}

export async function loadStores( base = BASE ) {

	const index = await ( await fetch( base + 'street/stores.json' ) ).json();
	const r = await fetch( base + 'street/stores.bin.deflate' );
	if ( ! r.ok ) throw new Error( `street: stores HTTP ${ r.status }` );
	return { index, modules: new Float32Array( await inflate( r ) ) };

}

// data: preloaded { index, pos, nrm, dat, indices } (gate fixtures), else fetched from base
export async function attachStreet( app, { base = BASE, data = null } = {} ) {

	data = data || await loadStreet( base );
	const street = { surface: new StreetSurface( data ) };
	app.scene.add( street.surface.mesh );
	// storefronts: their sign atlas is drawn by code (in a worker in the browser)
	const stores = await loadStores( base );
	street.stores = new StreetStores( stores, await signAtlasImage( stores.index.texts ) );
	app.scene.add( street.stores.mesh );
	patchBuildingFacades( app );
	// street props (one instanced draw per type); the street-name blades read their own small atlas
	const props = await loadProps( base );
	const names = await signAtlasImage( props.index.names, { cellW: 256, cellH: 32, cols: 8, font: 'bold {s}px "Helvetica Neue", Helvetica, Arial, sans-serif' } );
	street.props = new StreetProps( props, names );
	for ( const m of street.props.meshes ) app.scene.add( m );
	// the crowd (seeded; ?crowd=0 turns it off) and the over-the-shoulder walker
	const qs = app.qs || new URLSearchParams();
	const crowd = await loadCrowd( base );
	const population = qs.has( 'crowd' ) ? Number( qs.get( 'crowd' ) ) : app.quality && app.quality.name === 'mobile' ? Math.round( crowd.index.population / 3 ) : crowd.index.population;
	street.crowd = new CrowdSim( crowd, { seed: Number( qs.get( 'seed' ) || 1975 ), population } );
	street.crowdView = new CrowdView();
	for ( const m of street.crowdView.meshes ) app.scene.add( m );
	street.playerView = new PlayerView();
	const groundY = ( x, z ) => street.ground.heightAt( x, z ) ?? hf.heightAt( x, z );
	// the walker stands on the street surface (sidewalks a curb above the road), from the drawn triangles
	const hf = app.terrainData;
	street.ground = new StreetGround( data, hf.origin + hf.texel / 2 );
	app.player.terrain = streetTerrain( app.player.terrain, street.ground );
	// street lamps light the street at night (the engine's local lights: the 8 nearest are shaded): the heads of the
	// lamps and trolley poles drawn now join the engine's own light sources
	const lights = app.localLights, baseLights = lights ? lights.sources.slice() : [];
	const lampColor = new Color( 1.0, 0.8, 0.58 ), down = new Vector3( 0, - 1, 0 );
	let lampKey = '';
	const updateLamps = () => {

		if ( ! lights || street.props.lampKey === lampKey ) return;
		lampKey = street.props.lampKey;
		lights.sources = baseLights.concat( street.props.lampHeads().map( ( [ x, y, z ] ) => ( { position: new Vector3( x, y, z ), color: lampColor, intensity: 260, range: 24, dir: down, cosInner: 0.55, cosOuter: 0.05, kind: 'street', phase: 0 } ) ) );

	};
	street.update = ( a, dt = 0 ) => {

		street.playerView.update( a, dt, street.ground );
		street.crowd.update( dt );
		street.crowdView.update( street.crowd, a.camera, groundY, street.playerView.figure );
		street.surface.update( a.camera );
		street.stores.update( a.camera );
		street.props.update( a.camera );
		updateLamps();

	};

	// build the street pipelines now (the renderer skips a draw while its pipeline compiles in the background), and
	// surface any shader error here. (precompile() ends by starting the game afresh, so the hook goes on after it.)
	await app.precompile();
	// chain into the App's per-frame game hook
	const game = app.game;
	app.game = {
		...( game || { id: 'sightseeing' } ),
		update: ( a, dt ) => { if ( game && game.update ) game.update( a, dt ); street.update( a, dt ); },
	};
	street.update( app );
	app.street = street;
	return street;

}
