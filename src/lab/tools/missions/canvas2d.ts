/**
 * Top-down 2D view of a mission: ground, obstacles and buildings are rasterised once per map change
 * (one pixel per cell); entities, routes, markers and tool previews are drawn on top every frame.
 */
import { CELL_COLORS } from '../../../import/syndicate/raster.ts';
import type { ObjectiveDef, SpawnDef, SpawnKind } from '../../../sim/content.ts';
import { decodeGrid } from '../../../sim/grid64.ts';
import { GROUND_ALLEY, GROUND_BUILDING, GROUND_PLAZA, GROUND_ROAD, GROUND_SIDEWALK, type CityMap } from '../../../sim/map.ts';
import type { Vec2 } from '../../../sim/types.ts';
import type { MissionDoc } from './doc.ts';
import type { Issue } from './validate.ts';

export const GROUND_COLORS: Record<number, string> = {
  [GROUND_ROAD]: '#1b1e36',
  [GROUND_SIDEWALK]: '#454555',
  [GROUND_PLAZA]: '#51405e',
  [GROUND_ALLEY]: '#26222c',
  [GROUND_BUILDING]: '#0b0b10',
};

export const GROUND_NAMES: Record<number, string> = {
  [GROUND_ROAD]: 'Road',
  [GROUND_SIDEWALK]: 'Sidewalk',
  [GROUND_PLAZA]: 'Plaza',
  [GROUND_ALLEY]: 'Alley',
};

export const SPAWN_COLORS: Record<SpawnKind, string> = {
  civilian: '#e8d35a',
  police: '#3d7bff',
  enforcer: '#8fb8ff',
  rival: '#ff3b5c',
  heavy: '#ff7a3d',
  guard: '#ff6fa8',
  target: '#ffffff',
};

export type Selection =
  | { t: 'spawn'; id: string }
  | { t: 'building'; i: number }
  | { t: 'prop'; i: number }
  | { t: 'marker'; m: 'spawn' | 'extraction' | 'escape' }
  | { t: 'waypoint'; id: string; i: number }
  | null;

export interface Layers {
  ground: boolean;
  buildings: boolean;
  props: boolean;
  entities: boolean;
  routes: boolean;
  markers: boolean;
  reference: boolean;
  issues: boolean;
  grid: boolean;
}

export interface Overlay {
  /** Brush footprint or rectangle being dragged, in cells. */
  brush?: { x: number; y: number; w: number; h: number; color: string };
  /** A pending route (drawn from the selected spawn). */
  hover?: Vec2;
}

const hex = (s: string): [number, number, number] => [parseInt(s.slice(1, 3), 16), parseInt(s.slice(3, 5), 16), parseInt(s.slice(5, 7), 16)];

export class MapView {
  readonly canvas: HTMLCanvasElement;
  private g: CanvasRenderingContext2D;
  private base = document.createElement('canvas');
  private ref = document.createElement('canvas');
  private refScale = 1;
  private doc: MissionDoc | null = null;
  /** Pixels per cell and the cell at the canvas' top-left. */
  scale = 4;
  ox = 0;
  oy = 0;
  layers: Layers = { ground: true, buildings: true, props: true, entities: true, routes: true, markers: true, reference: false, issues: true, grid: true };
  selection: Selection = null;
  overlay: Overlay = {};
  issues: Issue[] = [];
  private dirty = true;
  private baseDirty = true;

  constructor() {
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'mv-canvas';
    this.g = this.canvas.getContext('2d')!;
  }

  setDoc(doc: MissionDoc): void {
    this.doc = doc;
    this.baseDirty = true;
    this.buildReference();
    this.fit();
  }

  get city(): CityMap {
    return this.doc!.city();
  }

  invalidate(base = false): void {
    this.dirty = true;
    if (base) this.baseDirty = true;
  }

  resize(): void {
    const r = this.canvas.getBoundingClientRect();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    this.canvas.width = Math.max(1, Math.round(r.width * dpr));
    this.canvas.height = Math.max(1, Math.round(r.height * dpr));
    this.dirty = true;
  }

  private get dpr(): number {
    return this.canvas.width / Math.max(1, this.canvas.clientWidth);
  }

  fit(): void {
    const c = this.city;
    const cw = this.canvas.clientWidth || 800;
    const ch = this.canvas.clientHeight || 600;
    this.scale = Math.max(0.5, Math.min(cw / c.w, ch / c.h) * 0.94);
    this.ox = c.w / 2 - cw / this.scale / 2;
    this.oy = c.h / 2 - ch / this.scale / 2;
    this.dirty = true;
  }

  /** Canvas (CSS px) to cell coordinates. */
  toCell(px: number, py: number): Vec2 {
    return { x: this.ox + px / this.scale, y: this.oy + py / this.scale };
  }

  toPx(x: number, y: number): Vec2 {
    return { x: (x - this.ox) * this.scale, y: (y - this.oy) * this.scale };
  }

  zoomAt(px: number, py: number, factor: number): void {
    const before = this.toCell(px, py);
    this.scale = Math.max(0.4, Math.min(48, this.scale * factor));
    this.ox = before.x - px / this.scale;
    this.oy = before.y - py / this.scale;
    this.dirty = true;
  }

  pan(dx: number, dy: number): void {
    this.ox -= dx / this.scale;
    this.oy -= dy / this.scale;
    this.dirty = true;
  }

  centerOn(p: Vec2): void {
    this.ox = p.x - this.canvas.clientWidth / this.scale / 2;
    this.oy = p.y - this.canvas.clientHeight / this.scale / 2;
    this.dirty = true;
  }

  private buildReference(): void {
    const src = this.doc?.layout?.source;
    if (!src?.classes) {
      this.ref.width = this.ref.height = 1;
      return;
    }
    const l = this.doc!.layout!;
    const tw = Math.round(l.w / src.scale);
    const th = Math.round(l.h / src.scale);
    const cells = decodeGrid(src.classes, tw * th);
    this.ref.width = tw;
    this.ref.height = th;
    this.refScale = src.scale;
    const g = this.ref.getContext('2d')!;
    const img = g.createImageData(tw, th);
    for (let i = 0; i < cells.length; i++) {
      const c = hex(CELL_COLORS[cells[i] as keyof typeof CELL_COLORS] ?? '#ff00ff');
      img.data.set([c[0], c[1], c[2], 255], i * 4);
    }
    g.putImageData(img, 0, 0);
  }

  private buildBase(): void {
    const doc = this.doc!;
    const city = this.city;
    const W = city.w;
    const H = city.h;
    this.base.width = W;
    this.base.height = H;
    const g = this.base.getContext('2d')!;
    const img = g.createImageData(W, H);
    const pal = Object.fromEntries(Object.entries(GROUND_COLORS).map(([k, v]) => [k, hex(v)]));
    const ground = doc.layout?.ground ?? city.ground;
    const extra = doc.layout?.blocked;
    for (let i = 0; i < W * H; i++) {
      let c = pal[ground[i]] ?? [255, 0, 255];
      const obstacle = extra ? extra[i] : city.blocked[i] && city.ground[i] !== GROUND_BUILDING;
      if (obstacle) c = [c[0] * 0.4 + 150 * 0.6, c[1] * 0.4 + 40 * 0.6, c[2] * 0.4 + 50 * 0.6];
      img.data.set([c[0], c[1], c[2], 255], i * 4);
    }
    g.putImageData(img, 0, 0);
    this.baseDirty = false;
  }

  private buildings(): { x: number; y: number; w: number; h: number; height: number }[] {
    return this.doc!.layout?.buildings ?? this.city.buildings;
  }

  private props() {
    return this.doc!.layout?.props ?? this.city.props;
  }

  draw(): void {
    if (!this.dirty || !this.doc) return;
    this.dirty = false;
    if (this.baseDirty) this.buildBase();
    const g = this.g;
    const dpr = this.dpr;
    const s = this.scale;
    const doc = this.doc;
    const city = this.city;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.fillStyle = '#07070b';
    g.fillRect(0, 0, this.canvas.width, this.canvas.height);
    g.setTransform(dpr * s, 0, 0, dpr * s, -this.ox * s * dpr, -this.oy * s * dpr);
    g.imageSmoothingEnabled = false;
    if (this.layers.ground) g.drawImage(this.base, 0, 0);
    const px = 1 / s;
    g.lineWidth = px;

    if (this.layers.grid && s >= 10) {
      g.strokeStyle = 'rgba(255,255,255,0.05)';
      g.beginPath();
      const x0 = Math.max(0, Math.floor(this.ox));
      const y0 = Math.max(0, Math.floor(this.oy));
      const x1 = Math.min(city.w, Math.ceil(this.ox + this.canvas.clientWidth / s));
      const y1 = Math.min(city.h, Math.ceil(this.oy + this.canvas.clientHeight / s));
      for (let x = x0; x <= x1; x++) {
        g.moveTo(x, y0);
        g.lineTo(x, y1);
      }
      for (let y = y0; y <= y1; y++) {
        g.moveTo(x0, y);
        g.lineTo(x1, y);
      }
      g.stroke();
    }

    if (this.layers.buildings) {
      const bs = this.buildings();
      bs.forEach((b, i) => {
        const k = Math.min(1, b.height / 30);
        g.fillStyle = `rgb(${34 + k * 70},${36 + k * 76},${60 + k * 120})`;
        g.fillRect(b.x, b.y, b.w, b.h);
        const sel = this.selection?.t === 'building' && this.selection.i === i;
        g.strokeStyle = sel ? '#0a84ff' : 'rgba(0,0,0,0.6)';
        g.lineWidth = sel ? 2.5 * px : px;
        g.strokeRect(b.x, b.y, b.w, b.h);
        if (sel) {
          g.fillStyle = '#0a84ff';
          g.fillRect(b.x + b.w - 5 * px, b.y + b.h - 5 * px, 10 * px, 10 * px);
        }
        if (s >= 5 && b.w * s > 30 && b.h * s > 14) {
          g.fillStyle = 'rgba(255,255,255,0.55)';
          g.font = `${11 * px}px -apple-system, sans-serif`;
          g.fillText(`${Math.round(b.height)}m`, b.x + 3 * px, b.y + 12 * px);
        }
      });
      g.lineWidth = px;
    }

    if (this.layers.props) {
      this.props().forEach((p, i) => {
        const sel = this.selection?.t === 'prop' && this.selection.i === i;
        const w = Math.max(1, p.w ?? 1);
        const h = Math.max(1, p.h ?? 1);
        const col = { car: '#9aa3b8', tree: '#ff4fa3', lamp: '#ffc070', vending: '#1ff4ff', planter: '#3fd08a', bench: '#8a8fa0', fountain: '#6ad6ff', vtol: '#50ffaa' }[p.kind] ?? '#fff';
        g.fillStyle = col;
        if (p.kind === 'lamp' || p.kind === 'tree') {
          g.beginPath();
          g.arc(p.x + 0.5, p.y + 0.5, p.kind === 'tree' ? 0.7 : 0.35, 0, Math.PI * 2);
          g.fill();
        } else g.fillRect(p.x + 0.1, p.y + 0.1, w - 0.2, h - 0.2);
        if (sel) {
          g.strokeStyle = '#0a84ff';
          g.lineWidth = 2 * px;
          g.strokeRect(p.x - 0.2, p.y - 0.2, w + 0.4, h + 0.4);
          g.lineWidth = px;
        }
      });
    }

    if (this.layers.reference && this.ref.width > 1) {
      g.globalAlpha = 0.6;
      g.drawImage(this.ref, 0, 0, this.ref.width * this.refScale, this.ref.height * this.refScale);
      g.globalAlpha = 1;
    }

    const spawns = doc.spawns;
    const targeted = new Set(doc.mission.objectives.flatMap((o) => o.targets ?? []));
    if (this.layers.routes) {
      for (const sp of spawns) {
        if (!sp.patrol?.length) continue;
        const sel = this.selection && 'id' in this.selection && this.selection.id === sp.id;
        g.strokeStyle = sel ? '#0a84ff' : `${SPAWN_COLORS[sp.kind]}88`;
        g.lineWidth = (sel ? 2 : 1.2) * px;
        g.setLineDash([4 * px, 3 * px]);
        g.beginPath();
        g.moveTo(sp.x, sp.y);
        for (const p of sp.patrol) g.lineTo(p.x, p.y);
        if (sp.kind !== 'civilian' && sp.patrol.length > 1) g.lineTo(sp.patrol[0].x, sp.patrol[0].y);
        g.stroke();
        g.setLineDash([]);
        if (sel)
          sp.patrol.forEach((p, i) => {
            const on = this.selection?.t === 'waypoint' && this.selection.i === i;
            g.fillStyle = on ? '#fff' : '#0a84ff';
            g.fillRect(p.x - 3 * px, p.y - 3 * px, 6 * px, 6 * px);
          });
      }
      g.lineWidth = px;
      if (this.overlay.hover && this.selection && 'id' in this.selection) {
        const sp = spawns.find((x) => x.id === (this.selection as { id: string }).id);
        const last = sp?.patrol?.at(-1) ?? sp;
        if (last) {
          g.strokeStyle = 'rgba(10,132,255,0.8)';
          g.setLineDash([3 * px, 3 * px]);
          g.beginPath();
          g.moveTo(last.x, last.y);
          g.lineTo(this.overlay.hover.x, this.overlay.hover.y);
          g.stroke();
          g.setLineDash([]);
        }
      }
    }

    if (this.layers.entities) {
      const r = Math.max(0.45, 3.2 * px);
      for (const sp of spawns) this.drawSpawn(sp, r, targeted.has(sp.id) || sp.kind === 'target', px);
    }

    if (this.layers.markers) {
      const ex = city.extraction;
      this.ring(ex.x, ex.y, 4.5, '#50ffaa', 2 * px, this.selection?.t === 'marker' && this.selection.m === 'extraction');
      this.label('VTOL', ex.x, ex.y - 5, '#50ffaa', px);
      const es = city.escape;
      this.ring(es.x, es.y, 2.2, '#ff4a5f', 2 * px, this.selection?.t === 'marker' && this.selection.m === 'escape');
      this.label('ESCAPE', es.x, es.y - 3, '#ff4a5f', px);
      const sp = city.spawn;
      g.fillStyle = '#1ff4ff';
      g.beginPath();
      const d = Math.max(1.4, 7 * px);
      g.moveTo(sp.x, sp.y - d);
      g.lineTo(sp.x + d, sp.y);
      g.lineTo(sp.x, sp.y + d);
      g.lineTo(sp.x - d, sp.y);
      g.closePath();
      g.fill();
      if (this.selection?.t === 'marker' && this.selection.m === 'spawn') this.ring(sp.x, sp.y, d * 1.6, '#0a84ff', 2 * px, false);
      this.label('SQUAD', sp.x, sp.y - d - 1, '#1ff4ff', px);
      g.fillStyle = 'rgba(200,200,220,0.6)';
      for (const e of city.exits) g.fillRect(e.x - 2.5 * px, e.y - 2.5 * px, 5 * px, 5 * px);
      this.drawObjectivePoints(doc.mission.objectives, px);
    }

    if (this.layers.issues)
      for (const is of this.issues) {
        if (!is.at || is.level === 'info') continue;
        this.ring(is.at.x, is.at.y, Math.max(1.5, 9 * px), is.level === 'error' ? '#ff453a' : '#ff9f0a', 2 * px, false);
      }

    const b = this.overlay.brush;
    if (b) {
      g.strokeStyle = '#fff';
      g.lineWidth = 1.5 * px;
      g.fillStyle = `${b.color}66`;
      g.fillRect(b.x, b.y, b.w, b.h);
      g.strokeRect(b.x, b.y, b.w, b.h);
    }
  }

  private drawSpawn(sp: SpawnDef, r: number, important: boolean, px: number): void {
    const g = this.g;
    const sel = this.selection && 'id' in this.selection && this.selection.id === sp.id;
    g.fillStyle = SPAWN_COLORS[sp.kind];
    g.beginPath();
    if (sp.kind === 'police' || sp.kind === 'enforcer') g.rect(sp.x - r, sp.y - r, r * 2, r * 2);
    else g.arc(sp.x, sp.y, sp.kind === 'civilian' ? r * 0.7 : r, 0, Math.PI * 2);
    g.fill();
    if (sp.holds) {
      g.strokeStyle = '#000';
      g.lineWidth = px;
      g.stroke();
    }
    if (important) this.ring(sp.x, sp.y, r * 2.1, '#ffd34d', 1.5 * px, false);
    if (sel) this.ring(sp.x, sp.y, r * 2.6, '#0a84ff', 2.5 * px, false);
    if (sel || (important && this.scale > 3)) this.label(sp.name ?? sp.id, sp.x, sp.y - r * 3, '#fff', px);
  }

  private drawObjectivePoints(objectives: ObjectiveDef[], px: number): void {
    objectives.forEach((o, i) => {
      if (!o.at) return;
      const c = o.type === 'extract' ? '#50ffaa' : o.type === 'protect' ? '#ffd34d' : '#c77dff';
      this.ring(o.at.x, o.at.y, o.radius ?? 2.5, c, 1.5 * px, false, true);
      this.label(`${i + 1}. ${o.type}`, o.at.x, o.at.y - (o.radius ?? 2.5) - 1, c, px);
    });
  }

  private ring(x: number, y: number, r: number, color: string, lw: number, sel: boolean, dashed = false): void {
    const g = this.g;
    g.strokeStyle = sel ? '#0a84ff' : color;
    g.lineWidth = sel ? lw * 1.8 : lw;
    if (dashed) g.setLineDash([lw * 3, lw * 2]);
    g.beginPath();
    g.arc(x, y, r, 0, Math.PI * 2);
    g.stroke();
    g.setLineDash([]);
  }

  private label(text: string, x: number, y: number, color: string, px: number): void {
    if (this.scale < 1.5) return;
    const g = this.g;
    g.font = `600 ${10 * px}px -apple-system, sans-serif`;
    const w = g.measureText(text).width;
    g.fillStyle = 'rgba(10,10,14,0.75)';
    g.fillRect(x - w / 2 - 3 * px, y - 10 * px, w + 6 * px, 13 * px);
    g.fillStyle = color;
    g.fillText(text, x - w / 2, y);
  }

  /** Topmost thing under a cell position, for the select tool. */
  pick(p: Vec2): Selection {
    const doc = this.doc!;
    const tol = Math.max(0.8, 6 / this.scale);
    const city = this.city;
    const sel = this.selection;
    if (sel && 'id' in sel) {
      const sp = doc.spawns.find((s) => s.id === sel.id);
      const i = sp?.patrol?.findIndex((w) => Math.hypot(w.x - p.x, w.y - p.y) < tol) ?? -1;
      if (sp && i >= 0) return { t: 'waypoint', id: sp.id, i };
    }
    if (Math.hypot(city.spawn.x - p.x, city.spawn.y - p.y) < tol * 1.4) return { t: 'marker', m: 'spawn' };
    let best: SpawnDef | null = null;
    let bestD = tol;
    for (const s of doc.spawns) {
      const d = Math.hypot(s.x - p.x, s.y - p.y);
      if (d < bestD) [best, bestD] = [s, d];
    }
    if (best) return { t: 'spawn', id: best.id };
    if (Math.abs(Math.hypot(city.extraction.x - p.x, city.extraction.y - p.y) - 4.5) < tol || Math.hypot(city.extraction.x - p.x, city.extraction.y - p.y) < tol) return { t: 'marker', m: 'extraction' };
    if (Math.hypot(city.escape.x - p.x, city.escape.y - p.y) < 2.2 + tol * 0.5) return { t: 'marker', m: 'escape' };
    const props = this.props();
    for (let i = props.length - 1; i >= 0; i--) {
      const q = props[i];
      if (p.x >= q.x - 0.3 && p.y >= q.y - 0.3 && p.x <= q.x + Math.max(1, q.w ?? 1) + 0.3 && p.y <= q.y + Math.max(1, q.h ?? 1) + 0.3) return { t: 'prop', i };
    }
    const bs = this.buildings();
    for (let i = bs.length - 1; i >= 0; i--) {
      const b = bs[i];
      if (p.x >= b.x && p.y >= b.y && p.x <= b.x + b.w && p.y <= b.y + b.h) return { t: 'building', i };
    }
    return null;
  }

  /** True when p is on the selected building's resize handle. */
  onHandle(p: Vec2): boolean {
    if (this.selection?.t !== 'building') return false;
    const b = this.buildings()[this.selection.i];
    const tol = Math.max(0.6, 7 / this.scale);
    return !!b && Math.abs(p.x - (b.x + b.w)) < tol && Math.abs(p.y - (b.y + b.h)) < tol;
  }
}
