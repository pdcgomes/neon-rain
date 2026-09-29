/**
 * Turns an original Syndicate mission (GAME + MAP + COL + MISS files) into one of our MissionDefs with
 * an authored layout. Syndicate maps are 3D stacks of isometric tiles; the sim is a 2D grid, so each
 * tile column is read at street level and flattened:
 *
 * - the tile at street level gives the ground (road, crossing, pavement);
 * - anything solid in the next `clearance` levels above it blocks the column, and the column's top
 *   tile gives its height (buildings, walls, fences);
 * - structures that start higher than that (bridges, walkways) are dropped, leaving the street
 *   underneath walkable.
 *
 * Large doors are open, as in the original. What the mission needs (targets, people to sweep,
 * objective points) must be reachable from the drop zone, so where flattening cuts it off the
 * columns along the original's own route to it (stairs, walkways, passages; see walk3d.ts) open up,
 * and what the original only reaches by car, or not on foot at all, is handled as the notes say.
 *
 * Blocked columns are merged greedily into rectangles of similar height, which become our buildings.
 * People become explicit spawns, their scenario chains become patrol routes, and objectives map onto
 * our objective types (anything we can't do yet is kept as a TODO note on the objective).
 */
import type { MapLayout, MissionDef, ObjectiveDef, SpawnDef, SpawnKind } from '../../sim/content.ts';
import { encodeGrid } from '../../sim/grid64.ts';
import { GROUND_ALLEY, GROUND_BUILDING, GROUND_PLAZA, GROUND_ROAD, GROUND_SIDEWALK } from '../../sim/map.ts';
import type { Vec2 } from '../../sim/types.ts';
import type { SyndGame, SyndObjective, SyndPerson, SyndPos } from './gameFile.ts';
import type { SyndBriefing } from './missFile.ts';
import { tileAt, type SyndMap } from './mapFile.ts';
import { resolveTileClasses, type TileClass, type TileTable } from './tileClasses.ts';
import { buildWalk3D, cheapestRoutes, floorsAt, UNREACHED } from './walk3d.ts';

export interface ConvertOptions {
  /** Metres (sim cells) per Syndicate tile. */
  scale: number;
  /** 'mission' trims to where the mission's people are (plus a margin); 'full' keeps the whole map. */
  crop: 'mission' | 'full';
  /** Tiles kept around the mission area when cropping. */
  margin: number;
  /** Level that counts as the street; 'auto' reads it from where people stand. */
  streetLevel: number | 'auto';
  /** Levels above the street that must be free for a column to be walkable. */
  clearance: number;
  /** How many tiles in from open ground covered ground stays walkable (deeper = building interior). */
  coveredDepth: number;
  /** Metres per Syndicate level when turning stacks into building heights. */
  levelHeight: number;
  /** Columns whose heights differ by at most this many levels merge into one building. */
  mergeTolerance: number;
  /** Add a final "reach the extraction VTOL" objective (Syndicate missions end on the last objective). */
  addExtraction: boolean;
  /** Keep the mission's cars as parked props. */
  cars: boolean;
  /** Street lamps along kerbs, like the procedural city. */
  lamps: boolean;
  tiles: TileTable;
}

export const DEFAULT_CONVERT: Omit<ConvertOptions, 'tiles'> = {
  scale: 3,
  crop: 'mission',
  margin: 8,
  streetLevel: 'auto',
  clearance: 2,
  coveredDepth: 2,
  levelHeight: 2.6,
  mergeTolerance: 1,
  addExtraction: true,
  cars: true,
  lamps: true,
};

/** What each tile column became, at tile resolution (for the importer's side-by-side preview). */
export const Cell = {
  Walk: 0,
  Road: 1,
  Crossing: 2,
  Building: 3,
  Wall: 4,
  Hole: 5,
  Overpass: 6,
} as const;
export type Cell = (typeof Cell)[keyof typeof Cell];

export const CELL_NAMES: Record<Cell, string> = ['Walkable', 'Road', 'Crossing', 'Building', 'Wall / fence', 'Hole', 'Under a walkway'];

export interface ConvertInput {
  mission: number;
  game: SyndGame;
  map: SyndMap;
  col: Uint8Array;
  briefing?: SyndBriefing | null;
}

export interface ConvertResult {
  mission: MissionDef;
  /** Tile-resolution classification of the cropped area, row-major (Cell values). */
  cells: Uint8Array;
  crop: { x: number; y: number; w: number; h: number };
  streetLevel: number;
  notes: string[];
  counts: Record<string, number>;
}

/** Original weapon to Neon Rain weapon id: the same guns, since both sides share one weapon table. */
const WEAPON_MAP: Record<string, string> = {
  pistol: 'pistol',
  uzi: 'uzi',
  shotgun: 'shotgun',
  minigun: 'minigun',
  gauss: 'gauss',
  laser: 'laser',
  flamer: 'flamer',
  longRange: 'longRange',
};

/** Neon Rain health equivalent to the original's 16 (a full-health agent). */
const AGENT_HP = 100;
/** A squad that can walk over fewer columns than this in the original starts perched (on guard towers). */
const PERCHED_COLUMNS = 64;
/** How far (tiles) something cut off from the drop zone may move to reachable ground. */
const MAX_SNAP_TILES = 10;
/** How far (sim cells) something the mission needs may move off a parked car or wall edge. */
const MAX_NUDGE_CELLS = 6;

const pad2 = (n: number) => String(n).padStart(2, '0');
const titleCase = (s: string) => s.replace(/\b\w/g, (c) => c.toUpperCase());

function mode(values: number[], fallback: number): number {
  const count = new Map<number, number>();
  for (const v of values) count.set(v, (count.get(v) ?? 0) + 1);
  let best = fallback;
  let bestN = 0;
  for (const [v, n] of count) if (n > bestN) [best, bestN] = [v, n];
  return best;
}

export function convertMission(input: ConvertInput, opts: ConvertOptions): ConvertResult {
  const { game, map, col } = input;
  const notes: string[] = [];
  const cls = resolveTileClasses(col, opts.tiles);
  const walk3d = buildWalk3D(map, col, game);
  const clsAt = (x: number, y: number, z: number): TileClass => {
    const t = tileAt(map, x, y, z);
    return t && walk3d.opened.has((y * map.w + x) * map.levels + z) ? 'empty' : cls[t];
  };

  const onMap = game.people.filter((p) => p.onMap);

  // ---------------------------------------------------------------- crop
  let crop = { x: 0, y: 0, w: map.w, h: map.h };
  if (opts.crop === 'mission' && onMap.length) {
    // Routes often run off towards the map edge (people leaving), so only positions set the crop.
    const pts: SyndPos[] = [...onMap, ...game.cars];
    for (const o of game.objectives) if (o.at) pts.push(o.at);
    const x0 = Math.max(0, Math.floor(Math.min(...pts.map((p) => p.x))) - opts.margin);
    const y0 = Math.max(0, Math.floor(Math.min(...pts.map((p) => p.y))) - opts.margin);
    const x1 = Math.min(map.w, Math.ceil(Math.max(...pts.map((p) => p.x))) + opts.margin);
    const y1 = Math.min(map.h, Math.ceil(Math.max(...pts.map((p) => p.y))) + opts.margin);
    crop = { x: x0, y: y0, w: Math.max(8, x1 - x0), h: Math.max(8, y1 - y0) };
  }

  // ---------------------------------------------------------------- classify columns
  // For each column: the surface someone could stand on (a floor tile with `clearance` free levels
  // above it), whether something overhangs it, and its top. Some cities have more than one street
  // layer (an elevated deck over a lower road); the sim is flat, so each column takes the surface
  // nearest the layer most of the mission's people stand on. A fixed street level reads every column
  // at that one level instead.
  const layer = mode(onMap.map((p) => Math.max(0, Math.round(p.z) - 1)), 1);
  const N = crop.w * crop.h;
  const cells = new Uint8Array(N);
  const heights = new Uint8Array(N);
  const surf = new Int8Array(N).fill(-1);
  const covered = new Uint8Array(N);
  const tops = new Int8Array(N).fill(-1);
  const fixed = opts.streetLevel === 'auto' ? -1 : Math.max(0, opts.streetLevel);
  // Solid tops count too: some interiors (Information studies) floor their rooms with solid blocks.
  // Building roofs are solid tops as well, but the flood below never reaches them from the street.
  const walkable = (c: TileClass) => c === 'ground' || c === 'road' || c === 'crossing' || c === 'slope' || (fixed < 0 && c === 'solid');
  const headroom = (x: number, y: number, z: number) => {
    for (let k = z + 1; k <= z + opts.clearance && k < map.levels; k++) if (clsAt(x, y, k) !== 'empty') return false;
    return true;
  };
  for (let ty = 0; ty < crop.h; ty++) {
    for (let tx = 0; tx < crop.w; tx++) {
      const x = crop.x + tx;
      const y = crop.y + ty;
      const i = ty * crop.w + tx;
      for (let z = map.levels - 1; z >= 0; z--) if (clsAt(x, y, z) !== 'empty') {
        tops[i] = z;
        break;
      }
      let s = -1;
      if (fixed >= 0) s = walkable(clsAt(x, y, fixed)) && headroom(x, y, fixed) ? fixed : -1;
      else
        for (let z = 0; z < map.levels; z++)
          if (walkable(clsAt(x, y, z)) && headroom(x, y, z) && (s < 0 || Math.abs(z - layer) < Math.abs(s - layer))) s = z;
      if (s >= 0) {
        surf[i] = s;
        const c = clsAt(x, y, s);
        cells[i] = c === 'road' ? Cell.Road : c === 'crossing' ? Cell.Crossing : Cell.Walk;
        covered[i] = tops[i] > s + opts.clearance ? 1 : 0;
        continue;
      }
      // Nothing to stand on: water or a pit, a wall or fence, or solid building.
      const ref = fixed >= 0 ? fixed : 1;
      let lowest: TileClass = 'empty';
      for (let z = 0; z < map.levels && lowest === 'empty'; z++) lowest = clsAt(x, y, z);
      let fence = false;
      for (let z = ref; z <= ref + opts.clearance && z < map.levels; z++) if (clsAt(x, y, z) === 'fence') fence = true;
      const standing = fixed >= 0 ? clsAt(x, y, fixed) : lowest;
      cells[i] = tops[i] < 0 || standing === 'water' || (fixed >= 0 && standing === 'empty' && tops[i] <= fixed) ? Cell.Hole : fence ? Cell.Wall : Cell.Building;
    }
  }

  // Which surfaces are really ground. With a fixed level, every open column is. Otherwise flood out
  // from where the mission's people stand: neighbours join at the same height, or one level apart
  // where a slope makes the step. Surfaces nobody can reach (rooftops) become buildings.
  //
  // Covered ground (something overhead) is either the street under a bridge or the inside of one of
  // Syndicate's hollow buildings, so it stays walkable only within `coveredDepth` tiles of open
  // ground. Rooms holding a guard or an objective target stay walkable in full, so the people the
  // mission is about start where the original put them.
  const UNSEEN = 255;
  const depth = new Uint8Array(N).fill(UNSEEN);
  const room = new Uint8Array(N);
  const queue: number[] = [];
  const important = new Set(game.objectives.filter((o) => o.target?.type === 'person').map((o) => o.target!.index));
  const seed = (i: number, isRoom: boolean) => {
    if (surf[i] < 0 || depth[i] === 0) return;
    if (covered[i] && !isRoom) return;
    depth[i] = 0;
    room[i] = covered[i] && isRoom ? 1 : 0;
    queue.push(i);
  };
  if (fixed >= 0) {
    for (let i = 0; i < N; i++) if (surf[i] >= 0 && !covered[i]) seed(i, false);
  } else {
    for (const p of onMap) {
      const tx = Math.floor(p.x) - crop.x;
      const ty = Math.floor(p.y) - crop.y;
      if (tx < 0 || ty < 0 || tx >= crop.w || ty >= crop.h) continue;
      seed(ty * crop.w + tx, false);
    }
  }
  for (const p of onMap) {
    if (!important.has(p.index) && p.cls !== 'guard') continue;
    const tx = Math.floor(p.x) - crop.x;
    const ty = Math.floor(p.y) - crop.y;
    if (tx >= 0 && ty >= 0 && tx < crop.w && ty < crop.h) seed(ty * crop.w + tx, true);
  }
  // A one-level step joins where a slope makes it, or between a road slab and the pavement deck
  // beside it. Solid surfaces only join at the same height, so a wall top next to a road stays a wall.
  const surfClass = (i: number) => clsAt(crop.x + (i % crop.w), crop.y + ((i / crop.w) | 0), surf[i]);
  const canStep = (a: TileClass, b: TileClass) =>
    a === 'slope' || b === 'slope' || ((a === 'road' || a === 'crossing') && b === 'ground') || ((b === 'road' || b === 'crossing') && a === 'ground');
  for (let q = 0; q < queue.length; q++) {
    const i = queue[q];
    const tx = i % crop.w;
    const ty = (i / crop.w) | 0;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const x = tx + dx;
      const y = ty + dy;
      if (x < 0 || y < 0 || x >= crop.w || y >= crop.h) continue;
      const j = y * crop.w + x;
      if (surf[j] < 0) continue;
      const dz = Math.abs(surf[j] - surf[i]);
      if (dz > 1 || (dz === 1 && !canStep(surfClass(i), surfClass(j)))) continue;
      const inRoom = room[i] && covered[j];
      const d = covered[j] ? (inRoom ? 0 : depth[i] + 1) : 0;
      if (!inRoom && d > opts.coveredDepth) continue;
      if (d >= depth[j] && !(inRoom && !room[j])) continue;
      depth[j] = d;
      room[j] = inRoom ? 1 : 0;
      queue.push(j);
    }
  }
  const reachedLevels: number[] = [];
  for (let i = 0; i < N; i++) if (depth[i] !== UNSEEN && !covered[i]) reachedLevels.push(surf[i]);
  const street = fixed >= 0 ? fixed : mode(reachedLevels, layer);
  for (let i = 0; i < N; i++) {
    // Unreached open ground at street height (outside the city walls, say) stays ground; unreached
    // rooftops and building interiors become buildings.
    const offStreet = covered[i] || Math.abs(surf[i] - street) > 1;
    if (surf[i] >= 0 && depth[i] === UNSEEN && offStreet) cells[i] = Cell.Building;
    else if (surf[i] >= 0 && covered[i] && cells[i] === Cell.Walk) cells[i] = Cell.Overpass;
    if (cells[i] === Cell.Building || cells[i] === Cell.Wall) heights[i] = Math.max(1, tops[i] - street);
  }

  // ---------------------------------------------------------------- who the mission is about
  const inCrop = (p: { x: number; y: number }) => p.x >= crop.x && p.y >= crop.y && p.x < crop.x + crop.w && p.y < crop.y + crop.h;
  const targets = new Set<number>();
  const persuades = new Set<number>();
  const protects = new Set<number>();
  for (const o of game.objectives) {
    if (o.target?.type !== 'person') continue;
    if (o.kind === 'assassinate') targets.add(o.target.index);
    if (o.kind === 'persuade') persuades.add(o.target.index);
    if (o.kind === 'protect') protects.add(o.target.index);
  }
  const squad = onMap.filter((p) => p.cls === 'agent' && p.index < 4);
  const squadAt = squad.length
    ? { x: squad.reduce((s, p) => s + p.x, 0) / squad.length, y: squad.reduce((s, p) => s + p.y, 0) / squad.length }
    : { x: crop.x + crop.w / 2, y: crop.y + crop.h / 2 };
  const kindOf = (p: SyndPerson): SpawnKind | null => {
    if (targets.has(p.index)) return 'target';
    // Whoever the squad must protect walks their route as a civilian, whatever their class (often a rival agent).
    if (protects.has(p.index)) return 'civilian';
    switch (p.cls) {
      case 'civilian':
        return 'civilian';
      case 'police':
        return 'police';
      case 'guard':
        return p.weapons.includes('minigun') || p.weapons.includes('gauss') ? 'heavy' : 'guard';
      case 'criminal':
        return 'rival';
      case 'agent':
        return p.index < 8 ? null : 'rival';
      default:
        return 'civilian';
    }
  };
  /** Where a point objective (evacuate, acquire, use or destroy a vehicle) happens. */
  const pointOf = (o: SyndObjective): SyndPos | undefined => {
    if (o.kind === 'persuade' || o.kind === 'assassinate' || o.kind === 'protect' || o.kind === 'sweepAll' || o.kind === 'sweepPolice') return undefined;
    if (o.at) return o.at;
    if (o.target?.type === 'weapon') return game.weapons.find((x) => x.index === o.target!.index);
    if (o.target?.type === 'car') return game.cars.find((x) => x.index === o.target!.index);
    return undefined;
  };
  const swept = new Set(game.objectives.flatMap((o) => (o.kind === 'sweepAll' ? ['enemy', 'police'] : o.kind === 'sweepPolice' ? ['police'] : [])));
  const sideOf = (k: SpawnKind) => (k === 'police' || k === 'enforcer' ? 'police' : k === 'civilian' ? 'civ' : 'enemy');
  interface Need {
    at: SyndPos;
    what: string;
    /** People's heights are exact; points' (waypoints, objective spots) often aren't. */
    exact: boolean;
  }
  const needs: Need[] = [];
  const needy = new Set<number>();
  for (const p of onMap) {
    const k = kindOf(p);
    if (!k) continue;
    const role = targets.has(p.index) ? 'target' : persuades.has(p.index) ? 'persuasion target' : protects.has(p.index) ? 'VIP' : swept.has(sideOf(k)) ? k : '';
    if (!role) continue;
    needs.push({ at: p, what: `p${p.index} (${role})`, exact: true });
    needy.add(p.index);
    // A VIP's walk ends where the protect objective is done.
    const end = protects.has(p.index) ? [...p.route].reverse().find(inCrop) : undefined;
    if (end) needs.push({ at: end, what: `p${p.index}'s destination`, exact: false });
  }
  game.objectives.forEach((o, k) => {
    const at = pointOf(o);
    if (at) needs.push({ at, what: `objective ${k + 1} (${o.kind})`, exact: false });
  });

  // ---------------------------------------------------------------- connect them to the drop zone
  // Flattening loses the original's stairs, walkways and upper floors, so people and points the
  // mission is about can end up cut off from the drop zone. Where the original connects them on
  // foot (or by car, through gates only cars pass), the columns along its cheapest route open up.
  // Anything it doesn't connect at all (snipers on towers, a target on a roof) moves to the nearest
  // ground the squad can reach.
  const L = map.levels;
  const open = (i: number) => cells[i] === Cell.Walk || cells[i] === Cell.Road || cells[i] === Cell.Crossing || cells[i] === Cell.Overpass;
  const tileOf = (p: { x: number; y: number }) =>
    Math.min(crop.h - 1, Math.max(0, Math.floor(p.y) - crop.y)) * crop.w + Math.min(crop.w - 1, Math.max(0, Math.floor(p.x) - crop.x));
  const tileOfNode = (n: number) => {
    const c = (n - (n % L)) / L;
    return tileOf({ x: c % map.w, y: Math.floor(c / map.w) });
  };
  /** Component labels over open tiles (0 = closed). */
  const components = () => {
    const out = new Int32Array(N);
    let next = 0;
    for (let s = 0; s < N; s++) {
      if (out[s] || !open(s)) continue;
      out[s] = ++next;
      const stack = [s];
      while (stack.length) {
        const i = stack.pop()!;
        const tx = i % crop.w;
        for (const j of [tx > 0 ? i - 1 : -1, tx < crop.w - 1 ? i + 1 : -1, i - crop.w, i + crop.w]) {
          if (j < 0 || j >= N || out[j] || !open(j)) continue;
          out[j] = next;
          stack.push(j);
        }
      }
    }
    return out;
  };
  const nearestTile = (p: { x: number; y: number }, ok: (i: number) => boolean, maxR: number) => {
    const cx = p.x - crop.x;
    const cy = p.y - crop.y;
    const r = Math.ceil(maxR);
    let best = -1;
    let bestD = Infinity;
    for (let ty = Math.max(0, Math.floor(cy) - r); ty <= Math.min(crop.h - 1, Math.floor(cy) + r); ty++)
      for (let tx = Math.max(0, Math.floor(cx) - r); tx <= Math.min(crop.w - 1, Math.floor(cx) + r); tx++) {
        const d = Math.hypot(tx + 0.5 - cx, ty + 0.5 - cy);
        if (d <= maxR && d < bestD && ok(ty * crop.w + tx)) [best, bestD] = [ty * crop.w + tx, d];
      }
    return best;
  };

  let comp = components();
  let drop = nearestTile(squadAt, open, crop.w + crop.h);
  // A squad that starts perched where it can't walk anywhere (guard towers, say) drops instead at
  // the nearest ground holding most of what the mission needs.
  const perch = cheapestRoutes(walk3d, squad.flatMap((p) => floorsAt(walk3d, p).slice(0, 1)), () => 0, () => true, false);
  let squadColumns = 0;
  for (let c = 0; c < map.w * map.h && squadColumns < PERCHED_COLUMNS; c++)
    for (let z = 0; z < L; z++)
      if (perch[c * L + z] !== UNREACHED) {
        squadColumns++;
        break;
      }
  if (squad.length && squadColumns < PERCHED_COLUMNS) {
    const tally = new Map<number, number>();
    for (const n of needs) if (inCrop(n.at) && comp[tileOf(n.at)]) tally.set(comp[tileOf(n.at)], (tally.get(comp[tileOf(n.at)]) ?? 0) + 1);
    const [best, most] = [...tally].reduce((a, b) => (b[1] > a[1] ? b : a), [0, 0]);
    if (best && drop >= 0 && most > (tally.get(comp[drop]) ?? 0)) {
      drop = nearestTile(squadAt, (i) => comp[i] === best, crop.w + crop.h);
      notes.push('The squad starts perched where it cannot walk anywhere; it drops at the nearest ground instead.');
    }
  }
  const reachable = () => {
    comp = components();
    return drop >= 0 ? comp.map((c) => (c && c === comp[drop] ? 1 : 0)) : new Int32Array(N);
  };
  let reach = reachable();

  const carved = new Uint8Array(N);
  const onRoute = new Uint8Array(N);
  const carve = (drive: boolean) => {
    const cut = needs.filter((n) => inCrop(n.at) && !reach[tileOf(n.at)]);
    if (!cut.length || drop < 0) return [];
    const sources: number[] = [];
    for (let i = 0; i < N; i++) {
      if (!reach[i] || surf[i] < 0) continue;
      const node = ((crop.y + Math.floor(i / crop.w)) * map.w + crop.x + (i % crop.w)) * L + surf[i];
      if (walk3d.walkable(node)) sources.push(node);
    }
    const from = cheapestRoutes(walk3d, sources, (j) => (open(tileOfNode(j)) ? 0 : 1), (x, y) => inCrop({ x, y }), drive);
    const joined: Need[] = [];
    for (const n of cut) {
      const floors = floorsAt(walk3d, n.at, drive);
      const end = (n.exact ? floors.slice(0, 1) : floors).find((j) => from[j] !== UNREACHED);
      if (end === undefined) continue;
      for (let j = end; j >= 0; j = from[j]) {
        const t = tileOfNode(j);
        onRoute[t] = 1;
        if (open(t)) continue;
        const z = j % L;
        const c = (j - z) / L;
        const k = clsAt(c % map.w, Math.floor(c / map.w), z);
        cells[t] = k === 'road' ? Cell.Road : k === 'crossing' ? Cell.Crossing : tops[t] > z + 1 ? Cell.Overpass : Cell.Walk;
        heights[t] = 0;
        carved[t] = 1;
      }
      joined.push(n);
    }
    reach = reachable();
    return joined;
  };
  const list = (ns: Need[]) => (ns.length > 6 ? `${ns.slice(0, 5).map((n) => n.what).join(', ')} and ${ns.length - 5} more` : ns.map((n) => n.what).join(', '));
  const onFoot = carve(false);
  const byCar = walk3d.cars ? carve(true) : [];
  const opened = carved.reduce((a, b) => a + b, 0);
  if (onFoot.length) notes.push(`Opened ${opened} tiles along the original's stairs, walkways and passages to reach ${list(onFoot)}.`);
  if (byCar.length) notes.push(`Only a car gets to ${list(byCar)} in the original; the road it takes is open on foot.`);

  const moved = new Map<SyndPos, SyndPos>();
  /** Where a person or point ends up: moved onto ground the squad can reach when it's cut off. */
  const placed = (p: SyndPos): SyndPos => {
    const m = moved.get(p);
    if (m) return m;
    if (!inCrop(p) || reach[tileOf(p)]) return p;
    const t = nearestTile(p, (i) => !!reach[i], MAX_SNAP_TILES);
    if (t < 0) return p;
    const q = { x: crop.x + (t % crop.w) + 0.5, y: crop.y + Math.floor(t / crop.w) + 0.5, z: p.z };
    moved.set(p, q);
    return q;
  };
  const stuck = needs.filter((n) => inCrop(n.at) && !reach[tileOf(n.at)]);
  const snapped = stuck.filter((n) => placed(n.at) !== n.at);
  if (snapped.length) notes.push(`No way on foot to ${list(snapped)} in the original; moved to the nearest ground the squad can reach.`);
  const lost = stuck.filter((n) => placed(n.at) === n.at);
  if (lost.length) notes.push(`Still cut off from the drop zone: ${list(lost)}.`);

  // ---------------------------------------------------------------- scale up to sim cells
  const S = Math.max(1, Math.round(opts.scale));
  const W = crop.w * S;
  const H = crop.h * S;
  const ground = new Uint8Array(W * H);
  const blocked = new Uint8Array(W * H);
  const nearRoad = (tx: number, ty: number) => {
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++) {
        const c = cells[(ty + dy) * crop.w + tx + dx];
        if (tx + dx >= 0 && ty + dy >= 0 && tx + dx < crop.w && ty + dy < crop.h && (c === Cell.Road || c === Cell.Crossing)) return true;
      }
    return false;
  };
  for (let ty = 0; ty < crop.h; ty++) {
    for (let tx = 0; tx < crop.w; tx++) {
      const c = cells[ty * crop.w + tx];
      const g =
        c === Cell.Road || c === Cell.Crossing
          ? GROUND_ROAD
          : c === Cell.Walk || c === Cell.Overpass
            ? nearRoad(tx, ty)
              ? GROUND_SIDEWALK
              : GROUND_PLAZA
            : c === Cell.Hole
              ? GROUND_ALLEY
              : GROUND_BUILDING;
      const b = c === Cell.Hole ? 1 : 0;
      for (let sy = 0; sy < S; sy++) {
        const row = (ty * S + sy) * W + tx * S;
        ground.fill(g, row, row + S);
        if (b) blocked.fill(1, row, row + S);
      }
    }
  }

  // ---------------------------------------------------------------- merge blocked columns into buildings
  const buildings: MapLayout['buildings'] = [];
  const used = new Uint8Array(crop.w * crop.h);
  const solid = (i: number) => cells[i] === Cell.Building || cells[i] === Cell.Wall;
  const tol = Math.max(0, opts.mergeTolerance);
  const band = (i: number) => (cells[i] === Cell.Wall ? -1 : Math.round(heights[i] / (tol + 1)));
  for (let ty = 0; ty < crop.h; ty++) {
    for (let tx = 0; tx < crop.w; tx++) {
      const i = ty * crop.w + tx;
      if (!solid(i) || used[i]) continue;
      const b = band(i);
      let w = 1;
      while (tx + w < crop.w && solid(i + w) && !used[i + w] && band(i + w) === b) w++;
      let h = 1;
      for (;;) {
        if (ty + h >= crop.h) break;
        let ok = true;
        for (let k = 0; k < w && ok; k++) {
          const j = (ty + h) * crop.w + tx + k;
          ok = solid(j) && !used[j] && band(j) === b;
        }
        if (!ok) break;
        h++;
      }
      let maxLevels = 0;
      for (let yy = 0; yy < h; yy++)
        for (let xx = 0; xx < w; xx++) {
          const j = (ty + yy) * crop.w + tx + xx;
          used[j] = 1;
          maxLevels = Math.max(maxLevels, heights[j]);
        }
      const height = b < 0 ? 1.4 : Math.max(3, Math.round(maxLevels * opts.levelHeight * 10) / 10);
      buildings.push({ x: tx * S, y: ty * S, w: w * S, h: h * S, height });
    }
  }

  // ---------------------------------------------------------------- props
  const toCell = (p: { x: number; y: number }): Vec2 => ({
    x: Math.round((p.x - crop.x) * S * 10) / 10,
    y: Math.round((p.y - crop.y) * S * 10) / 10,
  });
  const inside = (p: Vec2) => p.x >= 1 && p.y >= 1 && p.x < W - 1 && p.y < H - 1;
  const props: MapLayout['props'] = [];
  if (opts.cars) {
    for (const c of game.cars) {
      const p = toCell(c);
      if (!inside(p)) continue;
      const t = col[tileAt(map, Math.floor(c.x), Math.floor(c.y), street)];
      const alongX = t === 0x06 || t === 0x07;
      const car = alongX ? { kind: 'car' as const, x: Math.floor(p.x - 2), y: Math.floor(p.y - 1), w: 4, h: 2 } : { kind: 'car' as const, x: Math.floor(p.x - 1), y: Math.floor(p.y - 2), w: 2, h: 4 };
      // Opened routes are a single tile wide; a parked car would close them again.
      let inTheWay = false;
      for (let y = car.y; y < car.y + car.h && !inTheWay; y++)
        for (let x = car.x; x < car.x + car.w && !inTheWay; x++) inTheWay = x >= 0 && y >= 0 && x < W && y < H && !!onRoute[Math.floor(y / S) * crop.w + Math.floor(x / S)];
      if (!inTheWay) props.push(car);
    }
  }
  if (opts.lamps) {
    for (let y = 1; y < H - 1; y++)
      for (let x = 1; x < W - 1; x++) {
        if (ground[y * W + x] !== GROUND_SIDEWALK) continue;
        const road = [1, -1, W, -W].some((d) => ground[y * W + x + d] === GROUND_ROAD);
        if (road && (x * 7 + y * 13) % 41 === 0) props.push({ kind: 'lamp', x, y });
      }
  }

  // ---------------------------------------------------------------- people
  const spawn = drop < 0 || drop === tileOf(squadAt) ? toCell(squadAt) : { x: ((drop % crop.w) + 0.5) * S, y: (Math.floor(drop / crop.w) + 0.5) * S };
  // The VTOL waits a few metres from the drop point, on the side away from the mission area.
  const extraction = (() => {
    const cx = W / 2 - spawn.x;
    const cy = H / 2 - spawn.y;
    const len = Math.hypot(cx, cy) || 1;
    for (const dist of [9, 7, 5, 3]) {
      for (const turn of [0, 0.6, -0.6, 1.2, -1.2, Math.PI]) {
        const a = Math.atan2(-cy / len, -cx / len) + turn;
        const x = Math.round(spawn.x + Math.cos(a) * dist);
        const y = Math.round(spawn.y + Math.sin(a) * dist);
        if (x < 2 || y < 2 || x >= W - 2 || y >= H - 2) continue;
        const t = Math.floor(y / S) * crop.w + Math.floor(x / S);
        const c = cells[t];
        if ((c === Cell.Walk || c === Cell.Road || c === Cell.Crossing) && reach[t]) return { x, y };
      }
    }
    return { x: spawn.x, y: spawn.y };
  })();

  const spawns: SpawnDef[] = [];
  const counts: Record<string, number> = {};
  for (const p of onMap) {
    const kind = kindOf(p);
    if (!kind) continue;
    const at = toCell(needy.has(p.index) ? placed(p) : p);
    if (!inside(at)) continue;
    const s: SpawnDef = { id: `p${p.index}`, kind, x: at.x, y: at.y };
    const weapons = p.weapons.map((w) => WEAPON_MAP[w]).filter(Boolean);
    if (weapons.length && kind !== 'civilian' && kind !== 'target') s.weapons = [...new Set(weapons)];
    // Original health is out of 16 (an agent's full health) and loads as at least 2.
    if (kind !== 'civilian') s.hp = Math.round((Math.max(2, p.health) / 16) * AGENT_HP);
    if (p.cls === 'criminal') s.name = 'Criminal';
    if (p.cls === 'agent') s.name = 'Rival Agent';
    if (persuades.has(p.index)) s.name = 'Persuasion Target';
    if (protects.has(p.index)) s.name = 'Protected VIP';
    const route = (needy.has(p.index) ? p.route.map(placed) : p.route).map(toCell).filter(inside);
    const scripted = protects.has(p.index) || persuades.has(p.index);
    if ((route.length > 1 && kind !== 'civilian' && kind !== 'police') || (route.length && scripted && kind === 'civilian')) s.patrol = route;
    else if (kind === 'guard' || kind === 'heavy') s.holds = true;
    spawns.push(s);
    counts[kind] = (counts[kind] ?? 0) + 1;
  }
  const hidden = game.people.length - onMap.length;
  if (hidden) notes.push(`${hidden} people start hidden (inside vehicles or buildings) and were left out.`);

  // ---------------------------------------------------------------- objectives
  const idsFor = (set: Set<number>) => [...set].map((i) => `p${i}`).filter((id) => spawns.some((s) => s.id === id));
  const objectives: ObjectiveDef[] = [];
  const persuaded: string[] = [];
  game.objectives.forEach((o, k) => {
    const id = `o${k + 1}`;
    const person = o.target?.type === 'person' ? `p${o.target.index}` : undefined;
    switch (o.kind) {
      case 'assassinate': {
        const t = spawns.find((s) => s.id === person);
        objectives.push({ id, type: 'eliminate', targets: person ? [person] : [], text: `Eliminate the target${t?.name ? ` (${t.name})` : ''}`, escapeFails: 'The target escaped.' });
        break;
      }
      case 'persuade':
        if (person) persuaded.push(person);
        objectives.push({ id, type: 'persuade', targets: person ? [person] : [], text: 'Persuade the target to join Eurocorp' });
        break;
      case 'protect': {
        // The VIP walks their route; the job is done when they reach the end of it.
        const dest = spawns.find((s) => s.id === person)?.patrol?.at(-1);
        objectives.push({
          id,
          type: 'protect',
          targets: person ? [person] : [],
          at: dest,
          radius: 3,
          text: dest ? 'Escort the VIP safely to their destination' : 'Keep the VIP alive',
        });
        break;
      }
      case 'evacuate':
        objectives.push({ id, type: 'extract', targets: [...persuaded], at: o.at ? toCell(placed(o.at)) : undefined, radius: 5, text: 'Escort the persuaded to the evacuation point', successText: 'Evacuation complete.' });
        break;
      case 'sweepAll':
        objectives.push({ id, type: 'sweep', factions: ['enemy', 'police'], text: 'Eliminate all enemy agents and police' });
        break;
      case 'sweepPolice':
        objectives.push({ id, type: 'sweep', factions: ['police'], text: 'Eliminate the police force' });
        break;
      default: {
        const point = pointOf(o);
        const at: Vec2 | undefined = point ? toCell(placed(point)) : undefined;
        const what = { acquire: 'Recover the equipment', destroyVehicle: 'Reach the target vehicle', useVehicle: 'Reach the vehicle' }[o.kind as string] ?? 'Reach the objective';
        objectives.push({ id, type: 'reach', at, radius: 3, text: what, todo: `Original objective "${o.kind}" (type ${o.kindId}) is approximated as reaching a point.` });
        notes.push(`Objective ${k + 1} (${o.kind}) is approximated as "reach a point".`);
      }
    }
  });
  if (!game.objectives.length) notes.push('The mission has no objectives in its data.');
  const endsWithExtract = objectives.at(-1)?.type === 'extract';
  if (opts.addExtraction && !endsWithExtract) {
    objectives.push({ id: 'extract', type: 'extract', text: 'Reach the extraction VTOL', successText: 'Objectives complete. Squad extracted.' });
  }
  if (!objectives.length) objectives.push({ id: 'extract', type: 'extract', text: 'Reach the extraction VTOL' });
  for (const t of idsFor(targets)) if (!objectives.some((o) => o.targets?.includes(t))) notes.push(`Target ${t} has no objective.`);

  // ---------------------------------------------------------------- final check at sim resolution
  // Parked cars block too, and positions can sit on a tile's edge: nudge what the mission needs onto
  // a nearby free cell the squad can walk to, as the sim will see it.
  const closed = blocked.slice();
  const fill = (x0: number, y0: number, w: number, h: number) => {
    for (let y = Math.max(0, y0); y < Math.min(H, y0 + h); y++) closed.fill(1, y * W + Math.max(0, x0), y * W + Math.min(W, x0 + w));
  };
  for (const b of buildings) fill(b.x, b.y, b.w, b.h);
  for (const p of props) if (p.kind === 'car') fill(p.x, p.y, p.w ?? 1, p.h ?? 1);
  fill(0, 0, W, 1);
  fill(0, H - 1, W, 1);
  fill(0, 0, 1, H);
  fill(W - 1, 0, 1, H);
  const nearestCell = (p: Vec2, ok: (i: number) => boolean, maxR: number): number => {
    const cx = Math.floor(p.x);
    const cy = Math.floor(p.y);
    const at = (x: number, y: number) => (x >= 0 && y >= 0 && x < W && y < H && ok(y * W + x) ? y * W + x : -1);
    if (at(cx, cy) >= 0) return cy * W + cx;
    for (let r = 1; r <= maxR; r++) {
      let best = -1;
      let bestD = Infinity;
      for (let oy = -r; oy <= r; oy++)
        for (let ox = -r; ox <= r; ox++) {
          if (Math.max(Math.abs(ox), Math.abs(oy)) !== r || at(cx + ox, cy + oy) < 0) continue;
          const d = (cx + ox + 0.5 - p.x) ** 2 + (cy + oy + 0.5 - p.y) ** 2;
          if (d < bestD) [best, bestD] = [(cy + oy) * W + cx + ox, d];
        }
      if (best >= 0) return best;
    }
    return -1;
  };
  const walked = new Uint8Array(W * H);
  // The lead agent lands at the spawn's top-left offset (see the sim's squad setup), snapped to a free cell.
  const lead = nearestCell({ x: spawn.x - 0.8, y: spawn.y - 0.8 }, (i) => !closed[i], 12);
  if (lead >= 0) {
    const stack = [lead];
    walked[lead] = 1;
    while (stack.length) {
      const i = stack.pop()!;
      const x = i % W;
      for (const j of [x > 0 ? i - 1 : -1, x < W - 1 ? i + 1 : -1, i - W, i + W]) {
        if (j < 0 || j >= W * H || walked[j] || closed[j]) continue;
        walked[j] = 1;
        stack.push(j);
      }
    }
  }
  const nudge = (p: Vec2) => {
    const i = nearestCell(p, (j) => !!walked[j], MAX_NUDGE_CELLS);
    if (i < 0 || i === Math.floor(p.y) * W + Math.floor(p.x)) return;
    p.x = (i % W) + 0.5;
    p.y = Math.floor(i / W) + 0.5;
  };
  nudge(extraction);
  for (const s of spawns) if (needy.has(Number(s.id.slice(1)))) nudge(s);
  for (const o of objectives) if (o.at) nudge(o.at);

  // ---------------------------------------------------------------- briefing
  const br = input.briefing;
  const title = br?.title ? br.title.toUpperCase() : `MISSION ${pad2(input.mission)}`;
  const briefing = br ? [...br.text, ...br.tiers.map((t) => t.join(' '))] : ['Original Syndicate mission.'];

  const mission: MissionDef = {
    version: 2,
    id: `synd_${pad2(input.mission)}`,
    codename: title,
    city: `Syndicate mission ${input.mission}${br?.kind ? ` · ${titleCase(br.kind)}` : ''}`,
    seed: 1000 + input.mission,
    map: {
      kind: 'authored',
      layout: {
        w: W,
        h: H,
        ground: encodeGrid(ground),
        blocked: encodeGrid(blocked),
        buildings,
        props,
        spawn,
        extraction,
        source: {
          kind: 'syndicate',
          mission: input.mission,
          map: game.mapId,
          scale: S,
          origin: { x: crop.x, y: crop.y },
          classes: encodeGrid(cells),
        },
      },
    },
    briefing,
    targetName: 'the target',
    targetCorp: 'a rival syndicate',
    objectives,
    population: { civilians: 0, police: 0, rivals: 0, guards: 0, heavies: 0, traffic: 0 },
    spawns,
    policeHostileAt: 40,
    enforcersAt: 70,
    atmosphere: { hour: 22, rain: { min: 0, max: 1 } },
    barks: { targetFlees: 'The target is running. Cut them off!', targetShielded: 'The target is shielded. Persuasion will not work.' },
  };
  counts.buildings = buildings.length;
  counts.props = props.length;
  return { mission, cells, crop, streetLevel: street, notes, counts };
}
