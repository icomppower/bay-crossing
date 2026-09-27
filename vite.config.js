import { defineConfig } from 'vite';
import { harborEngine } from 'harbor-engine/vite';

export default defineConfig( {
	// relative asset paths: the build runs from any sub-path (GitHub Pages serves it under /bay-crossing/)
	base: './',
	plugins: [ harborEngine() ],
	build: { target: 'esnext', chunkSizeWarningLimit: 4000 },
	server: { port: 5188, strictPort: true, host: '127.0.0.1' },
} );
