// G17 Floor and bay alignment (run 3, D80, D81): for every wall of every building, the layout the shader draws
// (src/facades/material.js recomputes the upper floor count as floor( ( H − g ) / f )) has exactly the model's floors
// (window rows = floors), every window lies inside its floor below the top band and above the ground, and every wall
// with windows splits into whole bays between its corner piers (2·pier + n·w = length; n whole, w inside the
// archetype's range). Checked on the per-vertex attributes as uploaded.
// --negative: a wall with one window row more than its floors (6-floor building drawn with 7), and a bay width that
// leaves a partial window at the corner, must each be caught.
import { facadeModel, negativeSummary } from './lib/facades.mjs';
import { ARCH, RULES, floorsOf } from '../src/facades/model.js';

const NEG = process.argv.includes( '--negative' );
// the window opening rows per archetype as in faWindow (y0, y1 as fractions of the floor; arch rise)
const WIN = [ [ 0.2, 0.86, 0 ], [ 0.27, 0.8, 0.05 ], [ 0.2, 0.8, 0.07 ], [ 0.26, 0.8, 0 ], [ 0.24, 0.98, 0 ], [ 0.45, 0.8, 0 ], [ 0.28, 0.8, 0 ], [ 0.25, 0.78, 0 ] ];

function check( model ) {

	const fails = [];
	let walls = 0, windowed = 0;
	for ( const t of model.tiles ) {

		const A = t.aWall, S = t.aStyle;
		for ( const b of t.buildings ) {

			const want = floorsOf( b.arch, b.h );
			for ( const w of b.walls ) {

				walls ++;
				const o = w.v * 4;
				const L = A[ o + 1 ], H = A[ o + 2 ], arch = Math.floor( A[ o + 3 ] + 0.01 ), bw = S[ o + 1 ], f = S[ o + 2 ], g = S[ o + 3 ];
				const r = RULES[ ARCH[ arch ] ];
				// the shader's floors
				const upper = f > 0 ? Math.floor( ( H - g ) / Math.max( f, 0.5 ) + 0.001 ) : 0;
				const topY = f > 0 ? g + upper * f : H;
				if ( upper + 1 !== want.floors ) { fails.push( `wall at ${ w.ax.toFixed( 1 ) }, ${ w.az.toFixed( 1 ) }: ${ upper + 1 } window rows on a ${ want.floors }-floor ${ ARCH[ arch ] }` ); continue; }
				if ( topY > H + 1e-3 ) { fails.push( `wall at ${ w.ax.toFixed( 1 ) }, ${ w.az.toFixed( 1 ) }: floors run above the roof` ); continue; }
				// every window row inside its floor and under the top band (the arch rise included)
				const [ y0, y1, rise ] = WIN[ arch ];
				if ( f > 0 && ( y1 + rise > 1.0001 || y0 < 0 ) ) fails.push( `${ ARCH[ arch ] } windows cross a floor line` );
				if ( f > 0 && g + ( upper - 1 ) * f + ( y1 + rise ) * f > topY + 1e-3 ) fails.push( `wall at ${ w.ax.toFixed( 1 ) }, ${ w.az.toFixed( 1 ) }: top row enters the top band` );
				// whole bays between corner piers
				if ( bw > 0 ) {

					windowed ++;
					const n = ( L - 2 * r.pier ) / bw;
					if ( Math.abs( n - Math.round( n ) ) > 1e-3 ) fails.push( `wall at ${ w.ax.toFixed( 1 ) }, ${ w.az.toFixed( 1 ) } (${ L.toFixed( 2 ) } m): ${ n.toFixed( 3 ) } bays — a partial window at the corner` );
					else if ( arch !== 4 && ( bw < r.bayMin - 1e-3 || bw > r.bayMax + 1e-3 ) && Math.round( n ) > 1 ) fails.push( `wall at ${ w.ax.toFixed( 1 ) }, ${ w.az.toFixed( 1 ) }: bay ${ bw.toFixed( 2 ) } m outside ${ r.bayMin }–${ r.bayMax }` );

				} else if ( L >= 3 && L - 2 * r.pier >= r.bayMin + 1e-3 ) fails.push( `wall at ${ w.ax.toFixed( 1 ) }, ${ w.az.toFixed( 1 ) } (${ L.toFixed( 2 ) } m) has room for a bay but no windows` );

			}

		}

	}

	return { fails, walls, windowed };

}

const model = facadeModel();
if ( NEG ) {

	let caught = 0;
	// 6-floor building drawn with 7 rows: shrink one wall's floor height so floor( ( H − g ) / f ) gains a row
	const m1 = facadeModel();
	outer: for ( const t of m1.tiles ) for ( const b of t.buildings ) if ( floorsOf( b.arch, b.h ).floors === 6 ) { const o = b.walls[ 0 ].v * 4, H = t.aWall[ o + 2 ], g = t.aStyle[ o + 3 ]; for ( let k = 0; k < 4; k ++ ) t.aStyle[ o + k * 4 + 2 ] = ( H - g ) / 6; break outer; } // 6 upper rows + ground = 7
	const f1 = check( m1 ).fails; console.log( 'extra row:', f1[ 0 ] || 'NOT CAUGHT' ); if ( f1.length ) caught ++;
	const m2 = facadeModel();
	outer2: for ( const t of m2.tiles ) for ( const b of t.buildings ) for ( const w of b.walls ) { const o = w.v * 4; if ( t.aStyle[ o + 1 ] > 0 ) { for ( let k = 0; k < 4; k ++ ) t.aStyle[ o + k * 4 + 1 ] *= 1.07; break outer2; } }
	const f2 = check( m2 ).fails; console.log( 'partial bay:', f2[ 0 ] || 'NOT CAUGHT' ); if ( f2.length ) caught ++;
	negativeSummary( caught, 2 );

}

const { fails, walls, windowed } = check( model );
for ( const f of fails.slice( 0, 20 ) ) console.log( 'FAIL ' + f );
if ( fails.length > 20 ) console.log( `… ${ fails.length } failures` );
console.log( fails.length ? 'G17 FAIL' : `G17 PASS — ${ walls } walls: window rows = floors on all, ${ windowed } windowed walls in whole bays with corner piers` );
process.exit( fails.length ? 1 : 0 );
