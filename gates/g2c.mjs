// G2c Landmarks + LOD: landmark GLBs built offline in Blender (3 LODs each); building LODs merged per CDLOD
// tile (one mesh per LOD per 600 m quadtree node); triangle and draw-call caps (calibrated, frozen in
// SPEC-THRESHOLDS.md) hold at the fixed viewpoints in the real App, and per tile.
// --negative: each mutation must trip the check it targets.
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { root } from './lib/tiles.mjs';
import { readThresholds, freeze } from './lib/thresholds.mjs';
import { VIEWS, poseFor } from './lib/views.mjs';
import { parseGLB } from '../src/engine/loaders/GLTF.js';
import { toUTM } from '../tools/geo/utm.mjs';

const NEG = process.argv.includes( '--negative' );
const CAP_FACTOR = 1.5; // calibration rule: cap = 1.5 × the measured maximum (headroom for the ferry, piers, UI)

// ---- in-App measurement (child process: one App per process)
async function measure( sabotage ) {

	const { bootApp } = await import( '../tools/headless/app.mjs' );
	const { Vector3, Mesh } = await import( '../src/engine/index.js' );
	const H = await bootApp( { width: 1920, height: 1080, query: '?fly&noAudio' } );
	const app = H.app;
	if ( sabotage === 'nolod' ) { app.buildings.userData.lodBias = 1e9; app.landmarks.userData.lodBias = 1e9; }
	if ( sabotage === 'unmerged' ) {

		// one mesh per ~60 triangles-worth of building (roughly one per building): draw calls explode
		for ( const tile of app.buildings.children ) for ( const [ li, m ] of tile.userData.lods.entries() ) {

			const n = m.geometry.index.count, parts = Math.max( 1, Math.floor( n / 180 ) ), step = Math.ceil( n / parts / 3 ) * 3;
			for ( let s = step; s < n; s += step ) {

				const g = m.geometry.clone(); g.setDrawRange( s, step );
				const part = new Mesh( g, m.material ); part.position.copy( m.position ); part.visible = false;
				tile.add( part ); tile.userData.lods[ li ] = tile.userData.lods[ li ].isGroup ? tile.userData.lods[ li ] : tile.userData.lods[ li ];
				( m.userData.parts || ( m.userData.parts = [] ) ).push( part );

			}

			m.geometry.setDrawRange( 0, step );

		}

		const upd = app.buildings.update;
		app.buildings.update = ( cam ) => { upd( cam ); for ( const t of app.buildings.children ) for ( const m of t.userData.lods ) for ( const p of m.userData.parts || [] ) p.visible = m.visible; };

	}

	const out = [];
	for ( const v of VIEWS ) {

		const p = await poseFor( v );
		app.settings.timeOfDay = 16;
		app.fly.setPose( new Vector3( p.x, p.y, p.z ), p.yaw, p.pitch );
		H.frames( 12, 1 / 30 );
		await H.settle();
		H.frames( 1, 1 / 30 );
		const st = app.engine.meshRenderer.stats;
		// city layer: triangles of the building + landmark LOD meshes handed to the renderer this frame
		let city = 0;
		const count = ( o ) => { if ( ! o.visible ) return; if ( o.isMesh ) { const r = o.geometry.drawRange, n = o.geometry.index.count; city += Math.min( n - r.start, r.count ) / 3; } for ( const c of o.children ) count( c ); };
		count( app.buildings ); count( app.landmarks );
		out.push( { view: v[ 0 ], triangles: st.triangles, draws: st.draws, city } );

	}

	return { views: out, errors: H.errors.length };

}

if ( process.argv.includes( '--measure' ) ) {

	const s = ( process.argv.find( ( a ) => a.startsWith( '--sabotage=' ) ) || '' ).split( '=' )[ 1 ];
	console.log( 'MEASURE ' + JSON.stringify( await measure( s ) ) );
	process.exit( 0 );

}

function measureChild( sabotage = '' ) {

	const r = spawnSync( process.execPath, [ fileURLToPath( import.meta.url ), '--measure', ...( sabotage ? [ '--sabotage=' + sabotage ] : [] ) ], { encoding: 'utf8', maxBuffer: 1 << 26 } );
	const line = ( r.stdout || '' ).split( '\n' ).find( ( l ) => l.startsWith( 'MEASURE ' ) );
	if ( ! line ) throw new Error( 'measurement crashed: ' + ( r.stderr || '' ).slice( - 800 ) );
	return JSON.parse( line.slice( 8 ) );

}

// ---- static checks: landmarks, per-tile merge + LOD structure, per-tile cap
function staticChecks( { buildingIndex, landmarkIndex, caps } ) {

	const fail = [];
	const span = 600, o = - 4800;
	let maxTile = 0;
	for ( const f of buildingIndex.files ) {

		const lods = [ f, ...( f.lods || [] ) ];
		if ( lods.length !== 3 ) fail.push( `merge: tile ${ f.i },${ f.j } has ${ lods.length } LOD files, expected 3` );
		for ( const [ k, l ] of lods.entries() ) {

			const buf = readFileSync( join( root, 'public/buildings', l.name ) );
			const { inflateSync } = process.getBuiltinModule( 'node:zlib' );
			const g = parseGLB( inflateSync( buf ).buffer.slice( 0 ) );
			if ( g.meshes.length !== 1 || g.nodes.length !== 1 ) fail.push( `merge: ${ l.name } holds ${ g.meshes.length } meshes / ${ g.nodes.length } nodes, expected one merged mesh` );
			const [ tx, , tz ] = g.nodes[ 0 ].t;
			if ( Math.abs( tx - ( o + span * ( f.i + 0.5 ) ) ) > 1e-6 || Math.abs( tz - ( o + span * ( f.j + 0.5 ) ) ) > 1e-6 ) fail.push( `merge: ${ l.name } is not centred on its 600 m quadtree node` );
			if ( k > 0 && l.triangles > lods[ k - 1 ].triangles ) fail.push( `lod: ${ l.name } has more triangles than the level before it` );

		}

		maxTile = Math.max( maxTile, f.triangles );

	}

	if ( caps.tile !== undefined && maxTile > caps.tile ) fail.push( `cap: a building tile holds ${ maxTile } LOD0 triangles, cap ${ caps.tile }` );
	const wanted = [ 'alcatraz', 'coit-tower', 'ferry-building', 'golden-gate-bridge', 'transamerica-pyramid' ];
	const have = landmarkIndex.landmarks.map( ( l ) => l.slug ).sort();
	if ( have.join() !== wanted.join() ) fail.push( `landmarks: have [${ have }], expected [${ wanted }]` );
	if ( ! /^Blender 5\./.test( landmarkIndex.blender || '' ) ) fail.push( `landmarks: not built by Blender 5.x (index says '${ landmarkIndex.blender }')` );
	for ( const L of landmarkIndex.landmarks ) {

		if ( L.lods.length !== 3 ) fail.push( `landmarks: ${ L.slug } has ${ L.lods.length } LODs` );
		for ( let k = 1; k < L.lods.length; k ++ ) if ( L.lods[ k ].triangles > L.lods[ k - 1 ].triangles ) fail.push( `lod: ${ L.slug } LOD${ k } has more triangles than LOD${ k - 1 }` );
		for ( const l of L.lods ) {

			const buf = readFileSync( join( root, 'public/landmarks', l.name ) );
			const g = parseGLB( buf.buffer.slice( buf.byteOffset, buf.byteOffset + buf.length ) );
			const tris = g.meshes.flat().reduce( ( s, p ) => s + p.indices.length / 3, 0 );
			if ( tris !== l.triangles || tris === 0 ) fail.push( `landmarks: ${ l.name } holds ${ tris } triangles, index says ${ l.triangles }` );

		}

	}

	// the bridge sits on its towers: GG tower legs straddle the OSM tower centres (within 2 m)
	const gg = landmarkIndex.landmarks.find( ( l ) => l.slug === 'golden-gate-bridge' );
	if ( gg ) {

		const osm = JSON.parse( readFileSync( join( root, 'data/raw/landmarks-osm.json' ), 'utf8' ) ).elements.filter( ( e ) => e.tags?.[ 'tower:type' ] === 'bridge' && e.geometry );
		const buf = readFileSync( join( root, 'public/landmarks', gg.lods[ 0 ].name ) );
		const g = parseGLB( buf.buffer.slice( buf.byteOffset, buf.byteOffset + buf.length ) );
		for ( const north of [ false, true ] ) {

			const pts = osm.filter( ( e ) => ( e.geometry[ 0 ].lat > 37.82 ) === north ).flatMap( ( e ) => e.geometry.map( ( q ) => toUTM( q.lat, q.lon ) ) );
			const cx = pts.reduce( ( s, p ) => s + p[ 0 ], 0 ) / pts.length - 549504, cz = 4186800 - pts.reduce( ( s, p ) => s + p[ 1 ], 0 ) / pts.length;
			// the tower-leg tops: everything above 223 m (the cables peak at the 220 m saddles + 0.46 m radius)
			let sx = 0, sz = 0, n = 0;
			for ( const node of g.nodes ) if ( node.mesh !== undefined ) for ( const p of g.meshes[ node.mesh ] ) {

				const P = p.attributes.POSITION.array;
				for ( let v = 0; v < P.length; v += 3 ) if ( P[ v + 1 ] + node.t[ 1 ] > 223 && Math.hypot( P[ v ] + node.t[ 0 ] - cx, P[ v + 2 ] + node.t[ 2 ] - cz ) < 60 ) { sx += P[ v ] + node.t[ 0 ]; sz += P[ v + 2 ] + node.t[ 2 ]; n ++; }

			}

			const d = n ? Math.hypot( sx / n - cx, sz / n - cz ) : Infinity;
			if ( ! ( d < 2 ) ) fail.push( `landmarks: Golden Gate ${ north ? 'north' : 'south' } tower top is ${ d.toFixed( 1 ) } m from the OSM tower centre` );

		}

	}

	return { fail, maxTile };

}

function frameChecks( m, caps ) {

	const fail = [];
	if ( m.errors ) fail.push( `render: ${ m.errors } console/GPU errors` );
	for ( const v of m.views ) {

		if ( v.city > caps.city ) fail.push( `cap-city: ${ v.view } submits ${ v.city } building + landmark triangles/frame, cap ${ caps.city }` );
		if ( v.triangles > caps.triangles ) fail.push( `cap-triangles: ${ v.view } draws ${ v.triangles } triangles/frame (all passes), cap ${ caps.triangles }` );
		if ( v.draws > caps.draws ) fail.push( `cap-draws: ${ v.view } issues ${ v.draws } draw calls/frame, cap ${ caps.draws }` );

	}

	return fail;

}

const buildingIndex = JSON.parse( readFileSync( join( root, 'public/buildings/index.json' ), 'utf8' ) );
const landmarkIndex = JSON.parse( readFileSync( join( root, 'public/landmarks/index.json' ), 'utf8' ) );

// calibrate on first run (frozen afterwards)
let T = readThresholds();
const today = new Date().toISOString().slice( 0, 10 );
if ( ! [ 'G2c.cityTriangles', 'G2c.frameTriangles', 'G2c.frameDraws', 'G2c.tileTriangles' ].every( ( k ) => k in T ) ) {

	const m = measureChild();
	const mt = Math.max( ...m.views.map( ( v ) => v.triangles ) ), md = Math.max( ...m.views.map( ( v ) => v.draws ) );
	const mc = Math.max( ...m.views.map( ( v ) => v.city ) );
	const worstT = m.views.find( ( v ) => v.triangles === mt ).view, worstD = m.views.find( ( v ) => v.draws === md ).view, worstC = m.views.find( ( v ) => v.city === mc ).view;
	freeze( 'G2c.cityTriangles', Math.ceil( mc * CAP_FACTOR ), `building + landmark LOD triangles submitted per frame, fixed views (gates/lib/views.mjs); measured max ${ mc } at ${ worstC } on ${ today }; cap = ${ CAP_FACTOR } × measured` );
	const { maxTile } = staticChecks( { buildingIndex, landmarkIndex, caps: {} } );
	freeze( 'G2c.frameTriangles', Math.ceil( mt * 1.25 ), `triangles per frame, all passes, 1920×1080, fixed views (gates/lib/views.mjs); measured max ${ mt } at ${ worstT } on ${ today }; cap = 1.25 × measured (terrain + ocean dominate)` );
	freeze( 'G2c.frameDraws', Math.ceil( md * CAP_FACTOR ), `draw calls per frame, all passes, same views; measured max ${ md } at ${ worstD } on ${ today }; cap = ${ CAP_FACTOR } × measured` );
	freeze( 'G2c.tileTriangles', Math.ceil( maxTile * 1.25 ), `LOD0 triangles in one 600 m building tile; measured max ${ maxTile } on ${ today }; cap = 1.25 × measured` );
	T = readThresholds();
	console.log( 'calibrated:', JSON.stringify( m.views ) );

}

const caps = { city: T[ 'G2c.cityTriangles' ], triangles: T[ 'G2c.frameTriangles' ], draws: T[ 'G2c.frameDraws' ], tile: T[ 'G2c.tileTriangles' ] };

if ( ! NEG ) {

	const m = measureChild();
	console.log( 'views:', m.views.map( ( v ) => `${ v.view } ${ v.city } city / ${ v.triangles } frame tris / ${ v.draws } draws` ).join( '; ' ) );
	const fail = [ ...staticChecks( { buildingIndex, landmarkIndex, caps } ).fail, ...frameChecks( m, caps ) ];
	if ( fail.length ) { console.log( 'G2c FAIL\n- ' + fail.join( '\n- ' ) ); process.exit( 1 ); }
	console.log( `G2c PASS — 5 Blender landmarks × 3 LODs, 39 tiles × 3 merged LODs; caps city ${ caps.city } / frame ${ caps.triangles } tris / ${ caps.draws } draws hold at all views` );
	process.exit( 0 );

}

const MUTATIONS = [
	[ 'LOD selection disabled (everything at LOD0)', 'cap-city:', () => frameChecks( measureChild( 'nolod' ), caps ) ],
	[ 'buildings not merged (one mesh per building)', 'cap-draws:', () => frameChecks( measureChild( 'unmerged' ), caps ) ],
	[ 'a tile missing a LOD level', 'merge:', () => { const bi = structuredClone( buildingIndex ); bi.files[ 0 ] = { ...bi.files[ 0 ], lods: bi.files[ 0 ].lods.slice( 0, 1 ) }; return staticChecks( { buildingIndex: bi, landmarkIndex, caps } ).fail; } ],
	[ 'landmark LODs out of order', 'lod:', () => { const li = structuredClone( landmarkIndex ); li.landmarks[ 0 ].lods.reverse(); return staticChecks( { buildingIndex, landmarkIndex: li, caps } ).fail; } ],
	[ 'landmarks not built in Blender', 'landmarks:', () => staticChecks( { buildingIndex, landmarkIndex: { ...landmarkIndex, blender: '' }, caps } ).fail ],
	[ 'per-tile cap exceeded', 'cap:', () => staticChecks( { buildingIndex, landmarkIndex, caps: { ...caps, tile: 1000 } } ).fail ],
];
let missed = 0;
for ( const [ name, label, run ] of MUTATIONS ) {

	const fail = run().filter( ( m ) => m.startsWith( label ) );
	console.log( `${ fail.length ? 'caught  ' : 'MISSED  ' } ${ name }${ fail.length ? ' — ' + fail[ 0 ] : '' }` );
	if ( ! fail.length ) missed ++;

}

console.log( `NEGATIVE ${ MUTATIONS.length - missed }/${ MUTATIONS.length }` ); // verify.sh requires every mutation caught
process.exit( missed ? 0 : 1 );
