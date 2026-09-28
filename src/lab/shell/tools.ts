import { icon } from '../boards/layout.ts';
import type { Stage } from '../stage.ts';
import { getParam, setParams } from './url.ts';

/** What the host lends to the active tool. */
export interface ToolContext {
  /** The one shared WebGL stage. A tool that renders 3D moves `stage.canvas` into its own layout. */
  stage: Stage;
  /** Slot on the right of the app bar for the tool's own buttons (cleared on every switch). */
  actions: HTMLElement;
  setSubtitle(text: string): void;
  /** Switches to another tool, optionally setting some of its URL keys first. */
  open(toolId: string, params?: Record<string, string | null>): void;
}

export interface LabTool {
  /** Called every time the tool becomes active; `root` is the tool's own element and persists between visits. */
  mount(root: HTMLElement, ctx: ToolContext): void | Promise<void>;
  /** Called when another tool takes over. The tool must stop its loop and release shared resources. */
  unmount(): void;
  /** Keys pressed while the tool is active (after host shortcuts). */
  onKey?(e: KeyboardEvent): void;
}

export interface ToolEntry {
  id: string;
  title: string;
  icon: string;
  load(): Promise<LabTool>;
}

interface Loaded {
  tool: LabTool;
  root: HTMLElement;
}

/** App bar with tool tabs plus the switching logic: one tool mounted at a time, loaded lazily. */
export class ToolHost {
  private entries: ToolEntry[];
  private loaded = new Map<string, Loaded>();
  private current: { id: string; loaded: Loaded } | null = null;
  private tabs = new Map<string, HTMLElement>();
  private toolRoot: HTMLElement;
  private actions: HTMLElement;
  private subtitle: HTMLElement;
  private stage: Stage;
  private switching: Promise<void> = Promise.resolve();

  constructor(appbar: HTMLElement, toolRoot: HTMLElement, stage: Stage, entries: ToolEntry[]) {
    this.entries = entries;
    this.toolRoot = toolRoot;
    this.stage = stage;
    appbar.innerHTML = `
      <div class="traffic"><span></span><span></span><span></span></div>
      <nav class="ab-tabs"></nav>
      <div class="ab-title">Lab <small></small></div>
      <div class="ab-actions"></div>`;
    const nav = appbar.querySelector('.ab-tabs')!;
    entries.forEach((e, i) => {
      const b = document.createElement('button');
      b.className = 'ab-tab';
      b.title = `${e.title} (⌘${i + 1})`;
      b.innerHTML = `${icon(e.icon)}<span>${e.title}</span>`;
      b.addEventListener('click', () => this.open(e.id));
      nav.appendChild(b);
      this.tabs.set(e.id, b);
    });
    this.actions = appbar.querySelector('.ab-actions')!;
    this.subtitle = appbar.querySelector('.ab-title small')!;

    window.addEventListener('keydown', (e) => {
      if ((e.metaKey || e.ctrlKey) && !e.altKey && /^Digit[1-9]$/.test(e.code)) {
        const entry = this.entries[Number(e.code.slice(5)) - 1];
        if (entry) {
          e.preventDefault();
          this.open(entry.id);
          return;
        }
      }
      this.current?.loaded.tool.onKey?.(e);
    });
  }

  get currentId(): string {
    return this.current?.id ?? '';
  }

  /** Opens the tool named in the URL (?tool=), defaulting to the first. */
  start(): Promise<void> {
    const id = getParam('tool');
    return this.open(this.entries.some((e) => e.id === id) ? id! : this.entries[0].id);
  }

  open(id: string, params?: Record<string, string | null>): Promise<void> {
    this.switching = this.switching.then(() => this.doOpen(id, params));
    return this.switching;
  }

  private async doOpen(id: string, params?: Record<string, string | null>): Promise<void> {
    const entry = this.entries.find((e) => e.id === id);
    if (!entry) return;
    if (params) {
      // Apply synchronously so the tool reads them on mount.
      const q = new URLSearchParams(location.search);
      for (const [k, v] of Object.entries(params)) (v === null ? q.delete(k) : q.set(k, v));
      history.replaceState(null, '', `${location.pathname}?${q}`);
    }
    if (this.current?.id === id && !params) return;
    if (this.current) {
      this.current.loaded.tool.unmount();
      this.current.loaded.root.remove();
      this.current = null;
    }
    for (const [tid, tab] of this.tabs) tab.classList.toggle('on', tid === id);
    this.actions.innerHTML = '';
    this.subtitle.textContent = entry.title;
    let loaded = this.loaded.get(id);
    if (!loaded) {
      const root = document.createElement('div');
      root.className = `tool tool-${id}`;
      loaded = { tool: await entry.load(), root };
      this.loaded.set(id, loaded);
    }
    this.toolRoot.appendChild(loaded.root);
    this.current = { id, loaded };
    setParams({ tool: id === this.entries[0].id ? null : id });
    await loaded.tool.mount(loaded.root, {
      stage: this.stage,
      actions: this.actions,
      setSubtitle: (t) => (this.subtitle.textContent = t),
      open: (tid, p) => void this.open(tid, p),
    });
  }
}
