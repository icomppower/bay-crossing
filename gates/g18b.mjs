// G18b SF look, no Hong Kong drift (run 3, D90, D91): outside Chinatown the facade layer draws none of the HK-only
// elements (window AC boxes, laundry poles, window grilles, projecting / stacked neon, rooftop billboard frames) —
// the detail model may only emit the SF types; every Victorian lot on a street face (one per 7.6 m) has a stacked bay
// window; two Victorians sharing a wall never share a paint colour; and the building tops are the run-2 tops.
// --negative: an AC box on a Telegraph Hill building, a Victorian lot without its bay, two adjacent Victorians in the
// same colour, and a building raised 1 m must each be caught.
import { facadeModel, negativeSummary } from './lib/facades.mjs';
import { A, DETAIL_TYPES, neighbours, districtAt, inDistrict, floorsOf } from '../src/facades/model.js';
import { toLocal } from '../src/facades/geo.js';
import { readAll } from '../pipelines/facades/tiles.mjs';
import { join } from 'node:path';
import { root } from './lib/facades.mjs';

const NEG = process.argv.includes( '--negative' );
const SF_TYPES = new Set( [ 'cornice', 'parapet', 'bay', 'fireEscape', 'roofBox', 'tank', 'balcony', 'gable' ] );
const HK_ONLY = /^(ac|acBox|airCon|laundry|grille|neon|billboard)/i;
const tops = new Map( readAll( join( root, 'public/buildings' ) ).buildings.map( ( b ) => [ b.id, b.top ] ) );

function check( model ) {

	const fails = [];
	for ( const [ type, list ] of Object.entries( model.detail ) ) {

		if ( ! list.length ) continue;
		if ( ! SF_TYPES.has( type ) || HK_ONLY.test( type ) ) { const r = list[ 0 ]; if ( districtAt( r[ 0 ], r[ 2 ] ) !== 'chinatown' ) fails.push( `${ list.length } "${ type }" instances outside Chinatown (first at ${ r[ 0 ].toFixed( 0 ) }, ${ r[ 2 ].toFixed( 0 ) })` ); }
		if ( type === 'balcony' ) {

			// judged by the balcony's midpoint (its origin is the wall end, which may lie past the box edge)
			const bad = list.filter( ( r ) => ! inDistrict( 'chinatown', r[ 0 ] + Math.cos( r[ 3 ] ) * r[ 4 ] / 2, r[ 2 ] + Math.sin( r[ 3 ] ) * r[ 4 ] / 2, 1 ) );
			if ( bad.length ) fails.push( `${ bad.length } balconies outside Chinatown` );

		}

	}

	// every Victorian lot on a street face has a bay (lots: round( len / 7.6 ) per face ≥ 4 m, as D90)
	const bays = model.detail.bay;
	const byCell = new Map();
	for ( const r of bays ) { const k = Math.floor( r[ 0 ] / 20 ) + ',' + Math.floor( r[ 2 ] / 20 ); if ( ! byCell.has( k ) ) byCell.set( k, [] ); byCell.get( k ).push( r ); }
	let lots = 0, missing = 0, firstMissing = null;
	for ( const b of model.buildings ) {

		if ( b.arch !== A.victorian ) continue;
		for ( const w of b.walls ) {

			if ( ! w.sf || w.len < 4 ) continue;
			if ( floorsOf( b.arch, b.h ).floors < 2 ) continue; // a one-storey cottage: no upper floor to bay
			const n = Math.max( 1, Math.round( w.len / 7.6 ) );
			const dx = ( w.bx - w.ax ) / w.len, dz = ( w.bz - w.az ) / w.len;
			const on = [];
			for ( let x = Math.floor( ( Math.min( w.ax, w.bx ) - 1 ) / 20 ); x <= Math.floor( ( Math.max( w.ax, w.bx ) + 1 ) / 20 ); x ++ ) for ( let z = Math.floor( ( Math.min( w.az, w.bz ) - 1 ) / 20 ); z <= Math.floor( ( Math.max( w.az, w.bz ) + 1 ) / 20 ); z ++ ) for ( const r of byCell.get( x + ',' + z ) || [] ) {

				if ( Math.abs( ( r[ 0 ] - w.ax ) * dz - ( r[ 2 ] - w.az ) * dx ) > 0.05 ) continue;
				const s = ( r[ 0 ] - w.ax ) * dx + ( r[ 2 ] - w.az ) * dz;
				if ( s > - 0.1 && s < w.len + 0.1 ) on.push( r );

			}

			lots += n;
			if ( on.length < n ) { missing += n - on.length; firstMissing = firstMissing || `${ w.ax.toFixed( 1 ) }, ${ w.az.toFixed( 1 ) }`; }

		}

	}

	if ( missing ) fails.push( `${ missing } of ${ lots } Victorian lots without a bay window (first at ${ firstMissing })` );
	// adjacent Victorians never share a colour
	const grid = new Map(), cell = 30, gk = ( x, z ) => Math.floor( x / cell ) * 100003 + Math.floor( z / cell );
	for ( const b of model.buildings ) { const k = gk( b.cx, b.cz ); if ( ! grid.has( k ) ) grid.set( k, [] ); grid.get( k ).push( b ); }
	let same = 0, pairs = 0, firstSame = null;
	for ( const b of model.buildings ) {

		if ( b.arch !== A.victorian ) continue;
		for ( const n of neighbours( b, grid, gk, cell ) ) {

			if ( n.arch !== A.victorian || n.id < b.id ) continue;
			pairs ++;
			if ( n.colour.join() === b.colour.join() ) { same ++; firstSame = firstSame || `${ b.cx.toFixed( 0 ) }, ${ b.cz.toFixed( 0 ) }`; }

		}

	}

	if ( same ) fails.push( `${ same } of ${ pairs } adjacent Victorian pairs share a paint colour (first at ${ firstSame })` );
	let moved = 0;
	for ( const b of model.buildings ) if ( Math.abs( ( tops.get( b.id ) ?? NaN ) - b.top ) > 1e-4 ) moved ++;
	if ( moved ) fails.push( `${ moved } building tops differ from run 2` );
	return { fails, lots, pairs };

}

if ( NEG ) {

	let caught = 0;
	const tel = toLocal( 37.80060, - 122.40500 );
	const cases = [
		[ 'AC box on Telegraph Hill', ( m ) => { m.detail.acBox = [ [ tel[ 0 ], 20, tel[ 1 ], 0, 0.7, 0.5, 0.5, 0 ] ]; } ],
		[ 'Victorian lot without its bay', ( m ) => { m.detail.bay.splice( 100, 1 ); } ],
		[ 'adjacent Victorians in one colour', ( m ) => {

			const grid = new Map(), cell = 30, gk = ( x, z ) => Math.floor( x / cell ) * 100003 + Math.floor( z / cell );
			for ( const b of m.buildings ) { const k = gk( b.cx, b.cz ); if ( ! grid.has( k ) ) grid.set( k, [] ); grid.get( k ).push( b ); }
			for ( const b of m.buildings ) if ( b.arch === A.victorian ) { const n = neighbours( b, grid, gk, cell ).find( ( q ) => q.arch === A.victorian ); if ( n ) { n.colour = b.colour; return; } }

		} ],
		[ 'building raised 1 m', ( m ) => { m.buildings[ 42 ].top += 1; } ],
	];
	for ( const [ label, sabotage ] of cases ) {

		const m = facadeModel(); sabotage( m );
		const f = check( m ).fails;
		console.log( label + ':', f[ 0 ] || 'NOT CAUGHT' );
		if ( f.length ) caught ++;

	}

	negativeSummary( caught, cases.length );

}

const { fails, lots, pairs } = check( facadeModel() );
for ( const f of fails ) console.log( 'FAIL ' + f );
console.log( fails.length ? 'G18b FAIL' : `G18b PASS — detail types ${ DETAIL_TYPES.join( ', ' ) } (no HK-only types; balconies only in Chinatown); ${ lots } Victorian lots all with bays; ${ pairs } adjacent Victorian pairs, none sharing a colour; tops = run 2` );
process.exit( fails.length ? 1 : 0 );
