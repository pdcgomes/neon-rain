/** Plays one mission with one scripted squad and reports how it went. */
import { readFileSync } from 'node:fs';
import { upgradeMission, type Content, type MissionDef } from '../../src/sim/content.ts';
import { TICK_HZ, World } from '../../src/sim/world.ts';
import type { Config } from './config.ts';
import { MissionBot, type BotName } from './missionBot.ts';

export interface MissionRun {
  file: string;
  bot: BotName;
  seed: number;
  result: 'win' | 'loss' | 'timeout';
  reason: string;
  time: number;
  /** Objectives completed, as a fraction of the mission's objectives. */
  progress: number;
  /** Damage taken as a fraction of the squad's total HP (repairs don't give it back). */
  dmg: number;
  lost: number;
  kills: number;
  enemies: number;
  civilians: number;
}

const missions = new Map<string, MissionDef>();

export function loadMission(file: string): MissionDef {
  let m = missions.get(file);
  if (!m) {
    m = upgradeMission(JSON.parse(readFileSync(file, 'utf8')) as MissionDef);
    missions.set(file, m);
  }
  return m;
}

/**
 * What a squad on foot can't get to: objective targets, points and the extraction outside the
 * area connected to the drop zone. Converted missions lose the doors, vehicles and trains the
 * original used to link areas, so some can't be finished at all yet.
 */
export function unreachable(file: string, cfg: Config): string[] {
  const mission = loadMission(file);
  const world = new World({ weapons: cfg.weapons, agents: [], mission }, cfg.squad, 1);
  const { w: W, h: H } = world.map;
  const lead = world.livingAgents()[0];
  if (!lead) return ['no squad'];
  const seen = new Uint8Array(W * H);
  const cell = (p: { x: number; y: number }) => Math.floor(p.y) * W + Math.floor(p.x);
  const stack = [cell(lead)];
  seen[stack[0]] = 1;
  while (stack.length) {
    const c = stack.pop()!;
    const x = c % W;
    const y = (c / W) | 0;
    for (const [nx, ny] of [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]]) {
      const n = ny * W + nx;
      if (nx < 0 || ny < 0 || nx >= W || ny >= H || seen[n] || world.nav.isBlocked(nx, ny)) continue;
      seen[n] = 1;
      stack.push(n);
    }
  }
  const out: string[] = [];
  for (const o of mission.objectives) {
    for (const id of o.targets ?? []) {
      const e = world.get(world.spawnIds.get(id) ?? -1);
      if (e && !seen[cell(e)]) out.push(`${o.type} target ${e.name || id}`);
    }
    if (o.at && !seen[cell(o.at)]) out.push(`${o.type} point`);
    if (o.type === 'sweep') {
      const sides: string[] = o.factions?.length ? o.factions : ['enemy'];
      const cut = world.entities.filter((e) => sides.includes(e.faction) && !seen[cell(e)]).length;
      if (cut) out.push(`${cut} of the people to sweep`);
    }
  }
  if (!seen[cell(world.map.extraction)]) out.push('extraction');
  return [...new Set(out)];
}

export function playMission(file: string, bot: BotName, seed: number, cfg: Config, seconds: number, log?: (msg: string) => void): MissionRun {
  const mission = loadMission(file);
  const content: Content = { weapons: cfg.weapons, agents: [], mission };
  const world = new World(content, cfg.squad, seed);
  const squad = new MissionBot(world, bot);
  const agents = world.agents();
  const totalHp = agents.reduce((s, a) => s + a.maxHp, 0);
  const hostile = (f: string) => f === 'enemy' || f === 'police';
  const enemies = world.entities.filter((e) => hostile(e.faction) && e.weapons.length).length;
  const prev = new Map(agents.map((a) => [a.id, a.hp]));
  let dmg = 0;
  let kills = 0;
  let civilians = 0;

  let objective = world.objectiveIdx;
  let contact = false;
  let alarm = false;
  const say = (msg: string) => log?.(`${world.time.toFixed(1).padStart(6)}s  ${msg}`);

  while (world.tick < seconds * TICK_HZ && world.phase !== 'success' && world.phase !== 'fail') {
    world.step(squad.commands());
    for (const a of agents) {
      const hp = Math.max(0, a.hp);
      dmg += Math.max(0, prev.get(a.id)! - hp);
      prev.set(a.id, hp);
    }
    for (const ev of world.events) {
      if (ev.t !== 'death') continue;
      const e = world.get(ev.id);
      const byPlayer = world.get(ev.by)?.faction === 'player';
      if (ev.kind === 'agent') say(`agent ${e?.name ?? ev.id} killed`);
      else if (e && hostile(e.faction) && byPlayer) kills++;
      else if (ev.kind === 'civilian' && byPlayer) civilians++;
    }
    if (!log) continue;
    if (world.objectiveIdx !== objective) {
      objective = world.objectiveIdx;
      say(`objective ${objective + 1}/${mission.objectives.length}: ${mission.objectives[objective]?.text ?? 'done'}`);
    }
    if (squad.inContact !== contact) {
      contact = squad.inContact;
      const hp = world.livingAgents().map((a) => Math.round(a.hp)).join('/');
      say(contact ? `contact (squad hp ${hp})` : `clear (squad hp ${hp}, ${kills} kills)`);
    }
    if (world.alarm && !alarm) {
      alarm = true;
      say('alarm raised');
    }
  }
  if (log) say(`${world.phase}${world.resultReason ? `: ${world.resultReason}` : ''}`);

  const done = world.phase === 'success' ? mission.objectives.length : world.objectiveIdx;
  return {
    file,
    bot,
    seed,
    result: world.phase === 'success' ? 'win' : world.phase === 'fail' ? 'loss' : 'timeout',
    reason: world.resultReason,
    time: world.time,
    progress: mission.objectives.length ? done / mission.objectives.length : 1,
    dmg: dmg / totalHp,
    lost: agents.filter((a) => !a.alive).length,
    kills,
    enemies,
    civilians,
  };
}
