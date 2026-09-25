// Quality tiers (DECISIONS D6): one config. `low` is the Mac mini M4 baseline, the only tier gated (G5);
// `high` is reserved for a later PC run; `mobile` for touch devices (D37). Select with ?tier=low|mobile|high
// (default low, or mobile on a coarse pointer); ?scale / ?G still override.
export const QUALITY = {
	low: {
		renderScale: 1, // internal resolution relative to the output (the temporal upscaler reconstructs it)
		oceanGrid: 32, // CDLOD vertices per ocean node side
		shadowSize: 2048, // sun shadow cascade resolution
		lodBias: 1, // multiplies the building / landmark LOD distances
		clouds: true,
		caustics: true,
	},
	// phones and tablets (picked automatically on a coarse pointer): lower internal resolution, smaller
	// shadows, no volumetric clouds or caustics, nearer LOD switches
	mobile: {
		renderScale: 0.6,
		oceanGrid: 24,
		shadowSize: 1024,
		lodBias: 0.6,
		clouds: false,
		caustics: false,
	},
	high: {
		renderScale: 1,
		oceanGrid: 48,
		shadowSize: 4096,
		lodBias: 1.6,
		clouds: true,
		caustics: true,
	},
};

export function qualityTier( qs ) {

	const coarse = typeof matchMedia === 'function' && matchMedia( '(pointer: coarse)' ).matches;
	const name = qs.get( 'tier' ) || ( coarse || qs.has( 'touch' ) ? 'mobile' : 'low' );
	return { name, ...( QUALITY[ name ] || QUALITY.low ) };

}
