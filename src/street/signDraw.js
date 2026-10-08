// Draws sign text into atlas cells with Canvas 2D (D50: signs are drawn by code — no sign image files). One cell
// per distinct sign string: white lettering as coverage (one byte a pixel); the storefront shader colours the board
// and the ink. The font of a string is picked from its hash (seeded), so the same text always looks the same.
// Runs in a worker (OffscreenCanvas) in the browser, and on the main thread with a Canvas 2D implementation in Node.
export const CELL_W = 512, CELL_H = 64, COLS = 4;

const FONTS = [
	'bold {s}px "Helvetica Neue", Helvetica, Arial, sans-serif',
	'bold {s}px Futura, "Century Gothic", "Trebuchet MS", sans-serif',
	'bold {s}px Georgia, "Times New Roman", serif',
	'{s}px Impact, "Arial Black", sans-serif',
	'bold {s}px "Gill Sans", "Gill Sans MT", "Trebuchet MS", sans-serif',
	'{s}px Copperplate, "Copperplate Gothic Light", Georgia, serif',
	'bold {s}px "American Typewriter", "Courier New", monospace',
	'bold {s}px "Avenir Next Condensed", "Arial Narrow", Arial, sans-serif',
];
const CJK = 'bold {s}px "PingFang TC", "Hiragino Sans", "Noto Sans CJK TC", "Microsoft JhengHei", sans-serif';

const hash = ( s ) => { let h = 2166136261; for ( let i = 0; i < s.length; i ++ ) { h ^= s.charCodeAt( i ); h = Math.imul( h, 16777619 ); } return h >>> 0; };
const isCJK = ( c ) => c.charCodeAt( 0 ) >= 0x2e80;

// texts → { width, height, rows, cols, data: Uint8Array (r8, row 0 = top) }; makeCanvas( w, h ) returns a canvas-like;
// layout: cell size and columns (street-name blades use smaller cells)
export function drawSigns( texts, makeCanvas, { cellW = CELL_W, cellH = CELL_H, cols = COLS, fontFor = null } = {} ) {

	const CELL_W = cellW, CELL_H = cellH, COLS = cols;
	const rows = Math.max( 1, Math.ceil( texts.length / COLS ) );
	const width = CELL_W * COLS, height = CELL_H * rows;
	const canvas = makeCanvas( width, height );
	const ctx = canvas.getContext( '2d' );
	ctx.clearRect( 0, 0, width, height );
	ctx.fillStyle = '#fff';
	ctx.textBaseline = 'middle';
	texts.forEach( ( text, i ) => {

		const cx = ( i % COLS ) * CELL_W, cy = Math.floor( i / COLS ) * CELL_H;
		const font = fontFor ? fontFor( text ) : FONTS[ hash( text ) % FONTS.length ];
		// a leading Chinese character is set in a CJK face, the English after it in the sign's face
		const parts = text.split( ' ' );
		const zh = isCJK( parts[ 0 ] ) ? parts.shift() : null;
		const en = parts.join( ' ' );
		const size = Math.round( CELL_H * 0.72 );
		ctx.save();
		ctx.font = font.replace( '{s}', size );
		const wEn = ctx.measureText( en ).width;
		ctx.font = CJK.replace( '{s}', size );
		const wZh = zh ? ctx.measureText( zh ).width + size * 0.35 : 0;
		const total = wEn + wZh, room = CELL_W - 28;
		const sx = Math.min( 1, room / total );
		ctx.translate( cx + CELL_W / 2 - total * sx / 2, cy + CELL_H / 2 + 2 );
		ctx.scale( sx, 1 );
		if ( zh ) { ctx.font = CJK.replace( '{s}', size ); ctx.fillText( zh, 0, 0 ); }
		ctx.font = font.replace( '{s}', size );
		ctx.fillText( en, wZh, 0 );
		ctx.restore();

	} );
	const rgba = ctx.getImageData( 0, 0, width, height ).data;
	const data = new Uint8Array( width * height );
	for ( let k = 0; k < data.length; k ++ ) data[ k ] = rgba[ k * 4 + 3 ];
	return { width, height, rows, cols: COLS, data };

}

// box-filtered mip chain of an r8 image (each level halves both sides)
export function mipChain( { width, height, data }, levels ) {

	const out = [ { width, height, data } ];
	for ( let l = 1; l < levels; l ++ ) {

		const p = out[ l - 1 ], w = Math.max( 1, p.width >> 1 ), h = Math.max( 1, p.height >> 1 ), d = new Uint8Array( w * h );
		for ( let y = 0; y < h; y ++ ) for ( let x = 0; x < w; x ++ ) {

			const x0 = Math.min( p.width - 1, 2 * x ), y0 = Math.min( p.height - 1, 2 * y ), x1 = Math.min( p.width - 1, x0 + 1 ), y1 = Math.min( p.height - 1, y0 + 1 );
			d[ y * w + x ] = ( p.data[ y0 * p.width + x0 ] + p.data[ y0 * p.width + x1 ] + p.data[ y1 * p.width + x0 ] + p.data[ y1 * p.width + x1 ] + 2 ) >> 2;

		}

		out.push( { width: w, height: h, data: d } );

	}

	return out;

}
