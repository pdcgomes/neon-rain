import type { StyleId } from '../kits/types.ts';
import type { LightPreset } from '../stage.ts';
import { VIEW_LABELS, type ViewPreset } from '../viewport.ts';

export interface ToolbarHandlers {
  style(s: StyleId): void;
  light(l: LightPreset): void;
  view(v: ViewPreset): void;
  frame(): void;
  toggleInspector(): void;
}

function seg<T extends string>(label: string, options: [T, string][], onPick: (v: T) => void): { el: HTMLElement; set(v: T): void; enable(on: boolean): void } {
  const wrap = document.createElement('div');
  wrap.className = 'tb-group';
  wrap.title = label;
  const s = document.createElement('div');
  s.className = 'seg';
  const buttons = options.map(([v, text]) => {
    const b = document.createElement('button');
    b.textContent = text;
    b.dataset.v = v;
    b.addEventListener('click', () => onPick(v));
    s.appendChild(b);
    return b;
  });
  wrap.appendChild(s);
  return {
    el: wrap,
    set(v: T) {
      for (const b of buttons) b.classList.toggle('on', b.dataset.v === v);
    },
    enable(on: boolean) {
      wrap.style.opacity = on ? '1' : '0.4';
      wrap.style.pointerEvents = on ? '' : 'none';
    },
  };
}

export class Toolbar {
  private title: HTMLElement;
  private styleSeg;
  private lightSeg;
  private viewSeg;

  constructor(root: HTMLElement, h: ToolbarHandlers) {
    root.innerHTML = '';
    this.title = document.createElement('div');
    this.title.className = 'tb-title';
    root.appendChild(this.title);
    this.styleSeg = seg<StyleId>('Style', [['baseline', 'Base'], ['lowpoly', 'A  Low-poly'], ['voxel', 'C  Voxel'], ['imported', 'Imported']], h.style);
    this.lightSeg = seg<LightPreset>('Light', [['neon', 'Neon'], ['dusk', 'Dusk'], ['studio', 'Studio']], h.light);
    this.viewSeg = seg<ViewPreset>('View', (Object.keys(VIEW_LABELS) as ViewPreset[]).map((v) => [v, VIEW_LABELS[v]]), h.view);
    root.append(this.styleSeg.el, this.lightSeg.el, this.viewSeg.el);
    const spacer = document.createElement('div');
    spacer.className = 'tb-spacer';
    root.appendChild(spacer);
    const frame = document.createElement('button');
    frame.className = 'tb-btn';
    frame.textContent = 'Frame';
    frame.title = 'Frame selection or board (F)';
    frame.addEventListener('click', h.frame);
    const insp = document.createElement('button');
    insp.className = 'tb-btn';
    insp.textContent = 'Inspector';
    insp.title = 'Toggle inspector (I)';
    insp.addEventListener('click', h.toggleInspector);
    root.append(frame, insp);
  }

  set(state: { style: StyleId; light: LightPreset; view: ViewPreset }, board: { title: string; section: string; styled: boolean }): void {
    this.title.innerHTML = `<b>${board.title}</b><span>${board.section}</span>`;
    this.styleSeg.set(state.style);
    this.styleSeg.enable(board.styled);
    this.lightSeg.set(state.light);
    this.viewSeg.set(state.view);
  }
}
