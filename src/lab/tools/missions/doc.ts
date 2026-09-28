/**
 * The mission being edited. Map grids are decoded into typed arrays for painting; everything else is
 * the MissionDef itself. Edits go through `edit()`, which snapshots state for undo.
 */
import { MISSION_VERSION, upgradeMission, type MapLayout, type MissionDef, type SpawnDef } from '../../../sim/content.ts';
import { decodeGrid, encodeGrid } from '../../../sim/grid64.ts';
import { GROUND_BUILDING, GROUND_PLAZA, GROUND_SIDEWALK, generateCity, type CityMap, type MapParams } from '../../../sim/map.ts';
import { buildCity } from '../../../sim/world.ts';
import type { MissionSource } from './api.ts';

export interface EditLayout extends Omit<MapLayout, 'ground' | 'blocked'> {
  ground: Uint8Array;
  blocked: Uint8Array;
}

export type ChangeKind = 'map' | 'entities' | 'meta' | 'all' | 'selection';

interface Snapshot {
  mission: MissionDef;
  layout: EditLayout | null;
}

const BLOCKING_PROPS = new Set(['car', 'tree', 'vending', 'planter', 'fountain']);
const UNDO_LIMIT = 80;

export function decodeLayout(l: MapLayout): EditLayout {
  const ground = decodeGrid(l.ground, l.w * l.h);
  // Building footprints are stamped by the sim; underneath, keep plain ground so buildings can move.
  for (const b of l.buildings)
    for (let y = Math.max(0, b.y); y < Math.min(l.h, b.y + b.h); y++)
      for (let x = Math.max(0, b.x); x < Math.min(l.w, b.x + b.w); x++) if (ground[y * l.w + x] === GROUND_BUILDING) ground[y * l.w + x] = GROUND_PLAZA;
  return { ...structuredClone({ ...l, ground: '', blocked: '' }), ground, blocked: decodeGrid(l.blocked, l.w * l.h) };
}

export function encodeLayout(l: EditLayout): MapLayout {
  return { ...structuredClone({ ...l, ground: undefined, blocked: undefined }), ground: encodeGrid(l.ground), blocked: encodeGrid(l.blocked) } as MapLayout;
}

/** Freezes a procedural city into an editable layout (the grid roads lose their traffic). */
export function bakeCity(map: CityMap): EditLayout {
  const W = map.w;
  const H = map.h;
  const ground = map.ground.slice();
  const blocked = map.blocked.slice();
  for (const b of map.buildings)
    for (let y = b.y; y < b.y + b.h; y++)
      for (let x = b.x; x < b.x + b.w; x++) {
        ground[y * W + x] = GROUND_SIDEWALK;
        blocked[y * W + x] = 0;
      }
  for (const p of map.props)
    if (BLOCKING_PROPS.has(p.kind))
      for (let y = p.y; y < p.y + Math.max(1, p.h); y++) for (let x = p.x; x < p.x + Math.max(1, p.w); x++) blocked[y * W + x] = 0;
  for (let x = 0; x < W; x++) blocked[x] = blocked[(H - 1) * W + x] = 0;
  for (let y = 0; y < H; y++) blocked[y * W] = blocked[y * W + W - 1] = 0;
  return {
    w: W,
    h: H,
    ground,
    blocked,
    buildings: map.buildings.map((b) => ({ x: b.x, y: b.y, w: b.w, h: b.h, height: b.height, style: b.style, seed: b.seed })),
    props: map.props.filter((p) => p.kind !== 'vtol').map((p) => ({ kind: p.kind, x: p.x, y: p.y, w: p.w, h: p.h, rot: p.rot, seed: p.seed })),
    spawn: { ...map.spawn },
    extraction: { ...map.extraction },
    escape: { ...map.escape },
    exits: map.exits.map((p) => ({ ...p })),
    plaza: map.plaza.w ? { ...map.plaza } : undefined,
  };
}

export function blankLayout(w: number, h: number): EditLayout {
  const ground = new Uint8Array(w * h).fill(GROUND_PLAZA);
  return {
    w,
    h,
    ground,
    blocked: new Uint8Array(w * h),
    buildings: [],
    props: [],
    spawn: { x: 8, y: h - 8 },
    extraction: { x: 8, y: 8 },
  };
}

export class MissionDoc {
  id: string;
  source: MissionSource;
  mission: MissionDef;
  layout: EditLayout | null;
  dirty = false;
  private undoStack: Snapshot[] = [];
  private redoStack: Snapshot[] = [];
  private listeners = new Set<(k: ChangeKind) => void>();
  private cityCache: CityMap | null = null;

  constructor(mission: MissionDef, source: MissionSource) {
    const m = upgradeMission(structuredClone(mission));
    this.id = m.id;
    this.source = source;
    this.layout = m.map.kind === 'authored' ? decodeLayout(m.map.layout) : null;
    this.mission = m;
  }

  get procedural(): boolean {
    return !this.layout;
  }

  get params(): MapParams | null {
    return this.mission.map.kind === 'authored' ? null : this.mission.map;
  }

  get spawns(): SpawnDef[] {
    return (this.mission.spawns ??= []);
  }

  on(fn: (k: ChangeKind) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  emit(k: ChangeKind): void {
    if (k !== 'selection') {
      this.dirty = true;
      if (k === 'map' || k === 'all' || k === 'meta') this.cityCache = null;
    }
    for (const fn of this.listeners) fn(k);
  }

  private snapshot(): Snapshot {
    return { mission: structuredClone(this.mission), layout: this.layout ? structuredClone(this.layout) : null };
  }

  /** Runs a mutation as one undoable step. */
  edit(kind: ChangeKind, fn: () => void): void {
    this.undoStack.push(this.snapshot());
    if (this.undoStack.length > UNDO_LIMIT) this.undoStack.shift();
    this.redoStack = [];
    fn();
    this.emit(kind);
  }

  /** Starts a continuous edit (a brush stroke, a drag); call `emit` as it changes. */
  beginStroke(): void {
    this.undoStack.push(this.snapshot());
    if (this.undoStack.length > UNDO_LIMIT) this.undoStack.shift();
    this.redoStack = [];
  }

  get canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  get canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  undo(): void {
    const s = this.undoStack.pop();
    if (!s) return;
    this.redoStack.push(this.snapshot());
    this.restore(s);
  }

  redo(): void {
    const s = this.redoStack.pop();
    if (!s) return;
    this.undoStack.push(this.snapshot());
    this.restore(s);
  }

  private restore(s: Snapshot): void {
    this.mission = s.mission;
    this.layout = s.layout;
    this.emit('all');
  }

  /** The mission as it would be saved. */
  toMission(): MissionDef {
    const m = structuredClone(this.mission);
    m.version = MISSION_VERSION;
    m.id = this.id;
    if (this.layout) m.map = { kind: 'authored', layout: encodeLayout(this.layout) };
    if (m.spawns && !m.spawns.length) delete m.spawns;
    return m;
  }

  /** The sim's view of the current map (cached until the map changes). */
  city(): CityMap {
    if (!this.cityCache) {
      const m = this.mission;
      this.cityCache = this.layout ? buildCity({ ...m, map: { kind: 'authored', layout: encodeLayout(this.layout) } }) : generateCity(m.seed, this.params!);
    }
    return this.cityCache;
  }

  /** Converts a procedural city into an editable layout. */
  bake(): void {
    if (this.layout) return;
    this.edit('all', () => {
      this.layout = bakeCity(generateCity(this.mission.seed, this.params!));
      this.mission.population.traffic = 0;
    });
  }

  nextSpawnId(prefix = 's'): string {
    const used = new Set(this.spawns.map((s) => s.id));
    for (let i = 1; ; i++) if (!used.has(`${prefix}${i}`)) return `${prefix}${i}`;
  }
}
