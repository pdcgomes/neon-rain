/**
 * Telemetry tool: watch and analyse recorded play sessions (content-local/telemetry/, recorded
 * with "Record telemetry" in the game's briefing). URL: ?tool=telemetry&rec=<file>.
 *
 * Space play/pause · ← → 5 s (Shift 30 s) · , . one tick · [ ] speed · Tab squad · 1-4 agent ·
 * 0 free camera (WASD, Q/E, wheel) · F reset · Y top-down · T R H K V L N overlays
 */
import { balance, type Balance } from '../../../sim/balance.ts';
import type { Recording } from '../../../sim/telemetry.ts';
import { analyseTimeline, killerOf, outcomeOf, summarise, type LogKind, type Timeline } from '../../../sim/telemetryAnalysis.ts';
import { TICK_HZ } from '../../../sim/world.ts';
import { getParam, setParams } from '../../shell/url.ts';
import type { LabTool, ToolContext } from '../../shell/tools.ts';
import { LAYERS, type Layer } from './overlay.ts';
import { ReplayView, SPEEDS } from './view.ts';
import './telemetry.css';

const AGENT_COLORS = ['#5ad7ff', '#ffd24d', '#7dff9a', '#ff8ad8'];
const IPA_COLORS = { a: '#ff5a7a', p: '#ffd24d', i: '#6fb8ff' } as const;
const LOG_KINDS: { id: LogKind | 'combat'; label: string; kinds: LogKind[] }[] = [
  { id: 'death', label: 'Deaths', kinds: ['death', 'end'] },
  { id: 'hit', label: 'Hits', kinds: ['hit'] },
  { id: 'kill', label: 'Kills', kinds: ['kill', 'civilian', 'persuaded'] },
  { id: 'objective', label: 'Mission', kinds: ['objective', 'alarm', 'police', 'end'] },
  { id: 'comms', label: 'Comms', kinds: ['comms'] },
];

const fmt = (ticks: number) => {
  const s = Math.floor(ticks / TICK_HZ);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};
const pct = (x: number) => `${Math.round(x * 100)}%`;
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);

async function listRecordings(): Promise<string[]> {
  const r = await fetch('/__telemetry/list');
  return r.ok ? r.json() : [];
}

async function loadRecording(name: string): Promise<Recording> {
  const r = await fetch(`/__telemetry/file?name=${encodeURIComponent(name)}`);
  if (!r.ok) throw new Error(`${r.status}`);
  return r.json();
}

class TelemetryTool implements LabTool {
  private ctx!: ToolContext;
  private root!: HTMLElement;
  private built = false;
  private view: ReplayView | null = null;
  private timeline: Timeline | null = null;
  private name = '';
  private savedBalance: Balance | null = null;
  private tab: 'squad' | 'log' | 'summary' = 'log';
  private logOn = new Set<string>(['death', 'kill', 'objective', 'comms']);
  private lastLogTick = -1;
  private panelAt = 0;
  private el: Record<string, HTMLElement> = {};

  async mount(root: HTMLElement, ctx: ToolContext): Promise<void> {
    this.ctx = ctx;
    this.root = root;
    ctx.setSubtitle('Telemetry');
    if (!this.built) this.build();
    ctx.actions.innerHTML = '';
    const refresh = document.createElement('button');
    refresh.className = 'tb-btn';
    refresh.textContent = 'Refresh';
    refresh.addEventListener('click', () => void this.refreshList());
    ctx.actions.append(refresh);
    await this.refreshList();
    const want = getParam('rec');
    if (want && want !== this.name) await this.open(want);
    else if (this.view) {
      this.applyBalance();
      await this.view.start();
    }
  }

  unmount(): void {
    this.view?.dispose();
    this.view = null;
    this.name = '';
    this.restoreBalance();
  }

  // ------------------------------------------------------------------ layout

  private build(): void {
    this.built = true;
    this.root.innerHTML = `
      <div class="tm">
        <div class="tm-left">
          <input class="search tm-filter" placeholder="Filter recordings">
          <div class="tm-list"></div>
          <div class="note">Record sessions with "Record telemetry" in the game's briefing, or <code>npm run telemetry -- bot &lt;mission&gt;</code>.</div>
        </div>
        <div class="tm-center">
          <div class="tm-bar">
            <div class="tm-layers"></div>
            <div class="tm-spacer"></div>
            <div class="seg tm-follow"></div>
            <button class="tb-btn" data-cam="reset" title="Reset view (F)">Reset</button>
            <button class="tb-btn" data-cam="top" title="Top-down (Y)">Top</button>
          </div>
          <div class="tm-view"><div class="tm-empty">Pick a recording on the left.</div></div>
          <div class="tm-timeline">
            <button class="tl-btn tm-play" title="Play/pause (Space)">▶</button>
            <span class="tm-time">0:00 / 0:00</span>
            <div class="tm-track"><canvas class="tm-chart"></canvas><div class="tm-marks"></div><div class="tm-pos"></div></div>
            <button class="tl-btn tm-speed" title="Speed ([ ])">1×</button>
          </div>
        </div>
        <div class="tm-right">
          <div class="seg tm-tabs"><button data-tab="squad">Squad</button><button data-tab="log">Log</button><button data-tab="summary">Summary</button></div>
          <div class="tm-pane tm-squad"></div>
          <div class="tm-pane tm-log"><div class="chips tm-log-kinds"></div><div class="tm-log-list"></div></div>
          <div class="tm-pane tm-summary"></div>
        </div>
      </div>`;
    const q = <T extends HTMLElement>(s: string) => this.root.querySelector<T>(s)!;
    for (const k of ['list', 'filter', 'view', 'layers', 'follow', 'play', 'time', 'track', 'chart', 'marks', 'pos', 'speed', 'squad', 'log', 'summary']) this.el[k] = q(`.tm-${k}`);
    this.el.logList = q('.tm-log-list');
    this.el.logKinds = q('.tm-log-kinds');

    (this.el.filter as HTMLInputElement).addEventListener('input', () => this.filterList());
    for (const l of LAYERS) {
      const b = document.createElement('button');
      b.className = 'chip';
      b.dataset.layer = l.id;
      b.textContent = l.label;
      b.title = l.title;
      b.addEventListener('click', () => this.toggleLayer(l.id));
      this.el.layers.appendChild(b);
    }
    for (const k of LOG_KINDS) {
      const b = document.createElement('button');
      b.className = 'chip';
      b.dataset.kind = k.id;
      b.textContent = k.label;
      b.addEventListener('click', () => {
        if (this.logOn.has(k.id)) this.logOn.delete(k.id);
        else this.logOn.add(k.id);
        this.renderLog();
      });
      this.el.logKinds.appendChild(b);
    }
    this.root.querySelectorAll<HTMLButtonElement>('[data-tab]').forEach((b) =>
      b.addEventListener('click', () => {
        this.tab = b.dataset.tab as typeof this.tab;
        this.syncTabs();
      }),
    );
    this.root.querySelector('[data-cam=reset]')!.addEventListener('click', () => this.view?.resetView());
    this.root.querySelector('[data-cam=top]')!.addEventListener('click', () => this.view?.topDown());
    this.el.play.addEventListener('click', () => this.togglePlay());
    this.el.speed.addEventListener('click', () => this.setSpeed(1));
    const scrub = (e: MouseEvent) => {
      if (!this.view) return;
      const r = this.el.track.getBoundingClientRect();
      void this.view.seek(((e.clientX - r.left) / r.width) * this.view.end);
    };
    this.el.track.addEventListener('mousedown', (e) => {
      scrub(e);
      const move = (e2: MouseEvent) => scrub(e2);
      window.addEventListener('mousemove', move);
      window.addEventListener('mouseup', () => window.removeEventListener('mousemove', move), { once: true });
    });
    this.syncTabs();
  }

  private syncTabs(): void {
    this.root.querySelectorAll<HTMLButtonElement>('[data-tab]').forEach((b) => b.classList.toggle('on', b.dataset.tab === this.tab));
    this.el.squad.hidden = this.tab !== 'squad';
    this.el.log.hidden = this.tab !== 'log';
    this.el.summary.hidden = this.tab !== 'summary';
  }

  // ------------------------------------------------------------------ recordings

  private names: string[] = [];

  private async refreshList(): Promise<void> {
    try {
      this.names = await listRecordings();
    } catch {
      this.names = [];
    }
    this.filterList();
  }

  private filterList(): void {
    const f = (this.el.filter as HTMLInputElement).value.toLowerCase();
    const list = this.el.list;
    list.innerHTML = '';
    const shown = this.names.filter((n) => n.toLowerCase().includes(f));
    if (!shown.length) list.innerHTML = `<div class="nav-empty">${this.names.length ? 'No match' : 'No recordings yet'}</div>`;
    for (const n of shown) {
      const m = n.match(/^(\d{4}-\d\d-\d\d)T(\d\d)-(\d\d)-[\d-]+Z_(.+)_([^_]+)\.json$/);
      const item = document.createElement('div');
      item.className = `nav-item tm-rec${n === this.name ? ' selected' : ''}`;
      item.innerHTML = m
        ? `<div><b>${esc(m[4])}</b><span class="tm-out ${m[5]}">${esc(m[5].replace('bot-', 'bot '))}</span></div><small>${m[1]} ${m[2]}:${m[3]}</small>`
        : esc(n);
      item.title = n;
      item.addEventListener('click', () => void this.open(n));
      list.appendChild(item);
    }
  }

  private applyBalance(): void {
    if (!this.view) return;
    this.savedBalance ??= { ...balance };
    Object.assign(balance, this.view.rec.balance);
  }

  private restoreBalance(): void {
    if (this.savedBalance) Object.assign(balance, this.savedBalance);
    this.savedBalance = null;
  }

  private async open(name: string): Promise<void> {
    this.view?.dispose();
    this.view = null;
    this.timeline = null;
    this.restoreBalance();
    this.name = name;
    setParams({ rec: name });
    this.filterList();
    this.el.view.querySelector('.tm-empty')?.remove();
    let rec: Recording;
    try {
      rec = await loadRecording(name);
    } catch (e) {
      this.ctx.setSubtitle(`Could not load ${name}: ${(e as Error).message}`);
      return;
    }
    this.ctx.setSubtitle(`${rec.mission.codename} · ${rec.player} · ${outcomeOf(rec)}`);
    this.view = new ReplayView(this.el.view, rec, () => this.onFrame());
    this.applyBalance();
    this.buildFollow(rec);
    this.buildMarks(rec);
    this.renderSummary(rec, null);
    this.el.logList.innerHTML = '<div class="nav-empty">Analysing…</div>';
    this.lastLogTick = -1;
    await this.view.start();
    const view = this.view;
    const timeline = await analyseTimeline(rec, (f) => {
      if (this.view === view) this.el.logList.innerHTML = `<div class="nav-empty">Analysing… ${pct(f)}</div>`;
    });
    // The analysis ran with the recording's knobs; the live view still needs them.
    if (this.view !== view) return;
    this.applyBalance();
    this.timeline = timeline;
    view.data = { hits: timeline.hits, enemyTrails: timeline.enemyTrails };
    this.renderLog();
    this.drawChart();
    this.renderSummary(rec, timeline);
  }

  // ------------------------------------------------------------------ transport

  private togglePlay(): void {
    if (!this.view) return;
    if (this.view.playback.done) void this.view.seek(0).then(() => (this.view!.paused = false));
    else this.view.paused = !this.view.paused;
  }

  private setSpeed(dir: number): void {
    if (!this.view) return;
    const i = SPEEDS.indexOf(this.view.speed);
    this.view.speed = SPEEDS[dir > 0 ? (i + 1) % SPEEDS.length : Math.max(0, i - 1)];
  }

  private toggleLayer(id: Layer): void {
    if (!this.view) return;
    const on = this.view.overlay.on;
    if (on.has(id)) on.delete(id);
    else on.add(id);
  }

  onKey(e: KeyboardEvent): void {
    const v = this.view;
    if (!v || (e.target as HTMLElement).tagName === 'INPUT') return;
    const step = (e.shiftKey ? 30 : 5) * TICK_HZ;
    switch (e.code) {
      case 'Space':
        e.preventDefault();
        this.togglePlay();
        return;
      case 'ArrowLeft':
        void v.seek(v.world.tick - step);
        return;
      case 'ArrowRight':
        void v.seek(v.world.tick + step);
        return;
      case 'Comma':
        if (v.paused) void v.seek(v.world.tick - 1);
        return;
      case 'Period':
        if (v.paused) void v.seek(v.world.tick + 1);
        return;
      case 'BracketLeft':
        this.setSpeed(-1);
        return;
      case 'BracketRight':
        this.setSpeed(1);
        return;
      case 'Tab':
        e.preventDefault();
        v.follow = 'squad';
        return;
      case 'Digit0':
        v.follow = 'free';
        return;
      case 'Digit1':
      case 'Digit2':
      case 'Digit3':
      case 'Digit4':
        if (!e.metaKey && !e.ctrlKey) v.follow = Number(e.code.slice(5)) - 1;
        return;
      case 'KeyF':
        v.resetView();
        return;
      case 'KeyY':
        v.topDown();
        return;
    }
    const layer = LAYERS.find((l) => l.key === e.code);
    if (layer && !e.metaKey && !e.ctrlKey) this.toggleLayer(layer.id);
  }

  // ------------------------------------------------------------------ panels

  private buildFollow(rec: Recording): void {
    const seg = this.el.follow;
    seg.innerHTML = '';
    const add = (label: string, f: 'squad' | 'free' | number, title: string) => {
      const b = document.createElement('button');
      b.textContent = label;
      b.title = title;
      b.dataset.follow = String(f);
      b.addEventListener('click', () => this.view && (this.view.follow = f));
      seg.appendChild(b);
    };
    add('Squad', 'squad', 'Follow the squad (Tab)');
    rec.squad.forEach((a, i) => add(a.name, i, `Follow ${a.name} (${i + 1})`));
    add('Free', 'free', 'Free camera: WASD, Q/E, wheel (0)');
  }

  private buildMarks(rec: Recording): void {
    const marks = this.el.marks;
    marks.innerHTML = '';
    const end = rec.result.ticks || 1;
    const mark = (tick: number, cls: string, title: string) => {
      const m = document.createElement('i');
      m.className = cls;
      m.style.left = `${(tick / end) * 100}%`;
      m.title = `${fmt(tick)} ${title}`;
      marks.appendChild(m);
    };
    for (const m of rec.marks) mark(m.tick, m.what.startsWith('objective') ? 'obj' : 'alarm', m.what);
    for (const d of rec.deaths) if (d.kind === 'agent') mark(d.tick, 'death', `${d.name} killed by ${killerOf(d)}`);
  }

  /** Squad health, alerted enemies and shots per second, drawn behind the scrub bar. */
  private drawChart(): void {
    const t = this.timeline;
    const c = this.el.chart as HTMLCanvasElement;
    const w = (c.width = c.clientWidth * 2);
    const h = (c.height = c.clientHeight * 2);
    const g = c.getContext('2d')!;
    g.clearRect(0, 0, w, h);
    if (!t || !this.view) return;
    const end = this.view.end;
    const maxHp = this.view.rec.squad.reduce((s, a) => s + a.hp, 0) || 1;
    const maxAlert = Math.max(1, ...t.series.map((s) => s.alerted));
    const maxShots = Math.max(1, ...t.series.map((s) => s.playerShots + s.enemyShots));
    for (const s of t.series) {
      const x = (s.tick / end) * w;
      const bw = Math.max(1, w / (end / TICK_HZ));
      g.fillStyle = 'rgba(255,255,255,0.08)';
      const sh = ((s.playerShots + s.enemyShots) / maxShots) * h * 0.9;
      g.fillRect(x, h - sh, bw, sh);
    }
    const series = t.series;
    const line = (f: (s: Timeline['series'][number]) => number, color: string) => {
      g.strokeStyle = color;
      g.lineWidth = 2;
      g.beginPath();
      series.forEach((s, i) => {
        const x = (s.tick / end) * w;
        const y = h - 2 - f(s) * (h - 4);
        if (i === 0) g.moveTo(x, y);
        else g.lineTo(x, y);
      });
      g.stroke();
    };
    line((s) => s.squadHp / maxHp, 'rgba(90,215,255,0.9)');
    line((s) => s.alerted / maxAlert, 'rgba(255,80,90,0.85)');
  }

  private renderLog(): void {
    const t = this.timeline;
    this.el.logKinds.querySelectorAll<HTMLButtonElement>('[data-kind]').forEach((b) => b.classList.toggle('on', this.logOn.has(b.dataset.kind!)));
    const list = this.el.logList;
    list.innerHTML = '';
    if (!t) return;
    const kinds = new Set(LOG_KINDS.filter((k) => this.logOn.has(k.id)).flatMap((k) => k.kinds));
    for (const e of t.log) {
      if (!kinds.has(e.kind)) continue;
      const row = document.createElement('div');
      row.className = `tm-ev ${e.kind}`;
      row.dataset.tick = String(e.tick);
      row.innerHTML = `<span class="t">${fmt(e.tick)}</span><span>${esc(e.text)}</span>`;
      row.addEventListener('click', () => void this.view?.seek(Math.max(0, e.tick - 2 * TICK_HZ)));
      list.appendChild(row);
    }
    this.lastLogTick = -1;
  }

  private renderSummary(rec: Recording, t: Timeline | null): void {
    const s = summarise([rec]);
    const kv = (k: string, v: string) => `<div class="kv"><span>${k}</span><b>${v}</b></div>`;
    const list = (items: [string, number][], unit = '') => (items.length ? items.slice(0, 6).map(([k, n]) => kv(esc(k), `${Math.round(n)}${unit}`)).join('') : '<div class="note">None</div>');
    const faithful = t ? (t.faithful ? 'reproduces exactly' : 'diverged: the sim changed since') : 'checking…';
    this.el.summary.innerHTML = `
      <div class="ins-sec"><div class="ins-h">Session</div>
        ${kv('Mission', esc(`${rec.missionId} · ${rec.mission.codename}`))}
        ${kv('Player', esc(rec.player))}
        ${kv('Result', esc(`${outcomeOf(rec)}${rec.result.reason ? `: ${rec.result.reason}` : ''}`))}
        ${kv('Length', fmt(rec.result.ticks))}
        ${kv('Agents lost', `${s.lostPerSession} of ${rec.squad.length}`)}
        ${kv('Alarm at', s.alarmAt === null ? 'never' : `${Math.round(s.alarmAt)} s`)}
        ${kv('Kit', esc(rec.squad[0]?.loadout.join(', ') ?? ''))}
        ${kv('Replay', faithful)}</div>
      <div class="ins-sec"><div class="ins-h">Agents killed by</div>${list(s.killers)}</div>
      <div class="ins-sec"><div class="ins-h">Damage taken from</div>${list(s.damage)}</div>
      <div class="ins-sec"><div class="ins-h">Shooting</div>
        ${list(s.shots, ' rounds')}
        ${kv('Hit rate', pct(s.hitRate))}
        ${kv('Fired on their own', pct(s.ownFire))}</div>
      <div class="ins-sec"><div class="ins-h">IPA</div>
        ${s.ipa.bars.map((b) => kv({ a: 'Adrenaline', p: 'Perception', i: 'Intelligence' }[b.ch], `dose ${b.dose.toFixed(2)} · boosted ${pct(b.boost)} · dulled ${pct(b.dull)}`)).join('')}
        ${kv('Mean dependency', s.ipa.dependency.toFixed(2))}
        ${kv('Overdrive', pct(s.ipa.overdrive))}
        <div class="tm-sparks"></div></div>`;
    this.drawSparks(rec);
  }

  /** Per-agent health (white) and IPA dose (solid) against dependency (dashed) over the mission. */
  private drawSparks(rec: Recording): void {
    const box = this.el.summary.querySelector('.tm-sparks')!;
    const end = rec.result.ticks || 1;
    rec.squad.forEach((a, i) => {
      const id = rec.samples[0]?.agents[i]?.id;
      const c = document.createElement('canvas');
      c.width = 560;
      c.height = 96;
      c.title = `${a.name}: health (white), IPA dose (solid) and dependency (dashed); A red, P yellow, I blue`;
      box.appendChild(c);
      const g = c.getContext('2d')!;
      g.font = '20px ui-monospace, monospace';
      g.fillStyle = AGENT_COLORS[i];
      g.fillText(a.name, 6, 22);
      const plot = (f: (s: Recording['samples'][number]['agents'][number]) => number, color: string, dash: boolean, alpha = 1) => {
        g.strokeStyle = color;
        g.globalAlpha = alpha;
        g.setLineDash(dash ? [6, 6] : []);
        g.lineWidth = 2;
        g.beginPath();
        let started = false;
        for (const s of rec.samples) {
          const ag = s.agents.find((x) => x.id === id);
          if (!ag || ag.hp <= 0) continue;
          const x = (s.tick / end) * c.width;
          const y = c.height - 4 - f(ag) * (c.height - 30);
          if (started) g.lineTo(x, y);
          else g.moveTo(x, y);
          started = true;
        }
        g.stroke();
      };
      plot((ag) => ag.hp / (a.hp || 100), '#ffffff', false, 0.5);
      for (const ch of ['a', 'p', 'i'] as const) {
        plot((ag) => ag.ipa[ch], IPA_COLORS[ch], false);
        plot((ag) => ag.dep[ch], IPA_COLORS[ch], true, 0.6);
      }
      g.globalAlpha = 1;
      g.setLineDash([]);
    });
  }

  private renderSquad(): void {
    const v = this.view!;
    const w = v.world;
    this.el.squad.innerHTML = w
      .agents()
      .map((a) => {
        const weapon = w.content.weapons[a.weapons[a.weaponIdx]]?.name ?? '';
        const state = !a.alive ? 'KIA' : `${a.holstered ? 'holstered' : weapon}${a.firing ? ' · firing' : a.autoFire ? ' · firing on its own' : ''}${a.overdrive ? ' · overdrive' : ''}`;
        const bar = (ch: 'a' | 'p' | 'i', label: string) =>
          `<div class="tm-ipa"><span>${label}</span><div class="tm-ipa-track"><i style="width:${a.ipa[ch] * 100}%;background:${IPA_COLORS[ch]}"></i><b style="left:${a.ipaDep[ch] * 100}%"></b></div></div>`;
        return `<div class="ins-sec tm-agent${a.alive ? '' : ' dead'}">
          <div class="ins-name" style="color:${AGENT_COLORS[a.slot]}">${esc(a.name)} <small>${Math.round(Math.max(0, a.hp))} / ${a.maxHp}</small></div>
          <div class="tm-hp"><i style="width:${Math.max(0, a.hp / a.maxHp) * 100}%"></i></div>
          <div class="ins-sub">${esc(state)}</div>
          ${bar('a', 'ADR')}${bar('p', 'PER')}${bar('i', 'INT')}</div>`;
      })
      .join('');
  }

  private onFrame(): void {
    const v = this.view;
    if (!v) return;
    const t = v.world.tick;
    this.el.time.textContent = `${fmt(t)} / ${fmt(v.end)}`;
    this.el.pos.style.left = `${(t / v.end) * 100}%`;
    this.el.play.textContent = v.paused || v.playback.done ? '▶' : '❚❚';
    this.el.speed.textContent = `${v.speed}×`;
    this.el.layers.querySelectorAll<HTMLElement>('[data-layer]').forEach((b) => b.classList.toggle('on', v.overlay.on.has(b.dataset.layer as Layer)));
    this.el.follow.querySelectorAll<HTMLElement>('[data-follow]').forEach((b) => b.classList.toggle('on', b.dataset.follow === String(v.follow)));
    const now = performance.now();
    if (now - this.panelAt < 200) return;
    this.panelAt = now;
    if (this.tab === 'squad') this.renderSquad();
    if (this.tab === 'log' && t !== this.lastLogTick) {
      this.lastLogTick = t;
      let current: HTMLElement | null = null;
      this.el.logList.querySelectorAll<HTMLElement>('.tm-ev').forEach((row) => {
        const past = Number(row.dataset.tick) <= t;
        row.classList.toggle('past', past);
        if (past) current = row;
      });
      this.el.logList.querySelectorAll('.tm-ev.now').forEach((r) => r.classList.remove('now'));
      if (current) {
        (current as HTMLElement).classList.add('now');
        if (!v.paused) (current as HTMLElement).scrollIntoView({ block: 'nearest' });
      }
    }
  }
}

export const telemetryTool: LabTool = new TelemetryTool();
(window as unknown as { labTelemetry: unknown }).labTelemetry = telemetryTool;
