import { ComputeKernel, GPU } from '../engine/webgpu.js';

// Box-filtered mip chain of a square power-of-two 2d / 2d-array / cube texture in a few compute
// dispatches, instead of a render pass per level and layer (generateMipmaps). Each stage reads one
// level and writes the next few through workgroup memory:
//   S x S threads (S <= 16) per 2S x 2S tile of the level read -> up to log2( S ) + 1 levels
// At most maxStorageTexturesPerShaderStage levels per stage (4 on WebGPU's default limits): with 8
// (Apple) that is levels 1..5 from level 0, then one workgroup per layer from level 5 to the end.
// The texture needs 'storage' usage and a storage-capable float format (e.g. rgba16float).
//
//   const mips = new ComputeMips( tex, 'label' );
//   GPU.computePass( 'x', ( pass ) => mips.dispatch( pass ) );   // or mips.dispatch() (own pass)
export class ComputeMips {

	constructor( tex, label = tex.label ) {

		const res = tex.width;
		if ( tex.height !== res || res & ( res - 1 ) || res < 32 || res > 512 ) throw new Error( 'ComputeMips: square power-of-two 32..512 only' );
		this.res = res;
		this.layers = tex.dimension === '3d' ? 1 : tex.depth;
		const levels = tex.mipLevelCount;
		const out = ( l ) => ( { storageTexture: tex, access: 'write', view: { dimension: '2d-array', baseMipLevel: l, mipLevelCount: 1 } } );
		const src = ( l ) => ( { texture: tex, view: { dimension: '2d-array', baseMipLevel: l, mipLevelCount: 1 } } );
		// threads (lx, ly) < width reduce 2x2 of `from` (row 2 * width) into level lvl (and `to`)
		const reduce = ( from, to, width, lvl ) => /* wgsl */`
	if ( lx < ${ width }u && ly < ${ width }u ) {
		let i = ly * ${ 4 * width }u + lx * 2u;
		let v = ( ${ from }[ i ] + ${ from }[ i + 1u ] + ${ from }[ i + ${ 2 * width }u ] + ${ from }[ i + ${ 2 * width + 1 }u ] ) * 0.25;
		textureStore( out${ lvl }, vec2u( gx * ${ width }u + lx, gy * ${ width }u + ly ), layer, v );
		${ to ? `${ to }[ ly * ${ width }u + lx ] = v;` : '' }
	}
	workgroupBarrier();`;

		const maxOut = Math.max( 1, Math.min( 8, GPU.limits?.maxStorageTexturesPerShaderStage ?? 4 ) );
		this.stages = [];
		for ( let base = 0; base < levels - 1; ) {

			const wb = res >> base; // width of the level read
			const S = Math.min( 16, wb >> 1 );
			const count = Math.min( maxOut, levels - 1 - base, Math.log2( S ) + 1 );
			const b = { [ 'src' + base ]: src( base ) };
			for ( let l = base + 1; l <= base + count; l ++ ) b[ 'out' + l ] = out( l );
			let decl = '', code = '';
			for ( let j = 1; j < count; j ++ ) decl += `var<workgroup> s${ j }: array<vec4f, ${ ( S >> ( j - 1 ) ) ** 2 }>;\n`;
			for ( let j = 2, w = S >> 1; j <= count; j ++, w >>= 1 ) code += reduce( 's' + ( j - 1 ), j < count ? 's' + j : null, w, base + j );
			const kernel = new ComputeKernel( {
				label: `${ label } mips ${ String.fromCharCode( 65 + this.stages.length ) }`,
				bindings: b,
				workgroupSize: [ S, S, 1 ],
				code: /* wgsl */`
${ decl }
@compute @workgroup_size( WG_X, WG_Y, WG_Z )
fn main( @builtin( local_invocation_id ) lid: vec3u, @builtin( workgroup_id ) wid: vec3u ) {
	let lx = lid.x; let ly = lid.y;
	let gx = wid.x; let gy = wid.y; let layer = wid.z;
	let x1 = gx * ${ S }u + lx; let y1 = gy * ${ S }u + ly;
	let p = vec2u( x1, y1 ) * 2u;
	let v1 = ( textureLoad( src${ base }, p, layer, 0 ) + textureLoad( src${ base }, p + vec2u( 1u, 0u ), layer, 0 ) + textureLoad( src${ base }, p + vec2u( 0u, 1u ), layer, 0 ) + textureLoad( src${ base }, p + vec2u( 1u, 1u ), layer, 0 ) ) * 0.25;
	textureStore( out${ base + 1 }, vec2u( x1, y1 ), layer, v1 );
	${ count > 1 ? `s1[ ly * ${ S }u + lx ] = v1;\n\tworkgroupBarrier();` : '' }
${ code }
}`,
			} );
			this.stages.push( { kernel, groups: wb / ( 2 * S ) } );
			base += count;

		}

	}

	dispatch( pass = null ) {

		const o = pass ? { pass } : undefined;
		for ( const { kernel, groups } of this.stages ) kernel.dispatch( [ groups, groups, this.layers ], o );

	}

}
