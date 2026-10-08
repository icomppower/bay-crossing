// Headless street-level shot (one App per process): node gates/lib/shot.mjs <out.png> <lat> <lon> <eyeY|+h> <lookLat> <lookLon> <lookY|+h> [hour] [--no-street] [--w W --h H]
// Eye / look heights: a number is metres above MSL, "+h" is metres above the street (or terrain) there.
import { bootApp } from 'harbor-engine/tools/headless/app.mjs';
import { writePNG } from 'harbor-engine/test/headless.mjs';
import { toLocal } from 'harbor-engine/src/world/Frame.js';
import { toUTM } from 'harbor-engine/tools/geo/utm.mjs';
import { Vector3 } from 'harbor-engine/src/engine/index.js';
import { attachStreet } from '../../src/street/index.js';

const a = process.argv.slice(2);
const flag = k => a.includes(k), val = (k, d) => a.includes(k) ? a[a.indexOf(k) + 1] : d;
const [out, lat, lon, ey, tlat, tlon, ty, hour = '17.5'] = a.filter((s, i) => !s.startsWith('--') && !(i > 0 && ['--w', '--h'].includes(a[i - 1])));
const W = +val('--w', 1600), Hh = +val('--h', 900);
const H = await bootApp({ width: W, height: Hh, query: '?fly&noAudio&tier=low' });
const app = H.app;
const street = flag('--no-street') ? null : await attachStreet(app);
const p = toLocal(...toUTM(+lat, +lon)), t = toLocal(...toUTM(+tlat, +tlon));
const ground = (x, z) => (street && street.ground.heightAt(x, z)) ?? app.terrainData.heightAt(x, z);
const y = s => String(s).startsWith('+') ? 0 : null;
const eyeY = String(ey).startsWith('+') ? ground(p.x, p.z) + +ey.slice(1) : +ey;
const tY = String(ty).startsWith('+') ? ground(t.x, t.z) + +ty.slice(1) : +ty;
app.settings.timeOfDay = +hour;
const yaw = Math.atan2(-(t.x - p.x), -(t.z - p.z)), pitch = Math.atan2(tY - eyeY, Math.hypot(t.x - p.x, t.z - p.z));
app.fly.setPose(new Vector3(p.x, eyeY, p.z), yaw, pitch);
H.frames(90, 1 / 30);
const px = await H.readPixels();
writePNG(out, W, Hh, px);
console.log(JSON.stringify({ out, errors: H.errors.length, firstError: H.errors[0] || null, surfaceTris: street?.surface.triangles }));
process.exit(0);
