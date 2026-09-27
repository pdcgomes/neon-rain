import { DEFAULT_PROPORTIONS, type Proportions } from '../rig.ts';
import { FACTION, type CharacterKind } from './types.ts';

/**
 * Style-independent character designs. Every kit renders the same designs, so a style
 * comparison never mixes up who is who: silhouettes, faction colours and gear stay fixed.
 */
export type Outfit = 'longcoat' | 'jacket' | 'suit' | 'armor' | 'uniform' | 'dress' | 'hoodie';
export type Hair = 'slick' | 'buzz' | 'bob' | 'mohawk' | 'bald' | 'bun' | 'long';
export type HeadGear = 'none' | 'cap' | 'helmet' | 'hood';
export type Visor = 'band' | 'shades' | 'none' | 'full';
export type Weapon = 'uzi' | 'smg' | 'pistol' | 'gauss' | 'carbine' | null;

export interface Design {
  kind: CharacterKind;
  variant: number;
  name: string;
  prop: Proportions;
  outfit: Outfit;
  coat: string;
  trim: string;
  pants: string;
  skin: string;
  hair: string;
  boots: string;
  /** Emissive accent: visors, LED trim, shoulder lights. */
  accent: string;
  hairStyle: Hair;
  head: HeadGear;
  visor: Visor;
  pads: boolean;
  weapon: Weapon;
  shoulderLight: boolean;
  umbrella: string | null;
  ledTrim: boolean;
  walkSpeed: number;
  runSpeed: number;
}

const SKIN = ['#e7c7ab', '#c99a78', '#8f5f44', '#5d3d2c', '#f3d9c6', '#b07a58'];

const P = (o: Partial<Proportions>): Proportions => ({ ...DEFAULT_PROPORTIONS, ...o });

export function design(kind: CharacterKind, variant = 0): Design {
  const v = variant;
  const common = {
    kind,
    variant: v,
    skin: SKIN[v % SKIN.length],
    boots: '#15161b',
    pads: false,
    weapon: null as Weapon,
    shoulderLight: false,
    umbrella: null as string | null,
    ledTrim: false,
    walkSpeed: 1.5,
    runSpeed: 4.5,
  };
  switch (kind) {
    case 'agent': {
      const hair: Hair[] = ['slick', 'buzz', 'bob', 'mohawk'];
      return {
        ...common,
        name: ['Kade', 'Ivo', 'Rhee', 'Mara'][v % 4],
        prop: P({ height: v === 2 || v === 3 ? 1.76 : 1.84, shoulders: 0.47 }),
        outfit: 'longcoat',
        coat: '#1b1d26',
        trim: '#3d4356',
        pants: '#1b1c22',
        hair: ['#101014', '#2b2320', '#0b0b0e', '#e5e7ec'][v % 4],
        accent: FACTION.eurocorp,
        hairStyle: hair[v % 4],
        head: 'none',
        visor: 'band',
        weapon: 'uzi',
        ledTrim: true,
        walkSpeed: 1.7,
        runSpeed: 5.3,
      };
    }
    case 'rival':
      return {
        ...common,
        name: 'Rival Agent',
        prop: P({ height: 1.83, shoulders: 0.48 }),
        outfit: 'longcoat',
        coat: '#474b56',
        trim: '#2a2d35',
        pants: '#23252c',
        hair: '#111',
        accent: FACTION.rival,
        hairStyle: 'buzz',
        head: v % 2 ? 'hood' : 'none',
        visor: 'band',
        pads: true,
        weapon: 'smg',
        walkSpeed: 1.6,
        runSpeed: 5.0,
      };
    case 'heavy':
      return {
        ...common,
        name: 'Rival Heavy',
        prop: P({ height: 1.95, shoulders: 0.62, hips: 0.32, bulk: 1.35 }),
        outfit: 'armor',
        coat: '#3a3d45',
        trim: '#5b1320',
        pants: '#24262d',
        hair: '#111',
        accent: FACTION.rival,
        hairStyle: 'bald',
        head: 'helmet',
        visor: 'full',
        pads: true,
        weapon: 'gauss',
        walkSpeed: 1.4,
        runSpeed: 4.2,
      };
    case 'guard':
      return {
        ...common,
        name: 'Bodyguard',
        prop: P({ height: 1.9, shoulders: 0.52, bulk: 1.15 }),
        outfit: 'suit',
        coat: '#1a1e2b',
        trim: '#ffb627',
        pants: '#161a24',
        hair: '#0d0d10',
        accent: FACTION.guard,
        hairStyle: 'buzz',
        head: 'none',
        visor: 'shades',
        weapon: 'smg',
        walkSpeed: 1.6,
        runSpeed: 5.0,
      };
    case 'voss':
      return {
        ...common,
        name: 'Director Hale Voss',
        skin: '#e9c9b0',
        prop: P({ height: 1.78, shoulders: 0.48, hips: 0.32, bulk: 1.28 }),
        outfit: 'suit',
        coat: '#ece6d6',
        trim: '#c9a227',
        pants: '#d8d1bf',
        hair: '#9aa0a8',
        accent: FACTION.vip,
        hairStyle: 'slick',
        head: 'none',
        visor: 'none',
        umbrella: '#ffd34d',
        walkSpeed: 1.2,
        runSpeed: 3.1,
      };
    case 'police':
      return {
        ...common,
        name: 'Police Officer',
        prop: P({ height: 1.82, shoulders: 0.47 }),
        outfit: 'uniform',
        coat: '#1d3b82',
        trim: '#c8d2e8',
        pants: '#15264f',
        hair: '#1a1410',
        accent: FACTION.police,
        hairStyle: 'buzz',
        head: 'cap',
        visor: 'none',
        weapon: 'pistol',
        shoulderLight: true,
        walkSpeed: 1.3,
        runSpeed: 4.4,
      };
    case 'enforcer':
      return {
        ...common,
        name: 'Enforcer',
        prop: P({ height: 1.92, shoulders: 0.58, hips: 0.3, bulk: 1.3 }),
        outfit: 'armor',
        coat: '#2a303b',
        trim: '#4d8dff',
        pants: '#1d222b',
        hair: '#111',
        accent: FACTION.police,
        hairStyle: 'bald',
        head: 'helmet',
        visor: 'full',
        pads: true,
        weapon: 'carbine',
        shoulderLight: true,
        walkSpeed: 1.5,
        runSpeed: 4.8,
      };
    default: {
      const looks: Pick<Design, 'outfit' | 'coat' | 'trim' | 'pants' | 'hair' | 'hairStyle' | 'head' | 'umbrella' | 'ledTrim' | 'accent'>[] = [
        { outfit: 'jacket', coat: '#5b1e3a', trim: '#2d2d2d', pants: '#22232b', hair: '#1b1411', hairStyle: 'bob', head: 'none', umbrella: null, ledTrim: false, accent: '#ff2bd6' },
        { outfit: 'hoodie', coat: '#1c4a4a', trim: '#0f2a2a', pants: '#2a2c34', hair: '#0e0e10', hairStyle: 'buzz', head: 'hood', umbrella: '#1ff4ff', ledTrim: true, accent: '#1ff4ff' },
        { outfit: 'dress', coat: '#383a52', trim: '#a66bff', pants: '#1e1f29', hair: '#6b3a1f', hairStyle: 'long', head: 'none', umbrella: null, ledTrim: true, accent: '#a66bff' },
        { outfit: 'jacket', coat: '#6b5a3a', trim: '#3a3226', pants: '#2b2f3a', hair: '#c9c2b8', hairStyle: 'bald', head: 'cap', umbrella: '#ffb627', ledTrim: false, accent: '#ffb627' },
        { outfit: 'longcoat', coat: '#8a8f99', trim: '#5e636d', pants: '#23252d', hair: '#20150f', hairStyle: 'bun', head: 'none', umbrella: null, ledTrim: false, accent: '#7dff5c' },
        { outfit: 'hoodie', coat: '#2b2f3a', trim: '#ff2bd6', pants: '#16171c', hair: '#ff2bd6', hairStyle: 'mohawk', head: 'none', umbrella: '#ff2bd6', ledTrim: true, accent: '#ff2bd6' },
      ];
      const look = looks[v % looks.length];
      return {
        ...common,
        ...look,
        name: ['Commuter', 'Courier', 'Club-goer', 'Vendor', 'Office Worker', 'Punk'][v % 6],
        prop: P({ height: 1.6 + ((v * 3) % 5) * 0.04, shoulders: 0.4 + (v % 3) * 0.03, bulk: 0.92 + (v % 4) * 0.06 }),
        visor: 'none',
        walkSpeed: 1.5,
        runSpeed: 4.5,
      };
    }
  }
}

export interface CastEntry {
  kind: CharacterKind;
  variant: number;
}

export const CAST_GROUPS: { id: string; title: string; members: CastEntry[] }[] = [
  { id: 'agents', title: 'Agents', members: [0, 1, 2, 3].map((variant) => ({ kind: 'agent' as const, variant })) },
  {
    id: 'rivals',
    title: 'Rivals & Guards',
    members: [
      { kind: 'rival', variant: 0 },
      { kind: 'rival', variant: 1 },
      { kind: 'heavy', variant: 0 },
      { kind: 'guard', variant: 0 },
      { kind: 'voss', variant: 0 },
    ],
  },
  {
    id: 'law',
    title: 'Law Enforcement',
    members: [
      { kind: 'police', variant: 0 },
      { kind: 'police', variant: 1 },
      { kind: 'enforcer', variant: 0 },
    ],
  },
  { id: 'civilians', title: 'Civilians', members: [0, 1, 2, 3, 4, 5].map((variant) => ({ kind: 'civilian' as const, variant })) },
];

export const LINEUP: CastEntry[] = [
  { kind: 'agent', variant: 0 },
  { kind: 'agent', variant: 2 },
  { kind: 'rival', variant: 0 },
  { kind: 'heavy', variant: 0 },
  { kind: 'guard', variant: 0 },
  { kind: 'voss', variant: 0 },
  { kind: 'police', variant: 0 },
  { kind: 'enforcer', variant: 0 },
  { kind: 'civilian', variant: 0 },
  { kind: 'civilian', variant: 1 },
  { kind: 'civilian', variant: 2 },
  { kind: 'civilian', variant: 5 },
];
