// Sign atlas worker (D50): draws the sign strings off the main thread with OffscreenCanvas.
import { drawSigns } from './signDraw.js';

self.onmessage = ( e ) => {

	const img = drawSigns( e.data.texts, ( w, h ) => new OffscreenCanvas( w, h ) );
	self.postMessage( img, [ img.data.buffer ] );

};
