/**
 * Dev helper: decompresses every RNC file in a Syndicate DATA folder into .synd-import/raw/<folder>/.
 *
 *   node tools/syndicate/unpack.ts "content-local/synticate plus/SYNDICAT/DATA"
 */
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { isRnc, unrnc } from '../../src/import/syndicate/rnc.ts';

const dir = resolve(process.argv[2] ?? 'content-local/original');
const out = resolve('.synd-import/raw', basename(dirname(dir)));
mkdirSync(out, { recursive: true });
let packed = 0;
let failed = 0;
for (const f of readdirSync(dir)) {
  const data = new Uint8Array(readFileSync(join(dir, f)));
  if (!isRnc(data)) continue;
  try {
    const raw = unrnc(data);
    writeFileSync(join(out, f), raw);
    packed++;
  } catch (e) {
    failed++;
    console.error(f, (e as Error).message);
  }
}
console.log(`unpacked ${packed} files into ${out}${failed ? `, ${failed} failed` : ''}`);
