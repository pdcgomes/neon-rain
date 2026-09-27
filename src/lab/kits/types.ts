import type * as THREE from 'three';

export type StyleId = 'baseline' | 'lowpoly' | 'voxel' | 'imported';

export type CharacterKind = 'agent' | 'rival' | 'heavy' | 'guard' | 'voss' | 'police' | 'enforcer' | 'civilian';

export type PropKind = 'car' | 'lamp' | 'trafficLight' | 'vending' | 'umbrella' | 'vtol';

export interface BuildingSpec {
  id: string;
  label: string;
  w: number;
  d: number;
  h: number;
  variant: number;
}

export interface Palette {
  name: string;
  /** Named swatches shown in the inspector. */
  swatches: { name: string; hex: string; emissive?: boolean }[];
}

export type AssetCategory = 'character' | 'prop' | 'building' | 'sign';

export interface LabAsset {
  object: THREE.Object3D;
  clips: THREE.AnimationClip[];
  name: string;
  category: AssetCategory;
  /** Where it came from: procedural kit, a GLB path, a .vox file... */
  source: string;
  notes?: string;
  /** Movement speed (m/s) the treadmill uses for this character's walk/run. */
  walkSpeed?: number;
  runSpeed?: number;
}

export interface StyleKit {
  id: StyleId;
  label: string;
  short: string;
  palette: Palette;
  character(kind: CharacterKind, variant: number): Promise<LabAsset>;
  prop(kind: PropKind): Promise<LabAsset>;
  building(spec: BuildingSpec): Promise<LabAsset>;
  sign(text: string, color: string, vertical: boolean): Promise<LabAsset>;
}

export const CHARACTER_LABELS: Record<CharacterKind, string> = {
  agent: 'Eurocorp Agent',
  rival: 'Rival Agent',
  heavy: 'Rival Heavy',
  guard: 'Bodyguard',
  voss: 'Director Voss',
  police: 'Police Officer',
  enforcer: 'Enforcer',
  civilian: 'Civilian',
};

export const PROP_LABELS: Record<PropKind, string> = {
  car: 'Car',
  lamp: 'Street Lamp',
  trafficLight: 'Traffic Light',
  vending: 'Vending Machine',
  umbrella: 'LED Umbrella',
  vtol: 'Extraction VTOL',
};

export const BUILDINGS: BuildingSpec[] = [
  { id: 'tower', label: 'Corporate Tower', w: 8, d: 8, h: 30, variant: 0 },
  { id: 'block', label: 'Apartment Block', w: 10, d: 7, h: 14, variant: 1 },
  { id: 'shops', label: 'Shopfront Row', w: 12, d: 6, h: 8, variant: 2 },
  { id: 'annex', label: 'Service Annex', w: 6, d: 6, h: 10, variant: 3 },
];

/** Faction colours shared by every kit, so style changes never change who is who. */
export const FACTION = {
  eurocorp: '#1ff4ff',
  rival: '#ff3355',
  guard: '#ffb627',
  police: '#4d8dff',
  persuaded: '#c77dff',
  vip: '#ffd34d',
};
