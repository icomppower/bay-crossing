// Street level (run 2): attaches the baked street data (public/street/) to a running App — the street surface,
// and (later gates) storefronts, props and the crowd. main.js calls it from boot()'s onReady; headless gates call
// it after bootApp(). The per-frame update rides on the App's game hook (after the player and camera update).
import { StreetSurface } from './Surface.js';
import { StreetGround, streetTerrain } from './Ground.js';
import { StreetStores, signAtlasImage } from './Stores.js';
import { patchBuildingFacades } from './Facades.js';
import { StreetProps } from './Props.js';

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
	// the walker stands on the street surface (sidewalks a curb above the road), from the drawn triangles
	const hf = app.terrainData;
	street.ground = new StreetGround( data, hf.origin + hf.texel / 2 );
	app.player.terrain = streetTerrain( app.player.terrain, street.ground );
	street.update = ( a ) => {

		street.surface.update( a.camera );
		street.stores.update( a.camera );
		street.props.update( a.camera );

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
