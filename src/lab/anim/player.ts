import * as THREE from 'three';
import type { LabAsset } from '../kits/types.ts';
import { clipSpec } from './catalogue.ts';

export interface AnimEntry {
  asset: LabAsset;
  /** The object the mixer is bound to (the asset's own root). */
  target: THREE.Object3D;
  mixer: THREE.AnimationMixer;
  /** Clip this entry always plays (clip-grid), otherwise it follows the shared timeline clip. */
  fixedClip?: string;
  /** Seconds added to the shared clock (desyncs crowds). */
  offset: number;
  actions: Map<string, THREE.AnimationAction>;
}

export interface Crossfade {
  enabled: boolean;
  a: string;
  b: string;
  blend: number;
  /** When the blend starts (s). */
  at: number;
}

/**
 * Drives every animated asset on the current board from a single timeline clock. Poses are
 * evaluated at an absolute time (no wall-clock accumulation), so pause, scrub and headless
 * captures are exact and repeatable.
 */
export class AnimPlayer {
  entries: AnimEntry[] = [];
  time = 0;
  playing = true;
  speed = 1;
  loop = true;
  clip = 'idle';
  crossfade: Crossfade = { enabled: false, a: 'walk', b: 'run', blend: 0.3, at: 1.0 };

  register(asset: LabAsset, target: THREE.Object3D, opts: { fixedClip?: string; offset?: number } = {}): AnimEntry | null {
    if (!asset.clips.length) return null;
    const e: AnimEntry = { asset, target, mixer: new THREE.AnimationMixer(target), fixedClip: opts.fixedClip, offset: opts.offset ?? 0, actions: new Map() };
    this.entries.push(e);
    return e;
  }

  clear(): void {
    for (const e of this.entries) e.mixer.stopAllAction();
    this.entries = [];
  }

  private action(e: AnimEntry, name: string): THREE.AnimationAction | null {
    let a = e.actions.get(name);
    if (!a) {
      const clip = e.asset.clips.find((c) => c.name === name);
      if (!clip) return null;
      a = e.mixer.clipAction(clip);
      a.play();
      a.setEffectiveWeight(0);
      e.actions.set(name, a);
    }
    return a;
  }

  private clipLength(name: string): number {
    for (const e of this.entries) {
      const c = e.asset.clips.find((x) => x.name === name);
      if (c) return c.duration;
    }
    return clipSpec(name)?.duration ?? 1;
  }

  /** Length of what the timeline is showing: the shared clip, or the whole crossfade test. */
  duration(): number {
    if (this.crossfade.enabled) return this.crossfade.at + this.crossfade.blend + this.clipLength(this.crossfade.b);
    return this.clipLength(this.clip);
  }

  tick(dt: number): void {
    if (this.playing) {
      this.time += dt * this.speed;
      const d = this.duration();
      if (this.time > d) this.time = this.loop ? this.time % d : d;
    }
    this.apply();
  }

  seek(t: number): void {
    this.time = Math.max(0, Math.min(this.duration(), t));
    this.apply();
  }

  step(frames: number): void {
    this.playing = false;
    this.seek(this.time + frames / 30);
  }

  /** Evaluates every entry at the current time. */
  apply(): void {
    for (const e of this.entries) this.evaluate(e, this.time + e.offset);
  }

  evaluate(e: AnimEntry, t: number): void {
    for (const a of e.actions.values()) a.setEffectiveWeight(0);
    const local = (name: string, tt: number) => {
      const len = this.clipLength(name);
      const spec = clipSpec(name);
      const loops = e.fixedClip || this.crossfade.enabled ? spec?.loop ?? true : true;
      return loops ? ((tt % len) + len) % len : Math.min(Math.max(0, tt), len);
    };
    if (this.crossfade.enabled && !e.fixedClip) {
      const cf = this.crossfade;
      const w = THREE.MathUtils.clamp((t - cf.at) / Math.max(1e-3, cf.blend), 0, 1);
      const a = this.action(e, cf.a);
      const b = this.action(e, cf.b);
      if (a) {
        a.time = local(cf.a, t);
        a.setEffectiveWeight(b ? 1 - w : 1);
      }
      if (b) {
        b.time = local(cf.b, t - cf.at);
        b.setEffectiveWeight(a ? w : 1);
      }
    } else {
      const name = e.fixedClip ?? this.clip;
      const a = this.action(e, name);
      if (a) {
        a.time = local(name, t);
        a.setEffectiveWeight(1);
      }
    }
    e.mixer.update(0);
  }

  frameCount(): number {
    return Math.round(this.duration() * 30);
  }
}
