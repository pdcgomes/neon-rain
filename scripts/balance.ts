/**
 * Difficulty evaluation: plays each balance scenario (scripts/balance/scenarios.ts) with a
 * brute-force plan and a tactical plan over many seeds, and checks the results against the
 * difficulty we want: rushing should cost agents, playing carefully should win but hurt.
 *
 *   node scripts/balance.ts                          # every scenario, 16 seeds each
 *   node scripts/balance.ts plaza crossfire          # just these
 *   node scripts/balance.ts --seeds 40               # more seeds, tighter numbers
 *   node scripts/balance.ts --set npcSpread=1.2      # try a change without editing code (repeatable)
 *   node scripts/balance.ts --set uzi.damage=7 --set agent.loadout=pistol+uzi+persuadertron
 *   node scripts/balance.ts --sweep agentReact=0.3,0.45,0.6    # one knob, one column per value
 *   node scripts/balance.ts --runs                   # a line per run
 *   node scripts/balance.ts --json out.json          # save the numbers
 *   node scripts/balance.ts --wins 0                 # fight with the starting kit (default: 8 missions in)
 *
 * Mission mode plays the real campaign (bundled missions plus content-local/missions) with
 * scripted squads, in parallel worker threads:
 *
 *   node scripts/balance.ts --missions                         # every mission, every bot, 3 seeds
 *   node scripts/balance.ts --missions synd_0 revolt --bots rush,careful --seeds 5
 *   node scripts/balance.ts --missions synd_13 --trace careful # narrate one run
 *   node scripts/balance.ts --missions --sweep npcDamage=1,2 --time 240 --jobs 8
 *
 * `--set` keys are fields of `balance` (src/sim/balance.ts), `<weapon>.<field>` for weapons.json,
 * or `agent.<field>` for the agent template in agents.json.
 */
import { writeFileSync } from 'node:fs';
import { balance, BALANCE_DEFAULTS } from '../src/sim/balance.ts';
import type { Content } from '../src/sim/content.ts';
import { TICK_HZ, World } from '../src/sim/world.ts';
import { Bot, type Plan } from './balance/bot.ts';
import { configure, describe, type Config } from './balance/config.ts';
import type { Region } from './balance/asciiMap.ts';
import { loadMission } from './balance/missionRun.ts';
import { missionFile, printMap, runMissions, winsFor } from './balance/missions.ts';
import { PlanRunner } from './balance/planBot.ts';
import { BRUTE, scenarios, TACTIC, type Expect, type Scenario } from './balance/scenarios.ts';

const MAX_SECONDS = 150;
const MISSION_SECONDS = 600;

// ------------------------------------------------------------------ arguments

const argv = process.argv.slice(2);
let seedsArg: number | undefined;
let showRuns = false;
let jsonOut = '';
let traceArg = '';
let missionMode = false;
let botsArg: string[] = [];
let jobs = 0;
let seconds = 0;
let winsArg: number | undefined;
let mapArg = '';
let scaleArg = 3;
let regionArg: Region | undefined;
const sets: [string, string][] = [];
let sweep: { key: string; values: string[] } | null = null;
const only: string[] = [];
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  const kv = (s: string) => {
    const eq = s.indexOf('=');
    if (eq < 0) throw new Error(`expected key=value, got "${s}"`);
    return [s.slice(0, eq), s.slice(eq + 1)] as [string, string];
  };
  if (a === '--seeds') seedsArg = Number(argv[++i]);
  else if (a === '--missions') missionMode = true;
  else if (a === '--bots') botsArg = argv[++i].split(',');
  else if (a === '--jobs') jobs = Number(argv[++i]);
  else if (a === '--time') seconds = Number(argv[++i]);
  else if (a === '--wins') winsArg = Number(argv[++i]);
  else if (a === '--map') mapArg = argv[++i];
  else if (a === '--scale') scaleArg = Number(argv[++i]);
  else if (a === '--region') {
    const [x0, y0, x1, y1] = argv[++i].split(',').map(Number);
    regionArg = { x0, y0, x1, y1 };
  }
  else if (a === '--runs') showRuns = true;
  else if (a === '--json') jsonOut = argv[++i];
  else if (a === '--trace') traceArg = argv[++i];
  else if (a === '--set') sets.push(kv(argv[++i]));
  else if (a === '--sweep') {
    const [key, list] = kv(argv[++i]);
    sweep = { key, values: list.split(',') };
  } else if (a.startsWith('--')) throw new Error(`unknown option ${a}`);
  else only.push(a);
}
const seeds = seedsArg ?? 16;
/** Arenas are fought with the kit of a squad eight missions in: Uzi, long-range rifle, minigun, chest V1. */
const arenaWins = winsArg ?? 8;
const selected = missionMode || mapArg ? [] : scenarios.filter((s) => !only.length || only.includes(s.id));
if (!missionMode && !mapArg && !selected.length) throw new Error(`no scenario matches ${only.join(', ')}; have ${scenarios.map((s) => s.id).join(', ')}`);

// ------------------------------------------------------------------ running

interface Run {
  seed: number;
  result: 'win' | 'loss' | 'timeout';
  time: number;
  /** Damage taken as a fraction of the squad's total HP (repairs don't give it back). */
  dmg: number;
  lost: number;
  kills: number;
  enemies: number;
  shots: number;
  hits: number;
}

function play(sc: Scenario, plan: Plan, cfg: Config, seed: number, trace = false): Run {
  const mission = sc.arena ? sc.arena.mission : loadMission(missionFile(sc.mission!));
  const points = sc.arena?.points ?? sc.points ?? {};
  const squad = plan.loadout ? cfg.squad.map((d) => ({ ...d, loadout: [...plan.loadout!] })) : cfg.squad;
  const content: Content = { weapons: cfg.weapons, agents: [], mission };
  const world = new World(content, squad, seed);
  const bot = sc.mission ? new PlanRunner(world, plan, points) : new Bot(world, plan, points);
  const limit = sc.mission ? MISSION_SECONDS : MAX_SECONDS;
  const agents = world.agents();
  const totalHp = agents.reduce((s, a) => s + a.maxHp, 0);
  const enemies = world.entities.filter((e) => e.faction === 'enemy').length;
  const prev = new Map(agents.map((a) => [a.id, a.hp]));
  let dmg = 0;
  let step = bot.stepIdx;
  let alarm = false;
  const log = (msg: string) => console.log(`  ${lpad(world.time.toFixed(1), 6)}s  ${msg}`);
  const where = (e: { x: number; y: number }) => `(${e.x.toFixed(0)},${e.y.toFixed(0)})`;
  while (world.tick < limit * TICK_HZ && world.phase !== 'success' && world.phase !== 'fail') {
    world.step(bot.commands());
    for (const a of agents) {
      const hp = Math.max(0, a.hp);
      dmg += Math.max(0, prev.get(a.id)! - hp);
      prev.set(a.id, hp);
    }
    if (!trace) continue;
    if (bot.stepIdx !== step) {
      step = bot.stepIdx;
      const squad = agents.map((a) => (a.alive ? `${a.name} ${where(a)} ${Math.round(a.hp)}hp` : `${a.name} dead`)).join(', ');
      log(step < (plan.steps?.length ?? 0) ? `step ${step + 1}: ${squad}` : `hunting: ${squad}`);
    }
    if (world.alarm && !alarm) {
      alarm = true;
      const spotters = world.entities
        .filter((e) => e.alive && e.faction === 'enemy' && e.ai === 'combat')
        .map((e) => {
          const t = world.get(e.targetId);
          return t ? `${e.name} ${where(e)} saw ${t.name} ${where(t)}${t.holstered ? ' (holstered)' : ''} at ${Math.hypot(t.x - e.x, t.y - e.y).toFixed(0)}m` : `${e.name} ${where(e)} heard something`;
        });
      log(`alarm raised: ${spotters.join('; ')}`);
    }
    for (const ev of world.events) {
      if (ev.t !== 'death') continue;
      const by = world.get(ev.by);
      const killer = by ? ` (${by.name || by.kind} ${where(by)} with ${by.weapons[by.weaponIdx] ?? '?'})` : '';
      log(`${world.get(ev.id)?.name ?? ev.kind} died at ${where(ev)}${ev.kind === 'agent' ? killer : ''}`);
    }
  }
  if (trace) log(`${world.phase}${world.resultReason ? `: ${world.resultReason}` : ''}`);
  return {
    seed,
    result: world.phase === 'success' ? 'win' : world.phase === 'fail' ? 'loss' : 'timeout',
    time: world.time,
    dmg: dmg / totalHp,
    lost: agents.filter((a) => !a.alive).length,
    kills: enemies - world.entities.filter((e) => e.alive && e.faction === 'enemy').length,
    enemies,
    shots: world.stats.shotsFired,
    hits: world.stats.shotsHit,
  };
}

interface Row {
  scenario: string;
  plan: string;
  kind: Plan['kind'];
  win: number;
  dmg: number;
  lost: number;
  time: number;
  acc: number;
  kills: number;
  expect: Expect;
  failures: string[];
  runs: Run[];
}

const pct = (x: number) => `${Math.round(x * 100)}%`;

function check(r: Omit<Row, 'failures'>): string[] {
  const e = r.expect;
  const tests: [boolean | undefined, string][] = [
    [e.minWin !== undefined ? r.win >= e.minWin : undefined, `win ${pct(r.win)} < ${pct(e.minWin ?? 0)}`],
    [e.maxWin !== undefined ? r.win <= e.maxWin : undefined, `win ${pct(r.win)} > ${pct(e.maxWin ?? 0)}`],
    [e.minLost !== undefined ? r.lost >= e.minLost : undefined, `lost ${r.lost.toFixed(2)} < ${e.minLost}`],
    [e.maxLost !== undefined ? r.lost <= e.maxLost : undefined, `lost ${r.lost.toFixed(2)} > ${e.maxLost}`],
    [e.minDmg !== undefined ? r.dmg >= e.minDmg : undefined, `dmg ${pct(r.dmg)} < ${pct(e.minDmg ?? 0)}`],
    [e.maxDmg !== undefined ? r.dmg <= e.maxDmg : undefined, `dmg ${pct(r.dmg)} > ${pct(e.maxDmg ?? 0)}`],
  ];
  const checked = tests.filter(([ok]) => ok !== undefined);
  const failed = checked.filter(([ok]) => !ok).map(([, why]) => why);
  if (e.any) return checked.some(([ok]) => ok) ? [] : failed;
  return failed;
}

/** Arenas use the arena kit; real missions the kit the campaign has unlocked by then. */
function cfgFor(sc: Scenario, overrides: [string, string][]): Config {
  return configure(overrides, winsArg ?? (sc.mission ? winsFor(missionFile(sc.mission)) : arenaWins));
}

function evaluate(overrides: [string, string][]): Row[] {
  const rows: Row[] = [];
  for (const sc of selected) {
    const cfg = cfgFor(sc, overrides);
    for (const [name, plan] of Object.entries(sc.plans)) {
      const runs = Array.from({ length: seeds }, (_, i) => play(sc, plan, cfg, 1000 + i * 7919));
      const mean = (f: (r: Run) => number) => runs.reduce((s, r) => s + f(r), 0) / runs.length;
      const shots = runs.reduce((s, r) => s + r.shots, 0);
      const row = {
        scenario: sc.id,
        plan: name,
        kind: plan.kind,
        win: mean((r) => (r.result === 'win' ? 1 : 0)),
        dmg: mean((r) => r.dmg),
        lost: mean((r) => r.lost),
        time: mean((r) => r.time),
        acc: shots ? runs.reduce((s, r) => s + r.hits, 0) / shots : 0,
        kills: mean((r) => r.kills / r.enemies),
        expect: plan.expect ?? (plan.kind === 'brute' ? BRUTE : TACTIC),
        runs,
      };
      rows.push({ ...row, failures: check(row) });
    }
  }
  return rows;
}

// ------------------------------------------------------------------ reporting

const pad = (s: string | number, n: number) => String(s).padEnd(n);
const lpad = (s: string | number, n: number) => String(s).padStart(n);
const met = (rows: Row[]) => `${rows.filter((r) => !r.failures.length).length}/${rows.length}`;

function report(rows: Row[]): void {
  console.log(`${pad('scenario', 11)}${pad('plan', 9)}${pad('kind', 7)}${lpad('win', 5)}${lpad('dmg', 6)}${lpad('lost', 6)}${lpad('kills', 7)}${lpad('time', 6)}${lpad('acc', 5)}  check`);
  for (const r of rows) {
    const verdict = r.failures.length ? `✗ ${r.failures.join('; ')}` : '✓';
    console.log(
      `${pad(r.scenario, 11)}${pad(r.plan, 9)}${pad(r.kind, 7)}${lpad(pct(r.win), 5)}${lpad(pct(r.dmg), 6)}${lpad(r.lost.toFixed(2), 6)}${lpad(pct(r.kills), 7)}` +
        `${lpad(`${Math.round(r.time)}s`, 6)}${lpad(pct(r.acc), 5)}  ${verdict}`,
    );
    if (showRuns) {
      for (const run of r.runs) {
        console.log(`    seed ${lpad(run.seed, 6)}  ${pad(run.result, 8)}${lpad(`${run.time.toFixed(1)}s`, 7)}  dmg ${lpad(pct(run.dmg), 4)}  lost ${run.lost}  kills ${run.kills}/${run.enemies}  shots ${run.shots}`);
      }
    }
  }
  console.log(`\nexpectations met: ${met(rows)}`);
}

const results: { overrides: string; rows: Omit<Row, 'runs'>[] }[] = [];

if (mapArg) {
  printMap(mapArg, scaleArg, regionArg);
} else if (missionMode) {
  await runMissions({ filters: only, bots: botsArg, seeds: seedsArg ?? 3, jobs, seconds, sets, sweep, showRuns, jsonOut, trace: traceArg, wins: winsArg });
} else if (traceArg) {
  const [id, planName, seedArg] = traceArg.split(':');
  const sc = scenarios.find((s) => s.id === id);
  const plan = sc?.plans[planName];
  if (!sc || !plan) throw new Error(`--trace wants scenario:plan[:seed], e.g. plaza:rush`);
  const seed = seedArg ? Number(seedArg) : 1000;
  console.log(`trace ${id}:${planName} seed ${seed}, ${describe(sets)}`);
  const r = play(sc, plan, cfgFor(sc, sets), seed, true);
  console.log(`  dmg ${pct(r.dmg)}  lost ${r.lost}  kills ${r.kills}/${r.enemies}  shots ${r.shots}  acc ${pct(r.shots ? r.hits / r.shots : 0)}`);
} else if (!sweep) {
  console.log(`balance: ${selected.length} scenarios x ${seeds} seeds, ${describe(sets)}\n`);
  const rows = evaluate(sets);
  report(rows);
  results.push({ overrides: describe(sets), rows: rows.map(({ runs, ...r }) => r) });
} else {
  const { key, values } = sweep;
  console.log(`sweep ${key}: ${selected.length} scenarios x ${seeds} seeds, ${describe(sets)}   cells: win / dmg / lost\n`);
  const columns = values.map((v) => {
    const overrides: [string, string][] = [...sets, [key, v]];
    const rows = evaluate(overrides);
    results.push({ overrides: describe(overrides), rows: rows.map(({ runs, ...r }) => r) });
    return rows;
  });
  const W = 20;
  console.log(pad('', 20) + values.map((v) => pad(`${key}=${v}`, W)).join(''));
  columns[0].forEach((r, i) => {
    const cells = columns.map((c) => {
      const x = c[i];
      return pad(`${pct(x.win)} / ${pct(x.dmg)} / ${x.lost.toFixed(1)} ${x.failures.length ? '✗' : '✓'}`, W);
    });
    console.log(pad(`${r.scenario} ${r.plan}`, 20) + cells.join(''));
  });
  console.log(pad('met', 20) + columns.map((c) => pad(met(c), W)).join(''));
}
Object.assign(balance, BALANCE_DEFAULTS);

if (jsonOut && !missionMode) {
  writeFileSync(jsonOut, `${JSON.stringify({ seeds, results }, null, 2)}\n`);
  console.log(`\nwrote ${jsonOut}`);
}
