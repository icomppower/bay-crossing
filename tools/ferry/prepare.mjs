// Ferry facts from the cached Golden Gate Ferry GTFS feed → public/ferry/schedule.json: the terminal positions
// (bay frame) and the published Sausalito ↔ San Francisco trip times. Only facts are shipped (no shapes).
//   node tools/ferry/prepare.mjs [--raw <dir>] [--out <file>]
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readCached, RAW } from '../data/cache.mjs';
import { readZip, parseCSV } from '../data/zip.mjs';
import { toUTM } from '../geo/utm.mjs';
import { GRID } from '../terrain/build.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const R3 = v => Math.round(v * 1000) / 1000;

export function prepareFerry({ rawDir = RAW } = {}) {
  const z = readZip(readCached('ggt-gtfs.zip', rawDir));
  const T = n => parseCSV(z[n].toString('utf8'));
  const stops = Object.fromEntries(T('stops.txt').map(s => [s.stop_id, s]));
  const trips = T('trips.txt').filter(t => /^SSSF/.test(t.route_id));
  const ids = new Set(trips.map(t => t.trip_id));
  const byTrip = {};
  for (const s of T('stop_times.txt')) if (ids.has(s.trip_id)) (byTrip[s.trip_id] ||= []).push(s);
  const min = t => { const [h, m, s] = t.split(':').map(Number); return h * 60 + m + s / 60; };
  const name = id => stops[id].stop_name;
  const durations = { toSausalito: [], toSanFrancisco: [] }, used = new Set();
  for (const list of Object.values(byTrip)) {
    list.sort((a, b) => a.stop_sequence - b.stop_sequence);
    const a = list[0], b = list.at(-1);
    used.add(a.stop_id); used.add(b.stop_id);
    (/Sausalito/i.test(name(b.stop_id)) ? durations.toSausalito : durations.toSanFrancisco).push(min(b.arrival_time) - min(a.departure_time));
  }
  for (const k in durations) durations[k].sort((a, b) => a - b);
  const place = id => { const s = stops[id], [E, N] = toUTM(+s.stop_lat, +s.stop_lon); return { stopId: id, name: s.stop_name, lat: +s.stop_lat, lon: +s.stop_lon, x: R3(E - GRID.originE), z: R3(GRID.originN - N) }; };
  const all = [...used].sort().map(place);
  return {
    source: 'Golden Gate Ferry GTFS (realtime.goldengate.org/gtfsstatic/GTFSTransitData.zip), route SSSF "Sausalito - San Francisco Ferry"; facts only',
    trips: trips.length,
    terminals: { sausalito: all.filter(s => /Sausalito/i.test(s.name)), sanFrancisco: all.filter(s => !/Sausalito/i.test(s.name)) },
    publishedMinutes: { toSausalito: durations.toSausalito, toSanFrancisco: durations.toSanFrancisco },
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const out = arg('--out', join(root, 'public/ferry/schedule.json'));
  mkdirSync(dirname(out), { recursive: true });
  const f = prepareFerry({ rawDir: arg('--raw', RAW) });
  writeFileSync(out, JSON.stringify(f, null, 1) + '\n');
  console.log(`ferry: ${f.trips} trips; Sausalito ${f.terminals.sausalito.map(s => s.stopId)}; SF ${f.terminals.sanFrancisco.map(s => s.stopId)}; minutes ${JSON.stringify(f.publishedMinutes)}`);
}
