import { BufferGeometry, BufferAttribute, Group, Mesh } from '../engine/index.js';
import { Material } from '../engine/render/Material.js';
import { parseGLB } from '../engine/loaders/GLTF.js';

// Extruded bay buildings (public/buildings/, built by tools/buildings/build.mjs): one deflated GLB per
// 600 m tile, positions relative to the tile centre (node translation). Vertex colour = facade tint (rgb)
// and class (a: 0 house, 0.5 mid-rise, 1 tower); uv = metres along the wall / above the base (walls) or
// world x, z (roofs). The facade is procedural: storey bands and window bays from the uv, lit windows at
// night (G.night).
export function buildingMaterial() {

	return new Material( {
		name: 'bay-buildings',
		vertexColors: true,
		roughness: 0.85,
		surface: /* wgsl */`
	let tint = in.color.rgb;
	let cls = in.color.a;
	let roof = abs( in.N.y ) > 0.5;
	var albedo = tint;
	var rough = 0.85;
	var metal = 0.0;
	var glow = 0.0;
	if ( ! roof ) {

		// storeys and bays: towers 3.8 m / 1.5 m glass modules, mid-rise 3.6 m / 3 m, houses 3 m / 2.4 m
		let storey = select( select( 3.0, 3.6, cls > 0.25 ), 3.8, cls > 0.75 );
		let bay = select( select( 2.4, 3.0, cls > 0.25 ), 1.5, cls > 0.75 );
		let fy = fract( in.uv.y / storey );
		let fx = fract( in.uv.x / bay );
		let glassFrac = select( select( 0.35, 0.5, cls > 0.25 ), 0.85, cls > 0.75 );
		let win = step( 0.5 - 0.5 * glassFrac, fx ) * step( fx, 0.5 + 0.5 * glassFrac ) * step( 0.28, fy ) * step( fy, 0.82 ) * step( 1.2, in.uv.y );
		let glass = mix( vec3f( 0.10, 0.12, 0.14 ), vec3f( 0.22, 0.28, 0.33 ), select( 0.0, 1.0, cls > 0.75 ) );
		albedo = mix( tint, glass, win );
		rough = mix( 0.85, 0.12, win );
		metal = mix( 0.0, 0.6, win * select( 0.0, 1.0, cls > 0.75 ) );
		// lit windows after dusk: a stable per-window hash decides which are lit
		let cell = floor( vec2f( in.uv.x / bay, in.uv.y / storey ) ) + floor( in.P.xz * 0.013 ) * 17.0;
		let h = fract( sin( dot( cell, vec2f( 12.9898, 78.233 ) ) ) * 43758.5453 );
		glow = win * step( 0.55, h ) * frame.night;

	} else {

		albedo = tint * 0.72;

	}
	s.albedo = albedo;
	s.roughness = rough;
	s.metalness = metal;
	s.emissive = vec3f( 1.0, 0.78, 0.5 ) * glow * 2.2;
`,
	} );

}

export async function loadBayBuildings( base = ( import.meta.env && import.meta.env.BASE_URL ) || '/' ) {

	const index = await ( await fetch( base + 'buildings/index.json' ) ).json();
	const material = buildingMaterial();
	const group = new Group();
	group.name = 'bay-buildings';
	await Promise.all( index.files.map( async ( f ) => {

		const r = await fetch( base + 'buildings/' + f.name );
		if ( ! r.ok ) throw new Error( `buildings: ${ f.name } HTTP ${ r.status }` );
		const glb = parseGLB( await new Response( r.body.pipeThrough( new DecompressionStream( 'deflate' ) ) ).arrayBuffer() );
		const node = glb.nodes[ glb.roots ? glb.roots[ 0 ] : 0 ];
		const p = glb.meshes[ node.mesh ][ 0 ];
		const g = new BufferGeometry();
		g.setAttribute( 'position', new BufferAttribute( p.attributes.POSITION.array, 3 ) );
		g.setAttribute( 'normal', new BufferAttribute( p.attributes.NORMAL.array, 3 ) );
		g.setAttribute( 'uv', new BufferAttribute( p.attributes.TEXCOORD_0.array, 2 ) );
		const c8 = p.attributes.COLOR_0.array, c = new Float32Array( c8.length );
		for ( let k = 0; k < c8.length; k ++ ) c[ k ] = k % 4 === 3 ? c8[ k ] / 255 : Math.pow( c8[ k ] / 255, 2.2 ); // sRGB tint -> linear
		g.setAttribute( 'color', new BufferAttribute( c, 4 ) );
		g.setIndex( new BufferAttribute( p.indices, 1 ) );
		g.computeBoundingSphere && g.computeBoundingSphere();
		const mesh = new Mesh( g, material );
		mesh.name = node.name;
		mesh.position.set( ...node.t );
		mesh.castShadow = true;
		mesh.receiveShadow = true;
		mesh.userData.tile = f;
		group.add( mesh );

	} ) );
	group.userData.index = index;
	return group;

}
