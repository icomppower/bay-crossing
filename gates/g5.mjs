// G5 M4 budget: a scripted camera path through the fixed views at the `low` tier, 1920×1080, in the real App on
// the M4 GPU (headless Dawn → Metal, no vsync). Checks, with values calibrated on first run and frozen in
// SPEC-THRESHOLDS.md: an fps floor (target ≥ 30 at 1080p) on the 95th-percentile frame, a GPU memory cap
// (Metal IOAccelerator + IOSurface memory of the process, `footprint`), and no swap-outs during the run (vm_stat).
// Frame time = CPU + GPU serialised (each frame waits for the GPU), an upper bound on the pipelined cost.
// --negative: rendering at 4K (4× the pixels) must break the fps floor, a leaked GPU allocation the memory cap, and a
// recorded swap-out the swap check.
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { readThresholds, freeze } from './lib/thresholds.mjs';
import { VIEWS, poseFor } from './lib/views.mjs';

const NEG = process.argv.includes( '--negative' );
const SEG = 10; // s per path segment
const FPS_TARGET = 30;

// the camera path: Catmull-Rom through the views' eye points and look-at points
async function pathPoses() {

	const keys = [];
	for ( const v of VIEWS ) {

		const p = await poseFor( v );
		const d = 200; // a look-at point 200 m along the view direction
		keys.push( { eye: [ p.x, p.y, p.z ], at: [ p.x - Math.sin( p.yaw ) * Math.cos( p.pitch ) * d, p.y + Math.sin( p.pitch ) * d, p.z - Math.cos( p.yaw ) * Math.cos( p.pitch ) * d ] } );

	}

	const cr = ( a, b, c, d, t ) => a.map( ( _, i ) => 0.5 * ( 2 * b[ i ] + ( - a[ i ] + c[ i ] ) * t + ( 2 * a[ i ] - 5 * b[ i ] + 4 * c[ i ] - d[ i ] ) * t * t + ( - a[ i ] + 3 * b[ i ] - 3 * c[ i ] + d[ i ] ) * t * t * t ) );
	return ( time ) => {

		const n = keys.length, s = Math.min( time / SEG, n - 1 - 1e-6 ), k = Math.floor( s ), t = s - k;
		const K = ( i ) => keys[ Math.max( 0, Math.min( n - 1, i ) ) ];
		const eye = cr( K( k - 1 ).eye, K( k ).eye, K( k + 1 ).eye, K( k + 2 ).eye, t );
		const at = cr( K( k - 1 ).at, K( k ).at, K( k + 1 ).at, K( k + 2 ).at, t );
		eye[ 1 ] = Math.max( eye[ 1 ], 3 );
		const dx = at[ 0 ] - eye[ 0 ], dy = at[ 1 ] - eye[ 1 ], dz = at[ 2 ] - eye[ 2 ];
		return { eye, yaw: Math.atan2( - dx, - dz ), pitch: Math.atan2( dy, Math.hypot( dx, dz ) ) };

	};

}

function gpuMemory( pid ) {

	const r = spawnSync( 'footprint', [ '-f', 'bytes', String( pid ) ], { encoding: 'utf8' } );
	let gpu = 0, total = 0;
	for ( const line of ( r.stdout || '' ).split( '\n' ) ) {

		const m = line.match( /^\s*(\d+)\s*B?\s+(\d+)\s*B?\s+(\d+)\s*B?\s+(\d+)\s+(.+)$/ );
		if ( m && /IOAccelerator|IOSurface/i.test( m[ 5 ] ) ) gpu += Number( m[ 1 ] );
		const t = line.match( /Footprint:\s*(\d+)\s*B/ );
		if ( t ) total = Number( t[ 1 ] );

	}

	return { gpuMB: gpu / 2 ** 20, footprintMB: total / 2 ** 20 };

}

async function run( sabotage ) {

	const { bootApp } = await import( '../tools/headless/app.mjs' );
	const { Vector3 } = await import( '../src/engine/index.js' );
	const uhd = sabotage === 'uhd';
	const H = await bootApp( { width: uhd ? 3840 : 1920, height: uhd ? 2160 : 1080, query: '?fly&noAudio&tier=low' } );
	const app = H.app;
	let leak = null;
	if ( sabotage === 'leak' ) {

		// a leaked 1.5 GB of GPU buffers, written so the memory is committed
		leak = [];
		for ( let i = 0; i < 6; i ++ ) {

			const b = H.GPU.device.createBuffer( { size: 256 * 2 ** 20, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST } );
			H.GPU.queue.writeBuffer( b, 0, new Uint8Array( 256 * 2 ** 20 ).fill( 1 ) );
			leak.push( b );

		}

	}

	app.settings.timeOfDay = 17.5;
	const pose = await pathPoses();
	const dt = 1 / 60, total = SEG * ( VIEWS.length - 1 );
	const place = ( t ) => { const p = pose( t ); app.fly.setPose( new Vector3( ...p.eye ), p.yaw, p.pitch ); };
	place( 0 );
	for ( let i = 0; i < 60; i ++ ) app.frame( dt ); // warm-up (not measured)
	await H.settle();
	const ms = [];
	let mem = { gpuMB: 0, footprintMB: 0 };
	for ( let t = 0; t < total; t += dt ) {

		place( t );
		const t0 = performance.now();
		app.frame( dt );
		await H.settle();
		ms.push( performance.now() - t0 );
		if ( ms.length % 600 === 300 ) { const m = gpuMemory( process.pid ); if ( m.gpuMB > mem.gpuMB ) mem = m; }

	}

	const s = [ ...ms ].sort( ( a, b ) => a - b ), q = ( f ) => s[ Math.min( s.length - 1, Math.floor( f * s.length ) ) ];
	return { frames: ms.length, p50: q( 0.5 ), p95: q( 0.95 ), p99: q( 0.99 ), max: s.at( - 1 ), ...mem, errors: H.errors.length, keep: leak ? leak.length : 0 };

}

if ( process.argv.includes( '--run' ) ) {

	const s = ( process.argv.find( ( a ) => a.startsWith( '--sabotage=' ) ) || '' ).split( '=' )[ 1 ];
	console.log( 'RUN ' + JSON.stringify( await run( s ) ) );
	process.exit( 0 );

}

const swapouts = ( text ) => Number( ( text.match( /Swapouts:\s+(\d+)/ ) || [] )[ 1 ] );
const vmstat = () => spawnSync( 'vm_stat', { encoding: 'utf8' } ).stdout;

function runChild( sabotage = '' ) {

	const before = vmstat();
	const r = spawnSync( process.execPath, [ fileURLToPath( import.meta.url ), '--run', ...( sabotage ? [ '--sabotage=' + sabotage ] : [] ) ], { encoding: 'utf8', maxBuffer: 1 << 26 } );
	const after = vmstat();
	const line = ( r.stdout || '' ).split( '\n' ).find( ( l ) => l.startsWith( 'RUN ' ) );
	if ( ! line ) throw new Error( 'run crashed: ' + ( r.stderr || '' ).slice( - 800 ) );
	return { ...JSON.parse( line.slice( 4 ) ), swapBefore: before, swapAfter: after };

}

function judge( m, T ) {

	const fail = [], fps95 = 1000 / m.p95;
	const swaps = swapouts( m.swapAfter ) - swapouts( m.swapBefore );
	console.log( `path: ${ m.frames } frames at 1920×1080 low tier — p50 ${ m.p50.toFixed( 1 ) } ms, p95 ${ m.p95.toFixed( 1 ) } ms (${ fps95.toFixed( 1 ) } fps), p99 ${ m.p99.toFixed( 1 ) } ms, max ${ m.max.toFixed( 1 ) } ms; GPU memory ${ m.gpuMB.toFixed( 0 ) } MB (process footprint ${ m.footprintMB.toFixed( 0 ) } MB); swap-outs during the run ${ swaps }` );
	if ( m.errors ) fail.push( `render: ${ m.errors } console/GPU errors` );
	if ( ! ( fps95 >= T[ 'G5.fpsFloor' ] ) ) fail.push( `fps: 95th-percentile frame ${ m.p95.toFixed( 1 ) } ms = ${ fps95.toFixed( 1 ) } fps, floor ${ T[ 'G5.fpsFloor' ] } fps` );
	if ( ! ( m.gpuMB <= T[ 'G5.gpuMemoryMB' ] ) ) fail.push( `memory: GPU memory ${ m.gpuMB.toFixed( 0 ) } MB, cap ${ T[ 'G5.gpuMemoryMB' ] } MB` );
	if ( ! ( swaps === 0 ) ) fail.push( `swap: ${ swaps } swap-outs during the run` );
	return fail;

}

let T = readThresholds();
if ( ! ( 'G5.fpsFloor' in T ) || ! ( 'G5.gpuMemoryMB' in T ) ) {

	const m = runChild();
	const fps95 = 1000 / m.p95, today = new Date().toISOString().slice( 0, 10 );
	if ( fps95 < FPS_TARGET ) { console.log( `G5 FAIL — calibration run is ${ fps95.toFixed( 1 ) } fps at p95, below the ${ FPS_TARGET } fps target; not freezing` ); process.exit( 1 ); }
	freeze( 'G5.fpsFloor', Math.max( FPS_TARGET, Math.floor( 0.8 * fps95 ) ), `95th-percentile fps on the camera path (gates/g5.mjs), 1920×1080, low tier, M4 (Metal); measured ${ fps95.toFixed( 1 ) } fps (p95 ${ m.p95.toFixed( 1 ) } ms, CPU+GPU serialised) on ${ today }; floor = max( ${ FPS_TARGET }, 0.8 × measured )` );
	freeze( 'G5.gpuMemoryMB', Math.ceil( 1.25 * m.gpuMB ), `GPU memory (footprint IOAccelerator + IOSurface) of the App process on the path; measured ${ m.gpuMB.toFixed( 0 ) } MB on ${ today }; cap = 1.25 × measured` );
	T = readThresholds();

}

if ( ! NEG ) {

	const fail = judge( runChild(), T );
	if ( fail.length ) { console.log( 'G5 FAIL\n- ' + fail.join( '\n- ' ) ); process.exit( 1 ); }
	console.log( `G5 PASS — ≥ ${ T[ 'G5.fpsFloor' ] } fps at p95, GPU memory ≤ ${ T[ 'G5.gpuMemoryMB' ] } MB, no swap on the M4 path` );
	process.exit( 0 );

}

// Negatives. The swap fixture is a recorded vm_stat pair (forcing real swap would thrash the user's machine).
const MUTATIONS = [
	[ 'rendered at 3840×2160 (4× the pixels)', 'fps:', () => judge( runChild( 'uhd' ), T ) ],
	[ 'a leaked 1.5 GB of GPU buffers', 'memory:', () => judge( runChild( 'leak' ), T ) ],
	[ 'swap-outs recorded during the run', 'swap:', () => judge( { frames: 1, p50: 1, p95: 1, p99: 1, max: 1, gpuMB: 1, footprintMB: 1, errors: 0, swapBefore: 'Swapouts: 1000.', swapAfter: 'Swapouts: 1450.' }, T ) ],
];
let missed = 0;
for ( const [ name, label, fn ] of MUTATIONS ) {

	const fail = fn().filter( ( m ) => m.startsWith( label ) );
	console.log( `${ fail.length ? 'caught  ' : 'MISSED  ' } ${ name }${ fail.length ? ' — ' + fail[ 0 ] : '' }` );
	if ( ! fail.length ) missed ++;

}

process.exit( missed ? 0 : 1 );
