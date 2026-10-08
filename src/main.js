// SF Bay Crossing: a Harbor Engine title. The engine does everything else; this title is its map.json, its baked
// data in public/, its pipeline hooks (hooks.js) and the street level (src/street/, run 2).
import 'harbor-engine/src/ui/ui.css';
import map from '../map.json';
import { boot } from 'harbor-engine';
import { attachStreet } from './street/index.js';

boot( { map, onReady: ( app ) => attachStreet( app ).catch( ( e ) => console.error( 'street:', e ) ) } );
