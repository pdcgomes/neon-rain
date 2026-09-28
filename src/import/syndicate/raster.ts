/**
 * Pixel renderings of Syndicate maps, as plain RGBA buffers, so the Lab (canvas) and the CLI (PNG)
 * draw exactly the same pictures.
 */
import { Cell, type ConvertResult } from './convert.ts';
import type { SyndGame, PedClass } from './gameFile.ts';
import { tileAt, type SyndMap } from './mapFile.ts';
import { resolveTileClasses, TILE_CLASS_COLORS, type TileTable } from './tileClasses.ts';

export interface Raster {
  w: number;
  h: number;
  data: Uint8ClampedArray;
  /** Pixels per tile. */
  px: number;
}

export type OriginalMode = 'class' | 'street' | 'tile';

const hex = (s: string): [number, number, number] => [parseInt(s.slice(1, 3), 16), parseInt(s.slice(3, 5), 16), parseInt(s.slice(5, 7), 16)];

export const CELL_COLORS: Record<Cell, string> = {
  [Cell.Walk]: '#6e6e7c',
  [Cell.Road]: '#262b52',
  [Cell.Crossing]: '#c9c9dc',
  [Cell.Building]: '#3faa4a',
  [Cell.Wall]: '#c83a3a',
  [Cell.Hole]: '#0a0a0e',
  [Cell.Overpass]: '#8a7cc4',
};

export const PED_COLORS: Record<PedClass | 'target', string> = {
  agent: '#1ff4ff',
  civilian: '#ffe14a',
  police: '#4f86ff',
  guard: '#ff3b5c',
  criminal: '#ff4fe0',
  unknown: '#ffffff',
  target: '#ffffff',
};

function raster(w: number, h: number, px: number): Raster {
  return { w: w * px, h: h * px, px, data: new Uint8ClampedArray(w * px * h * px * 4) };
}

function fillTile(r: Raster, tx: number, ty: number, c: [number, number, number], k = 1, grid = true): void {
  for (let j = 0; j < r.px; j++) {
    for (let i = 0; i < r.px; i++) {
      const edge = grid && r.px >= 4 && (i === r.px - 1 || j === r.px - 1) ? 0.82 : 1;
      const o = ((ty * r.px + j) * r.w + tx * r.px + i) * 4;
      r.data[o] = c[0] * k * edge;
      r.data[o + 1] = c[1] * k * edge;
      r.data[o + 2] = c[2] * k * edge;
      r.data[o + 3] = 255;
    }
  }
}

/** Top-down view of the original map. 'class' colours the highest tile by class (brighter = taller), 'street' shows only the street level, 'tile' shows raw tile ids. */
export function renderOriginal(map: SyndMap, col: Uint8Array, table: TileTable, mode: OriginalMode, street: number, px = 6): Raster {
  const cls = resolveTileClasses(col, table);
  const r = raster(map.w, map.h, px);
  for (let y = 0; y < map.h; y++) {
    for (let x = 0; x < map.w; x++) {
      let z = street;
      if (mode !== 'street') {
        z = -1;
        for (let k = map.levels - 1; k >= 0; k--) if (cls[tileAt(map, x, y, k)] !== 'empty') {
          z = k;
          break;
        }
      }
      const id = z >= 0 ? tileAt(map, x, y, z) : 0;
      if (mode === 'tile') {
        const hue = (id * 137) % 360;
        const c = hslToRgb(hue / 360, 0.55, id ? 0.25 + 0.35 * Math.min(1, z / 8) : 0.02);
        fillTile(r, x, y, c);
        continue;
      }
      const k = mode === 'street' ? 1 : 0.45 + 0.55 * Math.min(1, Math.max(0, z) / 7);
      fillTile(r, x, y, hex(TILE_CLASS_COLORS[cls[id]]), k);
    }
  }
  return r;
}

/** The converter's per-tile result (cropped area). */
export function renderConverted(res: ConvertResult, px = 6): Raster {
  const { crop, cells } = res;
  const r = raster(crop.w, crop.h, px);
  for (let y = 0; y < crop.h; y++) for (let x = 0; x < crop.w; x++) fillTile(r, x, y, hex(CELL_COLORS[cells[y * crop.w + x] as Cell]));
  return r;
}

function dot(r: Raster, x: number, y: number, rad: number, c: [number, number, number], ring = false): void {
  const cx = x * r.px;
  const cy = y * r.px;
  for (let j = -rad - 1; j <= rad + 1; j++)
    for (let i = -rad - 1; i <= rad + 1; i++) {
      const d = Math.hypot(i, j);
      if (ring ? Math.abs(d - rad) > 0.8 : d > rad) continue;
      const px = Math.round(cx + i);
      const py = Math.round(cy + j);
      if (px < 0 || py < 0 || px >= r.w || py >= r.h) continue;
      const o = (py * r.w + px) * 4;
      r.data[o] = c[0];
      r.data[o + 1] = c[1];
      r.data[o + 2] = c[2];
      r.data[o + 3] = 255;
    }
}

function line(r: Raster, a: { x: number; y: number }, b: { x: number; y: number }, c: [number, number, number]): void {
  const n = Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) * r.px);
  for (let s = 0; s <= n; s++) dot(r, a.x + ((b.x - a.x) * s) / Math.max(1, n), a.y + ((b.y - a.y) * s) / Math.max(1, n), 0, c);
}

/** People (coloured by class), their patrol routes, cars and objective targets, in tile units offset by `origin`. */
export function overlayGame(r: Raster, game: SyndGame, origin = { x: 0, y: 0 }): void {
  const targets = new Set(game.objectives.filter((o) => o.target?.type === 'person').map((o) => o.target!.index));
  const at = (p: { x: number; y: number }) => ({ x: p.x - origin.x, y: p.y - origin.y });
  for (const p of game.people) {
    if (!p.onMap) continue;
    const c = hex(PED_COLORS[p.cls]);
    let last = at(p);
    for (const w of p.route) {
      const n = at(w);
      line(r, last, n, [c[0] * 0.6, c[1] * 0.6, c[2] * 0.6]);
      last = n;
    }
  }
  for (const car of game.cars) dot(r, car.x - origin.x, car.y - origin.y, Math.max(2, r.px * 0.7), [230, 230, 230], true);
  for (const p of game.people) {
    if (!p.onMap) continue;
    const q = at(p);
    dot(r, q.x, q.y, Math.max(1.5, r.px * 0.35), hex(PED_COLORS[p.cls]));
    if (targets.has(p.index)) dot(r, q.x, q.y, Math.max(4, r.px * 1.1), [255, 255, 255], true);
  }
  for (const o of game.objectives) if (o.at) dot(r, o.at.x - origin.x, o.at.y - origin.y, Math.max(4, r.px), [80, 255, 170], true);
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const f = (n: number) => {
    const k = (n + h * 12) % 12;
    const a = s * Math.min(l, 1 - l);
    return 255 * (l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)));
  };
  return [f(0), f(8), f(4)];
}
