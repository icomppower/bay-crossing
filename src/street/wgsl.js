// WGSL helpers shared by the street materials: hashes and value noise (no textures: every street surface,
// sign and figure is drawn by code).
import { ShaderModule } from 'harbor-engine/src/engine/gpu/Shader.js';

export const noiseModule = new ShaderModule( { name: 'street-noise', code: /* wgsl */`
fn stHash21( p: vec2f ) -> f32 {
	var q = fract( p * vec2f( 123.34, 456.21 ) );
	q += dot( q, q + 45.32 );
	return fract( q.x * q.y );
}
fn stHash11( x: f32 ) -> f32 { return fract( sin( x * 127.1 ) * 43758.5453 ); }
fn stNoise( p: vec2f ) -> f32 {
	let i = floor( p ); let f = fract( p );
	let u = f * f * ( 3.0 - 2.0 * f );
	let a = stHash21( i ); let b = stHash21( i + vec2f( 1.0, 0.0 ) );
	let c = stHash21( i + vec2f( 0.0, 1.0 ) ); let d = stHash21( i + vec2f( 1.0, 1.0 ) );
	return mix( mix( a, b, u.x ), mix( c, d, u.x ), u.y );
}
fn stFbm( p: vec2f ) -> f32 {
	return 0.5 * stNoise( p ) + 0.25 * stNoise( p * 2.03 + 17.1 ) + 0.125 * stNoise( p * 4.01 + 31.7 ) + 0.0625 * stNoise( p * 8.07 + 5.3 );
}
` } );
