// G1 Clean fork: D7 removals done; `npm run build` passes; ocean + sky render in headless Dawn (the real
// App, measured numerically); dependency audit passes.
// --negative: each mutation must trip the check it targets.
import { spawnSync } from 'node:child_process';
import { builtinModules } from 'node:module';
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join( dirname( fileURLToPath( import.meta.url ) ), '..' );
const NEG = process.argv.includes( '--negative' );

// D7: island content, fishing game, vendors, swash sim
export const REMOVED = [
	'src/game', 'public/models/characters', 'tools/characters',
	'src/world/TerrainData.js', 'src/world/terrain/IslandShape.js',
	'src/world/Village.js', 'src/world/village', 'src/world/Pier.js', 'src/world/Props.js',
	'src/world/Reef.js', 'src/world/reef', 'src/world/Vegetation.js', 'src/world/vegetation',
	'src/ocean/ShoreSim.js',
];

function checkRemovals( dir ) {

	return REMOVED.filter( ( p ) => existsSync( join( dir, p ) ) ).map( ( p ) => `removals: ${ p } still present` );

}

function checkBuild( dir ) {

	const out = join( root, '.verify', 'g1-build-' + Math.random().toString( 36 ).slice( 2 ) );
	const r = spawnSync( join( root, 'node_modules/.bin/vite' ), [ 'build', '--outDir', out, '--emptyOutDir', '--logLevel', 'error' ], { cwd: dir, encoding: 'utf8' } );
	rmSync( out, { recursive: true, force: true } );
	return r.status === 0 ? [] : [ `build: vite build failed — ${ ( r.stderr || r.stdout ).trim().split( '\n' ).slice( 0, 2 ).join( ' ' ) }` ];

}

// Every bare import in src/, tools/, gates/, test/ resolves to a package.json dependency or a Node builtin.
function sourceFiles( dir ) {

	const out = [];
	for ( const d of [ 'src', 'tools', 'gates', 'test' ] ) {

		const walk = ( p ) => {

			if ( ! existsSync( p ) ) return;
			for ( const e of readdirSync( p, { withFileTypes: true } ) ) {

				const f = join( p, e.name );
				if ( e.isDirectory() ) { if ( e.name !== 'node_modules' ) walk( f ); } else if ( /\.(m?js)$/.test( e.name ) ) out.push( f );

			}

		};
		walk( join( dir, d ) );

	}

	return out;

}

export function auditImports( files, pkg ) {

	const declared = new Set( [ ...Object.keys( pkg.dependencies || {} ), ...Object.keys( pkg.devDependencies || {} ) ] );
	const builtins = new Set( builtinModules );
	const fail = [];
	for ( const [ file, src ] of files ) {

		const code = src.replace( /\/\*[\s\S]*?\*\//g, '' ).replace( /^\s*\/\/.*$/gm, '' );
		for ( const m of code.matchAll( /(?:^|[\s;])(?:import|export)\s[^'"`]*?from\s*['"]([^'"]+)['"]|(?:^|[\s;(=])import\s*\(\s*['"]([^'"]+)['"]\s*\)|^\s*import\s*['"]([^'"]+)['"]/gm ) ) {

			const spec = m[ 1 ] || m[ 2 ] || m[ 3 ];
			if ( ! spec || spec.startsWith( '.' ) || spec.startsWith( '/' ) || /^https?:/.test( spec ) ) continue;
			if ( spec.startsWith( 'node:' ) || builtins.has( spec.split( '/' )[ 0 ] ) ) continue;
			const name = spec.startsWith( '@' ) ? spec.split( '/' ).slice( 0, 2 ).join( '/' ) : spec.split( '/' )[ 0 ];
			if ( ! declared.has( name ) ) fail.push( `audit: ${ file } imports '${ spec }', not declared in package.json` );

		}

	}

	return fail;

}

function checkAudit( extra = [] ) {

	const pkg = JSON.parse( readFileSync( join( root, 'package.json' ), 'utf8' ) );
	const files = sourceFiles( root ).map( ( f ) => [ relative( root, f ), readFileSync( f, 'utf8' ) ] );
	return auditImports( [ ...files, ...extra ], pkg );

}

// Ocean + sky in headless Dawn: the real App, free camera 12 m above the bay looking at the horizon.
async function checkRender( sabotage = null ) {

	const { bootApp } = await import( '../tools/headless/app.mjs' );
	const { Vector3 } = await import( '../src/engine/index.js' );
	const H = await bootApp( { width: 960, height: 540, query: '?fly&noAudio' } );
	const app = H.app, fail = [];
	if ( sabotage ) sabotage( app );
	const pose = () => app.fly.setPose( new Vector3( 2600, 12, 1200 ), - Math.PI / 2, - 0.02 );
	const band = ( px, y0, y1 ) => {

		let r = 0, g = 0, b = 0, n = 0;
		for ( let y = Math.floor( y0 * H.height ); y < Math.floor( y1 * H.height ); y ++ ) for ( let x = 0; x < H.width; x ++ ) {

			const k = ( y * H.width + x ) * 4; r += px[ k ]; g += px[ k + 1 ]; b += px[ k + 2 ]; n ++;

		}

		return { r: r / n, g: g / n, b: b / n, l: ( r + g + b ) / ( 3 * n ) };

	};
	const diff = ( a, b, y0, y1 ) => {

		let s = 0, n = 0;
		for ( let y = Math.floor( y0 * H.height ); y < Math.floor( y1 * H.height ); y ++ ) for ( let x = 0; x < H.width; x ++ ) {

			const k = ( y * H.width + x ) * 4;
			s += Math.abs( a[ k ] - b[ k ] ) + Math.abs( a[ k + 1 ] - b[ k + 1 ] ) + Math.abs( a[ k + 2 ] - b[ k + 2 ] ); n += 3;

		}

		return s / n;

	};
	const shot = async ( hours, frames = 24, dt = 1 / 30 ) => {

		app.settings.timeOfDay = hours;
		pose();
		H.frames( frames, dt );
		return H.readPixels();

	};

	await shot( 13 ); // settle the atmosphere, clouds and temporal history
	// ocean on / off with time frozen (dt 0): the only change between the two frames is the ocean mesh
	const day = await shot( 13, 16, 0 );
	const oceanWas = app.ocean.visible;
	app.ocean.visible = false;
	const noOcean = await shot( 13, 16, 0 );
	app.ocean.visible = oceanWas;
	await shot( 13, 16, 0 );
	const dayLater = await shot( 13, 30 ); // one more second of simulated sea
	const night = await shot( 23, 40 );

	const sky = band( day, 0, 0.3 ), skyNight = band( night, 0, 0.3 );
	const sea = band( day, 0.7, 1 );
	const oceanDelta = diff( day, noOcean, 0.7, 1 ), waveDelta = diff( day, dayLater, 0.7, 1 );
	console.log( `render: sky day L ${ sky.l.toFixed( 1 ) } (r ${ sky.r.toFixed( 0 ) } b ${ sky.b.toFixed( 0 ) }), night L ${ skyNight.l.toFixed( 1 ) }; sea L ${ sea.l.toFixed( 1 ) }; ocean on/off Δ ${ oceanDelta.toFixed( 1 ) }; 1 s wave Δ ${ waveDelta.toFixed( 2 ) }; GPU/console errors ${ H.errors.length }` );
	if ( H.errors.length ) fail.push( `render: ${ H.errors.length } console/GPU errors, first: ${ H.errors[ 0 ].slice( 0, 160 ) }` );
	if ( ! ( sky.l >= 60 && sky.l <= 250 && sky.b > sky.r ) ) fail.push( `render-sky: daytime sky L ${ sky.l.toFixed( 1 ) }, b ${ sky.b.toFixed( 0 ) } vs r ${ sky.r.toFixed( 0 ) } (want L 60–250, blue > red)` );
	if ( ! ( skyNight.l < 0.35 * sky.l ) ) fail.push( `render-sky: night sky L ${ skyNight.l.toFixed( 1 ) } not below 35% of day ${ sky.l.toFixed( 1 ) }` );
	if ( ! ( oceanDelta > 8 ) ) fail.push( `render-ocean: hiding the ocean changes the lower frame by only ${ oceanDelta.toFixed( 1 ) } (want > 8)` );
	if ( ! ( waveDelta > 1 ) ) fail.push( `render-ocean: the sea is static over 1 s (Δ ${ waveDelta.toFixed( 2 ) }, want > 1)` );
	return fail;

}

const SABOTAGE = {
	ocean: ( app ) => { Object.defineProperty( app.ocean, 'visible', { get: () => false, set: () => {} } ); },
	sun: ( app ) => { const f = app.updateSun.bind( app ); app.updateSun = () => { const t = app.settings.timeOfDay; app.settings.timeOfDay = 13; f(); app.settings.timeOfDay = t; }; },
};

// one App per process: each render check runs in a fresh child
function renderChild( sabotage = '' ) {

	const r = spawnSync( process.execPath, [ fileURLToPath( import.meta.url ), '--render', ...( sabotage ? [ '--sabotage=' + sabotage ] : [] ) ], { encoding: 'utf8', maxBuffer: 1 << 26 } );
	const line = ( r.stdout || '' ).split( '\n' ).find( ( l ) => l.startsWith( 'RENDER ' ) );
	for ( const l of ( r.stdout || '' ).split( '\n' ) ) if ( l.startsWith( 'render:' ) ) console.log( l );
	return line ? JSON.parse( line.slice( 7 ) ) : [ `render: child crashed (exit ${ r.status }): ${ ( r.stderr || '' ).trim().split( '\n' ).slice( - 3 ).join( ' ' ) }` ];

}

if ( process.argv.includes( '--render' ) ) {

	const s = ( process.argv.find( ( a ) => a.startsWith( '--sabotage=' ) ) || '' ).split( '=' )[ 1 ];
	const fail = await checkRender( s ? SABOTAGE[ s ] : null );
	console.log( 'RENDER ' + JSON.stringify( fail ) );
	process.exit( 0 );

}

if ( ! NEG ) {

	const fail = [ ...checkRemovals( root ), ...checkBuild( root ), ...checkAudit(), ...renderChild() ];
	if ( fail.length ) { console.log( 'G1 FAIL\n- ' + fail.join( '\n- ' ) ); process.exit( 1 ); }
	console.log( 'G1 PASS — D7 removals done, build passes, dependency audit clean, ocean + sky render in headless Dawn' );
	process.exit( 0 );

}

// ---- negative fixtures
const fx = join( root, '.verify', 'g1-neg' );
rmSync( fx, { recursive: true, force: true } );
mkdirSync( fx, { recursive: true } );
for ( const f of [ 'index.html', 'vite.config.js', 'package.json' ] ) cpSync( join( root, f ), join( fx, f ) );
cpSync( join( root, 'src' ), join( fx, 'src' ), { recursive: true } );
mkdirSync( join( fx, 'src/game' ) );
writeFileSync( join( fx, 'src/game/Game.js' ), 'export class Game {}\n' );
writeFileSync( join( fx, 'src/App.js' ), readFileSync( join( fx, 'src/App.js' ), 'utf8' ).replace( "import { HeightField }", "import { Fishing } from './game/Fishing.js';\nimport { HeightField }" ) );

const MUTATIONS = [
	[ 'removed path restored (src/game)', 'removals:', () => checkRemovals( fx ) ],
	[ 'import of a deleted module', 'build:', () => checkBuild( fx ) ],
	[ "undeclared package ('three')", 'audit:', () => checkAudit( [ [ 'src/fixture.js', "import * as THREE from 'three';\n" ] ] ) ],
	[ 'ocean mesh never drawn', 'render-ocean:', () => renderChild( 'ocean' ) ],
	[ 'sun frozen at noon', 'render-sky:', () => renderChild( 'sun' ) ],
];
let missed = 0;
for ( const [ name, label, run ] of MUTATIONS ) {

	const fail = run().filter( ( m ) => m.startsWith( label ) );
	console.log( `${ fail.length ? 'caught  ' : 'MISSED  ' } ${ name }${ fail.length ? ' — ' + fail[ 0 ] : '' }` );
	if ( ! fail.length ) missed ++;

}

rmSync( fx, { recursive: true, force: true } );
process.exit( missed ? 0 : 1 );
