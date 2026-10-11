// G18 Depth elements (run 3, D83, D86, D90): near-band detail where the street-level path runs (within 150 m of the
// Ferry Building → Pier 39 promenade, gates/lib/facades.mjs PATH) and over the whole slice:
//   - flat-roof buildings (all but Victorian / Sausalito) with a cornice or parapet: ≥ the calibrated share (floor 95 %)
//   - Victorian street faces (≥ 4 m) with a bay window: ≥ calibrated (floor 80 %)
//   - pre-war mid-rise / brick / Chinatown street faces (≥ 5 m, 9–32 m tall) with a fire escape: ≥ calibrated (60 %)
// Instances are matched to their wall by position (the instance origin lies on the wall line).
// --negative: cornices and parapets stripped, bay windows stripped, and fire escapes stripped must each be caught.
import { readThresholds, freeze } from 'harbor-engine/gates/lib/thresholds.mjs';
import { facadeModel, nearPath, negativeSummary } from './lib/facades.mjs';
import { A } from '../src/facades/model.js';

const NEG = process.argv.includes( '--negative' );

function onWall( list, b ) {

	// walls of b that carry an instance of `list` (origin within 5 cm of the wall line, inside its span)
	const hit = new Set();
	for ( const r of list ) for ( const w of b.walls ) {

		if ( w.len < 2 ) continue;
		const dx = ( w.bx - w.ax ) / w.len, dz = ( w.bz - w.az ) / w.len;
		if ( Math.abs( ( r[ 0 ] - w.ax ) * dz - ( r[ 2 ] - w.az ) * dx ) > 0.05 ) continue;
		const s = ( r[ 0 ] - w.ax ) * dx + ( r[ 2 ] - w.az ) * dz;
		if ( s > - 0.1 && s < w.len + 0.1 && r[ 1 ] >= b.base - 0.1 && r[ 1 ] <= b.top + 0.1 ) hit.add( w );

	}

	return hit;

}

function measure( model, near ) {

	// instances by 30 m cell for the wall matching
	const cells = new Map(), C = 30;
	for ( const [ type, list ] of Object.entries( model.detail ) ) for ( const r of list ) { const k = type + ':' + Math.floor( r[ 0 ] / C ) + ',' + Math.floor( r[ 2 ] / C ); if ( ! cells.has( k ) ) cells.set( k, [] ); cells.get( k ).push( r ); }
	const around = ( type, b ) => { const out = []; for ( let x = Math.floor( ( b.bbox[ 0 ] - 2 ) / C ); x <= Math.floor( ( b.bbox[ 2 ] + 2 ) / C ); x ++ ) for ( let z = Math.floor( ( b.bbox[ 1 ] - 2 ) / C ); z <= Math.floor( ( b.bbox[ 3 ] + 2 ) / C ); z ++ ) out.push( ...( cells.get( type + ':' + x + ',' + z ) || [] ) ); return out; };
	const m = { flat: [ 0, 0 ], vic: [ 0, 0 ], esc: [ 0, 0 ] };
	for ( const b of model.buildings ) {

		if ( near && ! nearPath( b ) ) continue;
		if ( b.arch !== A.victorian && b.arch !== A.sausalito && b.area > 60 ) {

			m.flat[ 1 ] ++;
			if ( onWall( [ ...around( 'cornice', b ), ...around( 'parapet', b ) ], b ).size ) m.flat[ 0 ] ++;

		}

		if ( b.arch === A.victorian ) {

			const faces = b.walls.filter( ( w ) => w.sf && w.len >= 4 );
			if ( faces.length ) { const hit = onWall( around( 'bay', b ), b ); for ( const w of faces ) { m.vic[ 1 ] ++; if ( hit.has( w ) ) m.vic[ 0 ] ++; } }

		}

		if ( ( b.arch === A.midrise || b.arch === A.warehouse || b.arch === A.chinatown ) && b.h >= 9 && b.h < 32 && b.district !== 'southBeach' ) {

			const faces = b.walls.filter( ( w ) => w.sf && w.len >= 5 );
			if ( faces.length ) { const hit = onWall( around( 'fireEscape', b ), b ); for ( const w of faces ) { m.esc[ 1 ] ++; if ( hit.has( w ) ) m.esc[ 0 ] ++; } }

		}

	}

	return m;

}

const share = ( [ a, b ] ) => b ? a / b : 1;
function check( model ) {

	const near = measure( model, true ), all = measure( model, false ), fails = [];
	const t = readThresholds(), day = new Date().toISOString().slice( 0, 10 );
	const cal = ( key, floor, v, what ) => t[ key ] ?? freeze( key, Math.max( floor, Math.floor( ( v - 0.02 ) * 100 ) / 100 ), `${ what }, within 150 m of the street path; measured ${ ( v * 100 ).toFixed( 1 ) } % on ${ day }; value = max( ${ floor }, measured − 2 points )` );
	const lim = {
		flat: NEG ? t[ 'G18.flatRoofTop' ] ?? 0.95 : cal( 'G18.flatRoofTop', 0.95, share( near.flat ), 'share of flat-roof buildings with a cornice or parapet' ),
		vic: NEG ? t[ 'G18.victorianBays' ] ?? 0.8 : cal( 'G18.victorianBays', 0.8, share( all.vic ), 'share of Victorian street faces ≥ 4 m with a bay window (whole slice: few Victorians face the promenade)' ),
		esc: NEG ? t[ 'G18.fireEscapes' ] ?? 0.6 : cal( 'G18.fireEscapes', 0.6, share( near.esc ), 'share of pre-war mid-rise / brick / Chinatown street faces ≥ 5 m with a fire escape' ),
	};
	if ( share( near.flat ) < lim.flat ) fails.push( `flat roofs with cornice / parapet near the path ${ ( share( near.flat ) * 100 ).toFixed( 1 ) } % < ${ lim.flat * 100 } %` );
	if ( share( all.vic ) < lim.vic ) fails.push( `Victorian street faces with bays ${ ( share( all.vic ) * 100 ).toFixed( 1 ) } % < ${ lim.vic * 100 } %` );
	if ( share( near.esc ) < lim.esc ) fails.push( `pre-war street faces with fire escapes near the path ${ ( share( near.esc ) * 100 ).toFixed( 1 ) } % < ${ lim.esc * 100 } %` );
	return { fails, near, all };

}

if ( NEG ) {

	let caught = 0;
	for ( const [ label, types ] of [ [ 'cornices + parapets stripped', [ 'cornice', 'parapet' ] ], [ 'bay windows stripped', [ 'bay' ] ], [ 'fire escapes stripped', [ 'fireEscape' ] ] ] ) {

		const m = facadeModel();
		for ( const ty of types ) m.detail[ ty ] = [];
		const f = check( m ).fails;
		console.log( label + ':', f[ 0 ] || 'NOT CAUGHT' );
		if ( f.length ) caught ++;

	}

	negativeSummary( caught, 3 );

}

const { fails, near, all } = check( facadeModel() );
const p = ( x ) => `${ x[ 0 ] }/${ x[ 1 ] } (${ ( share( x ) * 100 ).toFixed( 1 ) } %)`;
console.log( `near the path: flat roofs dressed ${ p( near.flat ) }, Victorian faces with bays ${ p( near.vic ) }, pre-war faces with fire escapes ${ p( near.esc ) }` );
console.log( `whole slice:   flat roofs dressed ${ p( all.flat ) }, Victorian faces with bays ${ p( all.vic ) }, pre-war faces with fire escapes ${ p( all.esc ) }` );
for ( const f of fails ) console.log( 'FAIL ' + f );
console.log( fails.length ? 'G18 FAIL' : 'G18 PASS' );
process.exit( fails.length ? 1 : 0 );
