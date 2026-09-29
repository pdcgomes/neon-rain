/**
 * Telemetry analysis shared by `scripts/telemetry.ts` and the Lab's Telemetry tool: summaries from
 * a recording's digest, and a headless pass over the replay for everything the digest doesn't
 * keep (the full event log, where agents were hit, enemy movements, per-second series).
 */
import { Playback, withBalance, type Death, type Recording } from './telemetry.ts';
import { TICK_HZ } from './world.ts';

export const outcomeOf = (r: Recording) => (r.result.abandoned ? 'abandoned' : r.result.phase === 'success' ? 'win' : r.result.phase === 'fail' ? 'loss' : 'timeout');
export const agentsLost = (r: Recording) => r.deaths.filter((d) => d.kind === 'agent').length;
export const killerOf = (d: Death) => (d.by ? `${d.by.name || d.by.kind}:${d.by.weapon || '?'}` : 'unknown');

export function tally<T>(items: T[], key: (t: T) => string, weight: (t: T) => number = () => 1): [string, number][] {
  const m = new Map<string, number>();
  for (const it of items) m.set(key(it), (m.get(key(it)) ?? 0) + weight(it));
  return [...m].sort((a, b) => b[1] - a[1]);
}

export interface IpaUse {
  bars: { ch: 'a' | 'p' | 'i'; dose: number; boost: number; dull: number }[];
  dependency: number;
  overdrive: number;
}

/** Mean dose per bar, and the share of samples it sat above (boost) or below (dull) dependency. */
export function ipaUse(recs: Recording[]): IpaUse {
  const acc = { a: [0, 0, 0], p: [0, 0, 0], i: [0, 0, 0] };
  let dep = 0;
  let over = 0;
  let n = 0;
  for (const r of recs) {
    for (const s of r.samples) {
      for (const a of s.agents) {
        if (a.hp <= 0) continue;
        n++;
        for (const ch of ['a', 'p', 'i'] as const) {
          acc[ch][0] += a.ipa[ch];
          if (a.ipa[ch] > a.dep[ch] + 0.05) acc[ch][1]++;
          if (a.ipa[ch] < a.dep[ch] - 0.05) acc[ch][2]++;
        }
        dep += (a.dep.a + a.dep.p + a.dep.i) / 3;
        if (a.overdrive) over++;
      }
    }
  }
  const k = n || 1;
  return {
    bars: (['a', 'p', 'i'] as const).map((ch) => ({ ch, dose: acc[ch][0] / k, boost: acc[ch][1] / k, dull: acc[ch][2] / k })),
    dependency: dep / k,
    overdrive: over / k,
  };
}

export interface Summary {
  sessions: number;
  played: number;
  wins: number;
  lostPerSession: number;
  seconds: number;
  alarmAt: number | null;
  killers: [string, number][];
  damage: [string, number][];
  shots: [string, number][];
  hitRate: number;
  /** Share of the squad's rounds fired on the agents' own judgement rather than the player's order. */
  ownFire: number;
  ipa: IpaUse;
}

export function summarise(recs: Recording[]): Summary {
  const played = recs.filter((r) => !r.result.abandoned);
  const deaths = recs.flatMap((r) => r.deaths.filter((d) => d.kind === 'agent'));
  const shotsBy = recs.flatMap((r) => Object.values(r.shots).flatMap((m) => Object.entries(m)));
  const own = shotsBy.reduce((s, [, v]) => s + v.own, 0);
  const all = shotsBy.reduce((s, [, v]) => s + v.own + v.ordered, 0);
  const alarms = played.map((r) => r.marks.find((m) => m.what === 'alarm')?.tick).filter((t): t is number => t !== undefined);
  return {
    sessions: recs.length,
    played: played.length,
    wins: played.filter((r) => r.result.phase === 'success').length,
    lostPerSession: deaths.length / Math.max(1, recs.length),
    seconds: played.reduce((s, r) => s + r.result.ticks, 0) / Math.max(1, played.length) / TICK_HZ,
    alarmAt: alarms.length ? alarms.reduce((a, b) => a + b, 0) / alarms.length / TICK_HZ : null,
    killers: tally(deaths, killerOf),
    damage: tally(recs.flatMap((r) => Object.values(r.damage).flatMap((m) => Object.entries(m))), ([k]) => k, ([, v]) => v),
    shots: tally(shotsBy, ([k]) => k, ([, v]) => v.ordered + v.own),
    hitRate: recs.reduce((s, r) => s + r.result.stats.shotsHit, 0) / Math.max(1, recs.reduce((s, r) => s + r.result.stats.shotsFired, 0)),
    ownFire: own / Math.max(1, all),
    ipa: ipaUse(recs),
  };
}

// ------------------------------------------------------------------ the headless pass

export type LogKind = 'death' | 'kill' | 'civilian' | 'hit' | 'objective' | 'alarm' | 'police' | 'comms' | 'persuaded' | 'end';

export interface LogEntry {
  tick: number;
  kind: LogKind;
  text: string;
  x?: number;
  y?: number;
}

export interface Hit {
  tick: number;
  agent: number;
  x: number;
  y: number;
  amount: number;
  from: string;
  fromX: number;
  fromY: number;
}

export interface Series {
  tick: number;
  squadHp: number;
  agents: number;
  hostiles: number;
  alerted: number;
  heat: number;
  playerShots: number;
  enemyShots: number;
}

export interface Timeline {
  log: LogEntry[];
  hits: Hit[];
  /** Positions each second of every enemy while it was hunting the squad. */
  enemyTrails: Map<number, { tick: number; x: number; y: number }[]>;
  series: Series[];
  faithful: boolean;
}

const round = (v: number) => Math.round(v * 10) / 10;

/**
 * Replays a recording headlessly and collects the timeline. Runs in chunks so a page stays
 * responsive; `progress` gets 0..1.
 */
export async function analyseTimeline(rec: Recording, progress?: (f: number) => void): Promise<Timeline> {
  const p = withBalance(rec, () => new Playback(rec));
  const w = p.world;
  const t: Timeline = { log: [], hits: [], enemyTrails: new Map(), series: [], faithful: false };
  const hitAt = new Map<string, Hit>();
  const damage = w.damage.bind(w);
  w.damage = (target, amount, sourceId) => {
    if (target.kind === 'agent' && target.alive) {
      const s = w.get(sourceId);
      const from = s ? `${s.name || s.kind} (${s.weapons[s.weaponIdx] ?? '?'})` : 'unknown';
      // One entry per agent, attacker and second, so a burst reads as one hit.
      const key = `${target.id}|${sourceId}|${Math.floor(w.tick / TICK_HZ)}`;
      const h = hitAt.get(key);
      const dealt = amount * (1 - target.armor);
      if (h) h.amount = round(h.amount + dealt);
      else {
        const hit = { tick: w.tick, agent: target.id, x: round(target.x), y: round(target.y), amount: round(dealt), from, fromX: round(s?.x ?? target.x), fromY: round(s?.y ?? target.y) };
        hitAt.set(key, hit);
        t.hits.push(hit);
      }
    }
    damage(target, amount, sourceId);
  };
  let objective = w.objectiveIdx;
  let alarm = false;
  let police = false;
  let shots = { player: 0, enemy: 0 };
  const push = (kind: LogKind, text: string, at?: { x: number; y: number }) => t.log.push({ tick: w.tick, kind, text, x: at && round(at.x), y: at && round(at.y) });

  while (!p.done) {
    withBalance(rec, () => {
      for (let k = 0; k < 600 && !p.done; k++) {
        p.step();
        for (const ev of w.events) {
          if (ev.t === 'shot') {
            if (ev.faction === 'player') shots.player++;
            else shots.enemy++;
          } else if (ev.t === 'death') {
            const e = w.get(ev.id);
            const by = w.get(ev.by);
            const who = by ? ` by ${by.name || by.kind} (${by.weapons[by.weaponIdx] ?? '?'})` : '';
            if (ev.kind === 'agent') push('death', `${e?.name ?? 'Agent'} killed${who}`, ev);
            else if (by?.faction === 'player') push(ev.kind === 'civilian' ? 'civilian' : 'kill', `${by.name} killed ${e?.name || ev.kind}`, ev);
          } else if (ev.t === 'bark' && ev.tone !== 'civ') push('comms', ev.text);
          else if (ev.t === 'persuaded') push('persuaded', `${w.get(ev.by)?.name} persuaded ${w.get(ev.id)?.name || 'someone'}`, w.get(ev.id));
        }
        if (w.objectiveIdx !== objective) {
          objective = w.objectiveIdx;
          const next = rec.mission.objectives[objective];
          push('objective', next ? `Objective: ${next.text}` : 'All objectives complete');
        }
        if (w.alarm && !alarm) {
          alarm = true;
          push('alarm', 'Alarm raised');
        }
        if (w.policeHostile !== police) {
          police = w.policeHostile;
          push('police', police ? 'Police hostile' : 'Police stand down');
        }
        if (w.tick % TICK_HZ === 0) {
          const hostile = w.entities.filter((e) => e.alive && e.weapons.length && (e.faction === 'enemy' || (e.faction === 'police' && w.policeHostile)));
          const agents = w.livingAgents();
          t.series.push({
            tick: w.tick,
            squadHp: round(agents.reduce((s, a) => s + Math.max(0, a.hp), 0)),
            agents: agents.length,
            hostiles: hostile.length,
            alerted: hostile.filter((e) => e.ai === 'combat').length,
            heat: round(w.heat),
            playerShots: shots.player,
            enemyShots: shots.enemy,
          });
          shots = { player: 0, enemy: 0 };
          for (const e of hostile) {
            if (e.ai !== 'combat') continue;
            const trail = t.enemyTrails.get(e.id) ?? [];
            trail.push({ tick: w.tick, x: round(e.x), y: round(e.y) });
            t.enemyTrails.set(e.id, trail);
          }
        }
      }
    });
    progress?.(w.tick / rec.result.ticks);
    await new Promise((r) => setTimeout(r, 0));
  }
  const end = w.phase === 'success' ? 'Mission complete' : w.phase === 'fail' ? `Mission failed: ${w.resultReason}` : rec.result.abandoned ? 'Abandoned' : 'Ended';
  push('end', end);
  for (const h of t.hits) {
    const a = w.get(h.agent);
    t.log.push({ tick: h.tick, kind: 'hit', text: `${a?.name ?? 'Agent'} took ${Math.round(h.amount)} from ${h.from}`, x: h.x, y: h.y });
  }
  t.log.sort((a, b) => a.tick - b.tick);
  t.faithful = p.faithful;
  return t;
}
