import * as THREE from '../engine/index.js';
import { PLACES } from '../world/Places.js';

// Name signs over the landmarks (world/Places.js): a label with the distance, on a short stem down to the spot.
// Hidden behind the camera, off screen, or when terrain / a roof blocks the line of sight; a nearer sign wins an
// overlap. Clicking (or tapping) one flies the free camera there; with the mouse captured, the sign under the
// screen centre lights up and a click flies there. Toggle with K or the Explore tab; photo mode hides them with the
// rest of the interface.
//   layout() is plain maths (tested headless); SignsLayer is the DOM.
const STEM = 26; // px from the spot to the bottom of the label
const _v = new THREE.Vector3();

// the anchor point of each sign: above the model's top, or above the ground / roofs around the spot
export function signAnchors( terrain, roofs ) {

	return PLACES.map( ( p ) => {

		const ground = Math.max( terrain.heightAt( p.x, p.z ), 0 );
		const top = Math.max( ground, roofs.heightAt( p.x, p.z, p.r ?? ( p.model ? 80 : 20 ) ) );
		return { ...p, ground, y: top + ( p.model ? 12 : 20 ) };

	} );

}

// true when terrain or a roof stands between the eye and the anchor (the last 150 m, the place itself, excluded)
export function blocked( eye, a, groundAt ) {

	const dx = a.x - eye.x, dy = a.y - eye.y, dz = a.z - eye.z, d = Math.hypot( dx, dz );
	for ( let k = 1; k < 32; k ++ ) {

		const f = k / 32;
		if ( ( 1 - f ) * d < 150 ) break;
		if ( eye.y + dy * f < groundAt( eye.x + dx * f, eye.z + dz * f ) ) return true;

	}

	return false;

}

// screen placement: [ { i, x, y, dist } ] for the visible signs, nearest first; sizes[ i ] = [ w, h ] px; `avoid`:
// screen rects { l, r, t, b } no sign may cover (the touch controls, which sit under the signs)
export function layout( anchors, camera, width, height, occluded, sizes, avoid = [] ) {

	camera.updateMatrixWorld();
	const out = [], placed = [ ...avoid ];
	const order = anchors.map( ( a, i ) => ( { i, dist: Math.hypot( a.x - camera.position.x, a.y - camera.position.y, a.z - camera.position.z ) } ) ).sort( ( p, q ) => p.dist - q.dist );
	for ( const { i, dist } of order ) {

		if ( occluded[ i ] ) continue;
		const a = anchors[ i ];
		_v.set( a.x, a.y, a.z ).applyMatrix4( camera.matrixWorldInverse );
		if ( _v.z > - 1 ) continue; // behind the camera
		_v.applyMatrix4( camera.projectionMatrix );
		const x = ( _v.x * 0.5 + 0.5 ) * width, y = ( 0.5 - _v.y * 0.5 ) * height;
		const [ w, h ] = sizes[ i ] || [ 120, 32 ];
		const r = { l: x - w / 2, r: x + w / 2, t: y - STEM - h, b: y };
		if ( r.r < 0 || r.l > width || r.b < 0 || r.t > height ) continue;
		if ( placed.some( ( o ) => r.l < o.r && o.l < r.r && r.t < o.b && o.t < r.b ) ) continue;
		placed.push( r );
		out.push( { i, x, y, dist } );

	}

	return out;

}

export class SignsLayer {

	constructor( app, parent ) {

		this.app = app;
		this.anchors = signAnchors( app.terrainData, app.roofs );
		this.enabled = true;
		this.occluded = this.anchors.map( () => false );
		this.avoid = [];
		this._frame = 0;
		this.el = document.createElement( 'div' );
		this.el.className = 'tw-signs';
		parent.prepend( this.el ); // under the HUD and the panel
		this.signs = this.anchors.map( ( a ) => {

			const b = document.createElement( 'button' );
			b.type = 'button';
			b.className = 'tw-sign tw-interactive';
			b.innerHTML = `<span class="tw-sign-name"></span><span class="tw-sign-dist"></span>`;
			b.firstChild.textContent = a.name;
			b.setAttribute( 'aria-label', `Fly to ${ a.name }` );
			b.addEventListener( 'click', () => app.goToPlace( a ) );
			this.el.append( b );
			return { b, dist: b.lastChild, shown: false, text: '' };

		} );
		this.sizes = this.signs.map( ( s ) => [ s.b.offsetWidth || 120, s.b.offsetHeight || 32 ] );
		this.aim = - 1; // sign under the screen centre (the crosshair while the mouse is captured)
		document.addEventListener( 'mousedown', ( e ) => {

			if ( e.button === 0 && document.pointerLockElement && this.enabled && this.aim >= 0 ) app.goToPlace( this.anchors[ this.aim ] );

		} );

	}

	setEnabled( on ) {

		this.enabled = on;
		this.el.hidden = ! on;

	}

	update() {

		if ( ! this.enabled ) return;
		const app = this.app, cam = app.camera;
		if ( this._frame ++ % 6 === 0 ) {

			if ( this.sizes.some( ( s ) => s[ 0 ] === 120 ) ) this.sizes = this.signs.map( ( s ) => [ s.b.offsetWidth || 120, s.b.offsetHeight || 32 ] );
			this.avoid = [ ...document.querySelectorAll( '.tc-btn, .tc-stick' ) ].map( ( e ) => e.getBoundingClientRect() ).filter( ( q ) => q.width > 0 ).map( ( q ) => ( { l: q.left - 6, r: q.right + 6, t: q.top - 6, b: q.bottom + 6 } ) );
			const groundAt = ( x, z ) => Math.max( app.terrainData.heightAt( x, z ), app.roofs.heightAt( x, z, 0 ) );
			this.anchors.forEach( ( a, i ) => { this.occluded[ i ] = blocked( cam.position, a, groundAt ); } );

		}

		const vis = layout( this.anchors, cam, innerWidth, innerHeight, this.occluded, this.sizes, this.avoid );
		const on = new Set(), cx = innerWidth / 2, cy = innerHeight / 2;
		let aim = - 1;
		for ( const { i, x, y, dist } of vis ) {

			const s = this.signs[ i ], [ w, h ] = this.sizes[ i ];
			on.add( i );
			if ( aim < 0 && Math.abs( cx - x ) < w / 2 && cy > y - STEM - h && cy < y ) aim = i; // label or stem
			s.b.style.transform = `translate(${ ( x - this.sizes[ i ][ 0 ] / 2 ).toFixed( 1 ) }px, ${ ( y - STEM - this.sizes[ i ][ 1 ] ).toFixed( 1 ) }px)`;
			const text = dist < 1000 ? `${ Math.round( dist / 10 ) * 10 } m` : `${ ( dist / 1000 ).toFixed( 1 ) } km`;
			if ( text !== s.text ) { s.dist.textContent = text; s.text = text; }
			if ( ! s.shown ) { s.b.classList.add( 'is-on' ); s.shown = true; }

		}

		this.signs.forEach( ( s, i ) => { if ( s.shown && ! on.has( i ) ) { s.b.classList.remove( 'is-on' ); s.shown = false; } } );
		if ( aim !== this.aim ) {

			if ( this.aim >= 0 ) this.signs[ this.aim ].b.classList.remove( 'is-aim' );
			if ( aim >= 0 ) this.signs[ aim ].b.classList.add( 'is-aim' );
			this.aim = aim;

		}

	}

}
