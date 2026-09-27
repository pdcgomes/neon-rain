import type { StyleId } from './kits/types.ts';
import type { LightPreset } from './stage.ts';
import type { ViewPreset } from './viewport.ts';

/** Everything that defines a view of the lab. Round-trips through the URL for deep links. */
export interface LabState {
  board: string;
  style: StyleId;
  light: LightPreset;
  view: ViewPreset;
  cam: string;
  clip: string;
  t: number;
  speed: number;
  loop: boolean;
  playing: boolean;
  sil: boolean;
  px: number;
  rain: boolean;
  wet: boolean;
  turn: boolean;
  skel: boolean;
  ghost: boolean;
  contact: boolean;
  subject: string;
  cf: boolean;
  cfa: string;
  cfb: string;
  cfblend: number;
  inspector: boolean;
}

export const DEFAULTS: LabState = {
  board: 'agents',
  style: 'lowpoly',
  light: 'neon',
  view: 'threeq',
  cam: '',
  clip: 'idle',
  t: -1,
  speed: 1,
  loop: true,
  playing: true,
  sil: false,
  px: 1,
  rain: false,
  wet: true,
  turn: false,
  skel: false,
  ghost: false,
  contact: false,
  subject: 'agent:0',
  cf: false,
  cfa: 'walk',
  cfb: 'run',
  cfblend: 0.3,
  inspector: true,
};

const BOOL_KEYS = ['loop', 'playing', 'sil', 'rain', 'wet', 'turn', 'skel', 'ghost', 'contact', 'cf', 'inspector'] as const;
const NUM_KEYS = ['t', 'speed', 'px', 'cfblend'] as const;

export function readState(): LabState {
  const q = new URLSearchParams(location.search);
  const s: LabState = { ...DEFAULTS };
  for (const [k, v] of q) {
    if (!(k in s)) continue;
    const key = k as keyof LabState;
    if ((BOOL_KEYS as readonly string[]).includes(k)) (s as unknown as Record<string, unknown>)[key] = v === '1' || v === 'true';
    else if ((NUM_KEYS as readonly string[]).includes(k)) (s as unknown as Record<string, unknown>)[key] = Number(v);
    else (s as unknown as Record<string, unknown>)[key] = v;
  }
  return s;
}

let pending = 0;
export function writeState(s: LabState): void {
  window.clearTimeout(pending);
  pending = window.setTimeout(() => {
    const q = new URLSearchParams();
    for (const k of Object.keys(DEFAULTS) as (keyof LabState)[]) {
      const v = s[k];
      if (v === DEFAULTS[k] || k === 't') continue;
      q.set(k, typeof v === 'boolean' ? (v ? '1' : '0') : String(v));
    }
    history.replaceState(null, '', `${location.pathname}${q.toString() ? `?${q}` : ''}`);
  }, 250);
}
