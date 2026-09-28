import type { MissionDef } from '../../../sim/content.ts';
import { getParam, setParams } from '../../shell/url.ts';
import type { LabTool, ToolContext } from '../../shell/tools.ts';
import { downloadMission, hasBackend, listMissions, loadMissionFile, saveMissionFile, type MissionSource } from './api.ts';
import { blankLayout, encodeLayout, MissionDoc } from './doc.ts';
import { Editor } from './editor.ts';
import { Library } from './library.ts';
import './missions.css';

function newMission(id: string, kind: 'blank' | 'procedural', size: number, seed: number): MissionDef {
  const base = {
    version: 2,
    id,
    codename: 'NEW OPERATION',
    city: 'Unassigned sector',
    seed,
    briefing: ['Describe the operation here.'],
    targetName: 'the target',
    targetCorp: 'a rival syndicate',
    policeHostileAt: 40,
    enforcersAt: 70,
    atmosphere: { hour: 22, rain: { min: 0, max: 1 } },
  };
  if (kind === 'procedural')
    return {
      ...base,
      map: { kind: 'procedural', size, blockMin: 20, blockMax: 28, roadWidth: 12, sidewalk: 3, openLots: 0.15 },
      objectives: [
        { id: 'kill', type: 'eliminate', text: 'Eliminate the target', escapeFails: 'The target escaped.' },
        { id: 'extract', type: 'extract', text: 'Reach the extraction VTOL', successText: 'Target terminated. Squad extracted.' },
      ],
      population: { civilians: 90, police: 6, rivals: 4, guards: 3, heavies: 1, traffic: 12 },
    };
  return {
    ...base,
    map: { kind: 'authored', layout: encodeLayout(blankLayout(size, size)) },
    objectives: [{ id: 'extract', type: 'extract', text: 'Reach the extraction VTOL', successText: 'Objectives complete. Squad extracted.' }],
    population: { civilians: 20, police: 2, rivals: 0, guards: 0, heavies: 0, traffic: 0 },
    spawns: [],
  };
}

/** Mission library plus editor. URL: ?tool=missions&mission=<source>:<id>. */
class MissionsTool implements LabTool {
  private ctx!: ToolContext;
  private root!: HTMLElement;
  private library: Library | null = null;
  private editor: Editor | null = null;
  private doc: MissionDoc | null = null;
  private statusEl = document.createElement('div');
  private backend = true;
  private keyup = (e: KeyboardEvent) => this.editor?.onKeyUp(e);

  async mount(root: HTMLElement, ctx: ToolContext): Promise<void> {
    this.ctx = ctx;
    this.root = root;
    this.statusEl.className = 'mt-status';
    window.addEventListener('keyup', this.keyup);
    this.backend = await hasBackend();
    const want = getParam('mission');
    if (want) {
      const [src, id] = want.includes(':') ? want.split(':') : ['local', want];
      if (!this.doc || this.doc.id !== id || this.doc.source !== src) {
        try {
          await this.openMission(id, src as MissionSource);
          return;
        } catch (e) {
          this.status(`Could not open ${want}: ${(e as Error).message}`, 'bad');
        }
      } else return this.showEditor();
    }
    await this.showLibrary();
  }

  unmount(): void {
    this.editor?.stop();
    window.removeEventListener('keyup', this.keyup);
  }

  onKey(e: KeyboardEvent): void {
    this.editor?.onKey(e);
  }

  status(text: string, tone: 'ok' | 'warn' | 'bad' | '' = ''): void {
    this.statusEl.textContent = text;
    this.statusEl.className = `mt-status ${tone}`;
  }

  private button(label: string, fn: () => void, cls = 'tb-btn', title = ''): HTMLButtonElement {
    const b = document.createElement('button');
    b.className = cls;
    b.textContent = label;
    if (title) b.title = title;
    b.addEventListener('click', fn);
    this.ctx.actions.appendChild(b);
    return b;
  }

  private async showLibrary(): Promise<void> {
    this.editor?.stop();
    this.root.innerHTML = '';
    this.ctx.actions.innerHTML = '';
    this.ctx.setSubtitle('Mission library');
    setParams({ mission: null });
    this.library ??= new Library({
      open: (id, src) => void this.openMission(id, src),
      playtest: (id) => window.open(`/?mission=${encodeURIComponent(id)}&autostart`, '_blank'),
      status: (t, tone) => this.status(t, tone),
    });
    this.root.append(this.library.root);
    this.ctx.actions.append(this.statusEl);
    this.button('New mission…', () => this.newDialog(), 'tb-btn on');
    this.button('Refresh', () => void this.library!.refresh());
    await this.library.refresh();
  }

  private async openMission(id: string, src: MissionSource): Promise<void> {
    const m = await loadMissionFile(id, src);
    this.openDoc(new MissionDoc(m, src));
  }

  private openDoc(doc: MissionDoc): void {
    this.editor?.dispose();
    this.doc = doc;
    this.editor = new Editor(doc, this.ctx.stage, {
      save: () => this.save(),
      playtest: () => this.playtest(),
      status: (t, tone) => this.status(t, tone),
    });
    doc.on(() => this.syncButtons());
    this.showEditor();
  }

  private undoBtn!: HTMLButtonElement;
  private redoBtn!: HTMLButtonElement;
  private saveBtn!: HTMLButtonElement;
  private viewBtn!: HTMLButtonElement;

  private showEditor(): void {
    const ed = this.editor!;
    const doc = this.doc!;
    this.root.innerHTML = '';
    this.root.appendChild(ed.root);
    ed.root.querySelector('.me-status')!.replaceChildren(this.statusEl);
    this.ctx.actions.innerHTML = '';
    this.ctx.setSubtitle(`Editing ${doc.id}`);
    setParams({ mission: `${doc.source}:${doc.id}` });
    this.button('‹ Library', () => {
      if (doc.dirty && !confirm('Leave without saving?')) return;
      void this.showLibrary();
    });
    this.undoBtn = this.button('Undo', () => doc.undo(), 'tb-btn', 'Undo (⌘Z)');
    this.redoBtn = this.button('Redo', () => doc.redo(), 'tb-btn', 'Redo (⇧⌘Z)');
    this.viewBtn = this.button(ed.is3d ? '2D map' : '3D preview', () => {
      ed.set3d(!ed.is3d);
      this.syncButtons();
    }, 'tb-btn', 'Toggle the 3D preview (T)');
    this.saveBtn = this.button('Save', () => void this.save(), 'tb-btn', `Save (⌘S) to ${doc.source === 'bundled' ? 'src/content/missions' : 'content-local/missions'}`);
    this.button('Playtest ▸', () => void this.playtest(), 'tb-btn on', 'Save, then play it in a new tab');
    ed.start();
    this.syncButtons();
  }

  private syncButtons(): void {
    const doc = this.doc;
    if (!doc || !this.undoBtn) return;
    this.undoBtn.disabled = !doc.canUndo;
    this.redoBtn.disabled = !doc.canRedo;
    this.saveBtn.textContent = doc.dirty ? 'Save •' : 'Save';
    this.viewBtn.textContent = this.editor?.is3d ? '2D map' : '3D preview';
    this.ctx.setSubtitle(`Editing ${doc.id}`);
  }

  private async save(): Promise<void> {
    const doc = this.doc!;
    const m = doc.toMission();
    if (!this.backend) {
      downloadMission(m);
      this.status('No dev server: downloaded the mission JSON instead.', 'warn');
      return;
    }
    try {
      const path = await saveMissionFile(m, doc.source);
      doc.dirty = false;
      setParams({ mission: `${doc.source}:${doc.id}` });
      this.status(`Saved ${path}.`, 'ok');
      this.syncButtons();
    } catch (e) {
      this.status(`Save failed: ${(e as Error).message}`, 'bad');
    }
  }

  private async playtest(): Promise<void> {
    await this.save();
    if (this.doc!.dirty) return;
    window.open(`/?mission=${encodeURIComponent(this.doc!.id)}&autostart`, '_blank');
  }

  private newDialog(): void {
    const dlg = document.createElement('div');
    dlg.className = 'mt-dialog';
    dlg.innerHTML = `<div class="mt-card">
      <h3>New mission</h3>
      <label class="me-row"><input type="radio" name="k" value="procedural" checked> Procedural city (grid roads and traffic; bake it later to hand-edit)</label>
      <label class="me-row"><input type="radio" name="k" value="blank"> Blank authored map</label>
      <div class="me-form"><label>Id<input class="me-in" data-f="id" value="op_${Date.now().toString(36).slice(-4)}"></label>
      <label>Size (m)<input class="me-in num" type="number" data-f="size" value="136"></label>
      <label>Seed<input class="me-in num" type="number" data-f="seed" value="${Math.floor(Math.random() * 99999)}"></label></div>
      <div class="me-row"><button class="tb-btn" data-a="cancel">Cancel</button><button class="tb-btn on" data-a="ok">Create</button></div></div>`;
    document.body.appendChild(dlg);
    const val = (f: string) => dlg.querySelector<HTMLInputElement>(`[data-f=${f}]`)!.value;
    dlg.querySelector('[data-a=cancel]')!.addEventListener('click', () => dlg.remove());
    dlg.querySelector('[data-a=ok]')!.addEventListener('click', async () => {
      const id = val('id').trim().replace(/[^a-z0-9_-]/gi, '_') || 'op_new';
      const existing = this.backend ? await listMissions() : [];
      if (existing.some((m) => m.id === id)) return alert(`A mission called ${id} already exists.`);
      const kind = dlg.querySelector<HTMLInputElement>('input[name=k]:checked')!.value as 'blank' | 'procedural';
      const size = Math.max(48, Math.min(400, Number(val('size')) || 136));
      dlg.remove();
      const doc = new MissionDoc(newMission(id, kind, size, Number(val('seed')) || 1), 'local');
      doc.dirty = true;
      this.openDoc(doc);
    });
  }
}

export const missionsTool: LabTool = new MissionsTool();
(window as unknown as { labMissions: unknown }).labMissions = missionsTool;
