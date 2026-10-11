// G16 Classification (run 3, D79): every building in the slice carries one of the eight SF archetypes; the share
// classified by height / size rules alone (no district box) stays at or under the calibrated value; the whole model
// (archetypes, colours, seeds, per-vertex facade attributes, detail instances) is identical across two runs.
// --negative: an unclassified building, and a non-deterministic rerun (a random seed), must each be caught.
import { readThresholds, freeze } from 'harbor-engine/gates/lib/thresholds.mjs';
import { facadeModel, digest, negativeSummary } from './lib/facades.mjs';
import { ARCH } from '../src/facades/model.js';

const NEG = process.argv.includes( '--negative' );

function check( a, b ) {

	const fails = [];
	for ( const x of a.buildings ) if ( ! ( x.arch >= 0 && x.arch < ARCH.length ) || ! Number.isInteger( x.arch ) ) { fails.push( `building ${ x.id } at ${ x.cx.toFixed( 0 ) }, ${ x.cz.toFixed( 0 ) } has no archetype` ); break; }
	const share = a.log.fallback / a.log.total;
	const cap = readThresholds()[ 'G16.ruleOnlyShare' ] ?? freeze( 'G16.ruleOnlyShare', Math.min( 0.75, Math.ceil( ( share + 0.02 ) * 100 ) / 100 ), `share of buildings classified by height / size rules alone (outside every district box, D79); measured ${ ( share * 100 ).toFixed( 1 ) } % on ${ new Date().toISOString().slice( 0, 10 ) }; cap = measured + 2 points` );
	if ( share > cap ) fails.push( `${ ( share * 100 ).toFixed( 1 ) } % classified by rules alone (cap ${ cap * 100 } %)` );
	const da = digest( a ), db = digest( b );
	if ( da !== db ) fails.push( `facade model differs between two runs (${ da.slice( 0, 12 ) } vs ${ db.slice( 0, 12 ) })` );
	return { fails, share };

}

const a = facadeModel(), b = facadeModel();
if ( NEG ) {

	let caught = 0;
	const c = facadeModel(); c.buildings[ 123 ].arch = undefined;
	const f1 = check( c, b ).fails; console.log( 'unclassified:', f1[ 0 ] || 'NOT CAUGHT' ); if ( f1.length ) caught ++;
	const d = facadeModel(); d.buildings[ 7 ].seed = Math.random();
	const f2 = check( a, d ).fails; console.log( 'random seed:', f2[ 0 ] || 'NOT CAUGHT' ); if ( f2.length ) caught ++;
	negativeSummary( caught, 2 );

}

const { fails, share } = check( a, b );
console.log( 'archetypes:', JSON.stringify( a.log.byArch ) );
for ( const f of fails ) console.log( 'FAIL ' + f );
console.log( fails.length ? 'G16 FAIL' : `G16 PASS — ${ a.log.total } buildings, 8 archetypes, ${ ( share * 100 ).toFixed( 1 ) } % by rules alone; model identical across two runs` );
process.exit( fails.length ? 1 : 0 );
