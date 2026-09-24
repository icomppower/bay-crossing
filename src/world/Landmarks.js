import { BufferGeometry, BufferAttribute, Color, Group, Mesh } from '../engine/index.js';
import { Material } from '../engine/render/Material.js';
import { parseGLB } from '../engine/loaders/GLTF.js';

// Landmark models built offline in Blender (tools/landmarks/, public/landmarks/): three LOD GLBs per landmark,
// the level picked by camera distance to the anchor (index.lodDistances).
const _materials = new Map();
function materialFor( m ) {

	const pbr = ( m && m.pbrMetallicRoughness ) || {};
	const key = JSON.stringify( [ pbr.baseColorFactor, pbr.roughnessFactor, pbr.metallicFactor ] );
	if ( ! _materials.has( key ) ) {

		const c = pbr.baseColorFactor || [ 0.8, 0.8, 0.8, 1 ];
		_materials.set( key, new Material( { name: 'landmark-' + ( m && m.name || 'default' ), color: new Color( c[ 0 ], c[ 1 ], c[ 2 ] ),
			roughness: pbr.roughnessFactor ?? 1, metalness: pbr.metallicFactor ?? 0 } ) );

	}

	return _materials.get( key );

}

async function loadLod( base, name ) {

	const r = await fetch( base + 'landmarks/' + name );
	if ( ! r.ok ) throw new Error( `landmarks: ${ name } HTTP ${ r.status }` );
	const glb = parseGLB( await r.arrayBuffer() );
	const g = new Group();
	g.name = name;
	for ( const n of glb.nodes ) {

		if ( n.mesh === undefined ) continue;
		for ( const p of glb.meshes[ n.mesh ] ) {

			const geo = new BufferGeometry();
			geo.setAttribute( 'position', new BufferAttribute( p.attributes.POSITION.array, 3 ) );
			geo.setAttribute( 'normal', new BufferAttribute( p.attributes.NORMAL.array, 3 ) );
			if ( p.indices ) geo.setIndex( new BufferAttribute( p.indices, 1 ) );
			const mesh = new Mesh( geo, materialFor( glb.materials[ p.material ] ) );
			mesh.name = n.name;
			mesh.position.set( ...n.t );
			mesh.castShadow = true;
			mesh.receiveShadow = true;
			g.add( mesh );

		}

	}

	return g;

}

export async function loadLandmarks( base = ( import.meta.env && import.meta.env.BASE_URL ) || '/' ) {

	const index = await ( await fetch( base + 'landmarks/index.json' ) ).json();
	const group = new Group();
	group.name = 'landmarks';
	await Promise.all( index.landmarks.map( async ( L ) => {

		const lods = await Promise.all( L.lods.map( ( l ) => loadLod( base, l.name ) ) );
		const lm = new Group();
		lm.name = L.slug;
		lm.userData = { landmark: L, lods, level: - 1 };
		for ( const g of lods ) { g.visible = false; lm.add( g ); }
		group.add( lm );

	} ) );
	group.userData.index = index;
	group.userData.lodBias = 1;
	group.update = ( camera ) => {

		const [ d0, d1 ] = index.lodDistances, k = group.userData.lodBias, p = camera.position;
		for ( const lm of group.children ) {

			const u = lm.userData, [ ax, az ] = u.landmark.anchor;
			const d = Math.hypot( p.x - ax, p.z - az );
			const level = d < d0 * k ? 0 : d < d1 * k ? 1 : 2;
			if ( level !== u.level ) { u.lods.forEach( ( g, i ) => { g.visible = i === level; } ); u.level = level; }

		}

	};
	return group;

}
