import type { MapParams, PropKind } from './map.ts';
import type { Vec2 } from './types.ts';

export type WeaponType = 'bullet' | 'rocket' | 'grenade' | 'persuade';

export interface WeaponDef {
  name: string;
  short: string;
  type: WeaponType;
  damage: number;
  interval: number;
  spread: number;
  range: number;
  speed: number;
  splash: number;
  spinup: number;
  moveMul: number;
  noise: number;
  ammo: number;
  fuse: number;
  /** Projectiles per trigger pull (shotgun), each with its own spread. */
  pellets: number;
  /** Carries on through everyone in its path (laser). */
  pierce: boolean;
  /** Preference when rival agents are armed from the player's arsenal: higher is better. */
  rank: number;
  color: string;
}

export interface AgentDef {
  name: string;
  hp: number;
  speed: number;
  loadout: string[];
  grenades: number;
  /** Chest mod version, 0 (none) to 3: armour, and self-repair from V2. */
  chest?: number;
}

/** When and in what weather a mission takes place. */
export interface AtmosphereDef {
  /** Local time, 0..24 (default 22). */
  hour?: number;
  /** Rain intensity range the weather drifts within, 0 dry .. 1 heavy. */
  rain?: { min?: number; max?: number };
}

export const MISSION_VERSION = 2;

/** A fixed, hand-authored (or imported) city instead of the procedural generator. */
export interface MapLayout {
  w: number;
  h: number;
  /** Ground type per cell (GROUND_* in map.ts), row-major, base64. */
  ground: string;
  /** Extra obstacles not covered by buildings or props (walls, fences, water): 1 per blocked cell, base64. */
  blocked: string;
  buildings: { x: number; y: number; w: number; h: number; height: number; style?: number; seed?: number }[];
  props: { kind: PropKind; x: number; y: number; w?: number; h?: number; rot?: number; seed?: number }[];
  spawn: Vec2;
  extraction: Vec2;
  /** Where a fleeing target heads (default: the exit furthest from the squad). */
  escape?: Vec2;
  /** Map-edge points where civilians leave and reinforcements arrive (default: walkable edge cells). */
  exits?: Vec2[];
  plaza?: { x: number; y: number; w: number; h: number };
  /** Where the layout came from, for the editor's reference overlay. */
  source?: { kind: 'syndicate'; mission: number; map: number; scale: number; origin: Vec2; classes?: string };
}

export type MapDef = ({ kind?: 'procedural' } & MapParams) | { kind: 'authored'; layout: MapLayout };

export type SpawnKind = 'civilian' | 'police' | 'enforcer' | 'rival' | 'heavy' | 'guard' | 'target';

export interface SpawnDef {
  /** Stable id objectives can refer to. */
  id: string;
  kind: SpawnKind;
  x: number;
  y: number;
  name?: string;
  facing?: number;
  weapons?: string[];
  hp?: number;
  armor?: number;
  /** Walk this route (rivals, guards and heavies); loops. */
  patrol?: Vec2[];
  /** Hold position here instead of patrolling. */
  holds?: boolean;
}

export type ObjectiveType = 'eliminate' | 'persuade' | 'protect' | 'extract' | 'reach' | 'sweep';

export interface ObjectiveDef {
  id: string;
  text: string;
  type?: ObjectiveType;
  /** Spawn ids this objective is about (eliminate, persuade, protect, extract escorts). Empty = the mission target. */
  targets?: string[];
  /** Point to reach (extract, reach); defaults to the extraction marker. */
  at?: Vec2;
  radius?: number;
  /** sweep: which sides must be wiped out. */
  factions?: ('enemy' | 'police')[];
  /** Announced when the objective completes. */
  doneText?: string;
  /** HQ chatter when the objective completes. */
  doneBark?: string;
  /** Reinforcements that arrive when the objective completes. */
  reinforce?: { kind: 'rival'; count: number; near: 'extraction' | 'spawn' };
  /** eliminate: the mission fails if a target reaches the escape point. */
  escapeFails?: string;
  /** Shown as success reason when this is the last objective. */
  successText?: string;
  /** Converter notes for things the game can't do yet. */
  todo?: string;
}

export interface MissionDef {
  version?: number;
  id: string;
  codename: string;
  city: string;
  seed: number;
  map: MapDef;
  briefing: string[];
  targetName: string;
  targetCorp: string;
  objectives: ObjectiveDef[];
  bonus?: { id: string; text: string };
  population: {
    civilians: number;
    police: number;
    rivals: number;
    guards: number;
    heavies: number;
    traffic?: number;
  };
  /** Explicit placements; when present, the procedural target/guard/rival/police placement is skipped. */
  spawns?: SpawnDef[];
  policeHostileAt: number;
  enforcersAt: number;
  /** Multiplier on how long enemies take to open fire (American Revolt: 0.5, "at least twice as fast"). */
  enemyReaction?: number;
  atmosphere?: AtmosphereDef;
  /** Mission-specific chatter (defaults are Neon Rain's lines). */
  barks?: { targetFlees?: string; targetShielded?: string };
}

/**
 * Brings older mission files up to the current format. Version 1 (Neon Rain as first written) had
 * untyped "kill" and "extract" objectives whose behaviour was hard-coded in the objective system.
 */
export function upgradeMission(m: MissionDef): MissionDef {
  const out: MissionDef = { ...m, version: MISSION_VERSION };
  out.objectives = m.objectives.map((o) => {
    if (o.type) return o;
    if (o.id === 'kill')
      return {
        ...o,
        type: 'eliminate',
        doneText: 'Target eliminated. Proceed to the extraction VTOL.',
        doneBark: 'Good work. A rival intercept team is moving on the VTOL. Expect resistance.',
        reinforce: { kind: 'rival', count: 3, near: 'extraction' },
        escapeFails: `${m.targetName.split(' ').pop()} reached his limousine and escaped the sector.`,
      };
    if (o.id === 'extract') return { ...o, type: 'extract', successText: 'Target terminated. Squad extracted.' };
    return { ...o, type: 'reach' };
  });
  return out;
}

/** What the squad has earned by winning missions: weapons, and chest mods. */
export interface ProgressionDef {
  /** Weapons and the wins needed to unlock them (the original's research tree, paced over the campaign). */
  unlocks: { weapon: string; after: number }[];
  /** Wins needed for chest mod V1, V2, V3. */
  chestAfter: number[];
}

/**
 * The kit for a squad with `wins` missions behind it: the three best guns unlocked so far (by
 * rank, a Gauss gun taking the third slot once there is one), plus the Persuadertron.
 */
export function kitFor(start: string[], p: ProgressionDef, weapons: Record<string, WeaponDef>, wins: number): { loadout: string[]; chest: number } {
  const earned = p.unlocks.filter((u) => wins >= u.after).map((u) => u.weapon);
  const owned = [...new Set([...start, ...earned])].filter((id) => weapons[id]);
  const guns = owned.filter((id) => weapons[id].type !== 'persuade' && id !== 'gauss').sort((a, b) => weapons[b].rank - weapons[a].rank);
  const gauss = owned.includes('gauss');
  const loadout = guns.slice(0, gauss ? 2 : 3).sort((a, b) => weapons[a].rank - weapons[b].rank);
  if (gauss) loadout.push('gauss');
  if (owned.includes('persuadertron')) loadout.push('persuadertron');
  const chest = p.chestAfter.filter((n) => wins >= n).length;
  return { loadout, chest };
}

export interface Content {
  weapons: Record<string, WeaponDef>;
  agents: AgentDef[];
  mission: MissionDef;
}

const WEAPON_DEFAULTS: WeaponDef = {
  name: '',
  short: '',
  type: 'bullet',
  damage: 0,
  interval: 0.3,
  spread: 0.05,
  range: 12,
  speed: 60,
  splash: 0,
  spinup: 0,
  moveMul: 1,
  noise: 10,
  ammo: -1,
  fuse: 0,
  pellets: 1,
  pierce: false,
  rank: -1,
  color: '#ffd27a',
};

/** Weapon table entries; `like` copies another entry's stats (the same gun under another name). */
export type RawWeapons = Record<string, Partial<WeaponDef> & { like?: string }>;

export function resolveWeapons(raw: RawWeapons): Record<string, WeaponDef> {
  const out: Record<string, WeaponDef> = {};
  const own = (id: string) => {
    const { like: _, ...w } = raw[id];
    return w;
  };
  for (const [id, { like }] of Object.entries(raw)) {
    if (like && !raw[like]) throw new Error(`weapon ${id} is like unknown weapon ${like}`);
    out[id] = { ...WEAPON_DEFAULTS, ...(like ? own(like) : {}), ...own(id) };
  }
  return out;
}
