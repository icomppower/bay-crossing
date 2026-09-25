// Minimal TIFF reader for DEM and imagery exports (single band, or interleaved multi-band → `bands`): little/big endian, strips or tiles,
// compression none (1), LZW (5) or deflate (8/32946), sample formats uint/int/float, 8–64 bit.
import { inflateSync } from 'node:zlib';

const TYPE_SIZE = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 6: 1, 7: 1, 8: 2, 9: 4, 10: 8, 11: 4, 12: 8, 16: 8 };

export function readTiff(buf) {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const le = buf[0] === 0x49;
  if (dv.getUint16(2, le) !== 42) throw new Error('not a classic TIFF');
  const ifd = dv.getUint32(4, le);
  const count = dv.getUint16(ifd, le);
  const tags = {};
  for (let i = 0; i < count; i++) {
    const e = ifd + 2 + i * 12;
    const tag = dv.getUint16(e, le), type = dv.getUint16(e + 2, le), n = dv.getUint32(e + 4, le);
    const size = (TYPE_SIZE[type] || 1) * n;
    const off = size <= 4 ? e + 8 : dv.getUint32(e + 8, le);
    const vals = [];
    for (let k = 0; k < n; k++) {
      const p = off + k * (TYPE_SIZE[type] || 1);
      vals.push(type === 3 ? dv.getUint16(p, le) : type === 4 ? dv.getUint32(p, le) : type === 11 ? dv.getFloat32(p, le)
        : type === 12 ? dv.getFloat64(p, le) : type === 16 ? Number(dv.getBigUint64(p, le)) : buf[p]);
    }
    tags[tag] = type === 2 ? buf.subarray(off, off + n - 1).toString('latin1') : vals;
  }
  const width = tags[256][0], height = tags[257][0];
  const bps = tags[258]?.[0] ?? 8, fmt = tags[339]?.[0] ?? 1, comp = tags[259]?.[0] ?? 1;
  const pred = tags[317]?.[0] ?? 1, spp = tags[277]?.[0] ?? 1;
  const planar = tags[284]?.[0] ?? 1;
  if (spp !== 1 && planar !== 1) throw new Error('only interleaved (chunky) multi-band TIFFs are supported');
  const bytes = bps / 8, px = bytes * spp; // bytes per sample, per pixel
  const tiled = !!tags[322];
  const bw = tiled ? tags[322][0] : width, bh = tiled ? tags[323][0] : (tags[278]?.[0] ?? height);
  const offs = tiled ? tags[324] : tags[273], lens = tiled ? tags[325] : tags[279];
  const across = Math.ceil(width / bw);
  const bands = Array.from({ length: spp }, () => new Float64Array(width * height));
  const out = bands[0];
  const read = (d, p) => fmt === 3 ? (bytes === 4 ? d.getFloat32(p, le) : d.getFloat64(p, le))
    : fmt === 2 ? (bytes === 1 ? d.getInt8(p) : bytes === 2 ? d.getInt16(p, le) : d.getInt32(p, le))
    : (bytes === 1 ? d.getUint8(p) : bytes === 2 ? d.getUint16(p, le) : d.getUint32(p, le));
  for (let b = 0; b < offs.length; b++) {
    let raw = buf.subarray(offs[b], offs[b] + lens[b]);
    if (comp === 8 || comp === 32946) raw = inflateSync(raw);
    else if (comp === 5) raw = lzw(raw);
    else if (comp !== 1) throw new Error(`unsupported compression ${comp}`);
    const rows = tiled ? bh : Math.min(bh, height - b * bh);
    if (pred === 2 || pred === 3) {
      if (spp !== 1) throw new Error('predictors with multi-band TIFFs are not supported');
      unpredict(raw, bw, rows, bytes, pred, le);
    }
    const d = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
    const x0 = tiled ? (b % across) * bw : 0, y0 = tiled ? Math.floor(b / across) * bh : b * bh;
    for (let y = 0; y < rows; y++) {
      const gy = y0 + y; if (gy >= height) break;
      for (let x = 0; x < bw; x++) {
        const gx = x0 + x; if (gx >= width) break;
        for (let c = 0; c < spp; c++) bands[c][gy * width + gx] = read(d, (y * bw + x) * px + c * bytes);
      }
    }
  }
  const noData = tags[42113] !== undefined ? parseFloat(tags[42113]) : null;
  return { width, height, data: out, bands, noData, tags };
}

function unpredict(raw, w, rows, bytes, pred, le) {
  if (pred === 2) {
    const d = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
    for (let y = 0; y < rows; y++) for (let x = 1; x < w; x++) {
      const p = (y * w + x) * bytes;
      if (bytes === 2) d.setUint16(p, d.getUint16(p, le) + d.getUint16(p - 2, le), le);
      else if (bytes === 4) d.setUint32(p, d.getUint32(p, le) + d.getUint32(p - 4, le), le);
      else raw[p] = (raw[p] + raw[p - 1]) & 255;
    }
    return;
  }
  // Floating-point predictor (3): byte-wise differencing across a row, bytes stored big-endian-planar.
  const rowLen = w * bytes, tmp = new Uint8Array(rowLen);
  for (let y = 0; y < rows; y++) {
    const r = raw.subarray(y * rowLen, (y + 1) * rowLen);
    for (let i = 1; i < rowLen; i++) r[i] = (r[i] + r[i - 1]) & 255;
    for (let x = 0; x < w; x++) for (let k = 0; k < bytes; k++)
      tmp[x * bytes + (le ? bytes - 1 - k : k)] = r[k * w + x];
    r.set(tmp);
  }
}

function lzw(input) {
  const out = []; let dict, next, width, bit = 0, prev = null;
  const reset = () => { dict = []; for (let i = 0; i < 256; i++) dict[i] = [i]; next = 258; width = 9; };
  reset();
  const readCode = () => {
    let v = 0;
    for (let i = 0; i < width; i++) {
      const byte = input[(bit >> 3)]; if (byte === undefined) return 257;
      v = (v << 1) | ((byte >> (7 - (bit & 7))) & 1); bit++;
    }
    return v;
  };
  for (;;) {
    const code = readCode();
    if (code === 257) break;
    if (code === 256) { reset(); prev = null; continue; }
    let entry;
    if (code < next && dict[code]) entry = dict[code];
    else if (prev) entry = prev.concat(prev[0]);
    else break;
    for (const b of entry) out.push(b);
    if (prev) { dict[next++] = prev.concat(entry[0]); if (next + 1 >= (1 << width) && width < 12) width++; }
    prev = entry;
  }
  return Buffer.from(out);
}

// Uncompressed single-strip Float32 GeoTIFF with the tie point / pixel scale tags readTiff() uses
// (for test fixtures).
export function writeTiff( { width, height, data, tie, scale } ) {

	const tags = [
		[ 256, 4, [ width ] ], [ 257, 4, [ height ] ], [ 258, 3, [ 32 ] ], [ 259, 3, [ 1 ] ], [ 262, 3, [ 1 ] ],
		[ 273, 4, [ 0 ] ], [ 277, 3, [ 1 ] ], [ 278, 4, [ height ] ], [ 279, 4, [ width * height * 4 ] ], [ 339, 3, [ 3 ] ],
		[ 33550, 12, scale ], [ 33922, 12, tie ],
	];
	const ifdSize = 2 + tags.length * 12 + 4;
	let extra = 8 + ifdSize;
	const extraBlocks = [];
	for ( const t of tags ) if ( t[ 1 ] === 12 ) { t.push( extra ); extraBlocks.push( t ); extra += t[ 2 ].length * 8; }
	const dataOff = extra;
	const buf = Buffer.alloc( dataOff + width * height * 4 );
	buf.write( 'II', 0, 'latin1' ); buf.writeUInt16LE( 42, 2 ); buf.writeUInt32LE( 8, 4 );
	buf.writeUInt16LE( tags.length, 8 );
	tags.forEach( ( [ tag, type, vals, off ], i ) => {

		const e = 10 + i * 12;
		buf.writeUInt16LE( tag, e ); buf.writeUInt16LE( type, e + 2 ); buf.writeUInt32LE( vals.length, e + 4 );
		if ( type === 12 ) buf.writeUInt32LE( off, e + 8 );
		else if ( type === 3 ) buf.writeUInt16LE( vals[ 0 ], e + 8 );
		else buf.writeUInt32LE( tag === 273 ? dataOff : vals[ 0 ], e + 8 );

	} );
	for ( const [ , , vals, off ] of extraBlocks ) vals.forEach( ( v, k ) => buf.writeDoubleLE( v, off + k * 8 ) );
	for ( let k = 0; k < width * height; k ++ ) buf.writeFloatLE( data[ k ], dataOff + k * 4 );
	return buf;

}
