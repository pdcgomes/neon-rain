/**
 * Builds a small authored mission from ASCII art, so balance scenarios read like level sketches.
 * Each character is a 2x2 m square:
 *
 *   #  building (blocks movement, sight and bullets)    =  low wall, same but no building on top
 *   .  open ground                                      S  squad spawn
 *   0-9  named waypoints for plans                      r  rival (patrols)   g  guard (holds)
 *   h  heavy with a Gauss gun (holds)
 *
 * Spawns get ids like "g0", "g1" in reading order, so scenarios can tweak individual units.
 */
import type { MapLayout, MissionDef, SpawnDef, SpawnKind } from '../../src/sim/content.ts';
import { encodeGrid } from '../../src/sim/grid64.ts';
import { GROUND_BUILDING, GROUND_PLAZA } from '../../src/sim/map.ts';
import type { Vec2 } from '../../src/sim/types.ts';

export const CELL = 2;

const KINDS: Record<string, SpawnKind> = { r: 'rival', g: 'guard', h: 'heavy' };

export interface Arena {
  mission: MissionDef;
  points: Record<string, Vec2>;
  spawns: SpawnDef[];
}

/** Splits the '#' cells into rectangles, greedily, so they render as buildings. */
function rectangles(rows: string[], ch: string): { x: number; y: number; w: number; h: number }[] {
  const H = rows.length;
  const W = Math.max(...rows.map((r) => r.length));
  const at = (x: number, y: number) => (rows[y]?.[x] ?? ' ') === ch;
  const used = new Set<number>();
  const out: { x: number; y: number; w: number; h: number }[] = [];
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (!at(x, y) || used.has(y * W + x)) continue;
      let w = 1;
      while (at(x + w, y) && !used.has(y * W + x + w)) w++;
      let h = 1;
      const rowFree = (yy: number) => {
        for (let k = 0; k < w; k++) if (!at(x + k, yy) || used.has(yy * W + x + k)) return false;
        return true;
      };
      while (y + h < H && rowFree(y + h)) h++;
      for (let yy = y; yy < y + h; yy++) for (let k = 0; k < w; k++) used.add(yy * W + x + k);
      out.push({ x, y, w, h });
    }
  }
  return out;
}

export function arena(id: string, rows: string[], tweak?: (spawns: SpawnDef[], points: Record<string, Vec2>) => void): Arena {
  const bad = rows.findIndex((r) => r.length !== rows[0].length);
  if (bad >= 0) throw new Error(`${id}: row ${bad} is ${rows[bad].length} wide, expected ${rows[0].length}`);
  const H = rows.length * CELL;
  const W = rows[0].length * CELL;
  const ground = new Uint8Array(W * H).fill(GROUND_PLAZA);
  const blocked = new Uint8Array(W * H);
  const points: Record<string, Vec2> = {};
  const spawns: SpawnDef[] = [];
  const counts: Record<string, number> = {};
  let spawn: Vec2 | null = null;

  rows.forEach((row, cy) => {
    [...row].forEach((ch, cx) => {
      const c = { x: cx * CELL + CELL / 2, y: cy * CELL + CELL / 2 };
      if (ch === '=') {
        for (let y = 0; y < CELL; y++) for (let x = 0; x < CELL; x++) blocked[(cy * CELL + y) * W + cx * CELL + x] = 1;
      } else if (ch === 'S') spawn = c;
      else if (/[0-9]/.test(ch)) points[ch] = c;
      else if (KINDS[ch]) {
        const n = counts[ch] ?? 0;
        counts[ch] = n + 1;
        const kind = KINDS[ch];
        spawns.push({ id: `${ch}${n}`, kind, x: c.x, y: c.y, holds: kind !== 'rival' });
      }
    });
  });
  if (!spawn) throw new Error(`${id}: no squad spawn (S)`);

  const buildings = rectangles(rows, '#').map((r) => ({ x: r.x * CELL, y: r.y * CELL, w: r.w * CELL, h: r.h * CELL, height: 8 }));
  for (const b of buildings) for (let y = b.y; y < b.y + b.h; y++) ground.fill(GROUND_BUILDING, y * W + b.x, y * W + b.x + b.w);

  tweak?.(spawns, points);

  const layout: MapLayout = {
    w: W,
    h: H,
    ground: encodeGrid(ground),
    blocked: encodeGrid(blocked),
    buildings,
    props: [],
    spawn: spawn!,
    extraction: spawn!,
  };
  const mission: MissionDef = {
    id,
    codename: id,
    city: 'Balance arena',
    seed: 1,
    map: { kind: 'authored', layout },
    briefing: [],
    targetName: '',
    targetCorp: '',
    objectives: [{ id: 'sweep', type: 'sweep', text: 'Eliminate all hostiles.', factions: ['enemy'] }],
    population: { civilians: 0, police: 0, rivals: 0, guards: 0, heavies: 0, traffic: 0 },
    spawns,
    policeHostileAt: 1e9,
    enforcersAt: 1e9,
  };
  return { mission, points, spawns };
}
