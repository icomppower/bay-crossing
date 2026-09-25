import { HeightField } from './HeightField.js';

// Loads the bay terrain tiles (public/terrain/, built by tools/terrain/build.mjs) into a HeightField:
// Int16 centimetres above local MSL, zlib-deflated, 200 x 200 samples per tile, row 0 = north.
export async function loadBayHeightField( base = ( import.meta.env && import.meta.env.BASE_URL ) || '/' ) {

	const index = await ( await fetch( base + 'terrain/index.json' ) ).json();
	const { res, tile, size } = index;
	const heights = new Float32Array( res * res );
	await Promise.all( index.files.map( async ( f ) => {

		const r = await fetch( base + 'terrain/' + f.name );
		if ( ! r.ok ) throw new Error( `terrain: ${ f.name } HTTP ${ r.status }` );
		const raw = await new Response( r.body.pipeThrough( new DecompressionStream( 'deflate' ) ) ).arrayBuffer();
		const dv = new DataView( raw );
		for ( let y = 0; y < tile; y ++ ) {

			const row = ( f.j * tile + y ) * res + f.i * tile;
			for ( let x = 0; x < tile; x ++ ) heights[ row + x ] = dv.getInt16( ( y * tile + x ) * 2, true ) / 100;

		}

	} ) );
	const hf = new HeightField( { size, res, heights } );
	hf.index = index;
	// ground colour map (NAIP, D39): RGB8 → RGBA8 for the GPU
	if ( index.aerial ) {

		const r = await fetch( base + 'terrain/' + index.aerial.file );
		if ( ! r.ok ) throw new Error( `terrain: ${ index.aerial.file } HTTP ${ r.status }` );
		const rgb = new Uint8Array( await new Response( r.body.pipeThrough( new DecompressionStream( 'deflate' ) ) ).arrayBuffer() );
		const { width, height } = index.aerial, rgba = new Uint8Array( width * height * 4 );
		for ( let k = 0, n = width * height; k < n; k ++ ) { rgba[ k * 4 ] = rgb[ k * 3 ]; rgba[ k * 4 + 1 ] = rgb[ k * 3 + 1 ]; rgba[ k * 4 + 2 ] = rgb[ k * 3 + 2 ]; rgba[ k * 4 + 3 ] = 255; }
		hf.aerial = { width, height, data: rgba };

	}

	return hf;

}
