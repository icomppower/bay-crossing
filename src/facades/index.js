// Run 3 facade pass (SPEC "Run 3 — Facades"): attaches to a running App after the street layer's storefronts are
// loaded. Buildings keep their run-1 geometry exactly (F1): this adds per-vertex facade attributes and the SF colour
// to every building tile LOD, swaps in the facade material, and adds the near-band detail layer.
// ?facades=0 leaves the run-2 look (for before / after shots).
import { BufferAttribute } from 'harbor-engine/src/engine/index.js';
import { buildingsOfTile, prepare, facadeAttributes, streetFacingFrom, details, tileInstances, ARCH, DETAIL_TYPES } from './model.js';
import { facadeMaterial } from './material.js';
import { FacadeDetail } from './Detail.js';

// the tile mesh's arrays as the model reads them (colour back to the GLB's sRGB bytes; a = class byte)
function arraysOf( mesh ) {

	const g = mesh.geometry;
	const c = g.getAttribute( 'color' ).array, col = new Uint8Array( c.length );
	for ( let k = 0; k < c.length; k ++ ) col[ k ] = k % 4 === 3 ? Math.round( c[ k ] * 255 ) : Math.round( Math.pow( c[ k ], 1 / 2.2 ) * 255 );
	return { pos: g.getAttribute( 'position' ).array, nrm: g.getAttribute( 'normal' ).array, uv: g.getAttribute( 'uv' ).array, col, t: [ mesh.position.x, mesh.position.z ] };

}

export function buildFacades( app, modules ) {

	const tiles = app.buildings.children.filter( ( t ) => t.userData.lods );
	// LOD0 of every tile, prepared together (the same as pipelines/facades/tiles.mjs readAll, so gates and browser agree)
	const all = [];
	for ( const tile of tiles ) {

		const a = arraysOf( tile.userData.lods[ 0 ] );
		tile.userData.facade = [ { a, buildings: buildingsOfTile( a.pos, a.nrm, a.uv, a.col, a.t ) } ];
		for ( const b of tile.userData.facade[ 0 ].buildings ) all.push( b );

	}

	const log = prepare( all );
	const sf = streetFacingFrom( modules );
	for ( const tile of tiles ) {

		const lods = tile.userData.lods, l0 = tile.userData.facade[ 0 ];
		for ( let lod = 0; lod < lods.length; lod ++ ) {

			let entry = l0;
			if ( lod > 0 ) {

				// simplified LODs: each building takes the archetype / seed / colour of the nearest LOD0 building
				const a = arraysOf( lods[ lod ] );
				const bs = buildingsOfTile( a.pos, a.nrm, a.uv, a.col, a.t );
				for ( const b of bs ) {

					let best = null, bd = Infinity;
					for ( const r of l0.buildings ) { if ( r.cls !== b.cls ) continue; const d = Math.hypot( r.cx - b.cx, r.cz - b.cz ); if ( d < bd ) { bd = d; best = r; } }
					best = best || l0.buildings[ 0 ];
					Object.assign( b, { arch: best.arch, seed: best.seed, colour: best.colour, district: best.district } );

				}

				entry = { a, buildings: bs };
				tile.userData.facade[ lod ] = entry;

			}

			const g = lods[ lod ].geometry, nv = entry.a.pos.length / 3;
			const { aWall, aStyle } = facadeAttributes( entry.buildings, nv, sf );
			g.setAttribute( 'aWall', new BufferAttribute( aWall, 4 ) );
			g.setAttribute( 'aStyle', new BufferAttribute( aStyle, 4 ) );
			// wall colour → the building's SF colour (linear); roofs keep theirs
			const c = g.getAttribute( 'color' ).array.slice();
			for ( const b of entry.buildings ) {

				const lin = b.colour.map( ( v ) => Math.pow( v / 255, 2.2 ) );
				for ( const w of b.walls ) for ( let k = 0; k < 4; k ++ ) { const o = ( w.v + k ) * 4; c[ o ] = lin[ 0 ]; c[ o + 1 ] = lin[ 1 ]; c[ o + 2 ] = lin[ 2 ]; }

			}

			g.setAttribute( 'color', new BufferAttribute( c, 4 ) );

		}

	}

	return { buildings: all, log };

}

export async function attachFacades( app, { modules, street = null } = {} ) {

	const qs = app.qs || new URLSearchParams();
	if ( qs.get( 'facades' ) === '0' ) return null;
	const { buildings, log } = buildFacades( app, modules );
	const material = facadeMaterial();
	for ( const tile of app.buildings.children ) if ( tile.userData.lods ) for ( const m of tile.userData.lods ) m.material = material;
	const { out, log: dlog } = details( buildings );
	const tiled = Object.fromEntries( DETAIL_TYPES.map( ( t ) => [ t, tileInstances( out[ t ] ) ] ) );
	const mobile = app.quality && app.quality.name === 'mobile';
	const detail = new FacadeDetail( tiled, { radius: mobile ? 60 : 150 } );
	for ( const m of detail.meshes ) app.scene.add( m );
	// the run-2 street props' bay windows and fire escapes are replaced by the facade layer's own
	if ( street && street.props ) for ( const t of [ 'fireEscape', 'bayWindow' ] ) if ( street.props.layers[ t ] ) street.props.layers[ t ].radiusScale = 0;
	const facades = { material, detail, buildings, log, detailLog: dlog, archetypes: ARCH, update: ( camera ) => detail.update( camera ) };
	app.facades = facades;
	return facades;

}
