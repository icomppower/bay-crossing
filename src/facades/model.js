// Facade model (run 3, F1–F14): reads the run-1 building tiles exactly as shipped (positions, uv, colour + class;
// nothing in them changes, F1 / G15), finds the buildings and their walls, gives every building an SF archetype
// (F2), every wall a whole-bay / whole-floor layout (F3, F4), and lists the near-band detail (F6, F9, F13). Pure and
// deterministic: the browser (src/facades/index.js) and the gates (gates/g15–g19) run the same code.
//
// Tile layout (harbor-engine tools/buildings/build.mjs extrude()): per building, per polygon ring, one 4-vertex quad
// per wall segment — uv.x = metres along the ring from its first vertex (run), uv.y = metres above the base — then the
// polygon's roof (normal +y, uv = world x, z). All of one building shares its wall colour and class (colour.a: 0 house,
// 128 mid, 255 tower).
import { localBox } from './geo.js';

export const ARCH = [ 'victorian', 'midrise', 'warehouse', 'office', 'tower', 'pier', 'sausalito', 'chinatown' ];
export const A = Object.fromEntries( ARCH.map( ( n, i ) => [ n, i ] ) );

// districts (lat/lon boxes, generous; written from the street plan, not from imagery)
const DISTRICTS = {
	sausalito: localBox( 37.840, - 122.500, 37.875, - 122.465 ),
	chinatown: localBox( 37.7905, - 122.4085, 37.7975, - 122.4045 ),
	jacksonSquare: localBox( 37.7952, - 122.4050, 37.7990, - 122.3990 ),
	northWaterfront: localBox( 37.7985, - 122.4045, 37.8060, - 122.3975 ), // Battery / Sansome brick (Levi's Plaza edge)
	wharf: localBox( 37.8050, - 122.4250, 37.8130, - 122.4080 ),
	fidi: localBox( 37.7880, - 122.4050, 37.7960, - 122.3920 ),
	southBeach: localBox( 37.7800, - 122.3990, 37.7935, - 122.3850 ),
	embarcaderoPiers: localBox( 37.7900, - 122.4120, 37.8120, - 122.3850 ),
};
export const inDistrict = ( name, x, z, margin = 0 ) => { const b = DISTRICTS[ name ]; return x >= b.x0 - margin && x <= b.x1 + margin && z >= b.z0 - margin && z <= b.z1 + margin; };
export const districtAt = ( x, z ) => {

	for ( const [ k, b ] of Object.entries( DISTRICTS ) ) if ( k !== 'embarcaderoPiers' && x >= b.x0 && x <= b.x1 && z >= b.z0 && z <= b.z1 ) return k;
	return null;

};
const inBox = ( b, x, z ) => x >= b.x0 && x <= b.x1 && z >= b.z0 && z <= b.z1;

// small stable hash → [0, 1)
export function hash01( ...v ) {

	let h = 2166136261 >>> 0;
	for ( const n of v ) { let k = Math.round( n * 100 ) | 0; for ( let i = 0; i < 4; i ++ ) { h ^= ( k >>> ( i * 8 ) ) & 255; h = Math.imul( h, 16777619 ) >>> 0; } }
	h ^= h >>> 13; h = Math.imul( h, 0x5bd1e995 ) >>> 0; h ^= h >>> 15;
	return ( h >>> 0 ) / 4294967296;

}

// ---- buildings from one tile's arrays (tile-local positions; t = tile centre [x, z])
export function buildingsOfTile( pos, nrm, uv, col, t ) {

	const nv = pos.length / 3, out = [];
	let cur = null;
	const key = ( v ) => `${ col[ v * 4 ] },${ col[ v * 4 + 1 ] },${ col[ v * 4 + 2 ] },${ col[ v * 4 + 3 ] }`;
	let v = 0;
	while ( v < nv ) {

		if ( Math.abs( nrm[ v * 3 + 1 ] ) < 0.5 ) {

			// a wall quad: 4 vertices; a new ring when its run restarts at 0; a new building when the wall colour /
			// class changes or the top differs (two neighbours never share both: colours are jittered per building)
			const top = pos[ ( v + 2 ) * 3 + 1 ], base = pos[ v * 3 + 1 ], k = key( v );
			if ( ! cur || cur.key !== k || Math.abs( cur.top - top ) > 1e-3 || cur.closed ) {

				cur = { key: k, top, base, cls: col[ v * 4 + 3 ], tint: [ col[ v * 4 ], col[ v * 4 + 1 ], col[ v * 4 + 2 ] ], walls: [], roofV: [], closed: false, firstVertex: v };
				out.push( cur );

			}

			cur.base = Math.min( cur.base, base );
			cur.walls.push( {
				v, // first vertex of the quad
				ax: pos[ v * 3 ] + t[ 0 ], az: pos[ v * 3 + 2 ] + t[ 1 ], bx: pos[ ( v + 1 ) * 3 ] + t[ 0 ], bz: pos[ ( v + 1 ) * 3 + 2 ] + t[ 1 ],
				nx: nrm[ v * 3 ], nz: nrm[ v * 3 + 2 ], u0: uv[ v * 2 ], len: uv[ ( v + 1 ) * 2 ] - uv[ v * 2 ], h: uv[ ( v + 2 ) * 2 + 1 ],
			} );
			v += 4;

		} else {

			// roof vertices of the current polygon; the building stays open for its next polygon (same colour)
			if ( cur ) cur.roofV.push( v );
			v ++;
			// the building is complete once a wall of a different building follows (handled above by the key)

		}

	}

	for ( const b of out ) {

		let sx = 0, sz = 0, L = 0, minx = Infinity, maxx = - Infinity, minz = Infinity, maxz = - Infinity;
		for ( const w of b.walls ) {

			const m = w.len;
			sx += ( w.ax + w.bx ) / 2 * m; sz += ( w.az + w.bz ) / 2 * m; L += m;
			minx = Math.min( minx, w.ax, w.bx ); maxx = Math.max( maxx, w.ax, w.bx ); minz = Math.min( minz, w.az, w.bz ); maxz = Math.max( maxz, w.az, w.bz );

		}

		b.cx = sx / L; b.cz = sz / L; b.perimeter = L;
		b.h = b.top - b.base;
		// footprint area from the wall rings (shoelace over each quad's ground edge, signed by the outward normal)
		let a2 = 0;
		for ( const w of b.walls ) a2 += w.ax * w.bz - w.bx * w.az;
		b.area = Math.abs( a2 ) / 2;
		b.bbox = [ minx, minz, maxx, maxz ];
		b.id = Math.round( b.cx * 10 ) * 100003 + Math.round( b.cz * 10 ); // stable id from the centroid (dm)
		delete b.key;

	}

	return out;

}

// ---- F2: archetype
export function classify( b ) {

	const { cx, cz, h, area, cls, base } = b;
	const d = districtAt( cx, cz );
	const longest = Math.max( ...b.walls.map( ( w ) => w.len ) );
	const reason = [];
	let arch;
	if ( d === 'sausalito' ) { arch = A.sausalito; reason.push( 'district' ); }
	else if ( cls === 255 || h > 60 ) { arch = A.tower; reason.push( 'class tower' ); }
	else if ( base < 0.6 && inBox( DISTRICTS.embarcaderoPiers, cx, cz ) && area > 1200 && h < 26 ) { arch = A.pier; reason.push( 'over water, long and low' ); }
	else if ( d === 'chinatown' && h < 40 ) { arch = A.chinatown; reason.push( 'district' ); }
	else if ( d === 'fidi' ) { arch = h > 30 && area > 600 ? A.office : h <= 30 && area > 900 ? A.office : A.midrise; reason.push( 'district fidi' ); }
	else if ( ( d === 'jacksonSquare' || d === 'northWaterfront' || d === 'wharf' || d === 'southBeach' ) && h < 30 && area > 350 ) { arch = A.warehouse; reason.push( 'district ' + d ); }
	else if ( cls === 0 && area < 450 ) { arch = A.victorian; reason.push( 'house, small lot' ); }
	else if ( cls === 0 ) { arch = area > 900 ? A.warehouse : A.midrise; reason.push( 'house class, large lot' ); }
	else if ( h > 30 && area > 700 ) { arch = A.office; reason.push( 'tall mid' ); }
	else { arch = A.midrise; reason.push( 'default mid' ); }
	return { arch, district: d, fallback: d === null, reason: reason.join( ', ' ), longest };

}

// ---- F3 / F4: floors and bays for one wall of building b (archetype `arch`)
const RULES = {
	// ground floor, upper floor, bay width target and range, top band (cornice / parapet zone), corner pier
	victorian: { g: 3.0, f: 3.0, bay: 1.35, bayMin: 1.1, bayMax: 1.8, top: 0.9, pier: 0.3 },
	midrise: { g: 4.0, f: 3.0, bay: 1.6, bayMin: 1.2, bayMax: 2.0, top: 1.0, pier: 0.4 },
	warehouse: { g: 4.6, f: 3.8, bay: 2.6, bayMin: 2.0, bayMax: 3.4, top: 1.1, pier: 0.6 },
	office: { g: 5.0, f: 3.7, bay: 1.9, bayMin: 1.5, bayMax: 2.4, top: 1.6, pier: 0.7 },
	tower: { g: 6.0, f: 3.9, bay: 1.5, bayMin: 1.5, bayMax: 1.5, top: 2.4, pier: 0.0 },
	pier: { g: 7.0, f: 4.5, bay: 6.0, bayMin: 4.5, bayMax: 8.0, top: 1.2, pier: 0.8 },
	sausalito: { g: 3.0, f: 2.9, bay: 1.5, bayMin: 1.1, bayMax: 2.2, top: 0.4, pier: 0.25 },
	chinatown: { g: 4.0, f: 3.0, bay: 1.5, bayMin: 1.2, bayMax: 2.0, top: 1.1, pier: 0.4 },
};
export { RULES };

export function floorsOf( arch, H, levels = null ) {

	const r = RULES[ ARCH[ arch ] ];
	const top = Math.min( r.top, H * 0.15 );
	if ( H < r.g + 1.5 ) return { floors: 1, g: Math.max( 2.6, H - top ), f: 0, top };
	// F3: floor count from the height (no OSM levels here, data/raw is not shipped): whole upper floors of ~f
	const upper = levels ? levels - 1 : Math.max( 1, Math.round( ( H - r.g - top ) / r.f ) );
	const f = ( H - r.g - top ) / upper;
	// a storey under 2.4 m is no storey: one tall ground floor instead
	if ( f < 2.4 ) return { floors: 1, g: Math.max( 2.6, H - top ), f: 0, top };
	// the shader counts floors as floor( ( H − g ) / f ): the top band must stay under one floor height
	if ( top >= f * 0.98 ) return { floors: upper + 1, g: r.g, f: ( H - r.g ) / upper, top: 0 };
	return { floors: upper + 1, g: r.g, f, top };

}

export function baysOf( arch, len ) {

	const r = RULES[ ARCH[ arch ] ];
	const inner = len - 2 * r.pier;
	if ( inner < r.bayMin ) return { n: 0, w: 0, pier: len / 2 }; // blank wall (party walls, slivers)
	let n = Math.max( 1, Math.round( inner / r.bay ) );
	if ( inner / n > r.bayMax ) n = Math.ceil( inner / r.bayMax );
	if ( inner / n < r.bayMin ) n = Math.max( 1, Math.floor( inner / r.bayMin ) );
	return { n, w: inner / n, pier: r.pier };

}

// per-vertex facade attributes for one tile LOD (the same order as the tile's vertices):
// aWall = ( u0, len, H, arch + 0.1·sf ) ; aStyle = ( seed, bayW, floorH, groundH ) — walls; roofs get ( 0, 0, H, arch ), ( seed, 0, 0, 0 )
//   sf: 1 when the wall faces a street (a storefront module lies on it), else 0
export function facadeAttributes( buildings, nv, streetFacing ) {

	const aWall = new Float32Array( nv * 4 ), aStyle = new Float32Array( nv * 4 );
	for ( const b of buildings ) {

		const fl = floorsOf( b.arch, b.h );
		for ( const w of b.walls ) {

			const bays = baysOf( b.arch, w.len );
			const sf = streetFacing ? ( streetFacing( w ) ? 1 : 0 ) : 1;
			w.sf = sf;
			for ( let k = 0; k < 4; k ++ ) {

				const o = ( w.v + k ) * 4;
				aWall[ o ] = w.u0; aWall[ o + 1 ] = w.len; aWall[ o + 2 ] = b.h; aWall[ o + 3 ] = b.arch + 0.1 * sf;
				aStyle[ o ] = b.seed; aStyle[ o + 1 ] = bays.n ? bays.w : 0; aStyle[ o + 2 ] = fl.f; aStyle[ o + 3 ] = fl.g;

			}

		}

		for ( const v of b.roofV ) {

			const o = v * 4;
			aWall[ o + 2 ] = b.h; aWall[ o + 3 ] = b.arch; aStyle[ o ] = b.seed;

		}

	}

	return { aWall, aStyle };

}

// ---- seeded colour per building (F7, F13): SF palettes in linear-ish sRGB bytes; Victorians never match a neighbour
const PALETTES = {
	victorian: [ [ 214, 226, 205 ], [ 238, 222, 160 ], [ 230, 192, 190 ], [ 182, 206, 226 ], [ 240, 236, 226 ], [ 202, 192, 222 ], [ 226, 206, 172 ], [ 168, 190, 168 ], [ 236, 214, 196 ], [ 196, 216, 214 ], [ 246, 228, 200 ], [ 190, 170, 200 ] ],
	midrise: [ [ 214, 206, 190 ], [ 200, 192, 178 ], [ 226, 220, 206 ], [ 190, 176, 150 ], [ 230, 224, 212 ], [ 210, 196, 168 ], [ 156, 84, 64 ], [ 176, 110, 82 ] ],
	warehouse: [ [ 150, 74, 56 ], [ 136, 66, 50 ], [ 166, 90, 66 ], [ 122, 70, 56 ], [ 158, 104, 80 ], [ 142, 82, 64 ] ],
	office: [ [ 214, 206, 188 ], [ 226, 218, 200 ], [ 200, 194, 182 ], [ 222, 210, 184 ] ],
	tower: null, // keeps its run-1 tint (curtain-wall glass colour)
	pier: [ [ 222, 212, 186 ], [ 210, 200, 178 ], [ 198, 194, 184 ] ],
	sausalito: [ [ 142, 112, 82 ], [ 122, 96, 72 ], [ 236, 232, 224 ], [ 202, 212, 208 ], [ 230, 220, 182 ], [ 168, 140, 106 ], [ 214, 206, 192 ] ],
	chinatown: [ [ 214, 206, 190 ], [ 196, 188, 172 ], [ 222, 212, 196 ], [ 170, 150, 130 ], [ 206, 196, 172 ] ],
};
export { PALETTES };

// classify + seed + colour every building of a set of tiles (neighbour-aware for Victorians)
export function prepare( buildings ) {

	const log = { byArch: Object.fromEntries( ARCH.map( ( n ) => [ n, 0 ] ) ), fallback: 0, total: 0 };
	for ( const b of buildings ) {

		const c = classify( b );
		b.arch = c.arch; b.district = c.district; b.reason = c.reason;
		b.seed = hash01( b.cx, b.cz, 7 );
		log.byArch[ ARCH[ b.arch ] ] ++; log.total ++;
		if ( c.fallback ) log.fallback ++;

	}

	// colours: pick by seed; Victorians re-pick until no adjacent (shared or near-touching wall) Victorian has the same
	const grid = new Map(), cell = 30;
	const gk = ( x, z ) => Math.floor( x / cell ) * 100003 + Math.floor( z / cell );
	for ( const b of buildings ) { const k = gk( b.cx, b.cz ); if ( ! grid.has( k ) ) grid.set( k, [] ); grid.get( k ).push( b ); }
	const sorted = buildings.slice().sort( ( p, q ) => p.cx - q.cx || p.cz - q.cz );
	for ( const b of sorted ) {

		const pal = PALETTES[ ARCH[ b.arch ] ];
		if ( ! pal ) { b.colour = b.tint.slice(); b.paletteIndex = - 1; continue; }
		let idx = Math.floor( b.seed * pal.length );
		if ( b.arch === A.victorian ) {

			const used = new Set();
			for ( const n of neighbours( b, grid, gk, cell ) ) if ( n.arch === A.victorian && n.paletteIndex !== undefined ) used.add( n.paletteIndex );
			for ( let t = 0; t < pal.length && used.has( idx ); t ++ ) idx = ( idx + 5 ) % pal.length;

		}

		b.paletteIndex = idx;
		b.colour = pal[ idx ];

	}

	// repair: a Victorian whose neighbours already use every palette colour takes a deeper shade of a free-ish one
	for ( const b of sorted ) {

		if ( b.arch !== A.victorian ) continue;
		const ns = neighbours( b, grid, gk, cell ).filter( ( n ) => n.arch === A.victorian );
		const usedC = new Set( ns.map( ( n ) => n.colour.join() ) );
		if ( ! usedC.has( b.colour.join() ) ) continue;
		const pal = PALETTES.victorian;
		for ( let k = 0; k < pal.length * 3; k ++ ) {

			const shade = 1 - 0.07 * ( 1 + Math.floor( k / pal.length ) );
			const c = pal[ ( b.paletteIndex + k ) % pal.length ].map( ( v ) => Math.round( v * ( k < pal.length ? 1 : shade ) ) );
			if ( ! usedC.has( c.join() ) ) { b.colour = c; break; }

		}

	}

	return log;

}

// buildings whose footprint bboxes touch b's (within 0.6 m)
export function neighbours( b, grid, gk, cell ) {

	const out = [], [ x0, z0, x1, z1 ] = b.bbox;
	// neighbours are filed by centroid: search a margin wide enough for any footprint's centroid-to-edge distance
	const M = 60;
	for ( let gx = Math.floor( ( x0 - M ) / cell ); gx <= Math.floor( ( x1 + M ) / cell ); gx ++ ) for ( let gz = Math.floor( ( z0 - M ) / cell ); gz <= Math.floor( ( z1 + M ) / cell ); gz ++ ) {

		for ( const n of grid.get( gx * 100003 + gz ) || [] ) {

			if ( n === b ) continue;
			const [ a0, c0, a1, c1 ] = n.bbox;
			if ( a0 > x1 + 0.6 || a1 < x0 - 0.6 || c0 > z1 + 0.6 || c1 < z0 - 0.6 ) continue;
			if ( sharesWall( b, n ) ) out.push( n );

		}

	}

	return out;

}

// two footprints share (part of) a wall: some wall of one runs along some wall of the other within 0.6 m
function sharesWall( p, q ) {

	for ( const a of p.walls ) {

		if ( a.len < 2 ) continue;
		const dx = ( a.bx - a.ax ) / a.len, dz = ( a.bz - a.az ) / a.len;
		for ( const c of q.walls ) {

			if ( c.len < 2 ) continue;
			if ( Math.abs( dx * ( c.bz - c.az ) / c.len - dz * ( c.bx - c.ax ) / c.len ) > 0.1 ) continue; // not parallel
			const off = Math.abs( ( c.ax - a.ax ) * dz - ( c.az - a.az ) * dx );
			if ( off > 0.6 ) continue;
			const s0 = ( c.ax - a.ax ) * dx + ( c.az - a.az ) * dz, s1 = ( c.bx - a.ax ) * dx + ( c.bz - a.az ) * dz;
			if ( Math.min( Math.max( s0, s1 ), a.len ) - Math.max( Math.min( s0, s1 ), 0 ) > 1.5 ) return true;

		}

	}

	return false;

}

// ---- street-facing walls: a run-2 storefront module (pipelines/street/stores.mjs; 12 floats: x0 z0 y0 H | x1 z1 y1
// seed | …) lies on the wall line over at least 40 % of its length. The modules were placed on exactly the street
// faces (G11: 99.9 % of street-facing edges carry them), so they are the street mask here.
export function streetFacingFrom( modules ) {

	const cells = new Map(), C = 10;
	for ( let i = 0; i < modules.length; i += 12 ) {

		const k = Math.floor( ( modules[ i + 1 ] + modules[ i + 5 ] ) / 2 / C ) * 1e5 + Math.floor( ( modules[ i ] + modules[ i + 4 ] ) / 2 / C );
		if ( ! cells.has( k ) ) cells.set( k, [] );
		cells.get( k ).push( i );

	}

	return ( w ) => {

		if ( w.len < 1.5 ) return false;
		const dx = ( w.bx - w.ax ) / w.len, dz = ( w.bz - w.az ) / w.len;
		const mx = ( w.ax + w.bx ) / 2, mz = ( w.az + w.bz ) / 2, R = w.len / 2 + C;
		let cover = 0;
		for ( let cz = Math.floor( ( mz - R ) / C ); cz <= Math.floor( ( mz + R ) / C ); cz ++ ) for ( let cx = Math.floor( ( mx - R ) / C ); cx <= Math.floor( ( mx + R ) / C ); cx ++ ) {

			for ( const m of cells.get( cz * 1e5 + cx ) || [] ) {

				const e = [ [ modules[ m ], modules[ m + 1 ] ], [ modules[ m + 4 ], modules[ m + 5 ] ] ];
				if ( ! e.every( ( [ x, z ] ) => Math.abs( ( x - w.ax ) * dz - ( z - w.az ) * dx ) < 0.08 ) ) continue;
				const s0 = ( e[ 0 ][ 0 ] - w.ax ) * dx + ( e[ 0 ][ 1 ] - w.az ) * dz, s1 = ( e[ 1 ][ 0 ] - w.ax ) * dx + ( e[ 1 ][ 1 ] - w.az ) * dz;
				cover += Math.max( 0, Math.min( Math.max( s0, s1 ), w.len ) - Math.max( Math.min( s0, s1 ), 0 ) );

			}

		}

		return cover >= 0.4 * w.len;

	};

}

// ---- F6 / F9 / F13: near-band detail instances. Each instance: [ x, y, z, angle, len, h, depth, variant ] — the
// template's unit box (x along the wall 0..1, y up 0..1, z outward 0..1) scaled by len / h / depth, turned so local x
// runs along `angle` and local z points out of the wall (outward = ( −sin angle, cos angle )), placed at x, y, z.
export const DETAIL_TYPES = [ 'cornice', 'parapet', 'bay', 'fireEscape', 'roofBox', 'tank', 'balcony', 'gable' ];

function wallFrame( w ) {

	// outward normal (nx, nz); along = ( nz, −nx ); origin = the wall end from which `along` runs over the wall
	const ax = w.nz, az = - w.nx;
	const forward = ( w.bx - w.ax ) * ax + ( w.bz - w.az ) * az > 0;
	return { ox: forward ? w.ax : w.bx, oz: forward ? w.az : w.bz, ax, az, angle: Math.atan2( az, ax ) };

}

function insideFootprint( b, x, z ) {

	let c = false;
	for ( const w of b.walls ) if ( ( w.az > z ) !== ( w.bz > z ) && x < ( w.bx - w.ax ) * ( z - w.az ) / ( w.bz - w.az ) + w.ax ) c = ! c;
	return c;

}
function edgeDistance( b, x, z ) {

	let d = Infinity;
	for ( const w of b.walls ) {

		const dx = w.bx - w.ax, dz = w.bz - w.az, L2 = dx * dx + dz * dz || 1e-9;
		const t = Math.max( 0, Math.min( 1, ( ( x - w.ax ) * dx + ( z - w.az ) * dz ) / L2 ) );
		d = Math.min( d, Math.hypot( x - w.ax - dx * t, z - w.az - dz * t ) );

	}

	return d;

}

export const rgb555 = ( c ) => ( ( c[ 0 ] >> 3 ) << 10 ) | ( ( c[ 1 ] >> 3 ) << 5 ) | ( c[ 2 ] >> 3 );

export function details( buildings ) {

	const out = Object.fromEntries( DETAIL_TYPES.map( ( t ) => [ t, [] ] ) );
	const log = { victorianLots: 0, victorianLotsWithBay: 0, streetFaces: 0, preWarStreetFaces: 0, preWarFireEscapes: 0, flatRoofs: 0, flatRoofsDressed: 0, tanks: 0, gables: 0 };
	const push = ( type, w, s, y, len, h, depth, variant ) => {

		const f = wallFrame( w );
		out[ type ].push( [ f.ox + f.ax * s, y, f.oz + f.az * s, f.angle, len, h, depth, variant ] );

	};
	for ( const b of buildings ) {

		const arch = ARCH[ b.arch ];
		if ( b.landmark ) continue;
		const fl = floorsOf( b.arch, b.h );
		const topY = b.base + ( fl.f > 0 ? fl.g + Math.floor( ( b.h - fl.g ) / fl.f + 1e-3 ) * fl.f : b.h );
		const flatRoof = arch !== 'sausalito';
		let dressedTop = false;
		for ( const w of b.walls ) {

			if ( w.len < 2 ) continue;
			const sf = !! w.sf;
			if ( sf ) log.streetFaces ++;
			// cornices on street faces; parapets on the other flat-roof walls (and on street faces of plain mid-rises)
			if ( sf && w.len >= 3 && arch !== 'tower' && arch !== 'pier' ) {

				const spec = { victorian: [ 0.62, 0.75 ], midrise: [ 0.4, 0.55 ], warehouse: [ 0.3, 0.5 ], office: [ 1.0, 1.2 ], sausalito: [ 0.35, 0.28 ], chinatown: [ 0.35, 0.5 ] }[ arch ];
				if ( arch === 'midrise' && b.seed > 0.55 ) push( 'parapet', w, 0, b.top, w.len, 0.9, 0.25, rgb555( b.colour ) );
				else push( 'cornice', w, - 0.02, b.top - spec[ 1 ], w.len + 0.04, spec[ 1 ], spec[ 0 ], b.arch * 32768 + rgb555( b.colour ) );
				dressedTop = true;

			} else if ( flatRoof && arch !== 'victorian' ) {

				push( 'parapet', w, 0, b.top, w.len, arch === 'tower' ? 1.2 : arch === 'warehouse' ? 1.1 : 0.9, 0.25, rgb555( arch === 'tower' ? [ 150, 152, 156 ] : b.colour ) );
				dressedTop = true;

			}

			// Victorian: one stacked bay window per 25 ft lot on each street face (F13), floors 2 → top
			if ( sf && arch === 'victorian' && w.len >= 4 ) {

				const lots = Math.max( 1, Math.round( w.len / 7.6 ) ), lw = w.len / lots;
				for ( let k = 0; k < lots; k ++ ) {

					log.victorianLots ++;
					const bw = Math.min( 3.2, lw * 0.5 ), c = k * lw + lw * ( b.seed > 0.5 ? 0.36 : 0.64 );
					const y0 = b.base + fl.g, h = topY - y0 - 0.05;
					if ( ! ( fl.f > 0 ) ) continue; // a one-storey cottage: no upper floor to bay
					push( 'bay', w, c - bw / 2, y0, bw, h, 0.75, Math.round( ( fl.f > 0 ? fl.f : 3 ) * 100 ) * 32768 + rgb555( b.colour ) );
					log.victorianLotsWithBay ++;

				}

			}

			// Edwardian flats: some low mid-rises outside downtown get bays too
			if ( sf && arch === 'midrise' && b.h < 20 && b.seed < 0.4 && w.len >= 6 && b.district !== 'fidi' ) {

				const n = Math.max( 1, Math.round( w.len / 8 ) ), lw = w.len / n;
				for ( let k = 0; k < n; k ++ ) { const bw = Math.min( 3.4, lw * 0.45 ); push( 'bay', w, k * lw + lw / 2 - bw / 2, b.base + fl.g, bw, topY - b.base - fl.g - 0.05, 0.7, Math.round( ( fl.f || 3 ) * 100 ) * 32768 + rgb555( b.colour ) ); }

			}

			// fire escapes on pre-1940 mid-rise / brick / Chinatown street faces (no fire escapes downtown towers)
			const preWar = ( arch === 'midrise' || arch === 'warehouse' || arch === 'chinatown' ) && b.h >= 9 && b.h < 32 && b.district !== 'southBeach';
			if ( sf && preWar && w.len >= 5 ) {

				log.preWarStreetFaces ++;
				if ( b.seed < 0.78 || hash01( w.ax, w.az ) < 0.4 ) {

					const width = Math.min( 3.6, w.len * 0.4 ), s = w.len * ( 0.25 + 0.5 * hash01( w.az, w.ax, 3 ) ) - width / 2;
					const floors = Math.max( 1, Math.floor( ( topY - b.base - fl.g ) / Math.max( fl.f, 2.5 ) + 1e-3 ) );
					for ( let k = 0; k < floors; k ++ ) push( 'fireEscape', w, s, b.base + fl.g + k * fl.f + 0.05, width, Math.min( fl.f, 3.0 ), 0.95, k === floors - 1 ? 1 : 0 );
					log.preWarFireEscapes ++;

				}

			}

			// Chinatown: balconies on upper floors of street faces
			if ( sf && arch === 'chinatown' && w.len >= 4 && fl.f > 0 && inDistrict( 'chinatown', ( w.ax + w.bx ) / 2, ( w.az + w.bz ) / 2 ) ) {

				const floors = Math.floor( ( topY - b.base - fl.g ) / fl.f + 1e-3 );
				for ( let k = 1; k < floors; k += 1 ) if ( hash01( w.ax, w.az, k ) < 0.6 ) push( 'balcony', w, 0.4, b.base + fl.g + k * fl.f, w.len - 0.8, 1.05, 0.9, 0 );

			}

		}

		// roof dressing (F9): flat roofs get boxes (HVAC, stair penthouse), older mid-rises a wooden water tank
		if ( flatRoof && arch !== 'victorian' && b.area > 60 ) {

			log.flatRoofs ++;
			const n = Math.max( 1, Math.min( 6, Math.round( b.area / 260 ) ) );
			let placed = 0;
			for ( let k = 0; k < n * 4 && placed < n; k ++ ) {

				const [ x0, z0, x1, z1 ] = b.bbox;
				const x = x0 + ( x1 - x0 ) * hash01( b.cx, k, 11 ), z = z0 + ( z1 - z0 ) * hash01( b.cz, k, 13 );
				const sx = arch === 'tower' ? 4 + 4 * hash01( x, 1 ) : 1.4 + 1.8 * hash01( x, 2 ), sz = arch === 'tower' ? 4 + 4 * hash01( z, 3 ) : 1.2 + 1.6 * hash01( z, 4 );
				if ( ! insideFootprint( b, x, z ) || edgeDistance( b, x, z ) < Math.hypot( sx, sz ) / 2 + 0.8 ) continue;
				const h = placed === 0 && b.h > 12 ? ( arch === 'tower' ? 5 + 3 * hash01( x, z ) : 2.8 ) : 0.9 + 0.9 * hash01( z, x );
				out.roofBox.push( [ x - sx / 2, b.top, z - sz / 2, 0, sx, h, sz, placed === 0 && b.h > 12 ? 1 : 0 ] );
				placed ++;

			}

			if ( placed ) log.flatRoofsDressed ++;
			if ( ( arch === 'midrise' || arch === 'warehouse' ) && b.h >= 12 && b.h < 40 && b.seed > 0.68 ) {

				for ( let k = 0; k < 8; k ++ ) {

					const x = b.cx + ( hash01( b.cx, k, 21 ) - 0.5 ) * 0.5 * ( b.bbox[ 2 ] - b.bbox[ 0 ] ), z = b.cz + ( hash01( b.cz, k, 23 ) - 0.5 ) * 0.5 * ( b.bbox[ 3 ] - b.bbox[ 1 ] );
					if ( ! insideFootprint( b, x, z ) || edgeDistance( b, x, z ) < 2.4 ) continue;
					out.tank.push( [ x, b.top, z, 0, 3.2, 5.2, 3.2, 0 ] );
					log.tanks ++;
					break;

				}

			}

		}

		// Sausalito: gables on small simple houses (along the longer side)
		if ( arch === 'sausalito' && b.walls.length === 4 && b.area < 260 && b.h < 12 ) {

			const w = b.walls.reduce( ( p, q ) => ( q.len > p.len ? q : p ) ), other = b.walls.find( ( q ) => q !== w && Math.abs( ( q.bx - q.ax ) * ( w.bx - w.ax ) + ( q.bz - q.az ) * ( w.bz - w.az ) ) < 0.2 * q.len * w.len );
			if ( other ) {

				const depth = b.area / w.len;
				push( 'gable', w, 0, b.top, w.len, Math.min( 3.2, depth * 0.38 ), depth, rgb555( [ 164, 92, 62 ] ) );
				log.gables ++;

			}

		}

		if ( ! dressedTop ) b.undressed = true;

	}

	return { out, log };

}

// group instances by 100 m tile → { instances: Float32Array (8 per instance), tiles: [ [ tx, tz, start, count ] ] }
export function tileInstances( list, tile = 100 ) {

	const by = new Map();
	for ( const r of list ) { const k = Math.floor( r[ 0 ] / tile ) + ',' + Math.floor( r[ 2 ] / tile ); if ( ! by.has( k ) ) by.set( k, [] ); by.get( k ).push( r ); }
	const keys = [ ...by.keys() ].sort();
	const inst = new Float32Array( list.length * 8 ), tiles = [];
	let n = 0;
	for ( const k of keys ) {

		const [ tx, tz ] = k.split( ',' ).map( Number );
		const rows = by.get( k );
		tiles.push( [ tx, tz, n, rows.length ] );
		for ( const r of rows ) { inst.set( r, n * 8 ); n ++; }

	}

	return { instances: inst, tiles, tile };

}
