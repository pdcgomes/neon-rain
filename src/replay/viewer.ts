/**
 * Plays a telemetry recording back in the game's renderer: the world is rebuilt from the recorded
 * content, seed and balance and fed the recorded commands, so nothing the viewer does can change
 * what happened. The camera is free (or follows the squad or one agent), playback can be paused,
 * sped up, stepped and scrubbed, and data overlays can be drawn over the scene.
 *
 *   Space  play/pause     ← →  back/forward 5 s (Shift: 30 s)     , .  one tick (paused)
 *   [ ]    slower/faster  Tab  follow squad   1-4  follow agent   0  free camera
 *   T K V L N  overlays (trails, deaths, vision, aim lines, labels)  WASD Q E  camera  F Y  reset/top-down  Esc exit
 */
import { Controls } from '../input/controls.ts';
import { GameRenderer } from '../render/renderer.ts';
import { balance, type Balance } from '../sim/balance.ts';
import type { Command } from '../sim/commands.ts';
import type { Recording } from '../sim/telemetry.ts';
import { DT, TICK_HZ, World } from '../sim/world.ts';
import { Hud } from '../ui/hud.ts';
import { LAYERS, Overlay } from './overlay.ts';

const SPEEDS = [0.25, 0.5, 1, 2, 4, 8];
const MAX_STEPS_PER_FRAME = 64;
type Follow = 'squad' | 'free' | number;

export class ReplayViewer {
  private readonly rec: Recording;
  private readonly app: HTMLElement;
  private readonly onExit: () => void;
  private readonly savedBalance: Balance;
  private world!: World;
  private view!: GameRenderer;
  private controls!: Controls;
  private hud!: Hud;
  private overlay!: Overlay;
  private canvas!: HTMLCanvasElement;
  private next = 0;
  private paused = false;
  private speed = 2;
  private follow: Follow = 'squad';
  private acc = 0;
  private last = performance.now();
  private time = 0;
  private raf = 0;
  private verdict = '';
  private panel = document.createElement('div');
  private abort = new AbortController();
  private busy = false;

  constructor(app: HTMLElement, rec: Recording, onExit: () => void) {
    this.app = app;
    this.rec = rec;
    this.onExit = onExit;
    this.savedBalance = { ...balance };
    Object.assign(balance, rec.balance);
    document.body.classList.add('replaying');
    this.build();
    this.buildPanel();
    window.addEventListener('keydown', (e) => this.onKey(e), { signal: this.abort.signal });
  }

  private get end(): number {
    return this.rec.result.ticks;
  }

  /** (Re)creates the world, renderer, camera controls, HUD and overlay at tick 0. */
  private build(): void {
    this.view?.dispose();
    this.controls?.dispose();
    this.overlay?.dispose();
    const rec = this.rec;
    this.world = new World({ weapons: rec.weapons, agents: [], mission: rec.mission }, rec.squad, rec.seed);
    this.next = 0;
    this.verdict = '';
    const old = document.getElementById('view');
    this.canvas = document.createElement('canvas');
    this.canvas.id = 'view';
    if (old) old.replaceWith(this.canvas);
    else this.app.prepend(this.canvas);
    this.view = new GameRenderer(this.canvas, this.world);
    // Camera only: with controls disabled, clicks and keys issue no commands.
    this.controls = new Controls(this.canvas, this.world, this.view, {
      onPause: () => this.togglePause(),
      onToggleStats: () => {},
      onMove: () => {},
    });
    this.controls.enabled = false;
    this.hud = new Hud(document.getElementById('hud')!, this.world, this.controls);
    this.hud.show(true);
    this.overlay = new Overlay(this.app);
  }

  async start(): Promise<void> {
    await this.view.warmup();
    this.last = performance.now();
    const loop = (now: number) => {
      this.raf = requestAnimationFrame(loop);
      this.frame(now);
    };
    this.raf = requestAnimationFrame(loop);
  }

  dispose(): void {
    cancelAnimationFrame(this.raf);
    this.abort.abort();
    this.controls.dispose();
    this.view.dispose();
    this.overlay.dispose();
    this.hud.show(false);
    this.panel.remove();
    document.body.classList.remove('replaying');
    Object.assign(balance, this.savedBalance);
  }

  // ------------------------------------------------------------------ playback

  private commandsAt(tick: number): Command[] {
    const c = this.rec.commands;
    if (this.next < c.length && c[this.next][0] === tick) return c[this.next++][1];
    return [];
  }

  private stepOnce(fx: boolean): void {
    const w = this.world;
    w.step(this.commandsAt(w.tick));
    if (fx) {
      this.view.onEvents(w.events);
      this.hud.onEvents(w.events);
    }
    if (w.tick === this.end) {
      this.verdict = w.checksum() === this.rec.result.checksum ? 'replay matches the recording' : 'replay diverged: the sim has changed since this was recorded';
    }
  }

  /** Jumps to a tick: forward by fast simulation, backward by rebuilding and fast-forwarding. */
  private async seek(tick: number): Promise<void> {
    if (this.busy) return;
    const target = Math.max(0, Math.min(this.end, Math.round(tick)));
    if (target < this.world.tick) {
      this.busy = true;
      this.build();
      await this.view.warmup();
      this.busy = false;
    }
    while (this.world.tick < target) this.stepOnce(false);
    this.acc = 0;
  }

  private togglePause(): void {
    this.paused = !this.paused;
  }

  private frame(now: number): void {
    const dt = Math.max(0, Math.min(0.1, (now - this.last) / 1000));
    this.last = now;
    this.time += dt;
    const w = this.world;
    if (!this.paused && !this.busy && w.tick < this.end) {
      this.acc += dt * this.speed * w.timeScale;
      let steps = 0;
      while (this.acc >= DT && steps++ < MAX_STEPS_PER_FRAME && w.tick < this.end) {
        this.stepOnce(this.speed <= 4);
        this.acc -= DT;
      }
      if (steps >= MAX_STEPS_PER_FRAME) this.acc = 0;
    }

    this.controls.frame(dt);
    let selected = new Set<number>();
    if (this.follow === 'squad') selected = new Set(w.livingAgents().map((a) => a.id));
    else if (typeof this.follow === 'number') {
      const a = w.agents().find((x) => x.slot === this.follow);
      if (a?.alive) selected.add(a.id);
    } else this.view.rig.commitPan();
    this.view.render(Math.min(1, this.acc / DT), dt, this.time, { selected, cursor: null, aiming: false, overdrive: w.timeScale < 1 });
    this.overlay.draw(this.view, w, this.rec);
    const t = this.view.rig.target;
    this.hud.update(60, this.view.renderScale, { yaw: this.view.rig.yawAngle, x: t.x, z: t.z });
    this.updatePanel();
  }

  // ------------------------------------------------------------------ input

  private onKey(e: KeyboardEvent): void {
    const step = e.shiftKey ? 30 : 5;
    const i = SPEEDS.indexOf(this.speed);
    switch (e.code) {
      case 'Space':
        e.preventDefault();
        this.togglePause();
        break;
      case 'ArrowLeft':
        void this.seek(this.world.tick - step * TICK_HZ);
        break;
      case 'ArrowRight':
        void this.seek(this.world.tick + step * TICK_HZ);
        break;
      case 'Comma':
        if (this.paused) void this.seek(this.world.tick - 1);
        break;
      case 'Period':
        if (this.paused) void this.seek(this.world.tick + 1);
        break;
      case 'BracketLeft':
        this.speed = SPEEDS[Math.max(0, i - 1)];
        break;
      case 'BracketRight':
        this.speed = SPEEDS[Math.min(SPEEDS.length - 1, i + 1)];
        break;
      case 'Tab':
        e.preventDefault();
        this.follow = 'squad';
        break;
      case 'Digit0':
        this.follow = 'free';
        break;
      case 'Digit1':
      case 'Digit2':
      case 'Digit3':
      case 'Digit4':
        this.follow = Number(e.code.slice(5)) - 1;
        break;
      case 'KeyF':
        this.view.rig.resetView();
        break;
      case 'KeyY':
        this.view.rig.toggleTopDown();
        break;
      case 'Escape':
        this.dispose();
        this.onExit();
        break;
      default: {
        const layer = LAYERS.find((l) => l.key === e.code);
        if (layer) {
          if (this.overlay.on.has(layer.id)) this.overlay.on.delete(layer.id);
          else this.overlay.on.add(layer.id);
        }
      }
    }
  }

  // ------------------------------------------------------------------ panel

  private buildPanel(): void {
    const rec = this.rec;
    const p = this.panel;
    p.className = 'replay-panel';
    const outcome = rec.result.abandoned ? 'abandoned' : rec.result.phase === 'success' ? 'success' : 'failed';
    p.innerHTML = `
      <div class="rp-head">
        <b>REPLAY</b> ${rec.mission.codename} · ${rec.player} · ${rec.recordedAt.slice(0, 16).replace('T', ' ')} · ${outcome}${rec.result.reason ? ` (${rec.result.reason})` : ''}
        <span class="rp-verdict"></span>
        <button class="rp-exit" title="Esc">✕</button>
      </div>
      <div class="rp-bar">
        <button class="rp-play" title="Space">❚❚</button>
        <span class="rp-time"></span>
        <div class="rp-track"><div class="rp-marks"></div><div class="rp-head-pos"></div></div>
        <span class="rp-speed" title="[ ]"></span>
      </div>
      <div class="rp-tools">
        <span>Camera</span>
        <button data-follow="squad" title="Tab">Squad</button>
        ${rec.squad.map((a, i) => `<button data-follow="${i}" title="${i + 1}">${a.name}</button>`).join('')}
        <button data-follow="free" title="0 · WASD to move">Free</button>
        <span>Overlays</span>
        ${LAYERS.map((l) => `<button data-layer="${l.id}" title="${l.key.slice(3)}">${l.label}</button>`).join('')}
      </div>
      <div class="rp-ipa"></div>`;
    document.body.appendChild(p);

    // Timeline marks: the alarm, objectives, and each agent's death.
    const marks = p.querySelector<HTMLElement>('.rp-marks')!;
    const mark = (tick: number, cls: string, title: string) => {
      const m = document.createElement('i');
      m.className = cls;
      m.style.left = `${(tick / this.end) * 100}%`;
      m.title = `${Math.round(tick / TICK_HZ)}s ${title}`;
      marks.appendChild(m);
    };
    for (const m of rec.marks) mark(m.tick, m.what.startsWith('objective') ? 'obj' : 'alarm', m.what);
    for (const d of rec.deaths) if (d.kind === 'agent') mark(d.tick, 'death', `${d.name} killed by ${d.by ? `${d.by.name || d.by.kind} (${d.by.weapon})` : '?'}`);

    const track = p.querySelector<HTMLElement>('.rp-track')!;
    const scrub = (e: MouseEvent) => {
      const r = track.getBoundingClientRect();
      void this.seek(((e.clientX - r.left) / r.width) * this.end);
    };
    track.addEventListener('mousedown', (e) => {
      scrub(e);
      const move = (e2: MouseEvent) => scrub(e2);
      window.addEventListener('mousemove', move);
      window.addEventListener('mouseup', () => window.removeEventListener('mousemove', move), { once: true });
    });
    p.querySelector('.rp-play')!.addEventListener('click', () => this.togglePause());
    p.querySelector('.rp-exit')!.addEventListener('click', () => {
      this.dispose();
      this.onExit();
    });
    p.querySelector('.rp-speed')!.addEventListener('click', () => {
      this.speed = SPEEDS[(SPEEDS.indexOf(this.speed) + 1) % SPEEDS.length];
    });
    p.querySelectorAll<HTMLButtonElement>('[data-follow]').forEach((b) =>
      b.addEventListener('click', () => {
        const f = b.dataset.follow!;
        this.follow = f === 'squad' || f === 'free' ? f : Number(f);
      }),
    );
    p.querySelectorAll<HTMLButtonElement>('[data-layer]').forEach((b) =>
      b.addEventListener('click', () => {
        const id = b.dataset.layer as (typeof LAYERS)[number]['id'];
        if (this.overlay.on.has(id)) this.overlay.on.delete(id);
        else this.overlay.on.add(id);
      }),
    );

    // Per-agent IPA sparklines over the whole recording: dose (solid) and dependency (dashed).
    const ipa = p.querySelector<HTMLElement>('.rp-ipa')!;
    rec.squad.forEach((a, i) => {
      const id = rec.samples[0]?.agents[i]?.id;
      const wrap = document.createElement('div');
      wrap.className = 'rp-spark';
      const cv = document.createElement('canvas');
      cv.width = 220;
      cv.height = 44;
      wrap.title = `${a.name}: IPA dose (solid) and dependency (dashed); A red, P yellow, I blue`;
      wrap.append(cv, Object.assign(document.createElement('i'), { className: 'rp-cursor' }));
      ipa.appendChild(wrap);
      const g = cv.getContext('2d')!;
      g.fillStyle = 'rgba(255,255,255,0.8)';
      g.font = '10px "Share Tech Mono", monospace';
      g.fillText(a.name, 2, 10);
      const colors = { a: '#ff5a7a', p: '#ffd24d', i: '#6fb8ff' } as const;
      for (const ch of ['a', 'p', 'i'] as const) {
        for (const dep of [false, true]) {
          g.strokeStyle = colors[ch];
          g.globalAlpha = dep ? 0.6 : 1;
          g.setLineDash(dep ? [3, 3] : []);
          g.beginPath();
          rec.samples.forEach((s, k) => {
            const ag = s.agents.find((x) => x.id === id);
            if (!ag || ag.hp <= 0) return;
            const x = (s.tick / this.end) * cv.width;
            const y = cv.height - 2 - (dep ? ag.dep[ch] : ag.ipa[ch]) * (cv.height - 14);
            if (k === 0) g.moveTo(x, y);
            else g.lineTo(x, y);
          });
          g.stroke();
        }
      }
      g.globalAlpha = 1;
      g.setLineDash([]);
    });
  }

  private updatePanel(): void {
    const p = this.panel;
    const t = this.world.tick;
    const fmt = (ticks: number) => {
      const s = Math.floor(ticks / TICK_HZ);
      return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
    };
    p.querySelector('.rp-time')!.textContent = `${fmt(t)} / ${fmt(this.end)}`;
    p.querySelector<HTMLElement>('.rp-head-pos')!.style.left = `${(t / this.end) * 100}%`;
    p.querySelector('.rp-play')!.textContent = this.paused || t >= this.end ? '▶' : '❚❚';
    p.querySelector('.rp-speed')!.textContent = `${this.speed}×`;
    p.querySelector('.rp-verdict')!.textContent = this.busy ? 'seeking…' : this.verdict;
    p.querySelectorAll<HTMLButtonElement>('[data-follow]').forEach((b) => b.classList.toggle('on', String(this.follow) === b.dataset.follow));
    p.querySelectorAll<HTMLButtonElement>('[data-layer]').forEach((b) => b.classList.toggle('on', this.overlay.on.has(b.dataset.layer as never)));
    const x = `${(t / this.end) * 100}%`;
    p.querySelectorAll<HTMLElement>('.rp-cursor').forEach((c) => (c.style.left = x));
  }
}
