// G3 control points: where the shipped scene puts a feature vs. where an independent source puts it.
// Scene side reads shipped artifacts (public/landmarks, public/buildings, public/ferry); references come from
// NOAA ENC (charted landmarks) and OSM (piers, the Sausalito terminal). Both converted by tools/geo/utm.mjs.
import { readFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
import { join } from 'node:path';
import { root, decodeTerrain } from './tiles.mjs';
import { parseGLB } from '../../src/engine/loaders/GLTF.js';
import { toUTM } from '../../tools/geo/utm.mjs';

const local = ( lat, lon ) => { const [ E, N ] = toUTM( lat, lon ); return [ E - 549504, 4186800 - N ]; };
const mean = ( pts ) => [ pts.reduce( ( s, p ) => s + p[ 0 ], 0 ) / pts.length, pts.reduce( ( s, p ) => s + p[ 1 ], 0 ) / pts.length ];

// every vertex of a landmark LOD0 GLB in world space: [ x, y, z, materialName ]
function landmarkVerts( dir, slug ) {

	const buf = readFileSync( join( dir, `${ slug }_lod0.glb` ) );
	const g = parseGLB( buf.buffer.slice( buf.byteOffset, buf.byteOffset + buf.length ) );
	const out = [];
	for ( const n of g.nodes ) if ( n.mesh !== undefined ) for ( const p of g.meshes[ n.mesh ] ) {

		const P = p.attributes.POSITION.array, m = g.materials[ p.material ]?.name || '';
		for ( let v = 0; v < P.length; v += 3 ) out.push( [ P[ v ] + n.t[ 0 ], P[ v + 1 ] + n.t[ 1 ], P[ v + 2 ] + n.t[ 2 ], m ] );

	}

	return out;

}

export function sceneControls( { landmarks = join( root, 'public/landmarks' ), buildings = join( root, 'public/buildings' ), ferry = join( root, 'public/ferry/schedule.json' ) } = {} ) {

	const raw = join( root, 'data/raw' ); // references and the pier frame always come from the canonical cache

	const idx = JSON.parse( readFileSync( join( landmarks, 'index.json' ), 'utf8' ) );
	const L = ( slug ) => idx.landmarks.find( ( l ) => l.slug === slug );
	const xz = ( vs ) => vs.length ? mean( vs.map( ( v ) => [ v[ 0 ], v[ 2 ] ] ) ) : [ NaN, NaN ];
	const out = {};
	out[ 'Ferry Building clock tower' ] = xz( landmarkVerts( landmarks, 'ferry-building' ).filter( ( v ) => v[ 1 ] > 40 && v[ 1 ] < 75 ) );
	out[ 'Coit Tower' ] = xz( landmarkVerts( landmarks, 'coit-tower' ).filter( ( v ) => v[ 1 ] > L( 'coit-tower' ).ground + 30 ) );
	out[ 'Transamerica Pyramid' ] = xz( landmarkVerts( landmarks, 'transamerica-pyramid' ).filter( ( v ) => v[ 1 ] > 150 ) );
	const gg = landmarkVerts( landmarks, 'golden-gate-bridge' ).filter( ( v ) => v[ 1 ] > 223 ), a = L( 'golden-gate-bridge' ).anchor;
	out[ 'Golden Gate south tower' ] = xz( gg.filter( ( v ) => v[ 2 ] > a[ 1 ] ) );
	out[ 'Golden Gate north tower' ] = xz( gg.filter( ( v ) => v[ 2 ] < a[ 1 ] ) );
	out[ 'Alcatraz Light' ] = xz( landmarkVerts( landmarks, 'alcatraz' ).filter( ( v ) => v[ 3 ] === 'dark' ) );
	const f = JSON.parse( readFileSync( ferry, 'utf8' ) );
	out[ 'Sausalito ferry landing' ] = [ f.terminals.sausalito[ 0 ].x, f.terminals.sausalito[ 0 ].z ];

	// Pier 1: the bayward end and the lateral centre of the DataSF shed (roofs in the shipped building tiles),
	// measured along the OSM pier's long axis
	const osm = JSON.parse( readFileSync( join( raw, 'landmarks-osm.json' ), 'utf8' ) ).elements;
	const pier = osm.find( ( e ) => e.type === 'way' && e.tags?.name === 'Pier 1' ).geometry.map( ( g ) => local( g.lat, g.lon ) );
	const bi = JSON.parse( readFileSync( join( buildings, 'index.json' ), 'utf8' ) );
	const c = mean( pier );
	const roofs = [];
	for ( const t of bi.files ) {

		const G = parseGLB( inflateSync( readFileSync( join( buildings, t.name ) ) ).buffer.slice( 0 ) ), n = G.nodes[ 0 ], p = G.meshes[ n.mesh ][ 0 ];
		const P = p.attributes.POSITION.array, N = p.attributes.NORMAL.array;
		for ( let v = 0; v < P.length; v += 3 ) if ( N[ v + 1 ] > 0.5 ) roofs.push( [ P[ v ] + n.t[ 0 ], P[ v + 2 ] + n.t[ 2 ] ] );

	}

	out.pierFrame = pierFrame( pier );
	out.pierRoofs = roofs.filter( ( [ x, z ] ) => Math.hypot( x - c[ 0 ], z - c[ 1 ] ) < 200 );
	return out;

}

// the long axis of a pier outline, oriented bayward (toward deeper water in the shipped terrain)
function pierFrame( pts ) {

	const c = mean( pts );
	let sxx = 0, szz = 0, sxz = 0;
	for ( const [ x, z ] of pts ) { sxx += ( x - c[ 0 ] ) ** 2; szz += ( z - c[ 1 ] ) ** 2; sxz += ( x - c[ 0 ] ) * ( z - c[ 1 ] ); }
	const ang = 0.5 * Math.atan2( 2 * sxz, sxx - szz );
	let u = [ Math.cos( ang ), Math.sin( ang ) ];
	const T = decodeTerrain( join( root, 'public/terrain' ) );
	const h = ( x, z ) => T.h[ Math.floor( ( z + 4800 ) / 3 ) * 3200 + Math.floor( ( x + 4800 ) / 3 ) ];
	if ( h( c[ 0 ] + u[ 0 ] * 150, c[ 1 ] + u[ 1 ] * 150 ) > h( c[ 0 ] - u[ 0 ] * 150, c[ 1 ] - u[ 1 ] * 150 ) ) u = [ - u[ 0 ], - u[ 1 ] ];
	return { c, u, v: [ - u[ 1 ], u[ 0 ] ] };

}

// the pier's bayward end + lateral centre from a set of points in the pier frame
export function pierEnd( pts, F, polygon = null ) {

	const inPoly = ( x, z ) => { let r = false; for ( let i = 0, j = polygon.length - 1; i < polygon.length; j = i ++ ) { const [ xi, zi ] = polygon[ i ], [ xj, zj ] = polygon[ j ]; if ( ( zi > z ) !== ( zj > z ) && x < ( xj - xi ) * ( z - zi ) / ( zj - zi ) + xi ) r = ! r; } return r; };
	const sel = polygon ? pts.filter( ( [ x, z ] ) => inPoly( x, z ) ) : pts;
	if ( ! sel.length ) return null;
	const a = sel.map( ( [ x, z ] ) => ( x - F.c[ 0 ] ) * F.u[ 0 ] + ( z - F.c[ 1 ] ) * F.u[ 1 ] );
	const l = sel.map( ( [ x, z ] ) => ( x - F.c[ 0 ] ) * F.v[ 0 ] + ( z - F.c[ 1 ] ) * F.v[ 1 ] );
	return { end: Math.max( ...a ), lateral: ( Math.max( ...l ) + Math.min( ...l ) ) / 2 };

}

export function referenceControls( raw = join( root, 'data/raw' ) ) {

	const enc = JSON.parse( readFileSync( join( raw, 'noaa-enc-landmarks.json' ), 'utf8' ) ).features.map( ( f ) => f.attributes && { a: f.attributes, g: f.geometry } );
	const pt = ( pred ) => { const f = enc.find( ( e ) => pred( e.a ) ); return f ? local( f.g.y, f.g.x ) : null; };
	const pyl = JSON.parse( readFileSync( join( raw, 'noaa-enc-pylons.json' ), 'utf8' ) ).features.find( ( f ) => f.attributes.OBJNAM === 'Golden Gate Bridge South Pier' );
	const osm = JSON.parse( readFileSync( join( raw, 'landmarks-osm.json' ), 'utf8' ) ).elements;
	const term = osm.find( ( e ) => e.tags?.name === 'Sausalito Ferry Terminal' );
	return {
		'Ferry Building clock tower': [ 'NOAA ENC "FERRY TOWER"', pt( ( a ) => /FERRY TOWER/i.test( a.INFORM || '' ) ) ],
		'Coit Tower': [ 'NOAA ENC "Coit Tower"', pt( ( a ) => /COIT/i.test( ( a.OBJNAM || '' ) + ( a.INFORM || '' ) ) ) ],
		'Transamerica Pyramid': [ 'NOAA ENC "Pyramidal building"', pt( ( a ) => /PYRAMIDAL/i.test( a.INFORM || '' ) ) ],
		'Golden Gate south tower': [ 'NOAA ENC "Golden Gate Bridge South Pier" (centroid)', pyl ? mean( pyl.geometry.rings[ 0 ].slice( 0, - 1 ).map( ( [ lon, lat ] ) => local( lat, lon ) ) ) : null ],
		'Golden Gate north tower': [ 'NOAA ENC "Golden Gate Bridge North Light"', pt( ( a ) => a.OBJNAM === 'Golden Gate Bridge North Light' ) ],
		'Alcatraz Light': [ 'NOAA ENC "Alcatraz Light"', pt( ( a ) => a.OBJNAM === 'Alcatraz Light' ) ],
		'Sausalito ferry landing': [ 'OSM "Sausalito Ferry Terminal"', term ? local( term.lat, term.lon ) : null ],
		pier1: osm.find( ( e ) => e.type === 'way' && e.tags?.name === 'Pier 1' ).geometry.map( ( g ) => local( g.lat, g.lon ) ),
	};

}

// Gated control points. Advisory (reported, not gated): the Golden Gate north tower (the charted "North Light"
// is a navigation light, not the tower centre) and Alcatraz Light (OSM and the chart disagree by ~14 m; no
// third source covers Alcatraz). Pier ends: only piers whose OSM outline is the shed itself (building=*),
// so both datasets map the same structure: Pier 1.
export const GATED = [ 'Ferry Building clock tower', 'Coit Tower', 'Transamerica Pyramid', 'Golden Gate south tower', 'Sausalito ferry landing', 'Pier 1 end' ];

// all control-point errors (m)
export function controlErrors( opts = {} ) {

	const S = sceneControls( opts ), R = referenceControls();
	const rows = [];
	for ( const name of Object.keys( R ) ) {

		if ( name === 'pier1' ) continue;
		const [ ref, p ] = R[ name ], s = S[ name ];
		rows.push( { name, ref, gated: GATED.includes( name ), error: p && s && Number.isFinite( s[ 0 ] ) ? Math.hypot( s[ 0 ] - p[ 0 ], s[ 1 ] - p[ 1 ] ) : Infinity } );

	}

	// Pier 1 end: scene roofs (DataSF shed) vs the OSM outline, both measured in the OSM pier frame; scene roofs
	// are picked inside the OSM outline grown by 25 m
	const F = S.pierFrame, poly = R.pier1;
	const grown = poly.map( ( [ x, z ] ) => { const dx = x - F.c[ 0 ], dz = z - F.c[ 1 ], d = Math.hypot( dx, dz ) || 1; return [ x + dx / d * 25, z + dz / d * 25 ]; } );
	const sc = pierEnd( S.pierRoofs, F, grown ), rf = pierEnd( poly, F );
	rows.push( { name: 'Pier 1 end', gated: true, ref: 'OSM "Pier 1" outline (bayward end)', error: sc && rf ? Math.hypot( sc.end - rf.end, sc.lateral - rf.lateral ) : Infinity } );
	return rows;

}
