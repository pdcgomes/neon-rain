import type { AudioSystem } from './audio/audio.ts';
import { Controls } from './input/controls.ts';
import { GameRenderer } from './render/renderer.ts';
import type { Command } from './sim/commands.ts';
import type { AgentDef, Content } from './sim/content.ts';
import { DT, World } from './sim/world.ts';
import { Hud } from './ui/hud.ts';

export interface GameResult {
  success: boolean;
  reason: string;
  world: World;
  kills: Map<number, number>;
}

export interface GameCallbacks {
  onEnd(result: GameResult): void;
  onPauseToggle(paused: boolean): void;
}

const MAX_STEPS_PER_FRAME = 8;

export class Game {
  readonly world: World;
  readonly view: GameRenderer;
  readonly controls: Controls;
  private hud: Hud;
  private audio: AudioSystem | null;
  private canvas: HTMLCanvasElement;
  private cb: GameCallbacks;
  private acc = 0;
  private last = performance.now();
  private time = 0;
  private raf = 0;
  private paused = false;
  private endAt = -1;
  private ended = false;
  private kills = new Map<number, number>();
  private fpsAvg = 60;
  private hudAt = 0;

  constructor(app: HTMLElement, content: Content, squad: AgentDef[], audio: AudioSystem | null, cb: GameCallbacks, seed?: number) {
    this.cb = cb;
    this.audio = audio;
    const old = document.getElementById('view');
    this.canvas = document.createElement('canvas');
    this.canvas.id = 'view';
    if (old) old.replaceWith(this.canvas);
    else app.prepend(this.canvas);

    this.world = new World(content, squad, seed);
    this.view = new GameRenderer(this.canvas, this.world);
    this.controls = new Controls(this.canvas, this.world, this.view, {
      onPause: () => this.togglePause(),
      onToggleStats: () => this.hud.toggleStats(),
      onMove: (x, z) => this.view.fx.movePulse(x, z),
    });
    this.hud = new Hud(document.getElementById('hud')!, this.world, this.controls);
    this.hud.show(true);
    this.audio?.startMission();
  }

  start(): void {
    this.last = performance.now();
    const loop = (now: number) => {
      this.raf = requestAnimationFrame(loop);
      this.frame(now);
    };
    this.raf = requestAnimationFrame(loop);
  }

  togglePause(force?: boolean): void {
    if (this.ended) return;
    this.paused = force ?? !this.paused;
    this.controls.enabled = !this.paused;
    if (this.paused) this.controls.release();
    this.audio?.setPaused(this.paused);
    this.cb.onPauseToggle(this.paused);
  }

  private frame(now: number): void {
    const dt = Math.max(0, Math.min(0.1, (now - this.last) / 1000));
    this.last = now;
    this.time += dt;
    this.fpsAvg += (1 / Math.max(dt, 1e-3) - this.fpsAvg) * 0.05;
    const world = this.world;

    if (!this.paused && !this.ended) {
      this.acc += dt * world.timeScale;
      let steps = 0;
      while (this.acc >= DT && steps++ < MAX_STEPS_PER_FRAME) {
        const cmds = this.controls.tick();
        world.step(cmds);
        this.acc -= DT;
        this.consume();
      }
      if (steps >= MAX_STEPS_PER_FRAME) this.acc = 0;
      if (this.endAt < 0 && (world.phase === 'success' || world.phase === 'fail')) {
        this.endAt = this.time + 2.8;
        this.controls.enabled = false;
        this.controls.release();
      }
      if (this.endAt > 0 && this.time >= this.endAt) this.finish();
    }

    this.controls.frame(dt);
    this.view.render(Math.min(1, this.acc / DT), dt, this.time, {
      selected: this.controls.selected,
      cursor: this.controls.cursor,
      aiming: this.controls.aiming,
      overdrive: world.timeScale < 1,
    });
    const veil = document.getElementById('overdrive-veil');
    if (veil) veil.classList.toggle('on', world.timeScale < 1);

    if (this.time - this.hudAt > 0.1) {
      this.hudAt = this.time;
      const t = this.view.rig.target;
      this.hud.update(this.fpsAvg, this.view.renderScale, { yaw: this.view.rig.yawAngle, x: t.x, z: t.z });
    }
    this.audio?.frame(world, this.view.rig.target, this.view.rig.yawAngle);
  }

  /** Debug/automation: advance the sim without waiting for frames, optionally issuing commands first. */
  advance(ticks: number, commands: Command[] = []): number {
    for (let i = 0; i < ticks && this.world.phase !== 'success' && this.world.phase !== 'fail'; i++) {
      this.world.step(i === 0 ? [...commands, ...this.controls.tick()] : this.controls.tick());
      this.consume();
    }
    return this.world.tick;
  }

  private consume(): void {
    const world = this.world;
    const events = world.events;
    if (!events.length) return;
    for (const ev of events) {
      if (ev.t === 'death') {
        const by = world.get(ev.by);
        if (by && by.kind === 'agent' && ev.kind !== 'civilian') this.kills.set(by.id, (this.kills.get(by.id) ?? 0) + 1);
      }
    }
    this.view.onEvents(events);
    this.hud.onEvents(events);
    this.audio?.onEvents(events, world, this.view.rig.target, this.view.rig.yawAngle);
  }

  private finish(): void {
    if (this.ended) return;
    this.ended = true;
    this.hud.show(false);
    this.audio?.endMission(this.world.phase === 'success');
    this.cb.onEnd({
      success: this.world.phase === 'success',
      reason: this.world.resultReason,
      world: this.world,
      kills: this.kills,
    });
  }

  dispose(): void {
    cancelAnimationFrame(this.raf);
    this.controls.dispose();
    this.view.dispose();
    this.hud.show(false);
  }
}
