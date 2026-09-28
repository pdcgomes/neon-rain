import { Howl, Howler } from 'howler';
import type * as THREE from 'three';
import type { SimEvent } from '../sim/types.ts';
import type { World } from '../sim/world.ts';
import * as synth from './synth.ts';

type SoundId =
  | 'pistol'
  | 'uzi'
  | 'minigun'
  | 'enemy'
  | 'gauss'
  | 'explosion'
  | 'impact'
  | 'thud'
  | 'persuade'
  | 'persuaded'
  | 'objective'
  | 'radio'
  | 'siren'
  | 'flatline'
  | 'click'
  | 'success'
  | 'fail'
  | 'horn'
  | 'crash'
  | 'type';

const HEAR = 55;
const TYPE_GAP_MS = 50;
/** Readout bleeps hop between root, 2nd, 4th and 5th rather than drifting randomly. */
const TYPE_STEPS = [1, 1.122, 1.335, 1.498];

export class AudioSystem {
  private sounds = new Map<SoundId, Howl>();
  private rain: Howl | null = null;
  private pad: Howl | null = null;
  private combat: Howl | null = null;
  private ready = false;
  private combatLevel = 0;
  private rainGain = 0;
  private rainLevel = 0.5;
  private slow = false;
  private lastType = 0;

  /** Safe before a user gesture: Howler resumes the audio context on the first interaction. */
  init(): void {
    if (this.ready) return;
    this.ready = true;
    const mk = (src: string, opts: Partial<{ volume: number; pool: number; loop: boolean }> = {}) =>
      new Howl({ src: [src], format: ['wav'], volume: opts.volume ?? 1, pool: opts.pool ?? 8, loop: opts.loop ?? false });
    this.sounds.set('pistol', mk(synth.gunshot('pistol'), { volume: 0.55, pool: 12 }));
    this.sounds.set('uzi', mk(synth.gunshot('uzi'), { volume: 0.45, pool: 24 }));
    this.sounds.set('minigun', mk(synth.gunshot('minigun'), { volume: 0.35, pool: 32 }));
    this.sounds.set('enemy', mk(synth.gunshot('enemy'), { volume: 0.4, pool: 24 }));
    this.sounds.set('gauss', mk(synth.gauss(), { volume: 0.7 }));
    this.sounds.set('explosion', mk(synth.explosion(), { volume: 0.9 }));
    this.sounds.set('impact', mk(synth.impact(), { volume: 0.25, pool: 16 }));
    this.sounds.set('thud', mk(synth.thud(), { volume: 0.4, pool: 12 }));
    this.sounds.set('persuade', mk(synth.persuadeHum(), { volume: 0.35 }));
    this.sounds.set('persuaded', mk(synth.chime([523.25, 659.25, 783.99, 1046.5], 0.06, 0.25), { volume: 0.4 }));
    this.sounds.set('objective', mk(synth.chime([293.66, 440, 587.33], 0.12, 0.5), { volume: 0.5 }));
    this.sounds.set('radio', mk(synth.radioBlip(), { volume: 0.5 }));
    this.sounds.set('siren', mk(synth.siren(), { volume: 0.35 }));
    this.sounds.set('flatline', mk(synth.flatline(), { volume: 0.4 }));
    this.sounds.set('click', mk(synth.click(), { volume: 0.4 }));
    this.sounds.set('success', mk(synth.chime([293.66, 369.99, 440, 587.33, 739.99], 0.14, 0.8), { volume: 0.55 }));
    this.sounds.set('fail', mk(synth.chime([293.66, 277.18, 220, 146.83], 0.22, 0.9), { volume: 0.55 }));
    this.sounds.set('horn', mk(synth.horn(), { volume: 0.4, pool: 6 }));
    this.sounds.set('crash', mk(synth.carCrash(), { volume: 0.7, pool: 6 }));
    this.sounds.set('type', mk(synth.dataTick(), { volume: 0.3, pool: 12 }));
    this.rain = mk(synth.rainLoop(), { volume: 0, loop: true, pool: 1 });
    this.pad = mk(synth.padLoop(), { volume: 0, loop: true, pool: 1 });
    this.combat = mk(synth.combatLoop(), { volume: 0, loop: true, pool: 1 });
  }

  ui(): void {
    this.play('click');
  }

  /** Before the first user gesture Howler queues plays until unlock, which would dump every tick at once. */
  typeChar(text: string): void {
    if (!this.ready || !/\S/.test(text) || navigator.userActivation?.hasBeenActive === false) return;
    const now = performance.now();
    if (now - this.lastType < TYPE_GAP_MS) return;
    this.lastType = now;
    const stop = /[.,:;!?]/.test(text);
    const rate = stop ? 0.891 : TYPE_STEPS[Math.floor(Math.random() * TYPE_STEPS.length)];
    this.play('type', stop ? 1 : 0.75 + Math.random() * 0.25, (Math.random() - 0.5) * 0.2, rate);
  }

  private play(id: SoundId, vol = 1, pan = 0, rate = 1): void {
    const s = this.sounds.get(id);
    if (!s) return;
    const h = s.play();
    s.volume(s.volume() * vol, h);
    s.stereo(Math.max(-1, Math.min(1, pan)), h);
    s.rate(rate * (this.slow ? 0.72 : 1), h);
  }

  private spatial(x: number, y: number, listener: THREE.Vector3, yaw: number): { vol: number; pan: number } {
    const dx = x - listener.x;
    const dz = y - listener.z;
    const d = Math.hypot(dx, dz);
    const right = dx * Math.cos(yaw) - dz * Math.sin(yaw);
    return { vol: Math.max(0, 1 - d / HEAR) ** 1.5, pan: right / 25 };
  }

  onEvents(events: readonly SimEvent[], world: World, listener: THREE.Vector3, yaw: number): void {
    if (!this.ready) return;
    let impacts = 0;
    for (const ev of events) {
      switch (ev.t) {
        case 'shot': {
          const { vol, pan } = this.spatial(ev.x, ev.y, listener, yaw);
          if (vol <= 0.01) break;
          const id: SoundId =
            ev.weapon === 'gauss' ? 'gauss' : ev.faction !== 'player' ? 'enemy' : ev.weapon === 'minigun' ? 'minigun' : ev.weapon === 'uzi' ? 'uzi' : 'pistol';
          this.play(id, vol, pan, 0.94 + Math.random() * 0.12);
          break;
        }
        case 'impact': {
          if (impacts++ > 2) break;
          const { vol, pan } = this.spatial(ev.x, ev.y, listener, yaw);
          if (vol > 0.05) this.play('impact', vol, pan, 0.8 + Math.random() * 0.5);
          break;
        }
        case 'hit': {
          const { vol, pan } = this.spatial(ev.x, ev.y, listener, yaw);
          if (vol > 0.05) this.play('thud', vol, pan, 0.9 + Math.random() * 0.3);
          break;
        }
        case 'explosion': {
          const { vol, pan } = this.spatial(ev.x, ev.y, listener, yaw);
          this.play('explosion', Math.max(0.25, vol), pan, 0.9 + Math.random() * 0.15);
          break;
        }
        case 'persuading': {
          const { vol, pan } = this.spatial(ev.x, ev.y, listener, yaw);
          this.play('persuade', Math.max(0.3, vol), pan);
          break;
        }
        case 'persuaded':
          this.play('persuaded');
          break;
        case 'death': {
          const e = world.get(ev.id);
          if (e?.kind === 'agent') this.play('flatline');
          break;
        }
        case 'bark':
          this.play('radio');
          if (ev.tone === 'police' && ev.id === -1) this.play('siren', 0.8);
          break;
        case 'objective':
          this.play('objective');
          break;
        case 'horn': {
          const { vol, pan } = this.spatial(ev.x, ev.y, listener, yaw);
          if (vol > 0.05) this.play('horn', vol, pan, 0.95 + Math.random() * 0.1);
          break;
        }
        case 'carHit': {
          const { vol, pan } = this.spatial(ev.x, ev.y, listener, yaw);
          if (vol > 0.05) this.play('crash', vol, pan);
          break;
        }
        case 'alarm':
          this.play('siren', 0.6);
          break;
        default:
          break;
      }
    }
  }

  frame(world: World, _listener: THREE.Vector3, _yaw: number): void {
    if (!this.ready) return;
    const slow = world.timeScale < 1;
    if (slow !== this.slow) {
      this.slow = slow;
      for (const l of [this.rain, this.pad, this.combat]) l?.rate(slow ? 0.72 : 1);
    }
    this.rainGain += (0.04 + 0.6 * this.rainLevel - this.rainGain) * 0.02;
    this.rain?.volume(this.rainGain);
    const hot = world.alarm || world.policeHostile ? 1 : 0;
    this.combatLevel += (hot - this.combatLevel) * 0.01;
    this.combat?.volume(this.combatLevel * 0.45);
  }

  startMission(): void {
    if (!this.ready) return;
    if (this.rain && !this.rain.playing()) this.rain.play();
    this.rainGain = 0;
    for (const [l, v] of [
      [this.pad, 0.5],
      [this.combat, 0],
    ] as const) {
      if (!l) continue;
      if (!l.playing()) l.play();
      l.fade(l.volume(), v, 1500);
    }
    this.combatLevel = 0;
  }

  /** Rain intensity, 0 dry .. 1 heavy; the rain bed follows it smoothly. */
  setRain(level: number): void {
    this.rainLevel = level;
  }

  endMission(success: boolean): void {
    if (!this.ready) return;
    this.play(success ? 'success' : 'fail');
    this.combat?.fade(this.combat.volume(), 0, 1200);
  }

  setPaused(paused: boolean): void {
    if (!this.ready) return;
    Howler.volume(paused ? 0.25 : 1);
  }
}
