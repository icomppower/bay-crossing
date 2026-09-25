// Quality tiers (DECISIONS D6): one config. `low` is the Mac mini M4 baseline, the only tier gated (G5);
// `high` is reserved for a later PC run. Select with ?tier=low|high (default low); ?scale / ?G still override.
export const QUALITY = {
	low: {
		renderScale: 1, // internal resolution relative to the output (the temporal upscaler reconstructs it)
		oceanGrid: 32, // CDLOD vertices per ocean node side
		shadowSize: 2048, // sun shadow cascade resolution
		lodBias: 1, // multiplies the building / landmark LOD distances
		clouds: true,
		caustics: true,
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

	const name = qs.get( 'tier' ) || 'low';
	return { name, ...( QUALITY[ name ] || QUALITY.low ) };

}
