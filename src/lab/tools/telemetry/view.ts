import { Controls } from '../../../input/controls.ts';
import { GameRenderer } from '../../../render/renderer.ts';
import { Playback, type Recording } from '../../../sim/telemetry.ts';
import { DT } from '../../../sim/world.ts';
import { Overlay, type OverlayData } from './overlay.ts';

export const SPEEDS = [0.25, 0.5, 1, 2, 4, 8];
const MAX_STEPS_PER_FRAME = 64;
export type Follow = 'squad' | 'free' | number;

/**
 * A recording played back in the game's renderer inside a Lab panel. The world only ever gets the
 * recorded commands; the viewer's controls move the camera and nothing else.
 */
export class ReplayView {
  readonly rec: Recording;
  playback!: Playback;
  paused = true;
  speed = 1;
  follow: Follow = 'squad';
  data: OverlayData | undefined;
  readonly overlay: Overlay;
  private view!: GameRenderer;
  private controls!: Controls;
  private canvas!: HTMLCanvasElement;
  private readonly host: HTMLElement;
  private acc = 0;
  private last = performance.now();
  private time = 0;
  private raf = 0;
  private busy = false;
  private target = 0;
  private resizer: ResizeObserver;
  private onFrame: () => void;

  constructor(host: HTMLElement, rec: Recording, onFrame: () => void) {
    this.host = host;
    this.rec = rec;
    this.onFrame = onFrame;
    this.overlay = new Overlay(host);
    this.build();
    this.resizer = new ResizeObserver(() => this.view.resize());
    this.resizer.observe(host);
  }

  get world() {
    return this.playback.world;
  }

  get end(): number {
    return this.rec.result.ticks;
  }

  get seeking(): boolean {
    return this.busy;
  }

  private build(): void {
    this.playback = new Playback(this.rec);
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'tm-canvas';
    this.host.prepend(this.canvas);
    this.view = new GameRenderer(this.canvas, this.playback.world);
    this.attachControls();
  }

  /** Restarts the recording from tick 0 in the same renderer, so the camera and GPU state survive. */
  private rewind(): void {
    this.playback = new Playback(this.rec);
    this.view.setWorld(this.playback.world);
    this.controls.dispose();
    this.attachControls();
  }

  private attachControls(): void {
    this.controls = new Controls(this.canvas, this.playback.world, this.view, {
      onPause: () => (this.paused = !this.paused),
      onToggleStats: () => {},
      onMove: () => {},
    });
    // Camera only: disabled controls turn clicks and keys into no commands at all.
    this.controls.enabled = false;
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
    this.resizer.disconnect();
    this.controls.dispose();
    this.view.dispose();
    this.canvas.remove();
    this.overlay.dispose();
  }

  /**
   * Jumps to a tick: forward by fast simulation, backward by restarting and fast-forwarding. Runs in
   * slices so long missions stay responsive; a seek issued mid-way retargets the running one.
   */
  async seek(tick: number): Promise<void> {
    this.target = Math.max(0, Math.min(this.end, Math.round(tick)));
    if (this.busy) return;
    this.busy = true;
    try {
      for (;;) {
        if (this.target < this.world.tick) this.rewind();
        const stop = performance.now() + 30;
        while (this.world.tick < this.target && performance.now() < stop) {
          for (let i = 0; i < 60 && this.world.tick < this.target; i++) this.playback.step();
        }
        if (this.world.tick >= this.target) break;
        await new Promise((r) => setTimeout(r, 0));
      }
    } finally {
      this.busy = false;
      this.acc = 0;
    }
  }

  resetView(): void {
    this.view.rig.resetView();
  }

  topDown(): void {
    this.view.rig.toggleTopDown();
  }

  private frame(now: number): void {
    const dt = Math.max(0, Math.min(0.1, (now - this.last) / 1000));
    this.last = now;
    this.time += dt;
    const w = this.world;
    if (!this.paused && !this.busy && !this.playback.done) {
      this.acc += dt * this.speed * w.timeScale;
      let steps = 0;
      while (this.acc >= DT && steps++ < MAX_STEPS_PER_FRAME && !this.playback.done) {
        this.playback.step();
        if (this.speed <= 4) this.view.onEvents(w.events);
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
    this.overlay.draw(this.view, w, this.rec, this.data);
    this.onFrame();
  }
}
