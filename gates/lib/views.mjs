// Fixed camera viewpoints shared by the budget / look gates (G2c caps, G5 path, G6 shots).
// [ name, lat, lon, eye y (m above MSL), look-at lat, lon, y ]
export const VIEWS = [
	[ 'embarcadero-street', 37.79530, - 122.39420, 4.2, 37.79250, - 122.39900, 60 ],
	[ 'ferry-deck-mid-bay', 37.81800, - 122.41500, 8, 37.79500, - 122.40000, 60 ],
	[ 'aerial-city', 37.81200, - 122.38500, 350, 37.79300, - 122.40500, 0 ],
	[ 'alcatraz-to-golden-gate', 37.82400, - 122.43800, 30, 37.81900, - 122.47850, 80 ],
	[ 'sausalito-waterfront', 37.85600, - 122.47700, 5, 37.80000, - 122.41000, 50 ],
];

export async function poseFor( view ) {

	const { toLocal } = await import( '../../src/world/BayFrame.js' );
	const { toUTM } = await import( '../../tools/geo/utm.mjs' );
	const [ , lat, lon, y, tlat, tlon, ty ] = view;
	const p = toLocal( ...toUTM( lat, lon ) ), t = toLocal( ...toUTM( tlat, tlon ) );
	return { x: p.x, y, z: p.z, yaw: Math.atan2( - ( t.x - p.x ), - ( t.z - p.z ) ), pitch: Math.atan2( ty - y, Math.hypot( t.x - p.x, t.z - p.z ) ) };

}
