// G21 Facade look (advisory, run 3): fixed-seed headless shots for human review in shots/facades/ — Ferry Building
// plaza, Embarcadero at Pier 7, Jackson Square, Telegraph Hill and Sausalito's Bridgeway at midday, golden hour and
// night (gates/lib/facade-shots.mjs; crowd off), plus the run-2 "before" set (?facades=0). Checked: no shot is
// blank, night is darker than midday, and every "after" differs visibly from its "before".
// --negative: a night shot that is really the midday one, and an "after" that is really its "before", must each be
// caught. (Reuses the shots of the last real run; renders them first if there are none.)
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, copyFileSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readPNG } from 'harbor-engine/gates/lib/png.mjs';
import { root } from './lib/facades.mjs';
import { VIEWS, TIMES } from './lib/facade-shots-views.mjs';

const NEG = process.argv.includes( '--negative' );
const OUT = join( root, 'shots/facades' );
const shoot = ( args ) => {

	const r = spawnSync( process.execPath, [ join( root, 'gates/lib/facade-shots.mjs' ), OUT, ...args ], { cwd: root, encoding: 'utf8', maxBuffer: 1 << 26 } );
	if ( r.status !== 0 ) throw new Error( 'shots crashed: ' + ( r.stderr || '' ).slice( - 1500 ) );
	return JSON.parse( readFileSync( join( OUT, args.includes( '--before' ) ? 'before.json' : 'after.json' ), 'utf8' ) );

};
const lum = ( file ) => { const { width, height, data } = readPNG( file ); let s = 0, s2 = 0; const n = width * height; for ( let i = 0; i < n; i ++ ) { const l = 0.2126 * data[ i * 4 ] + 0.7152 * data[ i * 4 + 1 ] + 0.0722 * data[ i * 4 + 2 ]; s += l; s2 += l * l; } const m = s / n; return { mean: m, std: Math.sqrt( s2 / n - m * m ), data, n }; };
const diff = ( a, b ) => { let s = 0; for ( let i = 0; i < a.n; i ++ ) s += Math.abs( a.data[ i * 4 ] - b.data[ i * 4 ] ) + Math.abs( a.data[ i * 4 + 1 ] - b.data[ i * 4 + 1 ] ) + Math.abs( a.data[ i * 4 + 2 ] - b.data[ i * 4 + 2 ] ); return s / a.n / 3; };

function judge( dir ) {

	const fail = [], rows = [];
	for ( const [ name ] of VIEWS ) {

		const L = Object.fromEntries( Object.keys( TIMES ).map( ( t ) => [ t, lum( join( dir, `${ name }-${ t }.png` ) ) ] ) );
		for ( const [ t, l ] of Object.entries( L ) ) if ( l.std < 6 ) fail.push( `blank: ${ name } ${ t }` );
		if ( ! ( L.night.mean < 0.6 * L.midday.mean ) ) fail.push( `night: ${ name } night (mean ${ L.night.mean.toFixed( 0 ) }) is not darker than midday (${ L.midday.mean.toFixed( 0 ) })` );
		for ( const t of Object.keys( TIMES ) ) {

			const d = diff( L[ t ], lum( join( dir, `before-${ name }-${ t }.png` ) ) );
			rows.push( `${ name } ${ t }: mean ${ L[ t ].mean.toFixed( 0 ) }, before/after difference ${ d.toFixed( 1 ) }` );
			if ( ! ( d > 3 ) ) fail.push( `facades: ${ name } ${ t } looks the same as run 2 (difference ${ d.toFixed( 1 ) })` );

		}

	}

	return { fail, rows };

}

mkdirSync( OUT, { recursive: true } );
const have = () => VIEWS.every( ( [ n ] ) => Object.keys( TIMES ).every( ( t ) => existsSync( join( OUT, `${ n }-${ t }.png` ) ) && existsSync( join( OUT, `before-${ n }-${ t }.png` ) ) ) );
if ( NEG ) {

	if ( ! have() ) { shoot( [] ); shoot( [ '--before' ] ); }
	let caught = 0;
	const [ n ] = VIEWS[ 0 ];
	const t1 = mkdtempSync( join( tmpdir(), 'g21-' ) );
	for ( const [ m ] of VIEWS ) for ( const t of Object.keys( TIMES ) ) for ( const p of [ '', 'before-' ] ) copyFileSync( join( OUT, `${ p }${ m }-${ t }.png` ), join( t1, `${ p }${ m }-${ t }.png` ) );
	copyFileSync( join( OUT, `${ n }-midday.png` ), join( t1, `${ n }-night.png` ) );
	const f1 = judge( t1 ).fail.find( ( f ) => f.startsWith( 'night' ) ); console.log( 'night = midday:', f1 || 'NOT CAUGHT' ); if ( f1 ) caught ++;
	const t2 = mkdtempSync( join( tmpdir(), 'g21-' ) );
	for ( const [ m ] of VIEWS ) for ( const t of Object.keys( TIMES ) ) for ( const p of [ '', 'before-' ] ) copyFileSync( join( OUT, `${ p }${ m }-${ t }.png` ), join( t2, `${ p }${ m }-${ t }.png` ) );
	copyFileSync( join( OUT, `before-${ n }-midday.png` ), join( t2, `${ n }-midday.png` ) );
	const f2 = judge( t2 ).fail.find( ( f ) => f.startsWith( 'facades' ) ); console.log( 'after = before:', f2 || 'NOT CAUGHT' ); if ( f2 ) caught ++;
	console.log( `NEGATIVE ${ caught }/2` );
	process.exit( caught === 2 ? 1 : 0 );

}

const a = shoot( [] ), b = shoot( [ '--before' ] );
const j = judge( OUT );
console.log( j.rows.join( '\n' ) );
if ( a.errors.length || b.errors.length ) j.fail.push( `render: ${ a.errors.length + b.errors.length } console / GPU errors` );
if ( j.fail.length ) { console.log( 'G21 FAIL (advisory)\n- ' + j.fail.join( '\n- ' ) ); process.exit( 1 ); }
console.log( `G21 PASS (advisory) — ${ a.stats.length } facade shots and ${ b.stats.length } run-2 "before" shots in shots/facades/ for review` );
process.exit( 0 );
