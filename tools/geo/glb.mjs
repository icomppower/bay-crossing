// Deterministic binary glTF writer: one scene, one node per mesh (with translation), triangle primitives,
// tightly packed accessors, 4-byte aligned chunks. No clocks or random ids, so equal input gives equal bytes.
const TYPE = { 1: 'SCALAR', 2: 'VEC2', 3: 'VEC3', 4: 'VEC4' };
const CT = { Float32Array: 5126, Uint32Array: 5125, Uint16Array: 5123, Uint8Array: 5121, Int16Array: 5122, Int8Array: 5120 };

export function writeGLB( { meshes, generator = 'bay-crossing', extras = undefined } ) {

	const chunks = [], bufferViews = [], accessors = [];
	let offset = 0;
	const push = ( arr, itemSize, { normalized = false, target, minmax = false } ) => {

		const bytes = new Uint8Array( arr.buffer, arr.byteOffset, arr.byteLength );
		const pad = ( 4 - ( bytes.length % 4 ) ) % 4;
		bufferViews.push( { buffer: 0, byteOffset: offset, byteLength: bytes.length, ...( target ? { target } : {} ) } );
		chunks.push( bytes, new Uint8Array( pad ) );
		offset += bytes.length + pad;
		const acc = { bufferView: bufferViews.length - 1, componentType: CT[ arr.constructor.name ], count: arr.length / itemSize, type: TYPE[ itemSize ] };
		if ( normalized ) acc.normalized = true;
		if ( minmax ) {

			const mn = new Array( itemSize ).fill( Infinity ), mx = new Array( itemSize ).fill( - Infinity );
			for ( let i = 0; i < arr.length; i += itemSize ) for ( let c = 0; c < itemSize; c ++ ) { mn[ c ] = Math.min( mn[ c ], arr[ i + c ] ); mx[ c ] = Math.max( mx[ c ], arr[ i + c ] ); }
			acc.min = mn.map( Math.fround ); acc.max = mx.map( Math.fround );

		}

		accessors.push( acc );
		return accessors.length - 1;

	};

	const gltfMeshes = [], nodes = [];
	for ( const m of meshes ) {

		const attributes = {};
		attributes.POSITION = push( m.position, 3, { target: 34962, minmax: true } );
		if ( m.normal ) attributes.NORMAL = push( m.normal, 3, { target: 34962 } );
		if ( m.uv ) attributes.TEXCOORD_0 = push( m.uv, 2, { target: 34962 } );
		if ( m.color ) attributes.COLOR_0 = push( m.color, 4, { target: 34962, normalized: true } );
		const indices = push( m.index, 1, { target: 34963 } );
		gltfMeshes.push( { name: m.name, primitives: [ { attributes, indices, mode: 4 } ] } );
		nodes.push( { name: m.name, mesh: gltfMeshes.length - 1, translation: m.translation || [ 0, 0, 0 ], ...( m.extras ? { extras: m.extras } : {} ) } );

	}

	const json = {
		asset: { version: '2.0', generator }, scene: 0, scenes: [ { nodes: nodes.map( ( _, i ) => i ) } ],
		nodes, meshes: gltfMeshes, accessors, bufferViews, buffers: [ { byteLength: offset } ],
		...( extras ? { extras } : {} ),
	};
	let js = Buffer.from( JSON.stringify( json ), 'utf8' );
	js = Buffer.concat( [ js, Buffer.alloc( ( 4 - ( js.length % 4 ) ) % 4, 0x20 ) ] );
	const bin = Buffer.concat( chunks.map( ( c ) => Buffer.from( c.buffer, c.byteOffset, c.byteLength ) ) );
	const header = Buffer.alloc( 12 ), jh = Buffer.alloc( 8 ), bh = Buffer.alloc( 8 );
	header.writeUInt32LE( 0x46546C67, 0 ); header.writeUInt32LE( 2, 4 ); header.writeUInt32LE( 12 + 8 + js.length + 8 + bin.length, 8 );
	jh.writeUInt32LE( js.length, 0 ); jh.writeUInt32LE( 0x4E4F534A, 4 );
	bh.writeUInt32LE( bin.length, 0 ); bh.writeUInt32LE( 0x004E4942, 4 );
	return Buffer.concat( [ header, jh, js, bh, bin ] );

}
