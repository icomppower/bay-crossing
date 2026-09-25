import * as THREE from '../engine/index.js';
import { FRAME, toLocal } from './BayFrame.js';

// Shared world layout in the bay frame (BayFrame.js): metres, y up, x east, z south, sea level y = 0.
// Placements are provisional until the gates that own them (G3 georeference, G4 ferry).
const fb = toLocal( 553383.6, 4183304.4 ); // Ferry Building clock tower (WGS84 37.79555, -122.39365)

export const WORLD = {
	terrainSize: FRAME.size,

	// the ferry berths just bayward (east) of the Ferry Building
	pier: { x: fb.x + 70, zStart: fb.z - 60, zEnd: fb.z + 60, deckHeight: 2.3, width: 8, headWidth: 14, headDepth: 7 },
	boatDock: { position: new THREE.Vector3( fb.x + 90, 0, fb.z - 20 ), heading: 0 },
	// on the Embarcadero promenade in front of the Ferry Building, facing the bay
	start: { position: new THREE.Vector3( fb.x - 40, 0, fb.z ), yaw: - Math.PI / 2 },

	// No reef in the bay: the terrain shader's reef term is inert (far away, 1 m radius).
	reef: { center: new THREE.Vector3( 1e6, 0, 1e6 ), radius: 1 },

	// SF Bay water: turbid, sediment-laden (yellow-green, a few metres of visibility) instead of the tropical
	// defaults (absorption 0.42 / 0.075 / 0.035, scattering 0.012 / 0.018 / 0.024 per m). D39.
	water: { absorption: [ 0.5, 0.16, 0.26 ], scattering: [ 0.075, 0.085, 0.055 ] },

	// San Francisco's sun: latitude, and the declination for late September (time of day = local solar time)
	sun: { latitude: 37.81, declination: - 0.5 },

	// Prevailing westerly: wind chop and the residual ocean swell travel east through the Golden Gate.
	swellDir: new THREE.Vector2( 1, 0.12 ).normalize(),
};
