// Sign atlas worker (D50): draws the sign strings off the main thread with OffscreenCanvas.
import { drawSigns } from './signDraw.js';

self.onmessage = ( e ) => {

	const img = drawSigns( e.data.texts, ( w, h ) => new OffscreenCanvas( w, h ), e.data.layout ? { ...e.data.layout, fontFor: e.data.layout.font ? () => e.data.layout.font : null } : {} );
	self.postMessage( img, [ img.data.buffer ] );

};
