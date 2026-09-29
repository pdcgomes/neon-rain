/**
 * Analyses gameplay telemetry: recordings the game saves to content-local/telemetry/ when
 * "Record telemetry" is ticked in the briefing (see src/sim/telemetry.ts).
 *
 *   node scripts/telemetry.ts                      # list sessions
 *   node scripts/telemetry.ts summary [filter…]    # per mission: wins, losses, killers, IPA, weapons
 *   node scripts/telemetry.ts deaths [filter…]     # every agent death: when, by what, from where, in what state
 *   node scripts/telemetry.ts ipa [filter…]        # how the drugs were used, per session
 *   node scripts/telemetry.ts replay <file|#> [--trace]   # re-run headlessly; check it reproduces
 *   node scripts/telemetry.ts bot <mission> [bot] [--seed n] [--wins n]  # record a scripted squad too
 *
 * Filters match mission ids or file names (e.g. synd_13, revolt, 2026-09-29, bot:expert).
 * `--player` / `--bots` limit to human or scripted sessions; `--json` prints raw numbers.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { configure } from './balance/config.ts';
import { BOTS, MissionBot, type BotName } from './balance/missionBot.ts';
import { loadMission } from './balance/missionRun.ts';
import { missionFile, winsFor } from './balance/missions.ts';
import { TICK_HZ, World } from '../src/sim/world.ts';
import { Recorder, replay, type Recording } from '../src/sim/telemetry.ts';
import { agentsLost, ipaUse, killerOf, outcomeOf, summarise } from '../src/sim/telemetryAnalysis.ts';

const dir = new URL('../content-local/telemetry/', import.meta.url).pathname;
const argv = process.argv.slice(2);
const flag = (f: string) => argv.includes(`--${f}`);
const opt = (f: string) => {
  const i = argv.indexOf(`--${f}`);
  return i >= 0 ? argv[i + 1] : undefined;
};
const words = argv.filter((a, i) => !a.startsWith('--') && !['--seed', '--wins'].includes(argv[i - 1]));
const cmd = ['summary', 'deaths', 'ipa', 'replay', 'bot', 'list'].includes(words[0]) ? words.shift()! : 'list';

const pct = (x: number) => `${Math.round(x * 100)}%`;
const secs = (ticks: number) => `${Math.round(ticks / TICK_HZ)}s`;
const pad = (s: string | number, n: number) => String(s).padEnd(n);
const lpad = (s: string | number, n: number) => String(s).padStart(n);

interface Session {
  file: string;
  rec: Recording;
}

function sessions(filters: string[]): Session[] {
  if (!existsSync(dir)) return [];
  const all = readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .map((file) => ({ file, rec: JSON.parse(readFileSync(dir + file, 'utf8')) as Recording }));
  return all.filter(({ file, rec }) => {
    if (flag('player') && rec.player !== 'player') return false;
    if (flag('bots') && rec.player === 'player') return false;
    return !filters.length || filters.some((f) => file.includes(f) || rec.missionId.includes(f) || rec.player === f.replace(/^bot:/, ''));
  });
}

const outcome = outcomeOf;
const lost = agentsLost;
const killer = killerOf;

// ------------------------------------------------------------------ list

function list(ss: Session[]): void {
  if (!ss.length) return void console.log(`no recordings in ${dir} (tick "Record telemetry" in the briefing, or use: bot <mission>)`);
  console.log(`${pad('#', 4)}${pad('recorded', 21)}${pad('mission', 12)}${pad('by', 9)}${pad('result', 10)}${lpad('time', 6)}${lpad('lost', 6)}${lpad('kills', 7)}  reason`);
  ss.forEach(({ rec }, i) => {
    const kills = rec.deaths.filter((d) => d.kind !== 'agent' && d.kind !== 'civilian' && d.by?.faction === 'player').length;
    console.log(
      `${pad(i, 4)}${pad(rec.recordedAt.slice(0, 19).replace('T', ' '), 21)}${pad(rec.missionId, 12)}${pad(rec.player, 9)}${pad(outcome(rec), 10)}${lpad(secs(rec.result.ticks), 6)}${lpad(lost(rec), 6)}${lpad(kills, 7)}  ${rec.result.reason}`,
    );
  });
}

// ------------------------------------------------------------------ summary

function summary(ss: Session[]): void {
  const byMission = new Map<string, Recording[]>();
  for (const { rec } of ss) byMission.set(rec.missionId, [...(byMission.get(rec.missionId) ?? []), rec]);
  const json: Record<string, unknown> = {};
  for (const [id, recs] of byMission) {
    const s = summarise(recs);
    const who = recs.map((r) => r.player).filter((p, i, a) => a.indexOf(p) === i).join(', ');
    console.log(`\n${id} ${recs[0].mission.codename}: ${s.sessions} session${s.sessions === 1 ? '' : 's'} (${s.sessions - s.played} abandoned), ${who}`);
    console.log(`  wins ${s.wins}/${s.played}   agents lost ${s.lostPerSession.toFixed(1)} a session   time ${Math.round(s.seconds)}s   alarm at ${s.alarmAt === null ? '-' : `${Math.round(s.alarmAt)}s`}`);
    console.log(`  agents killed by: ${s.killers.slice(0, 5).map(([k, n]) => `${k} ×${n}`).join(', ') || '-'}`);
    console.log(`  damage taken from: ${s.damage.slice(0, 5).map(([k, v]) => `${k} ${Math.round(v)}`).join(', ') || '-'}`);
    console.log(`  shots: ${s.shots.slice(0, 5).map(([k, n]) => `${k} ${n}`).join(', ') || '-'}   hit rate ${pct(s.hitRate)}   fired on the agents' own ${pct(s.ownFire)}`);
    console.log(`  IPA: ${s.ipa.bars.map((b) => `${b.ch.toUpperCase()} dose ${b.dose.toFixed(2)} (boosted ${pct(b.boost)}, dulled ${pct(b.dull)})`).join('  ')}   dependency ${s.ipa.dependency.toFixed(2)}   overdrive ${pct(s.ipa.overdrive)}`);
    json[id] = s;
  }
  if (flag('json')) console.log(JSON.stringify(json, null, 1));
}

// ------------------------------------------------------------------ deaths

function deaths(ss: Session[]): void {
  for (const { rec } of ss) {
    for (const d of rec.deaths.filter((x) => x.kind === 'agent')) {
      // The agent's last sample before death: what it was doing.
      const s = [...rec.samples].reverse().find((x) => x.tick <= d.tick && x.agents.some((a) => a.id === d.id && a.hp > 0));
      const a = s?.agents.find((x) => x.id === d.id);
      const dist = d.by ? Math.hypot(d.by.x - d.x, d.by.y - d.y).toFixed(0) : '?';
      const state = a ? `${a.holstered ? 'holstered' : a.weapon}${a.fire ? (a.fire === 1 ? ', firing' : ', firing on its own') : ''}, IPA ${a.ipa.a.toFixed(1)}/${a.ipa.p.toFixed(1)}/${a.ipa.i.toFixed(1)} (dep ${((a.dep.a + a.dep.p + a.dep.i) / 3).toFixed(2)})` : '';
      console.log(`${pad(rec.missionId, 12)}${lpad(secs(d.tick), 6)}  ${pad(d.name, 8)} at (${d.x},${d.y}) by ${killer(d)} from ${dist} m${a ? `  [${state}]` : ''}`);
    }
  }
}

// ------------------------------------------------------------------ ipa

function ipa(ss: Session[]): void {
  console.log(`${pad('mission', 12)}${pad('result', 10)}${pad('A dose/boost', 16)}${pad('P dose/boost', 16)}${pad('I dose/boost', 16)}${pad('dependency', 12)}overdrive`);
  for (const { rec } of ss) {
    const u = ipaUse([rec]);
    const cell = (b: { dose: number; boost: number }) => pad(`${b.dose.toFixed(2)} / ${pct(b.boost)}`, 16);
    console.log(`${pad(rec.missionId, 12)}${pad(outcome(rec), 10)}${u.bars.map(cell).join('')}${pad(u.dependency.toFixed(2), 12)}${pct(u.overdrive)}`);
  }
}

// ------------------------------------------------------------------ replay

function replayOne(ss: Session[], which: string): void {
  const s = /^\d+$/.test(which) ? sessions([])[Number(which)] : ss.find((x) => x.file.includes(which));
  if (!s) throw new Error(`no recording matches ${which}`);
  const rec = s.rec;
  const trace = flag('trace');
  let objective = -1;
  const world = replay(rec, (w) => {
    if (!trace) return;
    const t = `${lpad(w.time.toFixed(1), 6)}s`;
    if (w.objectiveIdx !== objective) {
      objective = w.objectiveIdx;
      console.log(`${t}  objective ${objective + 1}/${rec.mission.objectives.length}`);
    }
    for (const ev of w.events) {
      if (ev.t !== 'death' || ev.kind !== 'agent') continue;
      const by = w.get(ev.by);
      console.log(`${t}  ${w.get(ev.id)?.name} died${by ? ` (${by.name || by.kind} with ${by.weapons[by.weaponIdx] ?? '?'})` : ''}`);
    }
  });
  const same = world.checksum() === rec.result.checksum;
  console.log(`${s.file}: replayed ${secs(world.tick)}, ${world.phase}${world.resultReason ? ` (${world.resultReason})` : ''}`);
  console.log(same ? 'replay matches the recording' : `replay differs from the recording (#${world.checksum()} vs #${rec.result.checksum}): the sim has changed since it was recorded; the samples and events in the file still hold`);
}

// ------------------------------------------------------------------ bot

function recordBot(mission: string, bot: BotName): void {
  const file = missionFile(mission);
  const wins = opt('wins') ? Number(opt('wins')) : winsFor(file);
  const cfg = configure([], wins);
  const seed = Number(opt('seed') ?? 1000);
  const world = new World({ weapons: cfg.weapons, agents: [], mission: loadMission(file) }, cfg.squad, seed);
  const rec = new Recorder(world, mission, seed, bot);
  const squad = new MissionBot(world, bot);
  while (world.tick < 600 * TICK_HZ && world.phase !== 'success' && world.phase !== 'fail') {
    const cmds = squad.commands();
    world.step(cmds);
    rec.onStep(cmds);
  }
  const out = rec.finish(false);
  mkdirSync(dir, { recursive: true });
  const name = `${out.recordedAt.replace(/[:.]/g, '-')}_${mission}_bot-${bot}.json`;
  writeFileSync(dir + name, JSON.stringify(out));
  console.log(`${name}: ${outcome(out)}, ${secs(out.result.ticks)}, lost ${lost(out)}`);
}

// ------------------------------------------------------------------ main

const ss = sessions(cmd === 'replay' || cmd === 'bot' ? [] : words);
if (cmd === 'list') list(ss);
else if (cmd === 'summary') summary(ss);
else if (cmd === 'deaths') deaths(ss);
else if (cmd === 'ipa') ipa(ss);
else if (cmd === 'replay') replayOne(ss, words[0] ?? String(ss.length - 1));
else if (cmd === 'bot') {
  const bot = (words[1] ?? 'expert') as BotName;
  if (!BOTS.includes(bot)) throw new Error(`unknown bot ${bot}; have ${BOTS.join(', ')}`);
  recordBot(words[0], bot);
}
