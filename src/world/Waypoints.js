// Waypoints: named viewpoints to explore the bay from. Keys 1–8 (or the Explore tab, or N on touch for the next
// one) fly the free camera there; F then drops the walker at that spot. World frame metres (BayFrame): x east,
// z south, y up from MSL. Targets are the landmark anchors (public/landmarks/index.json) and the ferry berths
// (public/ferry/route.json); eyes were placed clear of terrain and buildings (test/waypoints.mjs checks it).
import * as THREE from '../engine/index.js';

export const WAYPOINTS = [
	{ name: 'Ferry Building', eye: [ 4080, 22, 3560 ], at: [ 3884, 45, 3507 ] },
	{ name: 'Transamerica Pyramid', eye: [ 3520, 190, 3180 ], at: [ 3076, 150, 3543 ] },
	{ name: 'Coit Tower', eye: [ 2850, 140, 3050 ], at: [ 2802, 130, 2745 ] },
	{ name: 'Alcatraz', eye: [ 1720, 45, 520 ], at: [ 1337, 25, 105 ] },
	{ name: 'Golden Gate Bridge', eye: [ - 4550, 60, 250 ], at: [ - 3611, 110, 855 ] },
	{ name: 'Sausalito', eye: [ - 3290, 28, - 2930 ], at: [ - 3650, 20, - 3260 ] },
	{ name: 'Mid-bay', eye: [ 1984, 8, 1017 ], at: [ 2800, 30, 2600 ] },
	{ name: 'City from above', eye: [ 4629, 350, 1666 ], at: [ 3300, 60, 3300 ] },
];

// camera pose (FlyCamera yaw / pitch, YXZ, looking down -z at yaw 0) for a waypoint
export function waypointPose( w ) {

	const [ x, y, z ] = w.eye, dx = w.at[ 0 ] - x, dy = w.at[ 1 ] - y, dz = w.at[ 2 ] - z;
	return { position: new THREE.Vector3( x, y, z ), yaw: Math.atan2( - dx, - dz ), pitch: Math.atan2( dy, Math.hypot( dx, dz ) ) };

}
