// G19 Materials + windows (run 3, D84, D85): the facade materials are drawn by code — the facade sources load no
// texture and public/ holds no facade image files; at least four material families face the street-level path
// (siding, shingle, brick, ashlar stone, stucco, curtain wall: chosen per building as in src/facades/material.js);
// the share of lit windows at night, from the shader's own per-window hash (replicated here in f32), sits inside the
// F8 ranges: residential 30–50 %, office 20–70 %.
// --negative: an injected facade texture file, a facade source loading a texture, all buildings on the path in one
// material, and a lit share of 90 % must each be caught.
import { readdirSync, readFileSync, statSync, mkdtempSync, cpSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join, extname } from 'node:path';
import { tmpdir } from 'node:os';
import { facadeModel, nearPath, negativeSummary, root } from './lib/facades.mjs';
import { A, ARCH, baysOf, floorsOf } from '../src/facades/model.js';

const NEG = process.argv.includes( '--negative' );
const IMG = new Set( [ '.png', '.jpg', '.jpeg', '.webp', '.ktx2', '.hdr', '.exr', '.basis', '.avif' ] );

export function family( b ) {

	if ( b.arch === A.victorian ) return 'siding';
	if ( b.arch === A.sausalito ) return b.seed < 0.55 ? 'siding' : 'shingle';
	if ( b.arch === A.warehouse || ( b.arch === A.midrise && b.seed > 0.62 ) || ( b.arch === A.chinatown && b.seed > 0.8 ) ) return 'brick';
	if ( b.arch === A.office ) return 'ashlar';
	if ( b.arch === A.tower ) return 'curtain wall';
	return 'stucco';

}

// stHash21 (src/street/wgsl.js) in f32
const f = Math.fround, fr = ( x ) => f( x - Math.floor( x ) );
function hash21( x, y ) {

	let qx = fr( f( x * f( 123.34 ) ) ), qy = fr( f( y * f( 456.21 ) ) );
	const d = f( f( qx * f( qx + f( 45.32 ) ) ) + f( qy * f( qy + f( 45.32 ) ) ) );
	qx = f( qx + d ); qy = f( qy + d );
	return fr( f( qx * qy ) );

}

function walk( dir, out = [] ) { for ( const e of readdirSync( dir ) ) { const p = join( dir, e ); if ( statSync( p ).isDirectory() ) walk( p, out ); else out.push( p ); } return out; }

function check( model, { publicDir = join( root, 'public' ), srcDir = join( root, 'src/facades' ), litShare = null } = {} ) {

	const fails = [];
	const images = walk( publicDir ).filter( ( p ) => IMG.has( extname( p ).toLowerCase() ) && /facade/i.test( p ) );
	if ( images.length ) fails.push( `facade image file(s) shipped: ${ images.slice( 0, 3 ).join( ', ' ) }` );
	for ( const p of walk( srcDir ) ) { const s = readFileSync( p, 'utf8' ); if ( /new Texture\(|loadTexture|\.png|\.jpg|\.ktx2|ImageBitmap/.test( s ) ) fails.push( `${ p } loads a texture` ); }
	const fam = new Map();
	for ( const b of model.buildings ) if ( nearPath( b, 150 ) ) fam.set( b.family || family( b ), ( fam.get( b.family || family( b ) ) || 0 ) + 1 );
	if ( fam.size < 4 ) fails.push( `${ fam.size } material families on the street path (${ [ ...fam.keys() ].join( ', ' ) }), need ≥ 4` );
	// lit windows at night: the shader's rule per window ( lit when hash ≥ 1 − share )
	const tally = { res: [ 0, 0 ], office: [ 0, 0 ] };
	for ( const b of model.buildings ) {

		const office = b.arch === A.office || b.arch === A.tower;
		const share = litShare ?? ( office ? 0.46 : 0.4 );
		const fl = floorsOf( b.arch, b.h );
		for ( const w of b.walls ) {

			const bays = baysOf( b.arch, w.len );
			for ( let i = 0; i < bays.n; i ++ ) for ( let k = 0; k < fl.floors - 1; k ++ ) {

				const h3 = hash21( i + f( b.seed * 97 ) + 19.1, k + f( b.seed * 61 ) + 19.1 );
				const t = office ? tally.office : tally.res;
				t[ 1 ] ++; if ( h3 >= 1 - share ) t[ 0 ] ++;

			}

		}

	}

	const rs = tally.res[ 0 ] / tally.res[ 1 ], os = tally.office[ 0 ] / tally.office[ 1 ];
	if ( rs < 0.3 || rs > 0.5 ) fails.push( `residential lit share ${ ( rs * 100 ).toFixed( 1 ) } % outside 30–50 %` );
	if ( os < 0.2 || os > 0.7 ) fails.push( `office lit share ${ ( os * 100 ).toFixed( 1 ) } % outside 20–70 %` );
	return { fails, fam, rs, os, windows: tally.res[ 1 ] + tally.office[ 1 ] };

}

const model = facadeModel();
if ( NEG ) {

	let caught = 0;
	const tp = mkdtempSync( join( tmpdir(), 'g19-' ) ); mkdirSync( join( tp, 'textures/facades' ), { recursive: true } ); writeFileSync( join( tp, 'textures/facades/brick.png' ), 'x' );
	const f1 = check( model, { publicDir: tp } ).fails; console.log( 'texture file:', f1[ 0 ] || 'NOT CAUGHT' ); if ( f1.length ) caught ++;
	const ts = mkdtempSync( join( tmpdir(), 'g19s-' ) ); cpSync( join( root, 'src/facades' ), ts, { recursive: true } ); writeFileSync( join( ts, 'tex.js' ), "export const t = new Texture( { url: 'brick.png' } );" );
	const f2 = check( model, { srcDir: ts } ).fails; console.log( 'texture load:', f2[ 0 ] || 'NOT CAUGHT' ); if ( f2.length ) caught ++;
	const m3 = facadeModel(); for ( const b of m3.buildings ) b.family = 'stucco';
	const f3 = check( m3 ).fails; console.log( 'one material:', f3[ 0 ] || 'NOT CAUGHT' ); if ( f3.length ) caught ++;
	const f4 = check( model, { litShare: 0.9 } ).fails; console.log( 'lit 90 %:', f4[ 0 ] || 'NOT CAUGHT' ); if ( f4.length ) caught ++;
	rmSync( tp, { recursive: true } ); rmSync( ts, { recursive: true } );
	negativeSummary( caught, 4 );

}

const { fails, fam, rs, os, windows } = check( model );
console.log( 'families on the path:', JSON.stringify( Object.fromEntries( fam ) ) );
for ( const x of fails ) console.log( 'FAIL ' + x );
console.log( fails.length ? 'G19 FAIL' : `G19 PASS — no facade textures (all by code); ${ fam.size } material families on the path; ${ windows } windows: lit at night residential ${ ( rs * 100 ).toFixed( 1 ) } %, office ${ ( os * 100 ).toFixed( 1 ) } %` );
process.exit( fails.length ? 1 : 0 );
