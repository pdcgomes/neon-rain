import { CELL_NAMES, DEFAULT_CONVERT, type ConvertOptions, type ConvertResult } from '../../../import/syndicate/convert.ts';
import { SyndDataset } from '../../../import/syndicate/dataset.ts';
import { tileAt } from '../../../import/syndicate/mapFile.ts';
import { CELL_COLORS, overlayGame, PED_COLORS, renderConverted, renderOriginal, type OriginalMode, type Raster } from '../../../import/syndicate/raster.ts';
import { defaultTileTable, resolveTileClasses, TILE_CLASS_COLORS, TILE_CLASSES, TYPE_NAMES, type TileClass, type TileTable } from '../../../import/syndicate/tileClasses.ts';
import type { LabTool, ToolContext } from '../../shell/tools.ts';
import { getParam, setParams } from '../../shell/url.ts';
import { hasBackend, listMissions, loadMissionFile, saveMissionFile } from '../missions/api.ts';
import '../missions/missions.css';
import './import.css';
import { cacheDatasets, cachedDatasets, clearCache, fromDevServer, fromDrop, fromFileList, type StoredDataset } from './sources.ts';

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const hex2 = (n: number) => `0x${n.toString(16).padStart(2, '0')}`;
const PX = 6;
type Opts = Omit<ConvertOptions, 'tiles'>;

function loadJson<T>(key: string, fallback: T): T {
  try {
    const v = localStorage.getItem(key);
    return v ? { ...fallback, ...JSON.parse(v) } : fallback;
  } catch {
    return fallback;
  }
}

/** Syndicate importer: load the original data, inspect a mission, tune the conversion, send a draft to Missions. */
class ImportTool implements LabTool {
  private ctx!: ToolContext;
  private root!: HTMLElement;
  private built = false;
  private sets: SyndDataset[] = [];
  private set: SyndDataset | null = null;
  private mission = 0;
  private query = '';
  private mode: OriginalMode = 'class';
  private opts: Opts = loadJson('lab.synd.opts', { ...DEFAULT_CONVERT });
  private tiles: TileTable = loadJson('lab.synd.tiles', defaultTileTable());
  private result: ConvertResult | null = null;
  private selectedTile = -1;
  private el: Record<string, HTMLElement> = {};
  private backend = false;

  async mount(root: HTMLElement, ctx: ToolContext): Promise<void> {
    this.ctx = ctx;
    this.root = root;
    ctx.setSubtitle('Syndicate data');
    if (!this.built) {
      this.build();
      this.built = true;
      this.backend = await hasBackend();
      const cached = await cachedDatasets();
      if (cached.length) this.useSets(cached, 'Loaded from the browser cache.');
      else this.renderEmpty();
    }
    this.renderActions();
  }

  unmount(): void {}

  private build(): void {
    this.root.innerHTML = `
      <div class="im">
        <aside class="im-left">
          <div class="me-h">SOURCE</div>
          <div class="im-src">
            <button class="tb-btn on" data-a="dev" title="Read the files you copied into content-local/ (dev server)">Load from content-local</button>
            <label class="tb-btn im-pick">Choose folder…<input type="file" webkitdirectory multiple hidden></label>
            <button class="tb-btn" data-a="clear" title="Forget the cached copy in this browser">Clear cache</button>
          </div>
          <div class="note im-src-note">Or drop the game folder anywhere on this page. Files stay on this machine: they are cached in this browser and never uploaded.</div>
          <select class="im-set"></select>
          <input type="search" class="ml-search im-search" placeholder="Filter missions" spellcheck="false">
          <div class="im-list"></div>
        </aside>
        <main class="im-center">
          <div class="im-title"></div>
          <div class="im-views">
            <figure><figcaption>Original <select class="im-mode"><option value="class">Highest tile, by class</option><option value="street">Street level only</option><option value="tile">Raw tile ids</option></select></figcaption><div class="im-canvas"><canvas class="im-orig"></canvas></div></figure>
            <figure><figcaption>Converted <span class="im-legend"></span></figcaption><div class="im-canvas"><canvas class="im-conv"></canvas></div></figure>
          </div>
          <div class="im-info">Hover the original map to inspect a tile column. Click a tile to reclassify it.</div>
        </main>
        <aside class="im-right"></aside>
        <div class="im-drop">Drop the Syndicate folder to import it</div>
      </div>`;
    for (const k of ['list', 'title', 'right', 'info', 'set', 'search', 'orig', 'conv', 'mode', 'legend', 'drop']) this.el[k] = this.root.querySelector(`.im-${k}`)!;
    const im = this.root.querySelector<HTMLElement>('.im')!;
    this.root.querySelector('[data-a=dev]')!.addEventListener('click', () => void this.loadDev());
    this.root.querySelector('[data-a=clear]')!.addEventListener('click', async () => {
      await clearCache();
      this.sets = [];
      this.set = null;
      this.renderEmpty();
      this.status('Cache cleared.');
    });
    this.root.querySelector<HTMLInputElement>('.im-pick input')!.addEventListener('change', async (e) => {
      const files = (e.target as HTMLInputElement).files;
      if (files?.length) this.useSets(await fromFileList(files), `Read ${files.length} files.`, true);
    });
    im.addEventListener('dragover', (e) => {
      e.preventDefault();
      im.classList.add('dragging');
    });
    im.addEventListener('dragleave', (e) => {
      if (e.target === this.el.drop) im.classList.remove('dragging');
    });
    im.addEventListener('drop', async (e) => {
      e.preventDefault();
      im.classList.remove('dragging');
      if (e.dataTransfer) this.useSets(await fromDrop(e.dataTransfer), 'Read the dropped folder.', true);
    });
    this.el.set.addEventListener('change', () => {
      this.set = this.sets.find((s) => s.info.key === (this.el.set as HTMLSelectElement).value) ?? null;
      this.mission = this.set?.missions()[0] ?? 0;
      this.renderList();
      this.refresh();
    });
    this.el.search.addEventListener('input', () => {
      this.query = (this.el.search as HTMLInputElement).value.trim().toLowerCase();
      this.renderList();
    });
    this.el.mode.addEventListener('change', () => {
      this.mode = (this.el.mode as HTMLSelectElement).value as OriginalMode;
      this.drawOriginal();
    });
    this.el.legend.innerHTML = Object.entries(CELL_COLORS)
      .map(([k, c]) => `<span><i style="background:${c}"></i>${CELL_NAMES[Number(k) as keyof typeof CELL_NAMES]}</span>`)
      .join('');
    const orig = this.el.orig as HTMLCanvasElement;
    orig.addEventListener('mousemove', (e) => this.hover(e));
    orig.addEventListener('click', (e) => this.pickTile(e));
  }

  private status(text: string, tone: 'ok' | 'warn' | 'bad' | '' = ''): void {
    const s = this.ctx.actions.querySelector('.mt-status');
    if (s) {
      s.textContent = text;
      s.className = `mt-status ${tone}`;
    }
  }

  private renderActions(): void {
    const a = this.ctx.actions;
    a.innerHTML = '<div class="mt-status"></div>';
    const add = (label: string, fn: () => void, cls = 'tb-btn', title = '') => {
      const b = document.createElement('button');
      b.className = cls;
      b.textContent = label;
      b.title = title;
      b.addEventListener('click', fn);
      a.appendChild(b);
    };
    add('Export tile table', () => this.exportTiles(), 'tb-btn', 'Download your tile-class overrides as JSON');
    add('Convert all', () => void this.convertAll(), 'tb-btn', 'Convert every campaign mission of this dataset into local drafts');
    add('Convert to draft ▸', () => void this.convert(), 'tb-btn on', 'Save this mission to content-local/missions and open it in the Missions tool');
  }

  private renderEmpty(): void {
    this.el.list.innerHTML = '<div class="note">No Syndicate data loaded yet.</div>';
    (this.el.set as HTMLSelectElement).innerHTML = '';
    this.el.title.innerHTML = `<h2>Import original Syndicate missions</h2><div class="note">Copy your Syndicate (or Syndicate Plus) folder into <code>content-local/</code> and press “Load from content-local”, or choose / drop the folder. The importer looks for <code>COL01.DAT</code>, <code>GAMExx.DAT</code>, <code>MAPxx.DAT</code> and <code>MISSxx.DAT</code>.</div>`;
    this.el.right.innerHTML = '';
    for (const c of [this.el.orig, this.el.conv] as HTMLCanvasElement[]) c.width = c.height = 1;
  }

  private async loadDev(): Promise<void> {
    if (!this.backend) return this.status('The dev server is not running; choose or drop the folder instead.', 'warn');
    try {
      const sets = await fromDevServer((done, total) => this.status(`Reading ${done}/${total} files…`));
      this.useSets(sets, 'Loaded from content-local.', true);
    } catch (e) {
      this.status(`Could not read content-local: ${(e as Error).message}`, 'bad');
    }
  }

  private useSets(stored: StoredDataset[], msg: string, cache = false): void {
    if (!stored.length) return this.status('No Syndicate data found there (needs COL01.DAT with GAME and MAP files).', 'warn');
    if (cache) void cacheDatasets(stored);
    this.sets = stored.map((s) => new SyndDataset(s.files, s.info)).sort((a) => (a.info.key === 'syndicate' ? -1 : 1));
    const want = getParam('synd');
    const [key, num] = want?.split(':') ?? [];
    this.set = this.sets.find((s) => s.info.key === key) ?? this.sets[0];
    const ms = this.set.missions();
    this.mission = ms.includes(Number(num)) ? Number(num) : ms[0];
    (this.el.set as HTMLSelectElement).innerHTML = this.sets.map((s) => `<option value="${s.info.key}"${s === this.set ? ' selected' : ''}>${s.info.label} · ${s.missions().length} missions</option>`).join('');
    this.renderList();
    this.refresh();
    this.status(`${msg} ${this.sets.map((s) => s.info.label).join(' and ')}.`, 'ok');
  }

  private renderList(): void {
    const set = this.set;
    if (!set) return;
    const rows = set
      .missions()
      .map((n) => set.summary(n))
      .filter((s) => !this.query || `${s.mission} ${s.title} ${s.kind} ${s.objectives.join(' ')}`.toLowerCase().includes(this.query));
    this.el.list.innerHTML = rows
      .map(
        (s) => `<div class="im-row${s.mission === this.mission ? ' on' : ''}" data-n="${s.mission}"><b>${String(s.mission).padStart(2, '0')}</b><span>${esc(s.title)}<small>${s.multiplayer ? 'multiplayer · ' : ''}map ${s.mapId} · ${s.people} people · ${s.objectives.join(', ') || 'no objectives'}</small></span></div>`,
      )
      .join('');
    this.el.list.querySelectorAll<HTMLElement>('.im-row').forEach((r) =>
      r.addEventListener('click', () => {
        this.mission = Number(r.dataset.n);
        this.selectedTile = -1;
        this.renderList();
        this.refresh();
      }),
    );
    this.el.list.querySelector('.on')?.scrollIntoView({ block: 'nearest' });
  }

  /** Re-runs the conversion with the current settings and redraws everything. */
  private refresh(): void {
    const set = this.set;
    if (!set || !this.mission) return;
    setParams({ synd: `${set.info.key}:${this.mission}` });
    localStorage.setItem('lab.synd.opts', JSON.stringify(this.opts));
    localStorage.setItem('lab.synd.tiles', JSON.stringify(this.tiles));
    const t0 = performance.now();
    try {
      this.result = set.convert(this.mission, { ...this.opts, tiles: this.tiles });
    } catch (e) {
      this.result = null;
      this.el.title.innerHTML = `<div class="warn-note">Conversion failed: ${esc((e as Error).message)}</div>`;
      return;
    }
    const ms = performance.now() - t0;
    const s = set.summary(this.mission);
    const r = this.result;
    const l = r.mission.map.kind === 'authored' ? r.mission.map.layout : null;
    this.el.title.innerHTML = `<h2>${String(s.mission).padStart(2, '0')} · ${esc(s.title)}</h2><div class="note">${esc(set.info.label)} · ${esc(s.kind || 'no briefing')} · MAP${String(s.mapId).padStart(2, '0')} · crop ${r.crop.w}×${r.crop.h} tiles at (${r.crop.x}, ${r.crop.y}) → ${l?.w}×${l?.h} m · street level ${r.streetLevel} · converted in ${ms.toFixed(0)} ms</div>`;
    this.drawOriginal();
    this.drawConverted();
    this.renderRight();
  }

  private put(canvas: HTMLCanvasElement, r: Raster): void {
    canvas.width = r.w;
    canvas.height = r.h;
    const g = canvas.getContext('2d')!;
    g.putImageData(new ImageData(new Uint8ClampedArray(r.data), r.w, r.h), 0, 0);
  }

  private drawOriginal(): void {
    const set = this.set;
    const r = this.result;
    if (!set || !r) return;
    const game = set.game(this.mission)!;
    const raster = renderOriginal(set.map(game.mapId), set.col(), this.tiles, this.mode, r.streetLevel, PX);
    overlayGame(raster, game);
    const cv = this.el.orig as HTMLCanvasElement;
    this.put(cv, raster);
    const g = cv.getContext('2d')!;
    g.strokeStyle = '#0a84ff';
    g.lineWidth = 2;
    g.setLineDash([6, 4]);
    g.strokeRect(r.crop.x * PX + 1, r.crop.y * PX + 1, r.crop.w * PX - 2, r.crop.h * PX - 2);
    if (this.selectedTile >= 0) {
      g.setLineDash([]);
      g.strokeStyle = '#fff';
      const map = set.map(game.mapId);
      for (let y = 0; y < map.h; y++)
        for (let x = 0; x < map.w; x++) {
          for (let z = 0; z < map.levels; z++)
            if (tileAt(map, x, y, z) === this.selectedTile) {
              g.strokeRect(x * PX + 0.5, y * PX + 0.5, PX - 1, PX - 1);
              break;
            }
        }
    }
  }

  private drawConverted(): void {
    const set = this.set;
    const r = this.result;
    if (!set || !r) return;
    const raster = renderConverted(r, PX);
    overlayGame(raster, set.game(this.mission)!, { x: r.crop.x, y: r.crop.y });
    this.put(this.el.conv as HTMLCanvasElement, raster);
  }

  private tileUnder(e: MouseEvent): { x: number; y: number } | null {
    const cv = e.currentTarget as HTMLCanvasElement;
    const rect = cv.getBoundingClientRect();
    const x = Math.floor(((e.clientX - rect.left) / rect.width) * (cv.width / PX));
    const y = Math.floor(((e.clientY - rect.top) / rect.height) * (cv.height / PX));
    return x >= 0 && y >= 0 && x < cv.width / PX && y < cv.height / PX ? { x, y } : null;
  }

  private hover(e: MouseEvent): void {
    const t = this.tileUnder(e);
    const set = this.set;
    if (!t || !set || !this.result) return;
    const game = set.game(this.mission)!;
    const map = set.map(game.mapId);
    const col = set.col();
    const cls = resolveTileClasses(col, this.tiles);
    const levels: string[] = [];
    for (let z = 0; z < map.levels; z++) {
      const id = tileAt(map, t.x, t.y, z);
      if (col[id] === 0 && id !== 0 && z > this.result.streetLevel + 3) continue;
      levels.push(`<span class="${z === this.result.streetLevel ? 'street' : ''}" style="border-color:${TILE_CLASS_COLORS[cls[id]]}">z${z} <b>${id}</b> ${hex2(col[id])} ${cls[id]}</span>`);
    }
    const people = game.people.filter((p) => p.onMap && Math.floor(p.x) === t.x && Math.floor(p.y) === t.y);
    this.el.info.innerHTML = `<b>Tile ${t.x}, ${t.y}</b> ${levels.join('')}${people.map((p) => `<span style="border-color:${PED_COLORS[p.cls]}">#${p.index} ${p.cls}${p.weapons.length ? ` · ${p.weapons.join(', ')}` : ''}</span>`).join('')}`;
  }

  private pickTile(e: MouseEvent): void {
    const t = this.tileUnder(e);
    const set = this.set;
    if (!t || !set || !this.result) return;
    const map = set.map(set.game(this.mission)!.mapId);
    const col = set.col();
    let z = this.result.streetLevel;
    if (this.mode !== 'street') for (z = map.levels - 1; z > 0 && col[tileAt(map, t.x, t.y, z)] === 0; z--);
    this.selectedTile = tileAt(map, t.x, t.y, z);
    this.drawOriginal();
    this.renderRight();
    this.root.querySelector('.im-tilesel')?.scrollIntoView({ block: 'nearest' });
  }

  private renderRight(): void {
    const r = this.result;
    const set = this.set;
    if (!r || !set) return;
    const o = this.opts;
    const col = set.col();
    const classSel = (cur: TileClass, attr: string) => `<select ${attr}>${TILE_CLASSES.map((c) => `<option${c === cur ? ' selected' : ''}>${c}</option>`).join('')}</select>`;
    const types = [...new Set([...col])].sort((a, b) => a - b);
    const sel = this.selectedTile;
    const brief = set.briefing(this.mission);
    const objectives = r.mission.objectives.map((ob, i) => `<div class="im-obj"><b>${i + 1}</b> ${esc(ob.type ?? '')} <span>${esc(ob.text)}</span>${ob.todo ? `<div class="warn-note">${esc(ob.todo)}</div>` : ''}</div>`).join('');
    const counts = Object.entries(r.counts).map(([k, v]) => `<span>${v} ${k}</span>`).join(' · ');
    this.el.right.innerHTML = `
      <details open class="me-sec"><summary>Conversion</summary><div class="me-form">
        <label>Metres per tile<input class="me-in num" type="number" min="1" max="6" data-o="scale" value="${o.scale}"></label>
        <label>Crop<select data-o="crop"><option value="mission"${o.crop === 'mission' ? ' selected' : ''}>Mission area</option><option value="full"${o.crop === 'full' ? ' selected' : ''}>Whole map</option></select></label>
        <label>Margin (tiles)<input class="me-in num" type="number" min="0" max="40" data-o="margin" value="${o.margin}"></label>
        <label>Street level<select data-o="streetLevel"><option value="auto"${o.streetLevel === 'auto' ? ' selected' : ''}>auto (${r.streetLevel})</option>${[0, 1, 2, 3].map((z) => `<option value="${z}"${o.streetLevel === z ? ' selected' : ''}>${z}</option>`).join('')}</select></label>
        <label>Headroom (levels)<input class="me-in num" type="number" min="1" max="6" data-o="clearance" value="${o.clearance}"></label>
        <label>Covered depth<input class="me-in num" type="number" min="0" max="10" data-o="coveredDepth" value="${o.coveredDepth}"></label>
        <label>Metres per level<input class="me-in num" type="number" step="0.1" min="0.5" max="6" data-o="levelHeight" value="${o.levelHeight}"></label>
        <label>Merge tolerance<input class="me-in num" type="number" min="0" max="6" data-o="mergeTolerance" value="${o.mergeTolerance}"></label>
        <label>Extraction<input type="checkbox" data-o="addExtraction"${o.addExtraction ? ' checked' : ''}></label>
        <label>Parked cars<input type="checkbox" data-o="cars"${o.cars ? ' checked' : ''}></label>
        <label>Street lamps<input type="checkbox" data-o="lamps"${o.lamps ? ' checked' : ''}></label>
      </div><button class="btn-wide ghost" data-a="reset-opts">Reset to defaults</button></details>
      <details open class="me-sec im-tilesel"><summary>Selected tile</summary>${
        sel >= 0
          ? `<div class="me-form"><label>Tile id<b>${sel}</b></label><label>COL01 type<span>${hex2(col[sel])} ${TYPE_NAMES[col[sel]] ?? ''}</span></label><label>Class${classSel(this.tiles.ids[sel] ?? this.tiles.types[col[sel]], 'data-id')}</label></div>${this.tiles.ids[sel] ? '<button class="btn-wide ghost" data-a="unset">Use the type default</button>' : ''}<div class="note">Changing the class here overrides this tile id everywhere (every map).</div>`
          : '<div class="note">Click a tile on the original map.</div>'
      }</details>
      <details class="me-sec"><summary>Tile types</summary><div class="me-form">${types.map((t) => `<label>${hex2(t)} ${esc(TYPE_NAMES[t] ?? '?')}${classSel(this.tiles.types[t] ?? 'solid', `data-type="${t}"`)}</label>`).join('')}</div>
        <div class="note">${Object.keys(this.tiles.ids).length} tile id overrides.</div>${Object.keys(this.tiles.ids).length ? '<button class="btn-wide ghost" data-a="reset-tiles">Clear overrides</button>' : ''}</details>
      <details open class="me-sec"><summary>Result</summary><div class="note">${counts}</div>${objectives}${r.notes.map((n) => `<div class="warn-note">${esc(n)}</div>`).join('')}</details>
      <details class="me-sec"><summary>Briefing</summary>${brief ? `<div class="im-brief">${[...brief.text, ...brief.tiers.map((t) => t.join(' '))].map((p) => `<p>${esc(p)}</p>`).join('')}</div>` : '<div class="note">No MISS file for this mission.</div>'}</details>`;
    const bind = (sel: string, fn: (el: HTMLInputElement) => void) => this.el.right.querySelectorAll<HTMLInputElement>(sel).forEach((el) => el.addEventListener('change', () => fn(el)));
    bind('[data-o]', (el) => {
      const k = el.dataset.o as keyof Opts;
      const v = el.type === 'checkbox' ? el.checked : el.tagName === 'SELECT' ? (el.value === 'auto' || el.value === 'mission' || el.value === 'full' ? el.value : Number(el.value)) : Number(el.value);
      (this.opts as unknown as Record<string, unknown>)[k] = v;
      this.refresh();
    });
    bind('[data-id]', (el) => {
      this.tiles.ids[sel] = el.value as TileClass;
      this.refresh();
    });
    bind('[data-type]', (el) => {
      this.tiles.types[Number(el.dataset.type)] = el.value as TileClass;
      this.refresh();
    });
    this.el.right.querySelectorAll<HTMLElement>('[data-a]').forEach((b) =>
      b.addEventListener('click', () => {
        if (b.dataset.a === 'reset-opts') this.opts = { ...DEFAULT_CONVERT };
        else if (b.dataset.a === 'reset-tiles') this.tiles = { ...this.tiles, ids: {} };
        else if (b.dataset.a === 'unset') delete this.tiles.ids[sel];
        this.refresh();
      }),
    );
  }

  private exportTiles(): void {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([JSON.stringify(this.tiles, null, 2)], { type: 'application/json' }));
    a.download = 'syndicate-tile-table.json';
    a.click();
  }

  private async convert(): Promise<void> {
    const r = this.result;
    if (!r) return;
    if (!this.backend) return this.status('Saving drafts needs the dev server.', 'warn');
    const id = r.mission.id;
    const existing = (await listMissions()).find((m) => m.id === id && m.source === 'local');
    let mission = r.mission;
    if (existing) {
      const keep = confirm(`${id} already exists in content-local/missions.\n\nOK: update only its map (keeps your edits to units, objectives and briefing).\nCancel: replace the whole draft.`);
      if (keep) {
        const old = await loadMissionFile(id, 'local');
        mission = { ...old, map: r.mission.map };
      }
    }
    await saveMissionFile(mission, 'local');
    this.status(`Saved content-local/missions/${id}.json`, 'ok');
    this.ctx.open('missions', { mission: `local:${id}` });
  }

  private async convertAll(): Promise<void> {
    const set = this.set;
    if (!set || !this.backend) return;
    const list = set.missions().filter((n) => n < 90);
    if (!confirm(`Convert all ${list.length} ${set.info.label} campaign missions into content-local/missions? Existing drafts with the same ids are replaced.`)) return;
    let n = 0;
    for (const m of list) {
      await saveMissionFile(set.convert(m, { ...this.opts, tiles: this.tiles }).mission, 'local');
      this.status(`Converted ${++n}/${list.length}…`);
    }
    this.status(`Converted ${n} missions. They are in the Missions library.`, 'ok');
  }
}

export const importTool: LabTool = new ImportTool();
(window as unknown as { labImport: unknown }).labImport = importTool;
