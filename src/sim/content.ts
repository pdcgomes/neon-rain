import type { MapParams } from './map.ts';

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
  color: string;
}

export interface AgentDef {
  name: string;
  hp: number;
  speed: number;
  loadout: string[];
  grenades: number;
}

export interface MissionDef {
  id: string;
  codename: string;
  city: string;
  seed: number;
  map: MapParams;
  briefing: string[];
  targetName: string;
  targetCorp: string;
  objectives: { id: string; text: string }[];
  bonus: { id: string; text: string };
  population: {
    civilians: number;
    police: number;
    rivals: number;
    guards: number;
    heavies: number;
    traffic?: number;
  };
  policeHostileAt: number;
  enforcersAt: number;
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
  color: '#ffd27a',
};

export function resolveWeapons(raw: Record<string, Partial<WeaponDef>>): Record<string, WeaponDef> {
  const out: Record<string, WeaponDef> = {};
  for (const [id, w] of Object.entries(raw)) out[id] = { ...WEAPON_DEFAULTS, ...w };
  return out;
}
