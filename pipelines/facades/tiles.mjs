// Node reader for the shipped building tiles (public/buildings/), the same arrays the browser loader builds, plus the
// facade model run over all of them. Used by the facade gates (G15–G19, G18b) and pipelines/facades/report.mjs.
import { readFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
import { join } from 'node:path';
import { parseGLB } from 'harbor-engine/src/engine/loaders/GLTF.js';
import { buildingsOfTile, prepare } from '../../src/facades/model.js';

export function readTileArrays( dir, name ) {

	const raw = inflateSync( readFileSync( join( dir, name ) ) );
	const glb = parseGLB( raw.buffer.slice( raw.byteOffset, raw.byteOffset + raw.byteLength ) );
	const node = glb.nodes[ glb.roots ? glb.roots[ 0 ] : 0 ];
	const p = glb.meshes[ node.mesh ][ 0 ];
	return { name, t: [ node.t[ 0 ], node.t[ 2 ] ], pos: p.attributes.POSITION.array, nrm: p.attributes.NORMAL.array, uv: p.attributes.TEXCOORD_0.array, col: p.attributes.COLOR_0.array, indices: p.indices };

}

// every LOD0 tile → buildings, classified and coloured as the browser does (all tiles at once: the Victorian colour
// rule looks across tile borders the same way in both, because the browser also prepares all LOD0 tiles together)
export function readAll( dir ) {

	const index = JSON.parse( readFileSync( join( dir, 'index.json' ), 'utf8' ) );
	const tiles = index.files.map( ( f ) => ( { f, lod0: readTileArrays( dir, f.name ) } ) );
	const buildings = [];
	for ( const t of tiles ) { t.buildings = buildingsOfTile( t.lod0.pos, t.lod0.nrm, t.lod0.uv, t.lod0.col, t.lod0.t ); for ( const b of t.buildings ) { b.tile = t.f.name; buildings.push( b ); } }
	const log = prepare( buildings );
	return { index, tiles, buildings, log };

}
