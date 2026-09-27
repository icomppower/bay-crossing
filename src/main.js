// SF Bay Crossing: a Harbor Engine title. The engine does everything; this title is its map.json, its baked
// data in public/ and its pipeline hooks (hooks.js).
import 'harbor-engine/src/ui/ui.css';
import map from '../map.json';
import { boot } from 'harbor-engine';

boot( { map } );
