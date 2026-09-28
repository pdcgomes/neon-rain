import { weapons } from '../../../content/data.ts';
import type { ObjectiveDef, ObjectiveType, SpawnDef, SpawnKind } from '../../../sim/content.ts';
import { GROUND_ALLEY, GROUND_PLAZA, GROUND_ROAD, GROUND_SIDEWALK, type PropKind } from '../../../sim/map.ts';
import type { Vec2 } from '../../../sim/types.ts';
import { icon } from '../../boards/layout.ts';
import type { Stage } from '../../stage.ts';
import { GROUND_COLORS, GROUND_NAMES, MapView, SPAWN_COLORS, type Layers, type Selection } from './canvas2d.ts';
import type { MissionDoc } from './doc.ts';
import { bakePopulation } from './population.ts';
import { Preview3D } from './preview3d.ts';
import { validate, type Issue } from './validate.ts';

type ToolId = 'select' | 'paint' | 'building' | 'prop' | 'entity' | 'marker' | 'route';

const TOOLS: { id: ToolId; title: string; icon: string; key: string; hint: string }[] = [
  { id: 'select', title: 'Select', icon: 'cursor', key: 'V', hint: 'Click to select, drag to move. Drag a building’s corner handle to resize. Delete removes.' },
  { id: 'paint', title: 'Ground', icon: 'brush', key: 'B', hint: 'Paint ground or obstacles. Shift-drag fills a rectangle.' },
  { id: 'building', title: 'Building', icon: 'building', key: 'G', hint: 'Drag out a rectangle to add a building.' },
  { id: 'prop', title: 'Prop', icon: 'tree', key: 'P', hint: 'Click to place a prop.' },
  { id: 'entity', title: 'Unit', icon: 'person', key: 'E', hint: 'Click to place a unit.' },
  { id: 'marker', title: 'Marker', icon: 'pin', key: 'M', hint: 'Click to move the squad spawn, extraction VTOL or escape point.' },
  { id: 'route', title: 'Route', icon: 'route', key: 'W', hint: 'Select a unit, then click to add patrol waypoints. Enter or Esc finishes.' },
];

type Paint = number | 'block' | 'unblock';
const PAINTS: { v: Paint; label: string; color: string }[] = [
  { v: GROUND_ROAD, label: GROUND_NAMES[GROUND_ROAD], color: GROUND_COLORS[GROUND_ROAD] },
  { v: GROUND_SIDEWALK, label: GROUND_NAMES[GROUND_SIDEWALK], color: GROUND_COLORS[GROUND_SIDEWALK] },
  { v: GROUND_PLAZA, label: GROUND_NAMES[GROUND_PLAZA], color: GROUND_COLORS[GROUND_PLAZA] },
  { v: GROUND_ALLEY, label: GROUND_NAMES[GROUND_ALLEY], color: GROUND_COLORS[GROUND_ALLEY] },
  { v: 'block', label: 'Obstacle', color: '#96283a' },
  { v: 'unblock', label: 'Clear obstacle', color: '#9aa0b0' },
];
const PROP_KINDS: PropKind[] = ['car', 'tree', 'lamp', 'bench', 'planter', 'vending'];
const SPAWN_KINDS: SpawnKind[] = ['civilian', 'police', 'enforcer', 'rival', 'heavy', 'guard', 'target'];
const OBJECTIVE_TYPES: ObjectiveType[] = ['eliminate', 'persuade', 'protect', 'extract', 'reach', 'sweep'];
const PROP_SIZE: Partial<Record<PropKind, [number, number]>> = { car: [2, 4] };

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

interface Picking {
  kind: 'target' | 'point';
  objective: number;
}

export interface EditorHost {
  save(): Promise<void>;
  playtest(): Promise<void>;
  status(text: string, tone?: 'ok' | 'warn' | 'bad'): void;
}

/** The mission editor: tool palette on the left, 2D map (or 3D preview) in the middle, panels on the right. */
export class Editor {
  readonly root: HTMLElement;
  private doc: MissionDoc;
  private view = new MapView();
  private preview: Preview3D;
  private host: EditorHost;
  private tool: ToolId = 'select';
  private paint: Paint = GROUND_SIDEWALK;
  private brush = 3;
  private buildingHeight = 8;
  private propKind: PropKind = 'car';
  private spawnKind: SpawnKind = 'guard';
  private marker: 'spawn' | 'extraction' | 'escape' = 'spawn';
  private mode3d = false;
  private picking: Picking | null = null;
  private issues: Issue[] = [];
  private raf = 0;
  private unsub: () => void;
  private el: Record<string, HTMLElement> = {};
  private panelLock = false;
  private spaceDown = false;

  constructor(doc: MissionDoc, stage: Stage, host: EditorHost) {
    this.doc = doc;
    this.host = host;
    this.preview = new Preview3D(stage);
    this.root = document.createElement('div');
    this.root.className = 'me';
    this.root.innerHTML = `
      <aside class="me-left">
        <div class="me-h">TOOLS</div>
        <div class="me-tools"></div>
        <div class="me-h">OPTIONS</div>
        <div class="me-opts"></div>
        <div class="me-h">LAYERS</div>
        <div class="me-layers"></div>
      </aside>
      <main class="me-center">
        <div class="me-view2d"></div>
        <div class="me-view3d"></div>
        <div class="me-banner"></div>
        <div class="me-status"></div>
      </main>
      <aside class="me-right"></aside>`;
    for (const k of ['tools', 'opts', 'layers', 'view2d', 'view3d', 'banner', 'status', 'right']) this.el[k] = this.root.querySelector(`.me-${k}`)!;
    this.el.view2d.appendChild(this.view.canvas);
    this.view.setDoc(doc);
    this.unsub = doc.on((k) => this.onChange(k));
    this.renderTools();
    this.renderOptions();
    this.renderLayers();
    this.bindCanvas();
    this.runValidation();
    this.renderPanels();
    this.renderBanner();
    new ResizeObserver(() => {
      this.view.resize();
      this.preview.resize();
    }).observe(this.el.view2d);
  }

  start(): void {
    this.view.resize();
    this.view.fit();
    const loop = () => {
      this.raf = requestAnimationFrame(loop);
      this.view.draw();
    };
    this.raf = requestAnimationFrame(loop);
    if (this.mode3d) this.preview.show(this.el.view3d, this.doc);
  }

  stop(): void {
    cancelAnimationFrame(this.raf);
    this.preview.hide();
  }

  dispose(): void {
    this.stop();
    this.unsub();
    this.root.remove();
  }

  get is3d(): boolean {
    return this.mode3d;
  }

  set3d(on: boolean): void {
    this.mode3d = on;
    this.root.classList.toggle('mode3d', on);
    if (on) this.preview.show(this.el.view3d, this.doc);
    else this.preview.hide();
  }

  // ---------------------------------------------------------------- change handling

  private onChange(k: string): void {
    if (k === 'selection') {
      this.view.invalidate();
      this.renderPanels();
      return;
    }
    this.view.invalidate(k === 'map' || k === 'all');
    if (k === 'all') this.view.setDoc(this.doc);
    if (k !== 'map') this.runValidation();
    if (!this.panelLock) this.renderPanels();
    this.renderBanner();
    if (this.mode3d && (k === 'map' || k === 'all' || k === 'entities')) this.preview.rebuild(this.doc);
  }

  private runValidation(): void {
    try {
      this.issues = validate(this.doc);
    } catch (e) {
      this.issues = [{ level: 'error', text: `Validation failed: ${(e as Error).message}` }];
    }
    this.view.issues = this.issues;
    this.view.invalidate();
  }

  private select(sel: Selection): void {
    this.view.selection = sel;
    this.doc.emit('selection');
  }

  // ---------------------------------------------------------------- left column

  private renderTools(): void {
    this.el.tools.innerHTML = TOOLS.map(
      (t) => `<button class="me-tool${t.id === this.tool ? ' on' : ''}" data-t="${t.id}" title="${t.title} (${t.key})">${icon(t.icon)}<span>${t.title}</span><kbd>${t.key}</kbd></button>`,
    ).join('');
    this.el.tools.querySelectorAll<HTMLElement>('.me-tool').forEach((b) => b.addEventListener('click', () => this.setTool(b.dataset.t as ToolId)));
  }

  setTool(t: ToolId): void {
    this.tool = t;
    this.picking = null;
    this.renderTools();
    this.renderOptions();
    this.view.overlay = {};
    this.view.invalidate();
    const hint = TOOLS.find((x) => x.id === t)!.hint;
    this.host.status(hint);
  }

  private renderOptions(): void {
    const o = this.el.opts;
    const locked = this.doc.procedural && ['paint', 'building', 'prop', 'marker'].includes(this.tool);
    if (locked) {
      o.innerHTML = `<div class="note">This mission uses the procedural city. Bake it into a layout to edit the map.</div><button class="btn-wide" data-a="bake">Bake city into layout</button>`;
      o.querySelector('[data-a=bake]')!.addEventListener('click', () => this.doc.bake());
      return;
    }
    switch (this.tool) {
      case 'paint':
        o.innerHTML = `<div class="me-swatches">${PAINTS.map(
          (p) => `<button class="me-sw${p.v === this.paint ? ' on' : ''}" data-v="${p.v}"><i style="background:${p.color}"></i>${p.label}</button>`,
        ).join('')}</div>
          <label class="me-row">Brush <input type="range" min="1" max="12" value="${this.brush}" data-k="brush"><b>${this.brush}</b></label>`;
        o.querySelectorAll<HTMLElement>('.me-sw').forEach((b) =>
          b.addEventListener('click', () => {
            const v = b.dataset.v!;
            this.paint = v === 'block' || v === 'unblock' ? v : Number(v);
            this.renderOptions();
          }),
        );
        o.querySelector<HTMLInputElement>('[data-k=brush]')!.addEventListener('input', (e) => {
          this.brush = Number((e.target as HTMLInputElement).value);
          o.querySelector('b')!.textContent = String(this.brush);
        });
        break;
      case 'building':
        o.innerHTML = `<label class="me-row">Height <input type="number" class="num" min="1" max="80" value="${this.buildingHeight}" data-k="h"> m</label>`;
        o.querySelector<HTMLInputElement>('[data-k=h]')!.addEventListener('change', (e) => (this.buildingHeight = Number((e.target as HTMLInputElement).value) || 8));
        break;
      case 'prop':
        o.innerHTML = `<div class="me-swatches">${PROP_KINDS.map((k) => `<button class="me-sw${k === this.propKind ? ' on' : ''}" data-v="${k}">${k}</button>`).join('')}</div>`;
        o.querySelectorAll<HTMLElement>('.me-sw').forEach((b) =>
          b.addEventListener('click', () => {
            this.propKind = b.dataset.v as PropKind;
            this.renderOptions();
          }),
        );
        break;
      case 'entity':
        o.innerHTML = `<div class="me-swatches">${SPAWN_KINDS.map(
          (k) => `<button class="me-sw${k === this.spawnKind ? ' on' : ''}" data-v="${k}"><i style="background:${SPAWN_COLORS[k]}"></i>${k}</button>`,
        ).join('')}</div>`;
        o.querySelectorAll<HTMLElement>('.me-sw').forEach((b) =>
          b.addEventListener('click', () => {
            this.spawnKind = b.dataset.v as SpawnKind;
            this.renderOptions();
          }),
        );
        break;
      case 'marker':
        o.innerHTML = `<div class="me-swatches">${(['spawn', 'extraction', 'escape'] as const)
          .map((k) => `<button class="me-sw${k === this.marker ? ' on' : ''}" data-v="${k}">${{ spawn: 'Squad spawn', extraction: 'Extraction VTOL', escape: 'Escape point' }[k]}</button>`)
          .join('')}</div>`;
        o.querySelectorAll<HTMLElement>('.me-sw').forEach((b) =>
          b.addEventListener('click', () => {
            this.marker = b.dataset.v as typeof this.marker;
            this.renderOptions();
          }),
        );
        break;
      case 'route':
        o.innerHTML = `<div class="note">Waypoints are added to the selected unit's patrol. Armed units loop it; civilians walk it once.</div><button class="btn-wide ghost" data-a="clear">Clear selected route</button>`;
        o.querySelector('[data-a=clear]')!.addEventListener('click', () => {
          const sp = this.selectedSpawn();
          if (sp) this.doc.edit('entities', () => delete sp.patrol);
        });
        break;
      default:
        o.innerHTML = `<div class="note">${TOOLS[0].hint}</div>`;
    }
  }

  private renderLayers(): void {
    const names: [keyof Layers, string][] = [
      ['ground', 'Ground'],
      ['buildings', 'Buildings'],
      ['props', 'Props'],
      ['entities', 'Units'],
      ['routes', 'Routes'],
      ['markers', 'Markers & objectives'],
      ['issues', 'Validation'],
      ['grid', 'Grid'],
      ['reference', 'Original tiles'],
    ];
    const hasRef = !!this.doc.layout?.source?.classes;
    this.el.layers.innerHTML = names
      .filter(([k]) => k !== 'reference' || hasRef)
      .map(([k, n]) => `<label class="chk"><input type="checkbox" data-k="${k}"${this.view.layers[k] ? ' checked' : ''}>${n}</label>`)
      .join('');
    this.el.layers.querySelectorAll<HTMLInputElement>('input').forEach((i) =>
      i.addEventListener('change', () => {
        this.view.layers[i.dataset.k as keyof Layers] = i.checked;
        this.view.invalidate();
      }),
    );
  }

  private renderBanner(): void {
    const errors = this.issues.filter((i) => i.level === 'error').length;
    const warns = this.issues.filter((i) => i.level === 'warn').length;
    const l = this.doc.city();
    this.el.banner.innerHTML = `<b>${esc(this.doc.mission.codename)}</b> <span>${esc(this.doc.id)} · ${this.doc.source} · ${l.w}×${l.h} m · ${this.doc.procedural ? 'procedural city' : 'authored layout'}</span>
      <span class="me-badges">${errors ? `<i class="bad">${errors} error${errors > 1 ? 's' : ''}</i>` : ''}${warns ? `<i class="warn">${warns} warning${warns > 1 ? 's' : ''}</i>` : ''}${this.doc.dirty ? '<i>unsaved</i>' : ''}</span>`;
  }

  // ---------------------------------------------------------------- canvas interaction

  private bindCanvas(): void {
    const cv = this.view.canvas;
    let drag: null | { kind: 'pan' | 'paint' | 'rect' | 'move' | 'resize' | 'building'; start: Vec2; last: Vec2; px: Vec2; orig?: Vec2 } = null;
    const cellAt = (e: PointerEvent | WheelEvent | MouseEvent) => {
      const r = cv.getBoundingClientRect();
      return this.view.toCell(e.clientX - r.left, e.clientY - r.top);
    };
    cv.addEventListener('contextmenu', (e) => e.preventDefault());
    cv.addEventListener('wheel', (e) => {
      e.preventDefault();
      const r = cv.getBoundingClientRect();
      if (e.ctrlKey || !e.shiftKey) this.view.zoomAt(e.clientX - r.left, e.clientY - r.top, Math.pow(1.0015, -e.deltaY));
      else this.view.pan(-e.deltaX, -e.deltaY);
    }, { passive: false });
    cv.addEventListener('pointerdown', (e) => {
      try {
        cv.setPointerCapture(e.pointerId);
      } catch {
        /* synthetic events (tests) have no capturable pointer */
      }
      const p = cellAt(e);
      const px = { x: e.clientX, y: e.clientY };
      if (e.button === 1 || e.button === 2 || this.spaceDown) {
        drag = { kind: 'pan', start: p, last: p, px };
        return;
      }
      if (this.picking) {
        this.finishPick(p);
        return;
      }
      const d = this.doc;
      const editableMap = !!d.layout;
      switch (this.tool) {
        case 'select': {
          if (this.view.onHandle(p)) {
            d.beginStroke();
            drag = { kind: 'resize', start: p, last: p, px };
            return;
          }
          const hit = this.view.pick(p);
          this.select(hit);
          const movable = hit && (hit.t === 'spawn' || hit.t === 'waypoint' || editableMap);
          const at = movable ? this.selectionPoint() : null;
          if (at) {
            d.beginStroke();
            drag = { kind: 'move', start: p, last: p, px, orig: { x: at.x, y: at.y } };
          }
          return;
        }
        case 'paint':
          if (!editableMap) return;
          d.beginStroke();
          if (e.shiftKey) drag = { kind: 'rect', start: p, last: p, px };
          else {
            drag = { kind: 'paint', start: p, last: p, px };
            this.stamp(p, p);
          }
          return;
        case 'building':
          if (!editableMap) return;
          drag = { kind: 'building', start: p, last: p, px };
          return;
        case 'prop':
          if (!editableMap) return;
          d.edit('map', () => {
            const [w, h] = PROP_SIZE[this.propKind] ?? [1, 1];
            d.layout!.props.push({ kind: this.propKind, x: Math.floor(p.x - w / 2 + 0.5), y: Math.floor(p.y - h / 2 + 0.5), w, h });
          });
          return;
        case 'entity': {
          const id = d.nextSpawnId(this.spawnKind === 'target' ? 'target' : this.spawnKind.slice(0, 3));
          const s: SpawnDef = { id, kind: this.spawnKind, x: Math.round(p.x * 2) / 2, y: Math.round(p.y * 2) / 2 };
          if (this.spawnKind === 'guard' || this.spawnKind === 'heavy') s.holds = true;
          d.edit('entities', () => d.spawns.push(s));
          this.select({ t: 'spawn', id });
          return;
        }
        case 'marker':
          if (!editableMap) return;
          d.edit('map', () => {
            const at = { x: Math.round(p.x * 2) / 2, y: Math.round(p.y * 2) / 2 };
            if (this.marker === 'spawn') d.layout!.spawn = at;
            else if (this.marker === 'extraction') d.layout!.extraction = at;
            else d.layout!.escape = at;
          });
          return;
        case 'route': {
          const sp = this.selectedSpawn();
          if (!sp) {
            const hit = this.view.pick(p);
            if (hit?.t === 'spawn') this.select(hit);
            else this.host.status('Select a unit first, then click to add waypoints.', 'warn');
            return;
          }
          d.edit('entities', () => {
            (sp.patrol ??= []).push({ x: Math.round(p.x * 2) / 2, y: Math.round(p.y * 2) / 2 });
            delete sp.holds;
          });
          return;
        }
      }
    });
    cv.addEventListener('pointermove', (e) => {
      const p = cellAt(e);
      this.el.status.dataset.pos = `${p.x.toFixed(1)}, ${p.y.toFixed(1)}`;
      this.updateCursor(p, e.shiftKey);
      if (!drag) return;
      const d = this.doc;
      switch (drag.kind) {
        case 'pan':
          this.view.pan(e.clientX - drag.px.x, e.clientY - drag.px.y);
          drag.px = { x: e.clientX, y: e.clientY };
          break;
        case 'paint':
          this.stamp(drag.last, p);
          break;
        case 'rect':
        case 'building': {
          const r = this.rectOf(drag.start, p);
          const color = drag.kind === 'building' ? '#6a70c8' : (PAINTS.find((x) => x.v === this.paint)?.color ?? '#fff');
          this.view.overlay.brush = { ...r, color };
          this.view.invalidate();
          break;
        }
        case 'move':
          this.moveSelection(drag.orig!, p.x - drag.start.x, p.y - drag.start.y);
          d.emit(this.view.selection?.t === 'building' || this.view.selection?.t === 'prop' || this.view.selection?.t === 'marker' ? 'map' : 'entities');
          break;
        case 'resize': {
          const sel = this.view.selection;
          if (sel?.t === 'building') {
            const b = d.layout!.buildings[sel.i];
            b.w = Math.max(1, Math.round(p.x) - b.x);
            b.h = Math.max(1, Math.round(p.y) - b.y);
            d.emit('map');
          }
          break;
        }
      }
      drag.last = p;
    });
    cv.addEventListener('pointerup', (e) => {
      if (!drag) return;
      const p = cellAt(e);
      const d = this.doc;
      if (drag.kind === 'rect') {
        const r = this.rectOf(drag.start, p);
        this.fillRect(r.x, r.y, r.w, r.h);
        d.emit('map');
      } else if (drag.kind === 'building') {
        const r = this.rectOf(drag.start, p);
        if (r.w >= 1 && r.h >= 1) {
          d.edit('map', () => d.layout!.buildings.push({ ...r, height: this.buildingHeight }));
          this.select({ t: 'building', i: d.layout!.buildings.length - 1 });
        }
      } else if (drag.kind === 'move' || drag.kind === 'paint' || drag.kind === 'resize') {
        this.runValidation();
        this.renderPanels();
        this.renderBanner();
      }
      this.view.overlay.brush = undefined;
      this.view.invalidate();
      drag = null;
    });
    cv.addEventListener('dblclick', () => this.view.fit());
  }

  private updateCursor(p: Vec2, shift: boolean): void {
    if (this.tool === 'paint' && this.doc.layout && !shift) {
      const r = this.brush;
      const color = PAINTS.find((x) => x.v === this.paint)?.color ?? '#fff';
      this.view.overlay.brush = { x: Math.floor(p.x - r / 2 + 0.5), y: Math.floor(p.y - r / 2 + 0.5), w: r, h: r, color };
      this.view.invalidate();
    } else if (this.tool === 'route' && this.selectedSpawn()) {
      this.view.overlay.hover = p;
      this.view.invalidate();
    } else if (this.view.overlay.hover) {
      this.view.overlay.hover = undefined;
      this.view.invalidate();
    }
    this.view.canvas.style.cursor = this.spaceDown ? 'grab' : this.tool === 'select' && this.view.onHandle(p) ? 'nwse-resize' : this.tool === 'select' ? 'default' : 'crosshair';
  }

  private rectOf(a: Vec2, b: Vec2): { x: number; y: number; w: number; h: number } {
    const x = Math.floor(Math.min(a.x, b.x));
    const y = Math.floor(Math.min(a.y, b.y));
    return { x, y, w: Math.max(1, Math.ceil(Math.max(a.x, b.x)) - x), h: Math.max(1, Math.ceil(Math.max(a.y, b.y)) - y) };
  }

  private fillRect(x0: number, y0: number, w: number, h: number): void {
    const l = this.doc.layout!;
    for (let y = Math.max(0, y0); y < Math.min(l.h, y0 + h); y++)
      for (let x = Math.max(0, x0); x < Math.min(l.w, x0 + w); x++) {
        const i = y * l.w + x;
        if (this.paint === 'block') l.blocked[i] = 1;
        else if (this.paint === 'unblock') l.blocked[i] = 0;
        else l.ground[i] = this.paint;
      }
  }

  /** Paints the brush along the segment a→b. */
  private stamp(a: Vec2, b: Vec2): void {
    const r = this.brush;
    const steps = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / Math.max(0.5, r / 3)));
    for (let s = 0; s <= steps; s++) {
      const x = a.x + ((b.x - a.x) * s) / steps;
      const y = a.y + ((b.y - a.y) * s) / steps;
      this.fillRect(Math.floor(x - r / 2 + 0.5), Math.floor(y - r / 2 + 0.5), r, r);
    }
    this.doc.emit('map');
  }

  private selectedSpawn(): SpawnDef | undefined {
    const s = this.view.selection;
    return s && 'id' in s ? this.doc.spawns.find((x) => x.id === s.id) : undefined;
  }

  /** The selected item's position object (mutated in place while dragging). */
  private selectionPoint(): Vec2 | null {
    const s = this.view.selection;
    const d = this.doc;
    if (!s) return null;
    if (s.t === 'spawn') return d.spawns.find((x) => x.id === s.id) ?? null;
    if (s.t === 'waypoint') return d.spawns.find((x) => x.id === s.id)?.patrol?.[s.i] ?? null;
    if (!d.layout) return null;
    if (s.t === 'marker') return s.m === 'spawn' ? d.layout.spawn : s.m === 'extraction' ? d.layout.extraction : (d.layout.escape ??= { ...d.city().escape });
    if (s.t === 'building') return d.layout.buildings[s.i] ?? null;
    return d.layout.props[s.i] ?? null;
  }

  /** Places the selection at its drag-start position plus the total drag offset (buildings and props snap to cells). */
  private moveSelection(orig: Vec2, dx: number, dy: number): void {
    const p = this.selectionPoint();
    const s = this.view.selection;
    if (!p || !s) return;
    const snap = s.t === 'building' || s.t === 'prop';
    p.x = snap ? Math.round(orig.x + dx) : Math.round((orig.x + dx) * 10) / 10;
    p.y = snap ? Math.round(orig.y + dy) : Math.round((orig.y + dy) * 10) / 10;
  }

  deleteSelection(): void {
    const s = this.view.selection;
    const d = this.doc;
    if (!s) return;
    if (s.t === 'spawn')
      d.edit('entities', () => {
        d.mission.spawns = d.spawns.filter((x) => x.id !== s.id);
        for (const o of d.mission.objectives) if (o.targets) o.targets = o.targets.filter((t) => t !== s.id);
      });
    else if (s.t === 'waypoint') d.edit('entities', () => d.spawns.find((x) => x.id === s.id)?.patrol?.splice(s.i, 1));
    else if (s.t === 'building' && d.layout) d.edit('map', () => d.layout!.buildings.splice(s.i, 1));
    else if (s.t === 'prop' && d.layout) d.edit('map', () => d.layout!.props.splice(s.i, 1));
    this.select(null);
  }

  private finishPick(p: Vec2): void {
    const pk = this.picking!;
    const d = this.doc;
    const o = d.mission.objectives[pk.objective];
    this.picking = null;
    this.root.classList.remove('picking');
    if (!o) return;
    if (pk.kind === 'point') d.edit('meta', () => (o.at = { x: Math.round(p.x * 2) / 2, y: Math.round(p.y * 2) / 2 }));
    else {
      const hit = this.view.pick(p);
      if (hit?.t !== 'spawn') return this.host.status('That is not a unit. Pick cancelled.', 'warn');
      d.edit('meta', () => {
        o.targets = [...new Set([...(o.targets ?? []), hit.id])];
      });
    }
    this.host.status('Objective updated.', 'ok');
  }

  // ---------------------------------------------------------------- keyboard

  onKey(e: KeyboardEvent): void {
    const tag = (e.target as HTMLElement).tagName;
    if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
    const mod = e.metaKey || e.ctrlKey;
    if (mod && e.code === 'KeyZ') {
      e.preventDefault();
      if (e.shiftKey) this.doc.redo();
      else this.doc.undo();
      return;
    }
    if (mod && e.code === 'KeyS') {
      e.preventDefault();
      void this.host.save();
      return;
    }
    if (mod) return;
    if (e.code === 'Space') {
      e.preventDefault();
      this.spaceDown = e.type === 'keydown';
      return;
    }
    const t = TOOLS.find((x) => `Key${x.key}` === e.code);
    if (t) return this.setTool(t.id);
    if (e.code === 'Delete' || e.code === 'Backspace') this.deleteSelection();
    else if (e.code === 'Escape' || e.code === 'Enter') {
      if (this.picking) {
        this.picking = null;
        this.root.classList.remove('picking');
      } else if (this.tool === 'route') this.setTool('select');
      else this.select(null);
    } else if (e.code === 'KeyF') this.view.fit();
    else if (e.code === 'KeyT') this.set3d(!this.mode3d);
  }

  onKeyUp(e: KeyboardEvent): void {
    if (e.code === 'Space') this.spaceDown = false;
  }

  // ---------------------------------------------------------------- right panels

  private renderPanels(): void {
    const d = this.doc;
    const m = d.mission;
    const sel = this.view.selection;
    const spawnOpts = (cur: string[] = []) => d.spawns.map((s) => `<option value="${s.id}"${cur.includes(s.id) ? ' selected' : ''}>${s.id} · ${s.kind}${s.name ? ` · ${esc(s.name)}` : ''}</option>`).join('');
    const selHtml = this.selectionHtml(sel);
    const objectives = m.objectives
      .map(
        (o, i) => `<div class="me-obj" data-i="${i}">
          <div class="me-obj-head"><b>${i + 1}</b>
            <select data-f="type">${OBJECTIVE_TYPES.map((t) => `<option${t === o.type ? ' selected' : ''}>${t}</option>`).join('')}</select>
            <button class="me-x" data-a="up" title="Move up">↑</button><button class="me-x" data-a="del" title="Remove">×</button></div>
          <input class="me-in" data-f="text" value="${esc(o.text)}" placeholder="Shown in the HUD">
          ${['eliminate', 'persuade', 'protect', 'extract'].includes(o.type ?? '') ? `<div class="me-row"><select multiple size="${Math.min(4, Math.max(2, d.spawns.length))}" data-f="targets" class="me-multi">${spawnOpts(o.targets)}</select><button class="me-x" data-a="pick-target" title="Pick a unit on the map">${icon('cursor')}</button></div>` : ''}
          ${['reach', 'extract', 'protect'].includes(o.type ?? '') ? `<div class="me-row"><span class="note">${o.at ? `at ${o.at.x.toFixed(1)}, ${o.at.y.toFixed(1)} · r ${o.radius ?? '—'}` : o.type === 'protect' ? 'no destination (keep alive)' : 'at the extraction VTOL'}</span><button class="me-x" data-a="pick-point" title="Pick a point on the map">${icon('pin')}</button>${o.at ? '<button class="me-x" data-a="clear-point">×</button>' : ''}</div>` : ''}
          ${o.type === 'sweep' ? `<div class="me-row"><label class="chk"><input type="checkbox" data-f="f-enemy"${(o.factions ?? ['enemy']).includes('enemy') ? ' checked' : ''}>enemies</label><label class="chk"><input type="checkbox" data-f="f-police"${o.factions?.includes('police') ? ' checked' : ''}>police</label></div>` : ''}
          ${o.todo ? `<div class="warn-note">${esc(o.todo)}</div>` : ''}
        </div>`,
      )
      .join('');
    const issues = this.issues.map((is, i) => `<div class="me-issue ${is.level}" data-i="${i}">${is.level === 'error' ? '●' : is.level === 'warn' ? '▲' : 'ⓘ'} ${esc(is.text)}</div>`).join('');
    const pop = m.population;
    const params = d.params;
    this.el.right.innerHTML = `
      <details open class="me-sec"><summary>Selection</summary>${selHtml}</details>
      <details open class="me-sec"><summary>Objectives</summary>${objectives}<button class="btn-wide ghost" data-a="add-obj">Add objective</button></details>
      <details class="me-sec" ${this.issues.some((x) => x.level !== 'info') ? 'open' : ''}><summary>Validation</summary>${issues}</details>
      <details class="me-sec"><summary>Mission</summary>
        <div class="me-form">
          <label>Id<input class="me-in" data-m="id" value="${esc(d.id)}"></label>
          <label>Codename<input class="me-in" data-m="codename" value="${esc(m.codename)}"></label>
          <label>City<input class="me-in" data-m="city" value="${esc(m.city)}"></label>
          <label>Target name<input class="me-in" data-m="targetName" value="${esc(m.targetName)}"></label>
          <label>Seed<input class="me-in num" type="number" data-m="seed" value="${m.seed}"></label>
          <label>Hour<input class="me-in num" type="number" min="0" max="24" step="0.5" data-m="hour" value="${m.atmosphere?.hour ?? 22}"></label>
          <label>Police hostile at<input class="me-in num" type="number" data-m="policeHostileAt" value="${m.policeHostileAt}"></label>
          <label>Enforcers at<input class="me-in num" type="number" data-m="enforcersAt" value="${m.enforcersAt}"></label>
          <label>Extra civilians<input class="me-in num" type="number" data-p="civilians" value="${pop.civilians}"></label>
          <label>Extra police<input class="me-in num" type="number" data-p="police" value="${pop.police}"></label>
          ${params ? `<label>Traffic<input class="me-in num" type="number" data-p="traffic" value="${pop.traffic ?? 0}"></label>` : ''}
        </div>
        ${params ? `<div class="me-h">PROCEDURAL CITY</div><div class="me-form">${(['size', 'blockMin', 'blockMax', 'roadWidth', 'sidewalk'] as const).map((k) => `<label>${k}<input class="me-in num" type="number" data-c="${k}" value="${params[k] ?? ''}"></label>`).join('')}<label>openLots<input class="me-in num" type="number" step="0.05" data-c="openLots" value="${params.openLots ?? 0}"></label></div><button class="btn-wide ghost" data-a="bake">Bake city into layout</button>` : ''}
        <button class="btn-wide ghost" data-a="bake-pop">${d.spawns.length ? 'Replace units with procedural placement' : 'Bake procedural units into spawns'}</button>
      </details>
      <details class="me-sec"><summary>Briefing</summary><textarea class="me-brief" rows="12">${esc(m.briefing.join('\n\n'))}</textarea><div class="note">Blank lines separate paragraphs.</div></details>`;
    this.bindPanels();
  }

  private selectionHtml(sel: Selection): string {
    const d = this.doc;
    if (!sel) return `<div class="note">Nothing selected. ${d.spawns.length} units, ${d.layout?.buildings.length ?? d.city().buildings.length} buildings, ${d.layout?.props.length ?? d.city().props.length} props.</div>`;
    if (sel.t === 'spawn' || sel.t === 'waypoint') {
      const s = d.spawns.find((x) => x.id === sel.id);
      if (!s) return '';
      const weaponOpts = Object.keys(weapons).filter((w) => w !== 'grenade').map((w) => `<option${s.weapons?.includes(w) ? ' selected' : ''}>${w}</option>`).join('');
      return `<div class="me-form">
        <label>Id<input class="me-in" data-s="id" value="${esc(s.id)}"></label>
        <label>Kind<select data-s="kind">${SPAWN_KINDS.map((k) => `<option${k === s.kind ? ' selected' : ''}>${k}</option>`).join('')}</select></label>
        <label>Name<input class="me-in" data-s="name" value="${esc(s.name ?? '')}" placeholder="default"></label>
        <label>X<input class="me-in num" type="number" step="0.5" data-s="x" value="${s.x}"></label>
        <label>Y<input class="me-in num" type="number" step="0.5" data-s="y" value="${s.y}"></label>
        <label>HP<input class="me-in num" type="number" data-s="hp" value="${s.hp ?? ''}" placeholder="default"></label>
        <label>Armor<input class="me-in num" type="number" step="0.05" data-s="armor" value="${s.armor ?? ''}" placeholder="default"></label>
        <label>Holds post<input type="checkbox" data-s="holds"${s.holds ? ' checked' : ''}></label>
        <label>Weapons<select multiple size="4" class="me-multi" data-s="weapons">${weaponOpts}</select></label>
      </div><div class="note">${s.patrol?.length ? `Patrol: ${s.patrol.length} waypoints.` : 'No patrol route (use the Route tool).'}</div>
      <button class="btn-wide ghost" data-a="del-sel">Delete unit</button>`;
    }
    if (sel.t === 'building') {
      const b = d.layout?.buildings[sel.i] ?? d.city().buildings[sel.i];
      if (!b) return '';
      const ro = d.layout ? '' : ' disabled';
      return `<div class="me-form">${(['x', 'y', 'w', 'h', 'height'] as const).map((k) => `<label>${k === 'height' ? 'Height (m)' : k.toUpperCase()}<input class="me-in num" type="number" data-b="${k}" value="${b[k]}"${ro}></label>`).join('')}</div>${d.layout ? '<button class="btn-wide ghost" data-a="del-sel">Delete building</button>' : ''}`;
    }
    if (sel.t === 'prop') {
      const p = d.layout?.props[sel.i] ?? d.city().props[sel.i];
      return p ? `<div class="note">${p.kind} at ${p.x}, ${p.y}</div>${d.layout ? '<button class="btn-wide ghost" data-a="del-sel">Delete prop</button>' : ''}` : '';
    }
    if (sel.t === 'marker') {
      const c = d.city();
      const p = sel.m === 'spawn' ? c.spawn : sel.m === 'extraction' ? c.extraction : c.escape;
      return `<div class="note">${{ spawn: 'Squad spawn', extraction: 'Extraction VTOL', escape: 'Escape point (fleeing targets head here)' }[sel.m]} at ${p.x.toFixed(1)}, ${p.y.toFixed(1)}${d.layout ? '' : ' (set by the procedural city)'}</div>`;
    }
    return '';
  }

  private bindPanels(): void {
    const d = this.doc;
    const r = this.el.right;
    const m = d.mission;
    const quiet = (kind: 'meta' | 'entities' | 'map', fn: () => void) => {
      this.panelLock = true;
      d.edit(kind, fn);
      this.panelLock = false;
    };
    r.querySelectorAll<HTMLElement>('[data-a]').forEach((b) =>
      b.addEventListener('click', () => {
        const a = b.dataset.a!;
        const oi = Number(b.closest<HTMLElement>('.me-obj')?.dataset.i ?? -1);
        if (a === 'add-obj') d.edit('meta', () => m.objectives.push({ id: `o${m.objectives.length + 1}`, type: 'reach', text: 'Reach the objective' }));
        else if (a === 'del') d.edit('meta', () => m.objectives.splice(oi, 1));
        else if (a === 'up' && oi > 0) d.edit('meta', () => m.objectives.splice(oi - 1, 0, ...m.objectives.splice(oi, 1)));
        else if (a === 'pick-target' || a === 'pick-point') {
          this.picking = { kind: a === 'pick-target' ? 'target' : 'point', objective: oi };
          this.root.classList.add('picking');
          this.host.status(a === 'pick-target' ? 'Click a unit on the map to add it as a target (Esc cancels).' : 'Click the map to set the objective point (Esc cancels).');
        } else if (a === 'clear-point') d.edit('meta', () => delete m.objectives[oi].at);
        else if (a === 'bake') d.bake();
        else if (a === 'bake-pop') {
          d.edit('all', () => bakePopulation(d));
          this.host.status(`Placed ${d.spawns.length} units.`, 'ok');
        } else if (a === 'del-sel') this.deleteSelection();
      }),
    );
    r.querySelectorAll<HTMLElement>('.me-obj').forEach((row) => {
      const o: ObjectiveDef = m.objectives[Number(row.dataset.i)];
      row.querySelector<HTMLSelectElement>('[data-f=type]')?.addEventListener('change', (e) => d.edit('meta', () => (o.type = (e.target as HTMLSelectElement).value as ObjectiveType)));
      row.querySelector<HTMLInputElement>('[data-f=text]')?.addEventListener('change', (e) => quiet('meta', () => (o.text = (e.target as HTMLInputElement).value)));
      row.querySelector<HTMLSelectElement>('[data-f=targets]')?.addEventListener('change', (e) =>
        quiet('meta', () => (o.targets = [...(e.target as HTMLSelectElement).selectedOptions].map((x) => x.value))),
      );
      for (const f of ['enemy', 'police'] as const)
        row.querySelector<HTMLInputElement>(`[data-f=f-${f}]`)?.addEventListener('change', (e) =>
          quiet('meta', () => {
            const set = new Set<'enemy' | 'police'>(o.factions ?? ['enemy']);
            if ((e.target as HTMLInputElement).checked) set.add(f);
            else set.delete(f);
            o.factions = [...set];
          }),
        );
    });
    r.querySelectorAll<HTMLElement>('.me-issue').forEach((row) =>
      row.addEventListener('click', () => {
        const at = this.issues[Number(row.dataset.i)]?.at;
        if (at) {
          if (this.view.scale < 4) this.view.scale = 6;
          this.view.centerOn(at);
        }
      }),
    );
    r.querySelectorAll<HTMLInputElement>('[data-m]').forEach((inp) =>
      inp.addEventListener('change', () => {
        const k = inp.dataset.m!;
        const v = inp.value;
        if (k === 'id') {
          const id = v.trim().replace(/[^a-z0-9_-]/gi, '_').slice(0, 64);
          if (id) quiet('meta', () => (d.id = m.id = id));
          this.renderBanner();
          return;
        }
        quiet('meta', () => {
          if (k === 'hour') m.atmosphere = { ...m.atmosphere, hour: Number(v) };
          else if (k === 'seed' || k === 'policeHostileAt' || k === 'enforcersAt') (m as unknown as Record<string, number>)[k] = Number(v);
          else (m as unknown as Record<string, string>)[k] = v;
        });
        if (k === 'seed' && d.procedural) this.view.setDoc(d);
        this.renderBanner();
      }),
    );
    r.querySelectorAll<HTMLInputElement>('[data-p]').forEach((inp) =>
      inp.addEventListener('change', () => quiet('meta', () => ((m.population as unknown as Record<string, number>)[inp.dataset.p!] = Math.max(0, Number(inp.value) || 0)))),
    );
    r.querySelectorAll<HTMLInputElement>('[data-c]').forEach((inp) =>
      inp.addEventListener('change', () => {
        quiet('meta', () => ((m.map as unknown as Record<string, number>)[inp.dataset.c!] = Number(inp.value)));
        this.view.setDoc(d);
      }),
    );
    r.querySelector<HTMLTextAreaElement>('.me-brief')?.addEventListener('change', (e) =>
      quiet('meta', () => (m.briefing = (e.target as HTMLTextAreaElement).value.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean))),
    );
    const sel = this.view.selection;
    if (sel && 'id' in sel) {
      const s = d.spawns.find((x) => x.id === sel.id);
      if (s)
        r.querySelectorAll<HTMLInputElement | HTMLSelectElement>('[data-s]').forEach((inp) =>
          inp.addEventListener('change', () => {
            const k = inp.dataset.s!;
            const v = inp.value;
            quiet('entities', () => {
              if (k === 'id') {
                const id = v.trim().replace(/[^a-z0-9_-]/gi, '_');
                if (!id || d.spawns.some((x) => x.id === id)) return;
                for (const o of m.objectives) if (o.targets) o.targets = o.targets.map((t) => (t === s.id ? id : t));
                s.id = id;
                this.view.selection = { t: 'spawn', id };
              } else if (k === 'kind') s.kind = v as SpawnKind;
              else if (k === 'name') v ? (s.name = v) : delete s.name;
              else if (k === 'holds') (inp as HTMLInputElement).checked ? (s.holds = true) : delete s.holds;
              else if (k === 'weapons') {
                const list = [...(inp as HTMLSelectElement).selectedOptions].map((o) => o.value);
                if (list.length) s.weapons = list;
                else delete s.weapons;
              } else if (k === 'x' || k === 'y') s[k] = Number(v);
              else if (k === 'hp' || k === 'armor') v === '' ? delete s[k] : (s[k] = Number(v));
            });
            this.view.invalidate();
            this.runValidation();
          }),
        );
    }
    if (sel?.t === 'building' && d.layout) {
      const b = d.layout.buildings[sel.i];
      r.querySelectorAll<HTMLInputElement>('[data-b]').forEach((inp) =>
        inp.addEventListener('change', () => {
          quiet('map', () => ((b as unknown as Record<string, number>)[inp.dataset.b!] = Math.max(inp.dataset.b === 'x' || inp.dataset.b === 'y' ? 0 : 1, Number(inp.value))));
        }),
      );
    }
  }
}
