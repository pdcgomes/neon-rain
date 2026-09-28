import { Rng } from './rng.ts';
import type { Vec2 } from './types.ts';

export const GROUND_ROAD = 0;
export const GROUND_SIDEWALK = 1;
export const GROUND_PLAZA = 2;
export const GROUND_ALLEY = 3;
export const GROUND_BUILDING = 4;

export interface Building {
  id: number;
  x: number;
  y: number;
  w: number;
  h: number;
  height: number;
  seed: number;
  style: number;
}

export type PropKind = 'lamp' | 'car' | 'tree' | 'vending' | 'planter' | 'fountain' | 'bench' | 'vtol';

export interface Prop {
  kind: PropKind;
  x: number;
  y: number;
  w: number;
  h: number;
  rot: number;
  seed: number;
}

export interface Band {
  start: number;
  end: number;
}

export interface CityMap {
  w: number;
  h: number;
  seed: number;
  ground: Uint8Array;
  blocked: Uint8Array;
  /**
   * Pedestrian crossings just outside each intersection: 0 = none, 1 = crosses a road whose traffic
   * runs along x, 2 = crosses a road whose traffic runs along y.
   */
  crosswalk: Uint8Array;
  /** Intersection index (i * roadsY.length + j) each crosswalk cell belongs to, -1 if none. */
  crosswalkNode: Int16Array;
  buildings: Building[];
  props: Prop[];
  roadsX: Band[];
  roadsY: Band[];
  intersections: Vec2[];
  exits: Vec2[];
  plaza: { x: number; y: number; w: number; h: number };
  spawn: Vec2;
  extraction: Vec2;
  escape: Vec2;
}

export interface MapParams {
  size: number;
  blockMin: number;
  blockMax: number;
  roadWidth: number;
  /** Sidewalk width around each block, metres (default 2). */
  sidewalk?: number;
  /** Chance that a lot is left open (courtyard or car park) instead of built on. */
  openLots?: number;
}

function makeBands(size: number, rng: Rng, p: MapParams): { roads: Band[]; blocks: Band[] } {
  const roads: Band[] = [];
  const blocks: Band[] = [];
  let pos = 0;
  let first = rng.int(Math.floor(p.blockMin * 0.7), p.blockMin);
  blocks.push({ start: 0, end: first });
  pos = first;
  while (pos + p.roadWidth + p.blockMin <= size) {
    roads.push({ start: pos, end: pos + p.roadWidth });
    pos += p.roadWidth;
    const remaining = size - pos;
    let len = rng.int(p.blockMin, p.blockMax);
    if (remaining - len < p.blockMin + p.roadWidth) len = remaining;
    blocks.push({ start: pos, end: pos + len });
    pos += len;
  }
  if (pos < size) blocks[blocks.length - 1].end = size;
  return { roads, blocks };
}

export function generateCity(seed: number, params: MapParams): CityMap {
  const rng = new Rng(seed);
  const W = params.size;
  const H = params.size;
  const ground = new Uint8Array(W * H).fill(GROUND_ROAD);
  const blocked = new Uint8Array(W * H);
  const buildings: Building[] = [];
  const props: Prop[] = [];

  const bx = makeBands(W, rng, params);
  const by = makeBands(H, rng, params);

  const setRect = (arr: Uint8Array, x0: number, y0: number, w: number, h: number, v: number) => {
    for (let y = Math.max(0, y0); y < Math.min(H, y0 + h); y++) {
      for (let x = Math.max(0, x0); x < Math.min(W, x0 + w); x++) arr[y * W + x] = v;
    }
  };

  // Pick the block closest to the centre as the plaza.
  let plazaI = 0;
  let plazaJ = 0;
  let best = Infinity;
  for (let i = 0; i < bx.blocks.length; i++) {
    for (let j = 0; j < by.blocks.length; j++) {
      const cx = (bx.blocks[i].start + bx.blocks[i].end) / 2;
      const cy = (by.blocks[j].start + by.blocks[j].end) / 2;
      const d = Math.hypot(cx - W / 2, cy - H / 2);
      if (d < best) {
        best = d;
        plazaI = i;
        plazaJ = j;
      }
    }
  }

  const sidewalk = params.sidewalk ?? 2;
  const openLots = params.openLots ?? 0;
  let plaza = { x: 0, y: 0, w: 0, h: 0 };

  const addBuilding = (x: number, y: number, w: number, h: number) => {
    // Mostly low-rise so streets stay readable from the gameplay camera; rare towers on big lots only.
    const area = Math.min(1, (w * h) / 100);
    const tall = area > 0.6 && rng.chance(0.06);
    const height = tall ? rng.range(22, 32) : rng.range(4, 10) * (0.85 + 0.35 * area);
    buildings.push({
      id: buildings.length,
      x,
      y,
      w,
      h,
      height: Math.round(height),
      seed: rng.int(1, 1 << 30),
      style: rng.int(0, 3),
    });
    setRect(ground, x, y, w, h, GROUND_BUILDING);
    setRect(blocked, x, y, w, h, 1);
  };

  const openLot = (x: number, y: number, w: number, h: number) => {
    setRect(ground, x, y, w, h, GROUND_PLAZA);
    if (w >= 5 && h >= 5 && rng.chance(0.5)) {
      // Car park: one row of parked cars along the longer side.
      const along = w >= h;
      const len = along ? w : h;
      for (let k = 1; k + 2 <= len - 1; k += 3) {
        if (!rng.chance(0.7)) continue;
        const cx = along ? x + k : x + 1;
        const cy = along ? y + 1 : y + k;
        const cw = along ? 2 : 4;
        const ch = along ? 4 : 2;
        if (cx + cw > x + w || cy + ch > y + h) continue;
        props.push({ kind: 'car', x: cx, y: cy, w: cw, h: ch, rot: along ? Math.PI / 2 : 0, seed: rng.int(1, 1e9) });
        setRect(blocked, cx, cy, cw, ch, 1);
      }
      return;
    }
    // Courtyard: a few trees, planters and benches, keeping the edges walkable.
    for (let ty = y + 1; ty < y + h - 1; ty += 3) {
      for (let tx = x + 1; tx < x + w - 1; tx += 3) {
        const r = rng.next();
        if (r < 0.3) {
          props.push({ kind: 'tree', x: tx, y: ty, w: 1, h: 1, rot: rng.range(0, 6.28), seed: rng.int(1, 1e9) });
          blocked[ty * W + tx] = 1;
        } else if (r < 0.42) {
          props.push({ kind: 'planter', x: tx, y: ty, w: 1, h: 1, rot: 0, seed: rng.int(1, 1e9) });
          blocked[ty * W + tx] = 1;
        } else if (r < 0.55) {
          props.push({ kind: 'bench', x: tx, y: ty, w: 1, h: 1, rot: rng.chance(0.5) ? 0 : Math.PI / 2, seed: 0 });
        }
      }
    }
  };

  const subdivide = (x: number, y: number, w: number, h: number, depth: number) => {
    const maxLot = 10;
    if ((w <= maxLot && h <= maxLot && (depth > 0 || rng.chance(0.5))) || w < 8 || h < 8) {
      if (depth > 0 && rng.chance(openLots)) {
        openLot(x, y, w, h);
        return;
      }
      if (rng.chance(0.07) && depth > 0) {
        setRect(ground, x, y, w, h, GROUND_ALLEY);
        if (w >= 3 && h >= 3 && rng.chance(0.6)) {
          props.push({ kind: 'vending', x: x + 1, y: y + 1, w: 1, h: 1, rot: 0, seed: rng.int(1, 1e9) });
          blocked[(y + 1) * W + x + 1] = 1;
        }
        return;
      }
      addBuilding(x, y, w, h);
      return;
    }
    const alley = rng.chance(0.4) ? 2 : 0;
    if (w >= h) {
      const cut = rng.int(Math.floor(w * 0.35), Math.ceil(w * 0.65));
      if (alley) setRect(ground, x + cut, y, alley, h, GROUND_ALLEY);
      subdivide(x, y, cut, h, depth + 1);
      subdivide(x + cut + alley, y, w - cut - alley, h, depth + 1);
    } else {
      const cut = rng.int(Math.floor(h * 0.35), Math.ceil(h * 0.65));
      if (alley) setRect(ground, x, y + cut, w, alley, GROUND_ALLEY);
      subdivide(x, y, w, cut, depth + 1);
      subdivide(x, y + cut + alley, w, h - cut - alley, depth + 1);
    }
  };

  for (let i = 0; i < bx.blocks.length; i++) {
    for (let j = 0; j < by.blocks.length; j++) {
      const b0 = bx.blocks[i];
      const b1 = by.blocks[j];
      const x0 = b0.start;
      const y0 = b1.start;
      const w = b0.end - b0.start;
      const h = b1.end - b1.start;
      setRect(ground, x0, y0, w, h, GROUND_SIDEWALK);
      const ix = x0 + sidewalk;
      const iy = y0 + sidewalk;
      const iw = w - sidewalk * 2;
      const ih = h - sidewalk * 2;
      if (i === plazaI && j === plazaJ) {
        plaza = { x: ix, y: iy, w: iw, h: ih };
        setRect(ground, ix, iy, iw, ih, GROUND_PLAZA);
        const fx = Math.floor(ix + iw / 2 - 1.5);
        const fy = Math.floor(iy + ih / 2 - 1.5);
        props.push({ kind: 'fountain', x: fx, y: fy, w: 3, h: 3, rot: 0, seed: 1 });
        setRect(blocked, fx, fy, 3, 3, 1);
        for (let ty = iy + 2; ty < iy + ih - 1; ty += 5) {
          for (let tx = ix + 2; tx < ix + iw - 1; tx += 5) {
            if (Math.abs(tx - (fx + 1)) < 4 && Math.abs(ty - (fy + 1)) < 4) continue;
            if (rng.chance(0.55)) {
              props.push({ kind: 'tree', x: tx, y: ty, w: 1, h: 1, rot: rng.range(0, 6.28), seed: rng.int(1, 1e9) });
              blocked[ty * W + tx] = 1;
            } else if (rng.chance(0.35)) {
              props.push({ kind: 'bench', x: tx, y: ty, w: 1, h: 1, rot: rng.chance(0.5) ? 0 : Math.PI / 2, seed: 0 });
            }
          }
        }
        continue;
      }
      if (iw > 2 && ih > 2) subdivide(ix, iy, iw, ih, 0);
    }
  }

  // Roads: parked cars along the kerbs.
  const isRoadX = (x: number) => bx.roads.some((r) => x >= r.start && x < r.end);
  const isRoadY = (y: number) => by.roads.some((r) => y >= r.start && y < r.end);
  const clearRect = (x0: number, y0: number, w: number, h: number) => {
    for (let y = y0; y < y0 + h; y++)
      for (let x = x0; x < x0 + w; x++) {
        if (x < 0 || y < 0 || x >= W || y >= H) return false;
        if (blocked[y * W + x] || ground[y * W + x] !== GROUND_ROAD) return false;
      }
    return true;
  };
  for (const r of bx.roads) {
    for (const lane of [r.start, r.end - 2]) {
      for (let y = 3; y < H - 7; y += 6) {
        if (isRoadY(y - 1) || isRoadY(y + 5)) continue;
        if (!rng.chance(0.3) || !clearRect(lane, y, 2, 4)) continue;
        props.push({ kind: 'car', x: lane, y, w: 2, h: 4, rot: Math.PI / 2, seed: rng.int(1, 1e9) });
        setRect(blocked, lane, y, 2, 4, 1);
      }
    }
  }
  for (const r of by.roads) {
    for (const lane of [r.start, r.end - 2]) {
      for (let x = 3; x < W - 7; x += 6) {
        if (isRoadX(x - 1) || isRoadX(x + 5)) continue;
        if (!rng.chance(0.3) || !clearRect(x, lane, 4, 2)) continue;
        props.push({ kind: 'car', x, y: lane, w: 4, h: 2, rot: 0, seed: rng.int(1, 1e9) });
        setRect(blocked, x, lane, 4, 2, 1);
      }
    }
  }

  // Street lamps along kerbs.
  for (let y = 1; y < H - 1; y++) {
    for (let x = 1; x < W - 1; x++) {
      if (ground[y * W + x] !== GROUND_SIDEWALK) continue;
      const nearRoad =
        ground[y * W + x + 1] === GROUND_ROAD ||
        ground[y * W + x - 1] === GROUND_ROAD ||
        ground[(y + 1) * W + x] === GROUND_ROAD ||
        ground[(y - 1) * W + x] === GROUND_ROAD;
      if (nearRoad && (x * 7 + y * 13) % 29 === 0) {
        props.push({ kind: 'lamp', x, y, w: 1, h: 1, rot: 0, seed: x * 31 + y });
      }
    }
  }

  // Seal the outer boundary.
  for (let x = 0; x < W; x++) {
    blocked[x] = 1;
    blocked[(H - 1) * W + x] = 1;
  }
  for (let y = 0; y < H; y++) {
    blocked[y * W] = 1;
    blocked[y * W + W - 1] = 1;
  }

  const crosswalk = new Uint8Array(W * H);
  const crosswalkNode = new Int16Array(W * H).fill(-1);
  const mark = (x: number, y: number, kind: number, node: number) => {
    if (x < 0 || y < 0 || x >= W || y >= H) return;
    crosswalk[y * W + x] = kind;
    crosswalkNode[y * W + x] = node;
  };
  bx.roads.forEach((rx, i) => {
    by.roads.forEach((ry, j) => {
      const node = i * by.roads.length + j;
      // Strips across the vertical road (its traffic runs along y).
      for (const [y0, y1] of [[ry.start - 2, ry.start], [ry.end, ry.end + 2]]) {
        for (let y = y0; y < y1; y++) for (let x = rx.start; x < rx.end; x++) mark(x, y, 2, node);
      }
      // Strips across the horizontal road (its traffic runs along x).
      for (const [x0, x1] of [[rx.start - 2, rx.start], [rx.end, rx.end + 2]]) {
        for (let x = x0; x < x1; x++) for (let y = ry.start; y < ry.end; y++) mark(x, y, 1, node);
      }
    });
  });

  const center = (b: Band) => (b.start + b.end) / 2;
  const intersections: Vec2[] = [];
  for (const rx of bx.roads) for (const ry of by.roads) intersections.push({ x: center(rx), y: center(ry) });
  const exits: Vec2[] = [];
  for (const rx of bx.roads) exits.push({ x: center(rx), y: 2.5 }, { x: center(rx), y: H - 2.5 });
  for (const ry of by.roads) exits.push({ x: 2.5, y: center(ry) }, { x: W - 2.5, y: center(ry) });

  const nearest = (pts: Vec2[], x: number, y: number) =>
    pts.reduce((a, b) => (Math.hypot(a.x - x, a.y - y) <= Math.hypot(b.x - x, b.y - y) ? a : b));

  // Spawn and extraction sit on the sidewalk corner of an intersection, out of the traffic lanes.
  const corner = params.roadWidth / 2 + 1;
  const cornerOf = (p: Vec2, sx: number, sy: number) => ({ x: p.x + sx * corner, y: p.y + sy * corner });
  const spawn = cornerOf(nearest(intersections, W * 0.12, H * 0.88), -1, 1);
  const extraction = cornerOf(nearest(intersections, W * 0.12, H * 0.12), -1, -1);
  const escape = nearest(exits, W - 2.5, H * 0.55);
  props.push({ kind: 'vtol', x: extraction.x, y: extraction.y, w: 0, h: 0, rot: 0, seed: 0 });

  return {
    w: W,
    h: H,
    seed,
    ground,
    blocked,
    crosswalk,
    crosswalkNode,
    buildings,
    props,
    roadsX: bx.roads,
    roadsY: by.roads,
    intersections,
    exits,
    plaza,
    spawn: { ...spawn },
    extraction: { ...extraction },
    escape: { ...escape },
  };
}
