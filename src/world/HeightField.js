import { toLocal } from './BayFrame.js';

// A square heightfield over the world domain (centred on the origin), with the accessors the ocean, terrain,
// shore and player systems read: heights, heightAt / normalAt, coastDistance, and the min/max pyramid for
// CDLOD culling (boundsFor). The per-texel material masks (rock, sand, ...) are zero until a pipeline fills
// them. Replaces Tidewater's procedural island (TerrainData); G2a fills it from the bay terrain tiles.
export class HeightField {

	constructor( { size, res, heights = null, fill = - 20 } ) {

		this.size = size;
		this.res = res;
		this.texel = size / res;
		this.origin = - size / 2;
		const n = res * res;
		this.heights = heights || new Float32Array( n ).fill( fill );
		this.rock = new Float32Array( n );
		this.sand = new Uint8Array( n );
		this.path = new Uint8Array( n );
		this.gully = new Uint8Array( n );
		this.seagrass = new Uint8Array( n );
		this.rubble = new Uint8Array( n );
		this.scarp = new Uint8Array( n );
		this.pads = [];
		this.buildMinMax();
		this.buildCoastDistance();

	}

	heightAt( x, z ) {

		const { res, texel, origin, heights } = this;
		const fx = ( x - origin ) / texel - 0.5, fz = ( z - origin ) / texel - 0.5;
		if ( fx < 0 || fz < 0 || fx >= res - 1 || fz >= res - 1 ) return - 90;
		const i = Math.floor( fx ), j = Math.floor( fz );
		const tx = fx - i, tz = fz - j;
		const k = j * res + i;
		const a = heights[ k ], b = heights[ k + 1 ], c = heights[ k + res ], d = heights[ k + res + 1 ];
		return ( a * ( 1 - tx ) + b * tx ) * ( 1 - tz ) + ( c * ( 1 - tx ) + d * tx ) * tz;

	}

	heightAtUTM( E, N ) {

		const p = toLocal( E, N );
		return this.heightAt( p.x, p.z );

	}

	normalAt( x, z, out ) {

		const e = this.texel;
		const hx = this.heightAt( x + e, z ) - this.heightAt( x - e, z );
		const hz = this.heightAt( x, z + e ) - this.heightAt( x, z - e );
		out.set( - hx, 2 * e, - hz ).normalize();
		return out;

	}

	// Signed distance (m) to the waterline: > 0 over water, < 0 on land. Chamfer distance transform on a
	// coarse grid (<= 1024^2), sampled bilinearly.
	buildCoastDistance() {

		const n = Math.min( 1024, this.res ), step = this.res / n, cell = this.size / n;
		const wet = new Uint8Array( n * n );
		for ( let j = 0; j < n; j ++ ) for ( let i = 0; i < n; i ++ ) wet[ j * n + i ] = this.heights[ Math.floor( ( j + 0.5 ) * step ) * this.res + Math.floor( ( i + 0.5 ) * step ) ] < 0 ? 1 : 0;
		const dist = ( inside ) => {

			const D = new Float32Array( n * n ).fill( 1e9 );
			for ( let k = 0; k < n * n; k ++ ) if ( wet[ k ] !== inside ) D[ k ] = 0;
			const a = 1, b = Math.SQRT2;
			for ( let j = 0; j < n; j ++ ) for ( let i = 0; i < n; i ++ ) {

				const k = j * n + i;
				if ( i > 0 ) D[ k ] = Math.min( D[ k ], D[ k - 1 ] + a );
				if ( j > 0 ) {

					D[ k ] = Math.min( D[ k ], D[ k - n ] + a );
					if ( i > 0 ) D[ k ] = Math.min( D[ k ], D[ k - n - 1 ] + b );
					if ( i < n - 1 ) D[ k ] = Math.min( D[ k ], D[ k - n + 1 ] + b );

				}

			}

			for ( let j = n - 1; j >= 0; j -- ) for ( let i = n - 1; i >= 0; i -- ) {

				const k = j * n + i;
				if ( i < n - 1 ) D[ k ] = Math.min( D[ k ], D[ k + 1 ] + a );
				if ( j < n - 1 ) {

					D[ k ] = Math.min( D[ k ], D[ k + n ] + a );
					if ( i < n - 1 ) D[ k ] = Math.min( D[ k ], D[ k + n + 1 ] + b );
					if ( i > 0 ) D[ k ] = Math.min( D[ k ], D[ k + n - 1 ] + b );

				}

			}

			return D;

		};

		const toLand = dist( 1 ), toWater = dist( 0 );
		const sd = new Float32Array( n * n );
		for ( let k = 0; k < n * n; k ++ ) sd[ k ] = wet[ k ] ? Math.min( toLand[ k ], 1e6 ) * cell : - Math.min( toWater[ k ], 1e6 ) * cell;
		this.coastN = n;
		this.coastCell = cell;
		this.coastSD = sd;

	}

	coastDistance( x, z ) {

		const n = this.coastN, fx = ( x - this.origin ) / this.coastCell - 0.5, fz = ( z - this.origin ) / this.coastCell - 0.5;
		const i = Math.max( 0, Math.min( n - 2, Math.floor( fx ) ) ), j = Math.max( 0, Math.min( n - 2, Math.floor( fz ) ) );
		const tx = Math.max( 0, Math.min( 1, fx - i ) ), tz = Math.max( 0, Math.min( 1, fz - j ) );
		const S = this.coastSD, k = j * n + i;
		const d = ( S[ k ] * ( 1 - tx ) + S[ k + 1 ] * tx ) * ( 1 - tz ) + ( S[ k + n ] * ( 1 - tx ) + S[ k + n + 1 ] * tx ) * tz;
		return { d, beachZone: 0 };

	}

	// min/max pyramid for CDLOD culling bounds
	buildMinMax() {

		const tile = 8;
		const n = Math.ceil( this.res / tile );
		this.mmTile = tile;
		const H = this.heights, res = this.res;
		const mn0 = new Float32Array( n * n ), mx0 = new Float32Array( n * n );
		for ( let tj = 0; tj < n; tj ++ ) for ( let ti = 0; ti < n; ti ++ ) {

			let mn = Infinity, mx = - Infinity;
			const jEnd = Math.min( res - 1, ( tj + 1 ) * tile ), iEnd = Math.min( res - 1, ( ti + 1 ) * tile );
			for ( let j = tj * tile; j <= jEnd; j ++ ) for ( let i = ti * tile; i <= iEnd; i ++ ) {

				const h = H[ j * res + i ];
				if ( h < mn ) mn = h;
				if ( h > mx ) mx = h;

			}

			mn0[ tj * n + ti ] = mn;
			mx0[ tj * n + ti ] = mx;

		}

		this.mmLevels = [ { n, min: mn0, max: mx0 } ];
		let cur = this.mmLevels[ 0 ];
		while ( cur.n > 1 ) {

			// ceil halving keeps odd edges (a lone last tile is its own parent)
			const m = Math.ceil( cur.n / 2 );
			const mn = new Float32Array( m * m ).fill( Infinity ), mx = new Float32Array( m * m ).fill( - Infinity );
			for ( let j = 0; j < cur.n; j ++ ) for ( let i = 0; i < cur.n; i ++ ) {

				const p = ( j >> 1 ) * m + ( i >> 1 ), k = j * cur.n + i;
				if ( cur.min[ k ] < mn[ p ] ) mn[ p ] = cur.min[ k ];
				if ( cur.max[ k ] > mx[ p ] ) mx[ p ] = cur.max[ k ];

			}

			cur = { n: m, min: mn, max: mx };
			this.mmLevels.push( cur );

		}

	}

	boundsFor( x0, z0, x1, z1 ) {

		const { origin, texel, mmTile } = this;
		const span = Math.max( x1 - x0, z1 - z0 ) / ( texel * mmTile );
		const l = Math.max( 0, Math.min( this.mmLevels.length - 1, Math.ceil( Math.log2( Math.max( 1, span / 2 ) ) ) ) );
		const L = this.mmLevels[ l ];
		const ts = texel * mmTile * ( 1 << l );
		const i0 = Math.floor( ( x0 - origin ) / ts ), i1 = Math.floor( ( x1 - origin ) / ts );
		const j0 = Math.floor( ( z0 - origin ) / ts ), j1 = Math.floor( ( z1 - origin ) / ts );
		let mn = Infinity, mx = - Infinity, outside = false;
		for ( let j = j0; j <= j1; j ++ ) for ( let i = i0; i <= i1; i ++ ) {

			if ( i < 0 || j < 0 || i >= L.n || j >= L.n ) {

				outside = true;
				continue;

			}

			const k = j * L.n + i;
			if ( L.min[ k ] < mn ) mn = L.min[ k ];
			if ( L.max[ k ] > mx ) mx = L.max[ k ];

		}

		if ( outside ) {

			mn = Math.min( mn, - 90 );
			mx = Math.max( mx, - 90 );

		}

		return [ mn - 1, mx + 2 ];

	}

}
