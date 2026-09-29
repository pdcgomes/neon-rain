/**
 * Mission mode: plays the real campaign with scripted squads and reads the difficulty curve off
 * the results. See docs/design/original-balance.md for the curve we are aiming at.
 */
import { existsSync, readdirSync, writeFileSync } from 'node:fs';
import { availableParallelism } from 'node:os';
import { Worker } from 'node:worker_threads';
import { World } from '../../src/sim/world.ts';
import { asciiMap, type Region } from './asciiMap.ts';
import { configure, describe, type Overrides } from './config.ts';
import { BOTS, type BotName } from './missionBot.ts';
import { loadMission, playMission, unreachable, type MissionRun } from './missionRun.ts';
import type { Task } from './worker.ts';

export interface MissionOptions {
  filters: string[];
  bots: string[];
  seeds: number;
  jobs: number;
  seconds: number;
  sets: Overrides;
  sweep: { key: string; values: string[] } | null;
  showRuns: boolean;
  jsonOut: string;
  trace: string;
  /** Kit for every mission; by default each gets what the campaign has unlocked by then. */
  wins?: number;
}

const root = new URL('../../', import.meta.url);

function missionFiles(filters: string[]): string[] {
  const out: string[] = [];
  for (const dir of ['src/content/missions', 'content-local/missions']) {
    const d = new URL(`${dir}/`, root);
    if (!existsSync(d)) continue;
    for (const f of readdirSync(d).filter((n) => n.endsWith('.json')).sort()) out.push(new URL(f, d).pathname);
  }
  const id = (f: string) => f.split('/').pop()!.replace('.json', '');
  return out.filter((f) => !filters.length || filters.some((x) => id(f).includes(x)));
}

const idOf = (file: string) => file.split('/').pop()!.replace('.json', '');

/** The file for a mission id (e.g. "synd_13", "01_downtown"). */
export function missionFile(id: string): string {
  const f = missionFiles([id]).find((x) => idOf(x) === id);
  if (!f) throw new Error(`no mission file for ${id}; convert it first (npm run synd -- convert --all)`);
  return f;
}

/** Campaign stage of a mission, for the curve summary. */
function tier(file: string): string {
  const id = idOf(file);
  const n = Number(id.match(/_(\d+)$/)?.[1] ?? 0);
  if (id.startsWith('revolt_')) return 'American Revolt';
  if (!id.startsWith('synd_')) return 'Neon Rain';
  if (n <= 10) return 'Syndicate 1-10';
  if (n <= 25) return 'Syndicate 11-25';
  if (n <= 40) return 'Syndicate 26-40';
  return 'Syndicate 41-50';
}
/** Missions won before this one, which sets the squad's kit: Syndicate n comes after n-1, American Revolt after all 50. */
export function winsFor(file: string): number {
  const id = idOf(file);
  if (id.startsWith('revolt_')) return 50;
  const n = Number(id.match(/^synd_(\d+)$/)?.[1] ?? 1);
  return n - 1;
}

const TIERS = ['Neon Rain', 'Syndicate 1-10', 'Syndicate 11-25', 'Syndicate 26-40', 'Syndicate 41-50', 'American Revolt'];

/** Checks on the curve, from the manual and the American Revolt reference card. */
const CHECKS: { tier: string; bot: BotName; test: 'min' | 'max'; win: number; why: string }[] = [
  { tier: 'Syndicate 1-10', bot: 'rush', test: 'min', win: 0.6, why: 'early missions forgive a careless rush' },
  { tier: 'Syndicate 26-40', bot: 'rush', test: 'max', win: 0.5, why: 'from mid-campaign a rush fails more often than not' },
  { tier: 'Syndicate 41-50', bot: 'rush', test: 'max', win: 0.3, why: 'late missions punish a rush' },
  { tier: 'Syndicate 26-40', bot: 'careful', test: 'min', win: 0.6, why: 'careful play wins mid-campaign' },
  { tier: 'American Revolt', bot: 'panic', test: 'max', win: 0.2, why: '"bulldoze through in group mode ... and suffer the consequences"' },
  { tier: 'American Revolt', bot: 'careful', test: 'max', win: 0.5, why: 'careful play without IPA struggles in American Revolt' },
  { tier: 'American Revolt', bot: 'expert', test: 'min', win: 0.6, why: '"mastery of IPA levels" wins American Revolt' },
];

async function runAll(tasks: Omit<Task, 'id'>[], jobs: number, progress: (done: number) => void): Promise<MissionRun[]> {
  const results: MissionRun[] = new Array(tasks.length);
  // Longest missions first, so the pool doesn't end on one straggler.
  const order = tasks.map((t, i) => ({ t, i, size: loadMission(t.file).spawns?.length ?? 100 })).sort((a, b) => b.size - a.size);
  let next = 0;
  let done = 0;
  const n = Math.max(1, Math.min(jobs, tasks.length));
  await Promise.all(
    Array.from({ length: n }, async () => {
      const worker = new Worker(new URL('./worker.ts', import.meta.url));
      let failed: ((e: Error) => void) | null = null;
      worker.on('error', (e) => failed?.(e));
      try {
        while (next < order.length) {
          const { t, i } = order[next++];
          const msg = await new Promise<{ run?: MissionRun; error?: string }>((resolve, reject) => {
            failed = reject;
            worker.once('message', resolve);
            worker.postMessage({ ...t, id: i });
          });
          if (msg.error) throw new Error(msg.error);
          results[i] = msg.run!;
          progress(++done);
        }
      } finally {
        await worker.terminate();
      }
    }),
  );
  return results;
}

interface Cell {
  win: number;
  /** Runs that ran out of time rather than failing. */
  timeout: number;
  lost: number;
  dmg: number;
  progress: number;
  kills: number;
  n: number;
}

function summarise(runs: MissionRun[]): Cell {
  const n = runs.length || 1;
  const sum = (f: (r: MissionRun) => number) => runs.reduce((s, r) => s + f(r), 0) / n;
  return {
    win: sum((r) => (r.result === 'win' ? 1 : 0)),
    timeout: sum((r) => (r.result === 'timeout' ? 1 : 0)),
    lost: sum((r) => r.lost),
    dmg: sum((r) => r.dmg),
    progress: sum((r) => r.progress),
    kills: sum((r) => (r.enemies ? r.kills / r.enemies : 0)),
    n: runs.length,
  };
}

const pct = (x: number) => `${Math.round(x * 100)}%`;
const pad = (s: string | number, n: number) => String(s).padEnd(n);
/** win%, agents lost, damage taken; a trailing "t" when most non-wins ran out of time. */
const cellText = (c: Cell) => `${pct(c.win).padStart(4)} ${c.lost.toFixed(1)} ${pct(c.dmg).padStart(4)}${c.timeout > (1 - c.win) / 2 ? 't' : ' '}`;

function report(files: string[], bots: BotName[], runs: MissionRun[], showRuns: boolean): { met: number; total: number } {
  const by = (f: string, b: BotName) => runs.filter((r) => r.file === f && r.bot === b);
  console.log(`${pad('mission', 34)}${bots.map((b) => pad(b, 16)).join('')}   cells: win%, agents lost, damage taken; t = mostly timed out`);
  for (const f of files) {
    const m = loadMission(f);
    const name = `${idOf(f)} ${m.codename.toLowerCase()}`.slice(0, 32);
    console.log(pad(name, 34) + bots.map((b) => pad(cellText(summarise(by(f, b))), 16)).join(''));
    if (showRuns) {
      for (const r of runs.filter((x) => x.file === f)) {
        console.log(`    ${pad(r.bot, 8)} seed ${String(r.seed).padStart(5)}  ${pad(r.result, 8)}${r.time.toFixed(0).padStart(4)}s  obj ${pct(r.progress).padStart(4)}  lost ${r.lost}  kills ${r.kills}/${r.enemies}  civ ${r.civilians}  ${r.reason}`);
      }
    }
  }

  console.log(`\n${pad('stage', 34)}${bots.map((b) => pad(b, 16)).join('')}`);
  const tiers = TIERS.filter((t) => files.some((f) => tier(f) === t));
  const cells = new Map<string, Cell>();
  for (const t of tiers) {
    const row = bots.map((b) => {
      const c = summarise(runs.filter((r) => tier(r.file) === t && r.bot === b));
      cells.set(`${t}|${b}`, c);
      return pad(cellText(c), 16);
    });
    console.log(pad(`${t} (${files.filter((f) => tier(f) === t).length})`, 34) + row.join(''));
  }

  let met = 0;
  let total = 0;
  const lines: string[] = [];
  for (const c of CHECKS) {
    const cell = cells.get(`${c.tier}|${c.bot}`);
    if (!cell) continue;
    total++;
    const ok = c.test === 'min' ? cell.win >= c.win : cell.win <= c.win;
    if (ok) met++;
    lines.push(`  ${ok ? '✓' : '✗'} ${c.tier}: ${c.bot} wins ${pct(cell.win)} (want ${c.test === 'min' ? '≥' : '≤'} ${pct(c.win)}): ${c.why}`);
  }
  if (lines.length) console.log(`\ncurve checks met: ${met}/${total}\n${lines.join('\n')}`);
  return { met, total };
}

/** Prints a mission as ASCII (see asciiMap.ts), for reading real maps and writing plans. */
export function printMap(filter: string, scale: number, region?: Region): void {
  const f = missionFiles([filter]).find((x) => idOf(x) === filter) ?? missionFiles([filter])[0];
  if (!f) throw new Error(`no mission matches ${filter}`);
  const cfg = configure([], winsFor(f));
  const world = new World({ weapons: cfg.weapons, agents: [], mission: loadMission(f) }, cfg.squad, 1000);
  const m = world.content.mission;
  console.log(`${idOf(f)} ${m.codename}: ${world.map.w}x${world.map.h} m, ${scale} m per character`);
  console.log(`objectives: ${m.objectives.map((o) => `${o.type}${o.at ? ` at ${Math.round(o.at.x)},${Math.round(o.at.y)}` : ''}`).join(' > ')}`);
  for (const line of asciiMap(world, scale, region)) console.log(line);
}

export async function runMissions(o: MissionOptions): Promise<void> {
  const all = missionFiles(o.filters);
  if (!all.length) throw new Error(`no mission matches ${o.filters.join(', ')}`);
  const cfg0 = configure(o.sets);
  const blocked = new Map(all.map((f) => [f, unreachable(f, cfg0)] as const).filter(([, why]) => why.length));
  const files = all.filter((f) => !blocked.has(f));
  if (blocked.size) {
    console.log(`not playable as converted (can't be reached on foot from the drop zone), left out:`);
    for (const [f, why] of blocked) console.log(`  ${idOf(f).padEnd(10)} ${why.join(', ')}`);
  }
  if (!files.length) return;
  const bots = (o.bots.length ? o.bots : BOTS) as BotName[];
  for (const b of bots) if (!BOTS.includes(b)) throw new Error(`unknown bot "${b}"; have ${BOTS.join(', ')}`);
  const seconds = o.seconds || 300;
  const seeds = Array.from({ length: o.seeds }, (_, i) => 1000 + i * 7919);

  if (o.trace) {
    const bot = o.trace as BotName;
    if (!BOTS.includes(bot)) throw new Error(`--trace in mission mode wants a bot name (${BOTS.join(', ')})`);
    const f = files[0];
    console.log(`trace ${idOf(f)} ${bot} seed ${seeds[0]}, ${describe(o.sets)}`);
    const r = playMission(f, bot, seeds[0], configure(o.sets, o.wins ?? winsFor(f)), seconds, (msg) => console.log(`  ${msg}`));
    console.log(`  objectives ${pct(r.progress)}  lost ${r.lost}  dmg ${pct(r.dmg)}  kills ${r.kills}/${r.enemies}  civilians ${r.civilians}`);
    return;
  }

  const jobs = o.jobs || Math.max(1, availableParallelism() - 1);
  const variants: Overrides[] = o.sweep ? o.sweep.values.map((v) => [...o.sets, [o.sweep!.key, v]]) : [o.sets];
  const out: { overrides: string; runs: MissionRun[] }[] = [];
  const summaries: { label: string; tiers: Map<string, Cell>; met: string }[] = [];

  for (const overrides of variants) {
    const tasks = files.flatMap((file) => bots.flatMap((bot) => seeds.map((seed) => ({ file, bot, seed, overrides, seconds, wins: o.wins ?? winsFor(file) }))));
    const label = describe(overrides);
    const t0 = performance.now();
    console.log(`\nmissions: ${files.length} x ${bots.length} bots x ${seeds.length} seeds = ${tasks.length} runs on ${jobs} threads, up to ${seconds} s each, ${label}\n`);
    const runs = await runAll(tasks, jobs, (d) => {
      if (process.stdout.isTTY) process.stdout.write(`\r  ${d}/${tasks.length}`);
    });
    if (process.stdout.isTTY) process.stdout.write('\r');
    const { met, total } = report(files, bots, runs, o.showRuns);
    console.log(`\n(${((performance.now() - t0) / 1000).toFixed(0)} s)`);
    out.push({ overrides: label, runs });
    const tiers = new Map<string, Cell>();
    for (const t of TIERS) for (const b of bots) tiers.set(`${t}|${b}`, summarise(runs.filter((r) => tier(r.file) === t && r.bot === b)));
    summaries.push({ label, tiers, met: `${met}/${total}` });
  }

  if (o.sweep) {
    console.log(`\nsweep ${o.sweep.key}   cells: win%, agents lost, damage taken`);
    console.log(pad('', 34) + summaries.map((s) => pad(s.label.split(' ').pop()!, 18)).join(''));
    for (const t of TIERS) {
      for (const b of bots) {
        if (!summaries[0].tiers.get(`${t}|${b}`)?.n) continue;
        console.log(pad(`${t} ${b}`, 34) + summaries.map((s) => pad(cellText(s.tiers.get(`${t}|${b}`)!), 18)).join(''));
      }
    }
    console.log(pad('curve checks met', 34) + summaries.map((s) => pad(s.met, 18)).join(''));
  }

  if (o.jsonOut) {
    writeFileSync(o.jsonOut, `${JSON.stringify({ seconds, seeds, variants: out }, null, 1)}\n`);
    console.log(`\nwrote ${o.jsonOut}`);
  }
}
