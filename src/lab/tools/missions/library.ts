import type { MissionDef } from '../../../sim/content.ts';
import { decodeGrid } from '../../../sim/grid64.ts';
import { generateCity } from '../../../sim/map.ts';
import { GROUND_COLORS } from './canvas2d.ts';
import { deleteMissionFile, listMissions, loadMissionFile, promoteMission, saveMissionFile, type MissionListing, type MissionSource } from './api.ts';

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const thumbs = new Map<string, string>();

/** Small top-down picture of a mission's map (ground plus buildings). */
function thumbnail(m: MissionDef): string {
  const c = document.createElement('canvas');
  let w: number;
  let h: number;
  let ground: Uint8Array;
  let buildings: { x: number; y: number; w: number; h: number; height: number }[];
  if (m.map.kind === 'authored') {
    const l = m.map.layout;
    w = l.w;
    h = l.h;
    ground = decodeGrid(l.ground, w * h);
    buildings = l.buildings;
  } else {
    const city = generateCity(m.seed, m.map);
    w = city.w;
    h = city.h;
    ground = city.ground;
    buildings = city.buildings;
  }
  c.width = w;
  c.height = h;
  const g = c.getContext('2d')!;
  const img = g.createImageData(w, h);
  const pal = Object.fromEntries(Object.entries(GROUND_COLORS).map(([k, v]) => [k, [1, 3, 5].map((i) => parseInt(v.slice(i, i + 2), 16))]));
  for (let i = 0; i < w * h; i++) img.data.set([...(pal[ground[i]] ?? [0, 0, 0]), 255], i * 4);
  g.putImageData(img, 0, 0);
  for (const b of buildings) {
    const k = Math.min(1, b.height / 30);
    g.fillStyle = `rgb(${50 + k * 80},${54 + k * 86},${90 + k * 130})`;
    g.fillRect(b.x, b.y, b.w, b.h);
  }
  return c.toDataURL();
}

export interface LibraryHandlers {
  open(id: string, source: MissionSource): void;
  playtest(id: string): void;
  status(text: string, tone?: 'ok' | 'warn' | 'bad'): void;
}

/** Grid of every mission the dev server can see: bundled with the game, or local (gitignored). */
export class Library {
  readonly root = document.createElement('div');
  private list: MissionListing[] = [];
  private query = '';
  private h: LibraryHandlers;
  private thumbQueue: HTMLElement[] = [];
  private thumbTimer = 0;

  constructor(h: LibraryHandlers) {
    this.h = h;
    this.root.className = 'ml';
    this.root.innerHTML = `<div class="ml-head"><h2>Missions</h2><input type="search" class="ml-search" placeholder="Filter by id, name or city" spellcheck="false"></div><div class="ml-body"></div>`;
    this.root.querySelector<HTMLInputElement>('.ml-search')!.addEventListener('input', (e) => {
      this.query = (e.target as HTMLInputElement).value.trim().toLowerCase();
      this.render();
    });
  }

  async refresh(): Promise<void> {
    try {
      this.list = await listMissions();
    } catch (e) {
      this.root.querySelector('.ml-body')!.innerHTML = `<div class="note">The mission library needs the dev server (npm run dev). ${esc((e as Error).message)}</div>`;
      return;
    }
    this.render();
  }

  private render(): void {
    const body = this.root.querySelector('.ml-body')!;
    const match = (m: MissionListing) => !this.query || `${m.id} ${m.codename} ${m.city}`.toLowerCase().includes(this.query);
    const groups: [string, MissionListing[]][] = [
      ['Bundled with the game · src/content/missions', this.list.filter((m) => m.source === 'bundled' && match(m))],
      ['Local · content-local/missions (gitignored)', this.list.filter((m) => m.source === 'local' && match(m))],
    ];
    body.innerHTML = groups
      .map(
        ([title, items]) => `<div class="ml-group"><div class="me-h">${title} <span>${items.length}</span></div><div class="ml-grid">${items
          .map(
            (m) => `<div class="ml-card" data-id="${m.id}" data-src="${m.source}">
              <div class="ml-thumb" data-key="${m.source}:${m.id}:${m.mtime}"></div>
              <div class="ml-meta"><b>${esc(m.codename || m.id)}</b><span>${esc(m.id)} · ${m.kind}</span><span class="ml-city">${esc(m.city)}</span>
              <span class="ml-obj">${m.objectives.map((o) => `<i>${esc(o)}</i>`).join('')}</span></div>
              <div class="ml-actions"><button data-a="open" class="tb-btn on">Open</button><button data-a="play" class="tb-btn">Play</button><button data-a="dup" class="tb-btn">Duplicate</button>${m.source === 'local' ? '<button data-a="promote" class="tb-btn" title="Move into src/content/missions (committed)">Promote</button>' : ''}<button data-a="del" class="tb-btn">Delete</button></div>
            </div>`,
          )
          .join('') || '<div class="note">None.</div>'}</div></div>`,
      )
      .join('');
    body.querySelectorAll<HTMLElement>('.ml-card').forEach((card) => {
      const id = card.dataset.id!;
      const src = card.dataset.src as MissionSource;
      card.querySelector('.ml-thumb')!.addEventListener('dblclick', () => this.h.open(id, src));
      card.querySelectorAll<HTMLElement>('[data-a]').forEach((b) =>
        b.addEventListener('click', async () => {
          const a = b.dataset.a;
          try {
            if (a === 'open') this.h.open(id, src);
            else if (a === 'play') this.h.playtest(id);
            else if (a === 'dup') {
              const m = await loadMissionFile(id, src);
              const used = new Set(this.list.map((x) => x.id));
              let n = 2;
              while (used.has(`${id}_${n}`)) n++;
              m.id = `${id}_${n}`;
              await saveMissionFile(m, 'local');
              this.h.status(`Duplicated as ${m.id}.`, 'ok');
              await this.refresh();
            } else if (a === 'promote') {
              if (!confirm(`Move ${id} into src/content/missions? It will then be committed with the game. Only do this for missions that are your own design.`)) return;
              const path = await promoteMission(id);
              this.h.status(`Promoted to ${path}.`, 'ok');
              await this.refresh();
            } else if (a === 'del') {
              if (!confirm(`Delete ${id} (${src})? This removes the file.`)) return;
              await deleteMissionFile(id, src);
              await this.refresh();
            }
          } catch (e) {
            this.h.status((e as Error).message, 'bad');
          }
        }),
      );
    });
    this.thumbQueue = [...body.querySelectorAll<HTMLElement>('.ml-thumb')];
    window.clearTimeout(this.thumbTimer);
    this.pumpThumbs();
  }

  /** Thumbnails render one at a time so a long library doesn't freeze the page. */
  private pumpThumbs(): void {
    const el = this.thumbQueue.shift();
    if (!el) return;
    const key = el.dataset.key!;
    const done = (url: string) => {
      el.style.backgroundImage = `url(${url})`;
      this.thumbTimer = window.setTimeout(() => this.pumpThumbs(), 0);
    };
    if (thumbs.has(key)) return done(thumbs.get(key)!);
    const [src, id] = key.split(':');
    loadMissionFile(id, src as MissionSource)
      .then((m) => {
        const url = thumbnail(m);
        thumbs.set(key, url);
        done(url);
      })
      .catch(() => (this.thumbTimer = window.setTimeout(() => this.pumpThumbs(), 0)));
  }
}
