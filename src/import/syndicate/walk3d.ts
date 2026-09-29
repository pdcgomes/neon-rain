/**
 * Where someone can walk in the original, in 3D, after FreeSynd's Mission::setSurfaces. A node is a
 * floor tile (x, y, z) of a surface type (ground, road, roof, crossing) or a slope, with open air in
 * the tile above it (empty, or the marker tile left above train stops). Neighbours join on the same
 * level, or one level apart across a slope along its axis. Large doors are open: FreeSynd clears the
 * tiles they fill.
 *
 * Nodes are indexed like SyndMap.tiles: (y * w + x) * levels + z.
 */
import type { SyndGame, SyndPos } from './gameFile.ts';
import type { SyndMap } from './mapFile.ts';

const SURFACE = new Set([0x05, 0x06, 0x07, 0x08, 0x09, 0x0b, 0x0d, 0x0e, 0x0f]);
const ROAD = new Set([0x06, 0x07, 0x08, 0x09, 0x0b, 0x0e, 0x0f]);
/** Slopes 1 and 2 climb along y, 3 and 4 along x. */
const SLOPE_Y = new Set([0x01, 0x02]);
const SLOPE_X = new Set([0x03, 0x04]);
const STOP_MARKER = 0x10;
const LARGE_DOOR = 0x26;
/** Car models that are train carriages (head, body): they run on rails, not roads. */
const TRAIN_MODELS = new Set([0x05, 0x09]);

export interface Walk3D {
  w: number;
  h: number;
  levels: number;
  /** COL01 type per node, with large doors cleared. */
  types: Uint8Array;
  /** Nodes cleared because a large door fills them. */
  opened: Set<number>;
  /** Whether the mission has a car the squad could drive (through gates only cars pass). */
  cars: boolean;
  walkable(i: number): boolean;
  /** Road tiles, whatever is above them: FreeSynd's cars only look at the road. */
  drivable(i: number): boolean;
}

export function buildWalk3D(map: SyndMap, col: Uint8Array, game: SyndGame): Walk3D {
  const { w, h, levels: L } = map;
  const types = new Uint8Array(map.tiles.length);
  for (let i = 0; i < types.length; i++) types[i] = col[map.tiles[i]];
  const opened = new Set<number>();
  for (const s of game.statics) {
    if (s.kind !== LARGE_DOOR) continue;
    const x = Math.floor(s.x);
    const y = Math.floor(s.y);
    const z = Math.floor(s.z);
    // Orientation bytes 0x00 and 0x80 run the door along x; the rest along y. Doors are 1.5 levels tall.
    const b = Math.round((s.facing / (Math.PI * 2)) * 256) & 0xff;
    const alongX = (b & 0x7f) === 0;
    for (const k of [-1, 0, 1])
      for (const dz of [0, 1]) {
        const xx = alongX ? x + k : x;
        const yy = alongX ? y : y + k;
        if (xx < 0 || yy < 0 || xx >= w || yy >= h || z + dz >= L) continue;
        const i = (yy * w + xx) * L + z + dz;
        types[i] = 0;
        opened.add(i);
      }
  }
  const walkable = (i: number) => {
    const z = i % L;
    if (z + 1 >= L) return false;
    const t = types[i];
    const up = types[i + 1];
    return (SURFACE.has(t) || SLOPE_X.has(t) || SLOPE_Y.has(t)) && (up === 0 || up === STOP_MARKER);
  };
  const drivable = (i: number) => ROAD.has(types[i]);
  const cars = game.cars.some((c) => !TRAIN_MODELS.has(c.model));
  return { w, h, levels: L, types, opened, cars, walkable, drivable };
}

/** Calls `fn(j, zStep)` for each node one step from `i`. With `drive`, road tiles also join along the road. */
export function forEachStep(g: Walk3D, i: number, drive: boolean, fn: (j: number) => void): void {
  const L = g.levels;
  const z = i % L;
  const c = (i - z) / L;
  const x = c % g.w;
  const y = (c - x) / g.w;
  const here = g.walkable(i);
  const t = g.types[i];
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    const nx = x + dx;
    const ny = y + dy;
    if (nx < 0 || ny < 0 || nx >= g.w || ny >= g.h) continue;
    const base = (ny * g.w + nx) * L;
    if (here) {
      for (const dz of [0, 1, -1]) {
        const nz = z + dz;
        if (nz < 0 || nz >= L) continue;
        const j = base + nz;
        if (!g.walkable(j)) continue;
        if (dz) {
          const slope = (s: number) => (dx ? SLOPE_X.has(s) : SLOPE_Y.has(s));
          if (!slope(t) && !slope(g.types[j])) continue;
        }
        fn(j);
      }
    }
    if (drive && g.drivable(i) && g.drivable(base + z) && (!here || !g.walkable(base + z))) fn(base + z);
  }
}

/** The floor nodes in p's column that someone could stand on, nearest p's height first. */
export function floorsAt(g: Walk3D, p: SyndPos, drive = false): number[] {
  const x = Math.floor(p.x);
  const y = Math.floor(p.y);
  if (x < 0 || y < 0 || x >= g.w || y >= g.h) return [];
  const out: number[] = [];
  const base = (y * g.w + x) * g.levels;
  for (let z = 0; z < g.levels; z++) if (g.walkable(base + z) || (drive && g.drivable(base + z))) out.push(base + z);
  // People stand in the tile above their floor.
  const stand = Math.floor(p.z) - 1;
  return out.sort((a, b) => Math.abs((a - base) - stand) - Math.abs((b - base) - stand));
}

export const UNREACHED = -2;

/**
 * Cheapest routes out from `sources` (0-1 BFS): entering node j costs `cost(j)`, 0 or 1. Only nodes
 * whose column passes `allow` are visited. Returns each node's predecessor (-1 for sources,
 * UNREACHED otherwise).
 */
export function cheapestRoutes(g: Walk3D, sources: number[], cost: (j: number) => number, allow: (x: number, y: number) => boolean, drive: boolean): Int32Array {
  const n = g.types.length;
  const from = new Int32Array(n).fill(UNREACHED);
  const dist = new Int32Array(n).fill(0x7fffffff);
  const L = g.levels;
  let frontier: number[] = [];
  for (const s of sources) {
    if (dist[s] === 0) continue;
    dist[s] = 0;
    from[s] = -1;
    frontier.push(s);
  }
  for (let d = 0; frontier.length; d++) {
    const next: number[] = [];
    for (let q = 0; q < frontier.length; q++) {
      const i = frontier[q];
      if (dist[i] !== d) continue;
      forEachStep(g, i, drive, (j) => {
        const c = (j - (j % L)) / L;
        if (!allow(c % g.w, (c / g.w) | 0)) return;
        const k = cost(j);
        if (d + k >= dist[j]) return;
        dist[j] = d + k;
        from[j] = i;
        (k ? next : frontier).push(j);
      });
    }
    frontier = next;
  }
  return from;
}
