// Boots the real App (src/App.js) in headless Dawn: a minimal DOM shim, a fake canvas whose WebGPU context
// hands out an offscreen texture, and fetch() of relative URLs served from public/. Used by the gates.
//   const H = await bootApp( { width: 1920, height: 1080, query: '?noAudio' } );
//   H.frames( 10 ); const rgba = await H.readPixels(); H.app.settings.timeOfDay = 19;
import '../../test/headless.mjs';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join( dirname( fileURLToPath( import.meta.url ) ), '../..' );

export async function bootApp( { width = 1280, height = 720, query = '?noAudio' } = {} ) {

	const noop = () => {};
	const element = () => ( {
		style: {}, children: [], tabIndex: 0, width: 0, height: 0,
		appendChild( c ) { this.children.push( c ); return c; }, addEventListener: noop, removeEventListener: noop,
		requestPointerLock: noop, getBoundingClientRect: () => ( { left: 0, top: 0, width, height } ),
	} );
	let current = null, configured = null;
	const context = {
		configure( c ) { configured = c; },
		getCurrentTexture() {

			const w = canvas.width, h = canvas.height;
			if ( ! current || current.width !== w || current.height !== h ) {

				if ( current ) current.destroy();
				current = configured.device.createTexture( { size: [ w, h ], format: configured.format,
					usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC | GPUTextureUsage.COPY_DST | GPUTextureUsage.TEXTURE_BINDING } );

			}

			return current;

		},
	};
	const canvas = { ...element(), getContext: () => context };
	const app = element();
	globalThis.window = globalThis;
	globalThis.innerWidth = width;
	globalThis.innerHeight = height;
	globalThis.devicePixelRatio = 1;
	globalThis.addEventListener = noop;
	globalThis.document = {
		hidden: false, pointerLockElement: null,
		createElement: () => canvas, getElementById: ( id ) => ( id === 'app' ? app : null ),
		addEventListener: noop, removeEventListener: noop, exitPointerLock: noop,
	};
	globalThis.location = { search: query, href: 'http://localhost/' + query };
	globalThis.requestAnimationFrame = ( f ) => setTimeout( () => f( performance.now() ), 0 );
	globalThis.cancelAnimationFrame = ( id ) => clearTimeout( id );
	if ( ! navigator.gpu.getPreferredCanvasFormat ) navigator.gpu.getPreferredCanvasFormat = () => 'bgra8unorm';
	const netFetch = globalThis.fetch;
	globalThis.fetch = async ( url, opts ) => {

		const u = String( url );
		if ( /^[a-z]+:/i.test( u ) ) return netFetch( url, opts );
		const buf = readFileSync( join( root, 'public', u.replace( /^\.?\//, '' ).split( '?' )[ 0 ] ) );
		return new Response( buf );

	};

	const { App } = await import( '../../src/App.js' );
	const { GPU } = await import( '../../src/engine/gpu/GPU.js' );
	const a = new App();
	const errors = [];
	const origError = console.error;
	console.error = ( ...args ) => { errors.push( args.join( ' ' ) ); origError( ...args ); };
	await a.init();
	return {
		app: a, GPU, errors, width, height,
		frames( n = 1, dt = 1 / 60 ) { for ( let i = 0; i < n; i ++ ) a.frame( dt ); },
		async settle() { await GPU.queue.onSubmittedWorkDone(); },
		// the presented frame as RGBA8 (the canvas texture is BGRA8: swizzled here)
		async readPixels() {

			await GPU.queue.onSubmittedWorkDone();
			const tex = current, bpr = Math.ceil( tex.width * 4 / 256 ) * 256;
			const buf = GPU.device.createBuffer( { size: bpr * tex.height, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ } );
			const enc = GPU.device.createCommandEncoder();
			enc.copyTextureToBuffer( { texture: tex }, { buffer: buf, bytesPerRow: bpr }, [ tex.width, tex.height ] );
			GPU.queue.submit( [ enc.finish() ] );
			await buf.mapAsync( GPUMapMode.READ );
			const src = new Uint8Array( buf.getMappedRange() ), out = new Uint8Array( tex.width * tex.height * 4 );
			const bgra = configured.format.startsWith( 'bgra' );
			for ( let y = 0; y < tex.height; y ++ ) for ( let x = 0; x < tex.width; x ++ ) {

				const s = y * bpr + x * 4, d = ( y * tex.width + x ) * 4;
				out[ d ] = src[ s + ( bgra ? 2 : 0 ) ]; out[ d + 1 ] = src[ s + 1 ]; out[ d + 2 ] = src[ s + ( bgra ? 0 : 2 ) ]; out[ d + 3 ] = 255;

			}

			buf.unmap(); buf.destroy();
			return out;

		},
	};

}
