/**
 * Gameplay telemetry. The sim is deterministic and only changes through commands, so a recording
 * of the content, seed and balance knobs plus every tick's commands is a complete replay:
 * `scripts/telemetry.ts` re-runs it headlessly to measure anything later. The recording also keeps
 * a per-second sample of the squad and a digest of key events, so most questions can be answered
 * without replaying, and still can be after the sim has changed.
 */
import { balance, type Balance } from './balance.ts';
import type { Command } from './commands.ts';
import type { AgentDef, Content, MissionDef, WeaponDef } from './content.ts';
import type { Ipa, MissionStats } from './types.ts';
import { World } from './world.ts';

export const TELEMETRY_VERSION = 1;
const SAMPLE_EVERY = 30;

export interface AgentSample {
  id: number;
  hp: number;
  x: number;
  y: number;
  weapon: string;
  holstered: boolean;
  /** 1 fired on the player's order, 2 fired on its own, 0 not firing. */
  fire: 0 | 1 | 2;
  ipa: Ipa;
  dep: Ipa;
  overdrive: boolean;
}

export interface Sample {
  tick: number;
  agents: AgentSample[];
  alarm: boolean;
  policeHostile: boolean;
  heat: number;
  hostiles: number;
  objective: number;
}

export interface Death {
  tick: number;
  id: number;
  kind: string;
  name: string;
  x: number;
  y: number;
  /** Who killed them, as they were at the moment of death. */
  by?: { id: number; kind: string; name: string; faction: string; weapon: string; x: number; y: number };
}

export interface Recording {
  version: number;
  recordedAt: string;
  missionId: string;
  mission: MissionDef;
  weapons: Record<string, WeaponDef>;
  squad: AgentDef[];
  seed: number;
  balance: Balance;
  /** Ticks that had commands, with the commands applied at that tick. */
  commands: [number, Command[]][];
  samples: Sample[];
  deaths: Death[];
  /** Tick of each objective completed, the alarm, the police turning hostile. */
  marks: { tick: number; what: string }[];
  /** Damage each agent took, by the attacker's kind and weapon. */
  damage: Record<number, Record<string, number>>;
  /** Rounds each agent fired, by weapon, and on whose order. */
  shots: Record<number, Record<string, { ordered: number; own: number }>>;
  result: { phase: string; reason: string; ticks: number; checksum: number; abandoned: boolean; stats: MissionStats };
  /** Who played: "player", or a scripted squad's name when recorded by the tooling. */
  player: string;
}

export class Recorder {
  private readonly rec: Recording;
  private readonly world: World;
  private objective: number;
  private alarm = false;
  private policeHostile = false;

  constructor(world: World, missionId: string, seed: number, player = 'player') {
    this.world = world;
    const c = world.content;
    this.rec = {
      version: TELEMETRY_VERSION,
      recordedAt: new Date().toISOString(),
      missionId,
      mission: c.mission,
      weapons: c.weapons,
      squad: world.agents().map((a) => ({ name: a.name, hp: a.maxHp, speed: a.speed, loadout: [...a.weapons], grenades: a.grenades, chest: a.chest })),
      seed,
      balance: { ...balance },
      commands: [],
      samples: [],
      deaths: [],
      marks: [],
      damage: {},
      shots: {},
      result: { phase: '', reason: '', ticks: 0, checksum: 0, abandoned: false, stats: { ...world.stats } },
      player,
    };
    this.objective = world.objectiveIdx;
    const damage = world.damage.bind(world);
    world.damage = (target, amount, sourceId) => {
      this.onDamage(target.id, amount, sourceId);
      damage(target, amount, sourceId);
    };
    this.sample();
  }

  /** Call right after `world.step(cmds)`, with the commands that step applied. */
  onStep(cmds: readonly Command[]): void {
    const w = this.world;
    if (cmds.length) this.rec.commands.push([w.tick - 1, structuredClone([...cmds])]);
    for (const ev of w.events) {
      if (ev.t === 'death') {
        const e = w.get(ev.id);
        const by = w.get(ev.by);
        this.rec.deaths.push({
          tick: w.tick,
          id: ev.id,
          kind: ev.kind,
          name: e?.name ?? '',
          x: round(ev.x),
          y: round(ev.y),
          by: by ? { id: by.id, kind: by.kind, name: by.name, faction: by.faction, weapon: by.weapons[by.weaponIdx] ?? '', x: round(by.x), y: round(by.y) } : undefined,
        });
      } else if (ev.t === 'shot') {
        const a = w.get(ev.owner);
        if (a?.kind !== 'agent') continue;
        const per = (this.rec.shots[a.id] ??= {});
        const s = (per[ev.weapon] ??= { ordered: 0, own: 0 });
        if (a.firing) s.ordered++;
        else s.own++;
      }
    }
    if (w.objectiveIdx !== this.objective) {
      this.objective = w.objectiveIdx;
      this.rec.marks.push({ tick: w.tick, what: `objective ${this.objective}` });
    }
    if (w.alarm && !this.alarm) {
      this.alarm = true;
      this.rec.marks.push({ tick: w.tick, what: 'alarm' });
    }
    if (w.policeHostile !== this.policeHostile) {
      this.policeHostile = w.policeHostile;
      this.rec.marks.push({ tick: w.tick, what: w.policeHostile ? 'police hostile' : 'police calm' });
    }
    if (w.tick % SAMPLE_EVERY === 0) this.sample();
  }

  private onDamage(targetId: number, amount: number, sourceId: number): void {
    const t = this.world.get(targetId);
    if (t?.kind !== 'agent') return;
    const s = this.world.get(sourceId);
    const key = s ? `${s.name || s.kind}:${s.weapons[s.weaponIdx] ?? '?'}` : 'unknown';
    const per = (this.rec.damage[targetId] ??= {});
    per[key] = round((per[key] ?? 0) + amount * (1 - t.armor));
  }

  finish(abandoned: boolean): Recording {
    const w = this.world;
    this.sample();
    this.rec.result = { phase: w.phase, reason: w.resultReason, ticks: w.tick, checksum: w.checksum(), abandoned, stats: { ...w.stats } };
    return this.rec;
  }

  private sample(): void {
    const w = this.world;
    this.rec.samples.push({
      tick: w.tick,
      agents: w.agents().map((a) => ({
        id: a.id,
        hp: round(Math.max(0, a.hp)),
        x: round(a.x),
        y: round(a.y),
        weapon: a.weapons[a.weaponIdx] ?? '',
        holstered: a.holstered,
        fire: a.firing ? 1 : a.autoFire ? 2 : 0,
        ipa: { ...a.ipa },
        dep: { ...a.ipaDep },
        overdrive: a.overdrive,
      })),
      alarm: w.alarm,
      policeHostile: w.policeHostile,
      heat: round(w.heat),
      hostiles: w.entities.filter((e) => e.alive && (e.faction === 'enemy' || (e.faction === 'police' && w.policeHostile)) && e.weapons.length).length,
      objective: w.objectiveIdx,
    });
  }
}

const round = (v: number) => Math.round(v * 10) / 10;

/**
 * Replays a recording headlessly with the content and balance it was made with. `onStep` sees the
 * world after every tick. Returns the world at the recorded end; compare `checksum()` with
 * `rec.result.checksum` to know whether the replay is faithful (it won't be if the sim changed).
 */
export function replay(rec: Recording, onStep?: (world: World) => void, overrides: Partial<Balance> = {}): World {
  const saved = { ...balance };
  Object.assign(balance, rec.balance, overrides);
  try {
    const p = new Playback(rec);
    while (!p.done) {
      p.step();
      onStep?.(p.world);
    }
    return p.world;
  } finally {
    Object.assign(balance, saved);
  }
}

/**
 * A recording being played one tick at a time, from tick 0. The caller sets `balance` to the
 * recording's knobs for as long as it steps (see `withBalance`). To go back, start a new one.
 */
export class Playback {
  readonly rec: Recording;
  readonly world: World;
  private next = 0;

  constructor(rec: Recording) {
    this.rec = rec;
    const content: Content = { weapons: rec.weapons, agents: [], mission: rec.mission };
    this.world = new World(content, rec.squad, rec.seed);
  }

  /** The game keeps stepping for a few seconds after a mission ends, so this runs to the recorded tick. */
  get done(): boolean {
    return this.world.tick >= this.rec.result.ticks;
  }

  step(): void {
    const c = this.rec.commands;
    let cmds: Command[] = [];
    if (this.next < c.length && c[this.next][0] === this.world.tick) cmds = c[this.next++][1];
    this.world.step(cmds);
  }

  /** At the end: does the replay reproduce the recording exactly? */
  get faithful(): boolean {
    return this.done && this.world.checksum() === this.rec.result.checksum;
  }
}

/** Sets the balance knobs to a recording's for as long as `fn` runs (sync), then restores them. */
export function withBalance<T>(rec: Recording, fn: () => T): T {
  const saved = { ...balance };
  Object.assign(balance, rec.balance);
  try {
    return fn();
  } finally {
    Object.assign(balance, saved);
  }
}
