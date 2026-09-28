import type { MapLayout } from './content.ts';
import { decodeGrid } from './grid64.ts';
import { GROUND_BUILDING, type Building, type CityMap, type Prop, type PropKind } from './map.ts';
import { hash2 } from './rng.ts';
import type { Vec2 } from './types.ts';

/** Props that stop people walking through them (benches and lamps don't). */
const BLOCKING: ReadonlySet<PropKind> = new Set<PropKind>(['car', 'tree', 'vending', 'planter', 'fountain']);

/** Walkable points along the map edge, roughly every `step` cells, for civilians to leave by. */
function edgeExits(W: number, H: number, blocked: Uint8Array, step = 14): Vec2[] {
  const out: Vec2[] = [];
  const free = (x: number, y: number) => !blocked[y * W + x];
  const scan = (pts: [number, number][]) => {
    let lastAt = -step;
    pts.forEach(([x, y], i) => {
      if (i - lastAt < step || !free(x, y)) return;
      out.push({ x: x + 0.5, y: y + 0.5 });
      lastAt = i;
    });
  };
  const inset = 2;
  scan(Array.from({ length: W - 2 * inset }, (_, i) => [inset + i, inset] as [number, number]));
  scan(Array.from({ length: W - 2 * inset }, (_, i) => [inset + i, H - 1 - inset] as [number, number]));
  scan(Array.from({ length: H - 2 * inset }, (_, i) => [inset, inset + i] as [number, number]));
  scan(Array.from({ length: H - 2 * inset }, (_, i) => [W - 1 - inset, inset + i] as [number, number]));
  return out;
}

/** Builds the sim's CityMap from an authored layout. Authored maps have no grid roads, so no traffic. */
export function buildAuthoredCity(seed: number, L: MapLayout): CityMap {
  const W = L.w;
  const H = L.h;
  const ground = decodeGrid(L.ground, W * H);
  const blocked = decodeGrid(L.blocked, W * H);
  const setRect = (arr: Uint8Array, x0: number, y0: number, w: number, h: number, v: number) => {
    for (let y = Math.max(0, y0); y < Math.min(H, y0 + h); y++)
      for (let x = Math.max(0, x0); x < Math.min(W, x0 + w); x++) arr[y * W + x] = v;
  };

  const buildings: Building[] = L.buildings.map((b, i) => ({
    id: i,
    x: b.x,
    y: b.y,
    w: b.w,
    h: b.h,
    height: b.height,
    seed: b.seed ?? Math.floor(hash2(b.x, b.y, seed) * (1 << 30)) + 1,
    style: b.style ?? Math.floor(hash2(b.y, b.x, 7) * 3),
  }));
  for (const b of buildings) {
    setRect(ground, b.x, b.y, b.w, b.h, GROUND_BUILDING);
    setRect(blocked, b.x, b.y, b.w, b.h, 1);
  }

  const props: Prop[] = L.props.map((p) => ({
    kind: p.kind,
    x: p.x,
    y: p.y,
    w: p.w ?? 1,
    h: p.h ?? 1,
    rot: p.rot ?? 0,
    seed: p.seed ?? Math.floor(hash2(p.x, p.y, 11) * 1e9),
  }));
  for (const p of props) if (BLOCKING.has(p.kind)) setRect(blocked, Math.floor(p.x), Math.floor(p.y), Math.max(1, p.w), Math.max(1, p.h), 1);
  if (!props.some((p) => p.kind === 'vtol')) props.push({ kind: 'vtol', x: L.extraction.x, y: L.extraction.y, w: 0, h: 0, rot: 0, seed: 0 });

  for (let x = 0; x < W; x++) {
    blocked[x] = 1;
    blocked[(H - 1) * W + x] = 1;
  }
  for (let y = 0; y < H; y++) {
    blocked[y * W] = 1;
    blocked[y * W + W - 1] = 1;
  }

  const exits = L.exits?.length ? L.exits.map((p) => ({ ...p })) : edgeExits(W, H, blocked);
  if (!exits.length) exits.push({ ...L.spawn });
  const far = exits.reduce((a, b) =>
    Math.hypot(a.x - L.spawn.x, a.y - L.spawn.y) >= Math.hypot(b.x - L.spawn.x, b.y - L.spawn.y) ? a : b,
  );

  return {
    w: W,
    h: H,
    seed,
    ground,
    blocked,
    crosswalk: new Uint8Array(W * H),
    crosswalkNode: new Int16Array(W * H).fill(-1),
    buildings,
    props,
    roadsX: [],
    roadsY: [],
    intersections: [],
    exits,
    plaza: L.plaza ? { ...L.plaza } : { x: 0, y: 0, w: 0, h: 0 },
    spawn: { ...L.spawn },
    extraction: { ...L.extraction },
    escape: { ...(L.escape ?? far) },
  };
}
