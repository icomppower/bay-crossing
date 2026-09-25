// NAIP helpers shared by the building (roof colours) and terrain (ground colour map) pipelines.
// Haze correction (dark-object subtraction): each channel's 1st percentile over the image is atmospheric path
// radiance, not surface; subtract it, stretch the 99th percentile to 235, then restore saturation ×1.5 about the
// luma (the haze greys the scene out). D38 / D39.
// `mask(k)` (optional): only these pixels feed the percentiles (the bay image is mostly water, which skews them)
// `shared`: one offset and one stretch for all channels (keeps the image's colour balance; the ground map, D39),
// else per channel (roofs, D38). `saturation`: the restore factor.
export function dehaze(tif, mask = null, { shared = false, saturation = 1.5 } = {}) {
  const lo = [], hi = [];
  for (const band of tif.bands) {
    const hist = new Uint32Array(256);
    for (let k = 0; k < band.length; k += 7) if (!mask || mask(k)) hist[band[k] | 0]++;
    const total = hist.reduce((a, b) => a + b, 0);
    let acc = 0, p1 = 0, p99 = 255;
    for (let v = 0; v < 256; v++) { acc += hist[v]; if (acc < total * 0.01) p1 = v; if (acc < total * 0.99) p99 = v; }
    lo.push(p1); hi.push(Math.max(p99, p1 + 1));
  }
  if (shared) { const l = Math.min(...lo), h = Math.max(...hi); lo.fill(l); hi.fill(h); }
  return ([r, g, b]) => {
    const c = [r, g, b].map((v, i) => Math.max(0, (v - lo[i]) / (hi[i] - lo[i]) * 235));
    const l = 0.3 * c[0] + 0.59 * c[1] + 0.11 * c[2];
    return c.map(v => Math.max(0, Math.min(255, Math.round(l + (v - l) * saturation))));
  };
}
