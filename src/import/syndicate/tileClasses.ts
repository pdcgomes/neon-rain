/**
 * How the converter reads Syndicate tiles. COL01.DAT gives each of the 256 tile ids a type; each type
 * maps to one of our tile classes. Individual tile ids can be overridden (the Import tool edits these).
 */
export type TileClass = 'empty' | 'ground' | 'road' | 'crossing' | 'slope' | 'solid' | 'fence' | 'water';

export const TILE_CLASSES: TileClass[] = ['empty', 'ground', 'road', 'crossing', 'slope', 'solid', 'fence', 'water'];

export const TILE_CLASS_COLORS: Record<TileClass, string> = {
  empty: '#000000',
  ground: '#7a7a86',
  road: '#2b3ad0',
  crossing: '#e0e0f0',
  slope: '#ffae1a',
  solid: '#3faa4a',
  fence: '#c83a3a',
  water: '#1a8fa8',
};

/** Default class for each COL01 tile type. */
export const DEFAULT_TYPE_CLASSES: Record<number, TileClass> = {
  0x00: 'empty',
  0x01: 'slope',
  0x02: 'slope',
  0x03: 'slope',
  0x04: 'slope',
  0x05: 'ground',
  0x06: 'road',
  0x07: 'road',
  0x08: 'road',
  0x09: 'road',
  0x0a: 'fence',
  0x0b: 'road',
  0x0c: 'fence',
  0x0d: 'solid',
  0x0e: 'crossing',
  0x0f: 'road',
  0x10: 'solid',
};

export const TYPE_NAMES: Record<number, string> = {
  0x00: 'Empty',
  0x01: 'Slope (S-N)',
  0x02: 'Slope (N-S)',
  0x03: 'Slope (E-W)',
  0x04: 'Slope (W-E)',
  0x05: 'Ground',
  0x06: 'Road lane (E-W)',
  0x07: 'Road lane (W-E)',
  0x08: 'Road lane (S-N)',
  0x09: 'Road lane (N-S)',
  0x0a: 'Wall',
  0x0b: 'Road junction',
  0x0c: 'Fence',
  0x0d: 'Solid block',
  0x0e: 'Pedestrian crossing',
  0x0f: 'Road marking',
  0x10: 'Special',
};

export interface TileTable {
  /** Class per COL01 type. */
  types: Record<number, TileClass>;
  /** Per tile id overrides. */
  ids: Record<number, TileClass>;
}

export function defaultTileTable(): TileTable {
  return { types: { ...DEFAULT_TYPE_CLASSES }, ids: {} };
}

/** Resolves every tile id (0..255) to a class, given COL01 types and a table. */
export function resolveTileClasses(col: Uint8Array, table: TileTable): TileClass[] {
  const out: TileClass[] = [];
  for (let id = 0; id < 256; id++) out.push(table.ids[id] ?? table.types[col[id] ?? 0] ?? 'solid');
  return out;
}
