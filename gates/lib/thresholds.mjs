// SPEC-THRESHOLDS.md: values marked *calibrate* in SPEC §5 are measured on first run, written here, then frozen.
// A frozen key is never rewritten by code; changing one needs a BLOCKED.md (SPEC §4).
import { existsSync, readFileSync, appendFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { root } from './tiles.mjs';

const FILE = join( root, 'SPEC-THRESHOLDS.md' );
const HEADER = `# Calibrated thresholds (frozen)

Measured at first run and frozen (SPEC §5). Each line: key, value, how it was measured. Never lowered to pass;
changing a frozen value needs a BLOCKED.md.

`;

export function readThresholds() {

	const out = {};
	if ( ! existsSync( FILE ) ) return out;
	for ( const m of readFileSync( FILE, 'utf8' ).matchAll( /^- `([^`]+)`: (-?[\d.]+)/gm ) ) out[ m[ 1 ] ] = Number( m[ 2 ] );
	return out;

}

// Freeze `key` at `value` if it is not frozen yet; returns the frozen value either way.
export function freeze( key, value, note ) {

	const t = readThresholds();
	if ( key in t ) return t[ key ];
	if ( ! existsSync( FILE ) ) writeFileSync( FILE, HEADER );
	appendFileSync( FILE, `- \`${ key }\`: ${ value } — ${ note }\n` );
	return value;

}
