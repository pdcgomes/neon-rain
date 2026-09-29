/**
 * Draws a mission as ASCII, for reading real maps and writing plans against them. One character
 * covers `scale` x `scale` metres:
 *
 *   #  blocked   .  walkable   S  squad drop   X  extraction   T  objective target   O  objective point
 *   r  rival agent   g  guard   h  heavy   p  police   e  enforcer   c  civilians (3+)
 *
 * Rulers along the top and left are in metres, so a plan's waypoints can be read straight off.
 */
import type { World } from '../../src/sim/world.ts';
import { objectiveTargets } from '../../src/sim/systems/objectives.ts';

export interface Region {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

const MARK: Record<string, string> = { rival: 'r', guard: 'g', heavy: 'h', police: 'p', enforcer: 'e', target: 'T' };

export function asciiMap(world: World, scale = 3, region?: Region): string[] {
  const { w: W, h: H } = world.map;
  const r = region ?? { x0: 0, y0: 0, x1: W, y1: H };
  const cols = Math.ceil((r.x1 - r.x0) / scale);
  const rows = Math.ceil((r.y1 - r.y0) / scale);
  const grid: string[][] = [];
  for (let cy = 0; cy < rows; cy++) {
    const row: string[] = [];
    for (let cx = 0; cx < cols; cx++) {
      let open = 0;
      for (let y = 0; y < scale; y++) {
        for (let x = 0; x < scale; x++) if (!world.nav.isBlocked(r.x0 + cx * scale + x, r.y0 + cy * scale + y)) open++;
      }
      row.push(open * 2 >= scale * scale ? '.' : '#');
    }
    grid.push(row);
  }
  const put = (p: { x: number; y: number }, ch: string, over = true) => {
    const cx = Math.floor((p.x - r.x0) / scale);
    const cy = Math.floor((p.y - r.y0) / scale);
    if (cx < 0 || cy < 0 || cx >= cols || cy >= rows) return;
    if (over || grid[cy][cx] === '.' || grid[cy][cx] === '#') grid[cy][cx] = ch;
  };

  const crowd = new Map<string, number>();
  for (const e of world.entities) {
    if (!e.alive || e.kind !== 'civilian') continue;
    const k = `${Math.floor((e.x - r.x0) / scale)},${Math.floor((e.y - r.y0) / scale)}`;
    crowd.set(k, (crowd.get(k) ?? 0) + 1);
  }
  for (const [k, n] of crowd) {
    if (n < 3) continue;
    const [cx, cy] = k.split(',').map(Number);
    if (grid[cy]?.[cx] === '.') grid[cy][cx] = 'c';
  }
  for (const e of world.entities) {
    if (!e.alive) continue;
    const kind = e.kind === 'rival' && e.name === 'Heavy' ? 'heavy' : e.kind;
    if (MARK[kind]) put(e, MARK[kind]);
  }
  for (const o of world.content.mission.objectives) {
    if (o.at) put(o.at, 'O');
    for (const t of objectiveTargets(world, o)) if (t) put(t, 'T');
  }
  put(world.map.extraction, 'X');
  for (const a of world.agents()) put(a, 'S');

  const ruler = (n: number) => String(n).padStart(3);
  const top = Array.from({ length: cols }, (_, cx) => (cx % 5 === 0 ? String(r.x0 + cx * scale).padEnd(5 * 1) : '')).join('');
  const out = [`      ${top.slice(0, cols)}`];
  grid.forEach((row, cy) => out.push(`${cy % 2 === 0 ? ruler(r.y0 + cy * scale) : '   '}   ${row.join('')}`));
  return out;
}
