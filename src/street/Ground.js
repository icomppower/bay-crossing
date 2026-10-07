// The street mesh as ground: surface height and walkability at (x, z), from the same triangles that are drawn.
// Every draped street triangle lies inside one 6 m block of the terrain-aligned grid (pipelines/street/mesh.mjs),
// so a lookup tests only the triangles of one cell. Walkable = sidewalk / plaza (materials 5, 6) or a road
// triangle inside a crosswalk band (data.z = 1). Curb faces and skirts (vertical) are not ground.
const CELL = 6; // pipelines/street/mesh.mjs BLOCK: every triangle lies inside one

export class StreetGround {

	constructor( { pos, dat, indices }, gridOrigin ) {

		const st = this.stride = 3, vertices = pos;
		this.v = pos; this.d = dat; this.ix = indices; this.o = gridOrigin;
		this.cells = new Map();
		for ( let t = 0; t < indices.length; t += 3 ) {

			const a = indices[ t ] * st, b = indices[ t + 1 ] * st, c = indices[ t + 2 ] * st;
			// vertical faces have no area in plan
			const area = ( vertices[ b ] - vertices[ a ] ) * ( vertices[ c + 2 ] - vertices[ a + 2 ] ) - ( vertices[ b + 2 ] - vertices[ a + 2 ] ) * ( vertices[ c ] - vertices[ a ] );
			if ( Math.abs( area ) < 1e-6 ) continue;
			const k = this.key( ( vertices[ a ] + vertices[ b ] + vertices[ c ] ) / 3, ( vertices[ a + 2 ] + vertices[ b + 2 ] + vertices[ c + 2 ] ) / 3 );
			let list = this.cells.get( k );
			if ( ! list ) this.cells.set( k, list = [] );
			list.push( t );

		}

	}

	key( x, z ) { return Math.floor( ( z - this.o ) / CELL ) * 100000 + Math.floor( ( x - this.o ) / CELL ); }

	// triangle offset under (x, z), or -1
	find( x, z ) {

		const e = 1e-4;
		for ( let s = 0; s < 5; s ++ ) {

			const dx = s === 1 ? e : s === 2 ? - e : 0, dz = s === 3 ? e : s === 4 ? - e : 0;
			const list = this.cells.get( this.key( x + dx, z + dz ) );
			if ( ! list ) continue;
			for ( const t of list ) if ( this.inTri( t, x, z ) ) return t;

		}

		return - 1;

	}

	inTri( t, x, z ) {

		const v = this.v, s = this.stride, a = this.ix[ t ] * s, b = this.ix[ t + 1 ] * s, c = this.ix[ t + 2 ] * s;
		const d1 = ( v[ b ] - v[ a ] ) * ( z - v[ a + 2 ] ) - ( v[ b + 2 ] - v[ a + 2 ] ) * ( x - v[ a ] );
		const d2 = ( v[ c ] - v[ b ] ) * ( z - v[ b + 2 ] ) - ( v[ c + 2 ] - v[ b + 2 ] ) * ( x - v[ b ] );
		const d3 = ( v[ a ] - v[ c ] ) * ( z - v[ c + 2 ] ) - ( v[ a + 2 ] - v[ c + 2 ] ) * ( x - v[ c ] );
		const e = 1e-7;
		return ( d1 <= e && d2 <= e && d3 <= e ) || ( d1 >= - e && d2 >= - e && d3 >= - e );

	}

	yAt( t, x, z ) {

		const v = this.v, s = this.stride, a = this.ix[ t ] * s, b = this.ix[ t + 1 ] * s, c = this.ix[ t + 2 ] * s;
		const det = ( v[ b + 2 ] - v[ c + 2 ] ) * ( v[ a ] - v[ c ] ) + ( v[ c ] - v[ b ] ) * ( v[ a + 2 ] - v[ c + 2 ] );
		const l1 = ( ( v[ b + 2 ] - v[ c + 2 ] ) * ( x - v[ c ] ) + ( v[ c ] - v[ b ] ) * ( z - v[ c + 2 ] ) ) / det;
		const l2 = ( ( v[ c + 2 ] - v[ a + 2 ] ) * ( x - v[ c ] ) + ( v[ a ] - v[ c ] ) * ( z - v[ c + 2 ] ) ) / det;
		return l1 * v[ a + 1 ] + l2 * v[ b + 1 ] + ( 1 - l1 - l2 ) * v[ c + 1 ];

	}

	material( t ) { return this.d[ this.ix[ t ] * 4 ]; }

	// { y, mat, walkable } at (x, z), or null off the street mesh
	at( x, z ) {

		const t = this.find( x, z );
		if ( t < 0 ) return null;
		const k = this.ix[ t ] * 4, mat = this.d[ k ];
		return { y: this.yAt( t, x, z ), mat, walkable: mat === 5 || mat === 6 || this.d[ k + 2 ] === 1 };

	}

	heightAt( x, z ) {

		const t = this.find( x, z );
		return t < 0 ? null : this.yAt( t, x, z );

	}

}

// The player stands on the street surface where there is one: wrap the terrain it walks on.
export function streetTerrain( terrain, ground ) {

	const proxy = Object.create( terrain );
	proxy.heightAt = ( x, z ) => {

		const g = ground.heightAt( x, z );
		return g === null ? terrain.heightAt( x, z ) : Math.max( g, terrain.heightAt( x, z ) );

	};
	return proxy;

}
