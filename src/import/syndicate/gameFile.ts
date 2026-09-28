/**
 * GAMExx.DAT (after RNC, 116010 bytes): one mission's level data.
 *
 * Positions are u16: horizontal units are 256 per tile, vertical units 128 per level. References
 * between records (objective -> person, weapon -> owner) are u16 values equal to the record's file
 * offset minus 0x8006. Scenario (waypoint) references are byte offsets into the scenario table.
 */

const REF_BASE = 0x8006;
const PEOPLE = { at: 0x8008, size: 92, count: 256 };
const CARS = { at: 0xdc08, size: 42, count: 64 };
const STATICS = { at: 0xe688, size: 30, count: 400 };
const WEAPONS = { at: 0x11568, size: 36, count: 512 };
const SCENARIOS = { at: 0x17b68, size: 8, count: 2048 };
const MAPINFO = 0x1bd28;
const OBJECTIVES = { at: 0x1bd36, size: 14, count: 6 };
export const GAME_FILE_SIZE = 116010;

export type PedClass = 'civilian' | 'agent' | 'police' | 'guard' | 'criminal' | 'unknown';

const PED_CLASS: Record<number, PedClass> = { 1: 'civilian', 2: 'agent', 4: 'police', 8: 'guard', 16: 'criminal' };

/** Weapon sub-types as stored in the weapon records. */
export const SYND_WEAPONS: Record<number, string> = {
  1: 'persuadertron',
  2: 'pistol',
  3: 'gauss',
  4: 'shotgun',
  5: 'uzi',
  6: 'minigun',
  7: 'laser',
  8: 'flamer',
  9: 'longRange',
  10: 'scanner',
  11: 'medikit',
  12: 'timeBomb',
  13: 'accessCard',
  14: 'energyShield',
};

export type ObjectiveKind =
  | 'none'
  | 'persuade'
  | 'assassinate'
  | 'protect'
  | 'acquire'
  | 'sweepPolice'
  | 'sweepAll'
  | 'destroyVehicle'
  | 'useVehicle'
  | 'evacuate'
  | 'unknown';

const OBJECTIVE_KIND: Record<number, ObjectiveKind> = {
  0: 'none',
  1: 'persuade',
  2: 'assassinate',
  3: 'protect',
  5: 'acquire',
  10: 'sweepPolice',
  11: 'sweepAll',
  14: 'destroyVehicle',
  15: 'useVehicle',
  16: 'evacuate',
};

/** Position in tile units (x, y) and levels (z). */
export interface SyndPos {
  x: number;
  y: number;
  z: number;
}

export interface SyndPerson extends SyndPos {
  index: number;
  ref: number;
  cls: PedClass;
  /** 4 = on the map; 0xd = hidden (e.g. inside a vehicle); others are rare. */
  state: number;
  onMap: boolean;
  health: number;
  facing: number;
  weapons: string[];
  /** Waypoint chain this person follows, in tile units. */
  route: SyndWaypoint[];
  loops: boolean;
}

export interface SyndCar extends SyndPos {
  index: number;
  ref: number;
  model: number;
  facing: number;
}

export interface SyndStatic extends SyndPos {
  index: number;
  kind: number;
  facing: number;
}

export interface SyndWeapon extends SyndPos {
  index: number;
  ref: number;
  kind: string;
  kindId: number;
  ownerRef: number;
}

export interface SyndWaypoint extends SyndPos {
  type: number;
}

export interface SyndObjective {
  kind: ObjectiveKind;
  kindId: number;
  /** Referenced record (person, car or weapon), when the objective targets one. */
  ref: number;
  target?: { type: 'person' | 'car' | 'weapon'; index: number };
  at?: SyndPos;
}

export interface SyndGame {
  mapId: number;
  /** Map info bounds as stored (units unknown; kept for reference). */
  mapInfo: number[];
  people: SyndPerson[];
  cars: SyndCar[];
  statics: SyndStatic[];
  weapons: SyndWeapon[];
  objectives: SyndObjective[];
}

function empty(data: Uint8Array, at: number, size: number): boolean {
  for (let i = 0; i < size; i++) if (data[at + i] !== 0) return false;
  return true;
}

export function parseGame(data: Uint8Array): SyndGame {
  if (data.length < GAME_FILE_SIZE) throw new Error(`Not a Syndicate mission file (${data.length} bytes)`);
  const u8 = (o: number) => data[o];
  const u16 = (o: number) => data[o] | (data[o + 1] << 8);
  const pos = (o: number): SyndPos => ({ x: u16(o) / 256, y: u16(o + 2) / 256, z: u16(o + 4) / 128 });
  const facing = (b: number) => (b / 256) * Math.PI * 2;

  const scenarioChain = (ref: number): { route: SyndWaypoint[]; loops: boolean } => {
    const route: SyndWaypoint[] = [];
    const seen = new Set<number>();
    let loops = false;
    let i = ref / 8;
    while (i > 0 && i < SCENARIOS.count && !seen.has(i) && route.length < 64) {
      seen.add(i);
      const o = SCENARIOS.at + i * SCENARIOS.size;
      const type = u8(o + 7);
      if (type === 9) {
        loops = true;
        break;
      }
      if (u8(o + 4) || u8(o + 5)) route.push({ x: u8(o + 4) / 2, y: u8(o + 5) / 2, z: u8(o + 6), type });
      const next = u16(o);
      if (!next) break;
      i = next / 8;
    }
    return { route, loops };
  };

  const weapons: SyndWeapon[] = [];
  for (let i = 0; i < WEAPONS.count; i++) {
    const o = WEAPONS.at + i * WEAPONS.size;
    if (empty(data, o, WEAPONS.size)) continue;
    const kindId = u8(o + 25);
    weapons.push({ index: i, ref: o - REF_BASE, ...pos(o + 4), kindId, kind: SYND_WEAPONS[kindId] ?? `weapon${kindId}`, ownerRef: u16(o + 32) });
  }

  const people: SyndPerson[] = [];
  for (let i = 0; i < PEOPLE.count; i++) {
    const o = PEOPLE.at + i * PEOPLE.size;
    if (empty(data, o, PEOPLE.size)) continue;
    const ref = o - REF_BASE;
    const state = u8(o + 10);
    const { route, loops } = scenarioChain(u16(o + 40));
    people.push({
      index: i,
      ref,
      ...pos(o + 4),
      cls: PED_CLASS[u8(o + 28)] ?? 'unknown',
      state,
      onMap: state === 4,
      health: u16(o + 20),
      facing: facing(u8(o + 26)),
      weapons: weapons.filter((w) => w.ownerRef === ref).map((w) => w.kind),
      route,
      loops,
    });
  }

  const cars: SyndCar[] = [];
  for (let i = 0; i < CARS.count; i++) {
    const o = CARS.at + i * CARS.size;
    if (empty(data, o, CARS.size)) continue;
    cars.push({ index: i, ref: o - REF_BASE, ...pos(o + 4), model: u8(o + 25), facing: facing(u8(o + 26)) });
  }

  const statics: SyndStatic[] = [];
  for (let i = 0; i < STATICS.count; i++) {
    const o = STATICS.at + i * STATICS.size;
    if (empty(data, o, STATICS.size)) continue;
    statics.push({ index: i, ...pos(o + 4), kind: u8(o + 25), facing: facing(u8(o + 26)) });
  }

  const resolve = (ref: number): SyndObjective['target'] => {
    const at = ref + REF_BASE;
    for (const [type, t] of [['person', PEOPLE], ['car', CARS], ['weapon', WEAPONS]] as const) {
      const rel = at - t.at;
      if (rel >= 0 && rel < t.size * t.count && rel % t.size === 0) return { type, index: rel / t.size };
    }
    return undefined;
  };

  const objectives: SyndObjective[] = [];
  for (let i = 0; i < OBJECTIVES.count; i++) {
    const o = OBJECTIVES.at + i * OBJECTIVES.size;
    const kindId = u16(o);
    if (!kindId) continue;
    const ref = u16(o + 2);
    const p = pos(o + 4);
    objectives.push({
      kind: OBJECTIVE_KIND[kindId] ?? 'unknown',
      kindId,
      ref,
      target: ref ? resolve(ref) : undefined,
      at: p.x || p.y ? p : undefined,
    });
  }

  const mapInfo = [0, 2, 4, 6, 8].map((k) => u16(MAPINFO + k));
  return { mapId: mapInfo[0], mapInfo, people, cars, statics, weapons, objectives };
}
