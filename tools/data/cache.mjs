// Read-only access to data/raw/: every file is checked against MANIFEST.sha256 before it is used, so
// pipelines only ever see the cached, checksummed download (never the network).
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export const RAW = join(dirname(fileURLToPath(import.meta.url)), '../../data/raw');

export function readCached(file, dir = RAW) {
  const man = join(dir, 'MANIFEST.sha256');
  if (!existsSync(man)) throw new Error(`cache: ${man} missing — run node tools/data/fetch.mjs`);
  const want = readFileSync(man, 'utf8').trim().split('\n').map(l => l.split(/\s+/)).find(([, f]) => f === file)?.[0];
  if (!want) throw new Error(`cache: ${file} is not in MANIFEST.sha256`);
  const path = join(dir, file);
  if (!existsSync(path)) throw new Error(`cache: ${file} missing from ${dir}`);
  const buf = readFileSync(path);
  const got = createHash('sha256').update(buf).digest('hex');
  if (got !== want) throw new Error(`cache: ${file} checksum mismatch`);
  return buf;
}
