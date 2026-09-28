import * as THREE from 'three';
import type { AtmosphereDef } from '../sim/content.ts';

/** Everything the renderer needs to light a scene at a given hour. Colours are hex, intensities scalars. */
export interface Palette {
  fog: THREE.Color;
  fogDensity: number;
  /** Environment/sky gradient: below horizon, zenith, and the smog band glowing on the horizon. */
  skyLow: THREE.Color;
  skyHigh: THREE.Color;
  horizon: THREE.Color;
  envIntensity: number;
  hemiSky: THREE.Color;
  hemiGround: THREE.Color;
  hemi: number;
  /** Key light (moon or smog-filtered sun). */
  key: THREE.Color;
  keyIntensity: number;
  keyElevation: number;
  rim: THREE.Color;
  rimIntensity: number;
  bloom: number;
  bloomThreshold: number;
  /** Share of office windows lit, 0..1. */
  windows: number;
  /** Street lamp brightness, 0..1. */
  lamps: number;
  rain: THREE.Color;
}

const COLOR_KEYS = ['fog', 'skyLow', 'skyHigh', 'horizon', 'hemiSky', 'hemiGround', 'key', 'rim', 'rain'] as const;
const NUM_KEYS = [
  'fogDensity', 'envIntensity', 'hemi', 'keyIntensity', 'keyElevation', 'rimIntensity', 'bloom', 'bloomThreshold', 'windows', 'lamps',
] as const;

type Key = { hour: number } & Record<(typeof COLOR_KEYS)[number] | (typeof NUM_KEYS)[number], number>;

const k = (p: Key) => p;
const NIGHT = {
  fog: 0x0a0918, fogDensity: 0.0105, skyLow: 0x0d0817, skyHigh: 0x141233, horizon: 0x59144d, envIntensity: 0.9,
  hemiSky: 0x5a5fb0, hemiGround: 0x120818, hemi: 0.9, key: 0x9fb4ff, keyIntensity: 1.1, keyElevation: 1.09,
  rim: 0xff4fb8, rimIntensity: 0.35, bloom: 1.45, bloomThreshold: 0.62, windows: 1, lamps: 1, rain: 0x8cadff,
};

/**
 * Keyframes around the clock. Even daytime stays smog-choked and low-contrast so neon still carries
 * the frame: amber haze by day (2049's Las Vegas), magenta dusk, teal-grey dawn, violet night.
 */
const KEYS: Key[] = [
  k({ hour: 1, ...NIGHT }),
  k({
    hour: 5, fog: 0x0e1020, fogDensity: 0.011, skyLow: 0x0e0c1a, skyHigh: 0x1a1d3a, horizon: 0x3d1e48, envIntensity: 0.9,
    hemiSky: 0x5a66a8, hemiGround: 0x140c1c, hemi: 0.95, key: 0xa4b6ff, keyIntensity: 1.0, keyElevation: 0.9,
    rim: 0x4fd8ff, rimIntensity: 0.3, bloom: 1.4, bloomThreshold: 0.62, windows: 0.8, lamps: 1, rain: 0x8cadff,
  }),
  k({
    hour: 7, fog: 0x283040, fogDensity: 0.0125, skyLow: 0x1d2130, skyHigh: 0x3b4a66, horizon: 0x9a5060, envIntensity: 1.0,
    hemiSky: 0x7888a8, hemiGround: 0x241a24, hemi: 1.1, key: 0xffb898, keyIntensity: 1.5, keyElevation: 0.42,
    rim: 0x4fd8ff, rimIntensity: 0.3, bloom: 1.15, bloomThreshold: 0.68, windows: 0.45, lamps: 0.45, rain: 0xb4c4dc,
  }),
  k({
    hour: 13, fog: 0x4a3f33, fogDensity: 0.0135, skyLow: 0x2e261e, skyHigh: 0x6a5a44, horizon: 0xb07038, envIntensity: 1.05,
    hemiSky: 0xa89478, hemiGround: 0x30261e, hemi: 1.25, key: 0xffd4a0, keyIntensity: 1.9, keyElevation: 1.05,
    rim: 0x5fd8ff, rimIntensity: 0.2, bloom: 0.9, bloomThreshold: 0.78, windows: 0.15, lamps: 0.08, rain: 0xc8c0b0,
  }),
  k({
    hour: 17.5, fog: 0x3e2a30, fogDensity: 0.013, skyLow: 0x22141c, skyHigh: 0x4a2c44, horizon: 0xc85a38, envIntensity: 1.0,
    hemiSky: 0x9a7090, hemiGround: 0x2a1420, hemi: 1.1, key: 0xff9a60, keyIntensity: 1.7, keyElevation: 0.36,
    rim: 0xff4fb8, rimIntensity: 0.4, bloom: 1.2, bloomThreshold: 0.68, windows: 0.55, lamps: 0.5, rain: 0xd8b0b8,
  }),
  k({
    hour: 19.5, fog: 0x1a1430, fogDensity: 0.012, skyLow: 0x120a1c, skyHigh: 0x251c48, horizon: 0x8a2a5a, envIntensity: 0.95,
    hemiSky: 0x6a64b8, hemiGround: 0x160a1c, hemi: 1.0, key: 0xa0a8ff, keyIntensity: 1.2, keyElevation: 0.8,
    rim: 0xff4fb8, rimIntensity: 0.4, bloom: 1.4, bloomThreshold: 0.64, windows: 0.95, lamps: 1, rain: 0x9cb0ff,
  }),
  k({ hour: 22, ...NIGHT }),
];

/** Lighting for `hour` (0..24), blended between the neighbouring keyframes around the clock. */
export function paletteAt(hour: number): Palette {
  const h = ((hour % 24) + 24) % 24;
  let i = KEYS.length - 1;
  for (let j = 0; j < KEYS.length; j++) if (KEYS[j].hour <= h) i = j;
  const a = KEYS[i];
  const b = KEYS[(i + 1) % KEYS.length];
  const span = (b.hour - a.hour + 24) % 24 || 24;
  const t = THREE.MathUtils.smoothstep(((h - a.hour + 24) % 24) / span, 0, 1);
  const out = {} as Palette;
  for (const key of COLOR_KEYS) out[key] = new THREE.Color(a[key]).lerp(new THREE.Color(b[key]), t);
  for (const key of NUM_KEYS) out[key] = a[key] + (b[key] - a[key]) * t;
  return out;
}

const hash = (n: number) => {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
};

/**
 * Rain intensity over mission time (0 dry .. 1 heavy): slow value noise, so showers build and ease
 * over tens of seconds, with dry spells and drizzle more common than downpours.
 */
export class RainTrack {
  private seed: number;
  private min: number;
  private max: number;
  private fixed: number | null;

  constructor(seed: number, def: AtmosphereDef['rain'], fixed: number | null = null) {
    this.seed = seed % 1000;
    this.min = def?.min ?? 0.3;
    this.max = def?.max ?? 0.8;
    this.fixed = fixed;
  }

  at(time: number): number {
    if (this.fixed !== null) return this.fixed;
    const noise = (period: number, salt: number) => {
      const x = time / period;
      const i = Math.floor(x);
      const f = THREE.MathUtils.smootherstep(x - i, 0, 1);
      return THREE.MathUtils.lerp(hash(i + this.seed + salt), hash(i + 1 + this.seed + salt), f);
    };
    const n = noise(55, 0) * 0.75 + noise(17, 50) * 0.25;
    const shaped = Math.pow(THREE.MathUtils.clamp((n - 0.28) / 0.72, 0, 1), 1.4);
    return this.min + (this.max - this.min) * shaped;
  }
}

/** Mission atmosphere with URL overrides (?hour=13 &rain=0.6) for previewing. */
export function resolveAtmosphere(def: AtmosphereDef | undefined): { hour: number; rain: AtmosphereDef['rain']; fixedRain: number | null } {
  const q = new URLSearchParams(typeof location === 'undefined' ? '' : location.search);
  const hour = q.has('hour') ? Number(q.get('hour')) : (def?.hour ?? 22);
  const fixedRain = q.has('rain') ? THREE.MathUtils.clamp(Number(q.get('rain')), 0, 1) : null;
  return { hour, rain: def?.rain, fixedRain };
}
