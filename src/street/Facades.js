// Facade depth for the run-1 buildings' upper floors (D51): the window grid of the building material
// (harbor-engine BuildingTiles buildingMaterial) gets a parallax recess — the window opening is shifted by the view
// ray in the wall's tangent space, so the jamb on the far side and the head above show, darker — and a small normal
// tilt on the reveal. No extra geometry. Not on the mobile tier (D53).
const DEPTH = 0.22; // m, window recess

export function patchBuildingFacades( app ) {

	if ( app.quality && app.quality.name === 'mobile' ) return false;
	const tile = app.buildings.children.find( ( t ) => t.userData.lods );
	if ( ! tile ) return false;
	const material = tile.userData.lods[ 0 ].material;
	if ( material.userData.streetFacade ) return true;
	// appended after the material's own surface code, at its top level (uniform control flow: screen derivatives
	// are allowed here)
	material.surface += /* wgsl */`
	// ---- D51: window recess (street level pass)
	{
		let N = normalize( in.N );
		let wall = abs( N.y ) < 0.5;
		let T = normalize( cross( vec3f( 0.0, 1.0, 0.0 ), select( vec3f( 0.0, 0.0, 1.0 ), N, wall ) ) );
		// does uv.x run along +T or -T? (from the screen derivatives of the world position and the uv)
		let du = dpdx( in.uv.x ) * dot( dpdx( in.P ), T ) + dpdy( in.uv.x ) * dot( dpdy( in.P ), T );
		let sgn = select( - 1.0, 1.0, du >= 0.0 );
		let V = normalize( frame.cameraPos - in.P );
		let vN = max( dot( V, N ), 0.08 );
		// where the far wall of the recess shows: shift by the view ray, in uv metres
		let shift = vec2f( - dot( V, T ) * sgn, - V.y ) / vN * ${ DEPTH.toFixed( 3 ) };
		let cls = in.color.a;
		let storey = select( select( 3.0, 3.6, cls > 0.25 ), 3.8, cls > 0.75 );
		let bay = select( select( 2.4, 3.0, cls > 0.25 ), 1.5, cls > 0.75 );
		let glassFrac = select( select( 0.35, 0.5, cls > 0.25 ), 0.85, cls > 0.75 );
		let fy0 = fract( in.uv.y / storey ); let fx0 = fract( in.uv.x / bay );
		let win0 = step( 0.5 - 0.5 * glassFrac, fx0 ) * step( fx0, 0.5 + 0.5 * glassFrac ) * step( 0.28, fy0 ) * step( fy0, 0.82 ) * step( 1.2, in.uv.y );
		let uv1 = in.uv.xy + shift;
		let fy1 = fract( uv1.y / storey ); let fx1 = fract( uv1.x / bay );
		let win1 = step( 0.5 - 0.5 * glassFrac, fx1 ) * step( fx1, 0.5 + 0.5 * glassFrac ) * step( 0.28, fy1 ) * step( fy1, 0.82 );
		// towers' curtain walls are flush: only mid-rises and houses get the recess
		let reveal = win0 * ( 1.0 - win1 ) * select( 1.0, 0.0, cls > 0.75 ) * select( 0.0, 1.0, wall );
		if ( reveal > 0.5 ) {
			s.albedo = in.color.rgb * 0.5;
			s.roughness = 0.9;
			s.metalness = 0.0;
			s.emissive = vec3f( 0.0 );
			s.normal = normalize( N + T * sgn * sign( shift.x ) * 0.6 );
		}
	}
`;
	material.userData.streetFacade = true;
	material.needsUpdate = true;
	return true;

}
