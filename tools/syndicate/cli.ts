/**
 * Syndicate data tools. Looks for DATA folders under content-local/ (or --data) and writes only to
 * gitignored folders.
 *
 *   npm run synd -- list
 *   npm run synd -- dump --mission 1 [--set revolt]      # PNGs + JSON listing in .synd-import/
 *   npm run synd -- convert --mission 1 [--scale 3]      # content-local/missions/synd_01.json
 *   npm run synd -- convert --all [--set revolt]
 */
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { SyndDataset } from '../../src/import/syndicate/dataset.ts';
import { overlayGame, renderConverted, renderOriginal, type Raster } from '../../src/import/syndicate/raster.ts';
import { defaultTileTable } from '../../src/import/syndicate/tileClasses.ts';
import { findDataFolders, loadDataset } from './node-data.ts';
import { encodePng } from './png.ts';

const args = process.argv.slice(2);
const cmd = args[0] ?? 'list';
const opt = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const flag = (name: string) => args.includes(`--${name}`);

const root = resolve(opt('data') ?? 'content-local');
const folders = findDataFolders(root);
if (!folders.length) {
  console.error(`No Syndicate DATA folder found under ${root}. Copy the game files into content-local/.`);
  process.exit(1);
}
const sets = new Map<string, SyndDataset>();
for (const f of folders) {
  const ds = loadDataset(f, root);
  if (!sets.has(ds.info.key)) sets.set(ds.info.key, ds);
}
const ds = sets.get(opt('set') ?? 'syndicate') ?? [...sets.values()][0];
const pad2 = (n: number) => String(n).padStart(2, '0');
const png = (r: Raster, path: string) => writeFileSync(path, encodePng(r.w, r.h, new Uint8Array(r.data.buffer)));

if (cmd === 'list') {
  for (const [key, set] of sets) {
    console.log(`\n${set.info.label} (${key})`);
    for (const n of set.missions()) {
      const s = set.summary(n);
      console.log(`  ${pad2(n)}  map ${pad2(s.mapId)}  ${s.title.padEnd(28)} ${String(s.people).padStart(3)} people  ${s.objectives.join(', ')}`);
    }
  }
} else if (cmd === 'dump') {
  const n = Number(opt('mission') ?? 1);
  const game = ds.game(n)!;
  const map = ds.map(game.mapId);
  const res = ds.convert(n, opt('scale') ? { scale: Number(opt('scale')) } : {});
  mkdirSync('.synd-import', { recursive: true });
  const base = `.synd-import/${ds.info.key}-${pad2(n)}`;
  const orig = renderOriginal(map, ds.col(), defaultTileTable(), 'class', res.streetLevel, 6);
  overlayGame(orig, game);
  png(orig, `${base}-original.png`);
  png(renderOriginal(map, ds.col(), defaultTileTable(), 'street', res.streetLevel, 6), `${base}-street.png`);
  const conv = renderConverted(res, 6);
  overlayGame(conv, game, { x: res.crop.x, y: res.crop.y });
  png(conv, `${base}-converted.png`);
  writeFileSync(`${base}.json`, JSON.stringify({ summary: ds.summary(n), game, briefing: ds.briefing(n), notes: res.notes, counts: res.counts, crop: res.crop }, null, 1));
  console.log(`${base}-{original,street,converted}.png, ${base}.json`);
  console.log('crop', res.crop, 'street level', res.streetLevel, res.counts);
  for (const note of res.notes) console.log(' -', note);
} else if (cmd === 'convert') {
  const list = flag('all') ? ds.missions().filter((n) => n < 90) : [Number(opt('mission') ?? 1)];
  const out = resolve('content-local/missions');
  mkdirSync(out, { recursive: true });
  // The American Revolt data disk ships all 50 mission files; only the ones that differ are its own.
  const base = ds.info.key !== 'syndicate' ? sets.get('syndicate') : undefined;
  for (const n of list) {
    if (base && JSON.stringify(base.game(n)) === JSON.stringify(ds.game(n))) {
      const stale = `${out}/${ds.info.key}_${pad2(n)}.json`;
      if (existsSync(stale)) rmSync(stale);
      console.log(`${ds.info.key}_${pad2(n)}  same as syndicate_${pad2(n)}, skipped`);
      continue;
    }
    const res = ds.convert(n, opt('scale') ? { scale: Number(opt('scale')) } : {});
    const file = `${out}/${res.mission.id}.json`;
    writeFileSync(file, JSON.stringify(res.mission));
    const l = res.mission.map.kind === 'authored' ? res.mission.map.layout : null;
    console.log(`${res.mission.id}  ${res.mission.codename.padEnd(28)} ${l?.w}x${l?.h} m  ${res.counts.buildings} buildings  ${res.mission.spawns?.length} spawns  ${res.mission.objectives.map((o) => o.type).join(' > ')}`);
    for (const note of res.notes) console.log('   -', note);
  }
} else if (cmd === 'stats') {
  // Opposition per mission: armed people by class, with health, mods and IPA as stored in GAMExx.DAT.
  const cls = (opt('class') ?? 'agent,guard,police').split(',');
  const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
  console.log(`${ds.info.label}: people on the map by class; hp, mods (L A C H E B) and IPA (A I P amount) are averages\n`);
  for (const n of ds.missions().filter((m) => m < 90)) {
    const g = ds.game(n)!;
    const s = ds.summary(n);
    const cells = cls.map((c) => {
      const ps = g.people.filter((p) => p.onMap && p.cls === c && p.index >= (c === 'agent' ? 8 : 0));
      if (!ps.length) return `${c} -`.padEnd(64);
      const mods = (['legs', 'arms', 'chest', 'heart', 'eyes', 'brain'] as const).map((k) => avg(ps.map((p) => p.mods[k])).toFixed(1)).join(' ');
      const ipa = (['adrenaline', 'intelligence', 'perception'] as const).map((k) => Math.round(avg(ps.map((p) => p.ipa[k].amount)))).join(' ');
      const weapons = new Map<string, number>();
      for (const p of ps) for (const w of p.weapons) weapons.set(w, (weapons.get(w) ?? 0) + 1);
      const top = [...weapons].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([w, k]) => `${w}×${k}`).join(',');
      return `${c} ${String(ps.length).padStart(2)} hp ${String(Math.round(avg(ps.map((p) => p.health)))).padStart(3)} mods ${mods} ipa ${ipa.padEnd(11)} ${top}`.padEnd(64);
    });
    console.log(`${pad2(n)} ${s.title.slice(0, 18).padEnd(18)} ${cells.join(' | ')}`);
  }
} else {
  console.error(`Unknown command ${cmd}`);
  process.exit(1);
}
