import { icon } from '../boards/layout.ts';
import { SECTIONS, type BoardDef, type Registry } from './registry.ts';

/** macOS-style source list: collapsible sections, counts, search, keyboard navigation. */
export class Sidebar {
  private root: HTMLElement;
  private nav: HTMLElement;
  private registry: Registry;
  private query = '';
  private collapsed = new Set<string>(JSON.parse(localStorage.getItem('lab.collapsed') ?? '[]') as string[]);
  current = '';
  onSelect: (id: string) => void = () => {};

  constructor(root: HTMLElement, registry: Registry) {
    this.root = root;
    this.registry = registry;
    root.innerHTML = `
      <div class="traffic"><span></span><span></span><span></span></div>
      <div class="app-title">Style Lab <small>Neon Rain</small></div>
      <div class="search">
        <svg viewBox="0 0 16 16"><circle cx="7" cy="7" r="4.5" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="m10.5 10.5 3 3" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>
        <input type="search" placeholder="Search" spellcheck="false" />
      </div>
      <nav class="nav"></nav>
      <div class="sidebar-foot">
        <kbd>↑</kbd><kbd>↓</kbd> boards · <kbd>←</kbd><kbd>→</kbd> sections<br />
        <kbd>⌘1</kbd>–<kbd>⌘4</kbd> style · <kbd>Space</kbd> play · <kbd>F</kbd> frame
      </div>`;
    this.nav = root.querySelector('.nav')!;
    const input = root.querySelector('input')!;
    input.addEventListener('input', () => {
      this.query = input.value.trim().toLowerCase();
      this.render();
    });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        input.value = '';
        this.query = '';
        this.render();
        input.blur();
      }
      if (e.key === 'Enter') {
        const first = this.visible()[0];
        if (first) this.onSelect(first.id);
      }
    });
  }

  private matches(b: BoardDef): boolean {
    return !this.query || `${b.title} ${b.section}`.toLowerCase().includes(this.query);
  }

  /** Boards in display order, respecting search and collapsed sections. */
  visible(): BoardDef[] {
    const out: BoardDef[] = [];
    for (const s of SECTIONS) {
      if (this.collapsed.has(s) && !this.query) continue;
      out.push(...this.registry.inSection(s).filter((b) => this.matches(b)));
    }
    return out;
  }

  render(): void {
    this.nav.innerHTML = '';
    for (const s of SECTIONS) {
      const boards = this.registry.inSection(s).filter((b) => this.matches(b));
      if (this.query && boards.length === 0) continue;
      const sec = document.createElement('div');
      sec.className = `nav-section${this.collapsed.has(s) && !this.query ? ' collapsed' : ''}`;
      const head = document.createElement('div');
      head.className = 'nav-head';
      head.innerHTML = `<svg class="chev" viewBox="0 0 10 10"><path d="M2 3.5 5 6.5 8 3.5" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>${s.toUpperCase()}<span class="count">${boards.length}</span>`;
      head.addEventListener('click', () => this.toggle(s));
      sec.appendChild(head);
      const list = document.createElement('div');
      list.className = 'nav-items';
      if (!boards.length) list.innerHTML = `<div class="nav-empty">${s === 'Imported' ? 'Drop .glb or .vox files' : 'Empty'}</div>`;
      for (const b of boards) {
        const item = document.createElement('div');
        item.className = `nav-item${b.id === this.current ? ' selected' : ''}`;
        item.dataset.id = b.id;
        item.innerHTML = `${icon(b.icon)}<span>${b.title}</span>${b.styled ? '' : '<span class="badge">fixed</span>'}`;
        item.addEventListener('click', () => this.onSelect(b.id));
        list.appendChild(item);
      }
      sec.appendChild(list);
      this.nav.appendChild(sec);
    }
  }

  toggle(section: string, force?: boolean): void {
    const collapse = force ?? !this.collapsed.has(section);
    if (collapse) this.collapsed.add(section);
    else this.collapsed.delete(section);
    localStorage.setItem('lab.collapsed', JSON.stringify([...this.collapsed]));
    this.render();
  }

  setCurrent(id: string): void {
    this.current = id;
    const b = this.registry.get(id);
    if (b && this.collapsed.has(b.section)) this.toggle(b.section, false);
    else this.render();
    this.nav.querySelector('.nav-item.selected')?.scrollIntoView({ block: 'nearest' });
  }

  move(delta: number): void {
    const list = this.visible();
    const i = list.findIndex((b) => b.id === this.current);
    const next = list[Math.max(0, Math.min(list.length - 1, (i < 0 ? 0 : i) + delta))];
    if (next && next.id !== this.current) this.onSelect(next.id);
  }

  collapseCurrent(collapse: boolean): void {
    const b = this.registry.get(this.current);
    if (b) this.toggle(b.section, collapse);
  }

  focusSearch(): void {
    this.root.querySelector('input')?.focus();
  }
}
