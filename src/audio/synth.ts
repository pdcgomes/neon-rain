/** Tiny offline synthesiser: renders sounds to WAV blob URLs so Howler can play them. */

const SR = 32000;

function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function wav(channels: Float32Array[], rate = SR): string {
  const n = channels[0].length;
  const ch = channels.length;
  const buf = new ArrayBuffer(44 + n * ch * 2);
  const v = new DataView(buf);
  const str = (o: number, s: string) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  str(0, 'RIFF');
  v.setUint32(4, 36 + n * ch * 2, true);
  str(8, 'WAVE');
  str(12, 'fmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, ch, true);
  v.setUint32(24, rate, true);
  v.setUint32(28, rate * ch * 2, true);
  v.setUint16(32, ch * 2, true);
  v.setUint16(34, 16, true);
  str(36, 'data');
  v.setUint32(40, n * ch * 2, true);
  let o = 44;
  for (let i = 0; i < n; i++) {
    for (let c = 0; c < ch; c++) {
      const s = Math.max(-1, Math.min(1, channels[c][i]));
      v.setInt16(o, s * 32767, true);
      o += 2;
    }
  }
  return URL.createObjectURL(new Blob([buf], { type: 'audio/wav' }));
}

function normalize(a: Float32Array, peak = 0.9): Float32Array {
  let m = 0;
  for (const x of a) m = Math.max(m, Math.abs(x));
  if (m > 0) for (let i = 0; i < a.length; i++) a[i] *= peak / m;
  return a;
}

/** One-pole low-pass with a time-varying cutoff (Hz). */
function lowpass(a: Float32Array, cutoff: (t: number) => number): Float32Array {
  let y = 0;
  for (let i = 0; i < a.length; i++) {
    const k = 1 - Math.exp((-2 * Math.PI * cutoff(i / SR)) / SR);
    y += (a[i] - y) * k;
    a[i] = y;
  }
  return a;
}

function highpass(a: Float32Array, cutoff: number): Float32Array {
  const k = 1 - Math.exp((-2 * Math.PI * cutoff) / SR);
  let lp = 0;
  for (let i = 0; i < a.length; i++) {
    lp += (a[i] - lp) * k;
    a[i] -= lp;
  }
  return a;
}

function render(dur: number, fn: (t: number, i: number, r: () => number) => number, seed = 1): Float32Array {
  const n = Math.floor(dur * SR);
  const out = new Float32Array(n);
  const r = rng(seed);
  for (let i = 0; i < n; i++) out[i] = fn(i / SR, i, r);
  return out;
}

const env = (t: number, a: number, d: number) => (t < a ? t / a : Math.exp(-(t - a) / d));

export function gunshot(kind: 'pistol' | 'uzi' | 'minigun' | 'enemy'): string {
  const p = {
    pistol: { dur: 0.35, body: 110, noiseD: 0.06, bodyD: 0.08, bright: 5200 },
    uzi: { dur: 0.18, body: 150, noiseD: 0.03, bodyD: 0.04, bright: 6500 },
    minigun: { dur: 0.12, body: 130, noiseD: 0.022, bodyD: 0.03, bright: 7000 },
    enemy: { dur: 0.22, body: 180, noiseD: 0.035, bodyD: 0.04, bright: 3800 },
  }[kind];
  let phase = 0;
  const a = render(p.dur, (t, _i, r) => {
    phase += (2 * Math.PI * p.body * (1 + 2 * Math.exp(-t / 0.01))) / SR;
    const noise = (r() * 2 - 1) * env(t, 0.0008, p.noiseD);
    const body = Math.sin(phase) * env(t, 0.001, p.bodyD) * 0.9;
    return noise + body;
  }, 7);
  lowpass(a, (t) => p.bright * Math.exp(-t / 0.05) + 400);
  return wav([normalize(a, 0.95)]);
}

export function gauss(): string {
  let ph = 0;
  const a = render(0.9, (t, _i, r) => {
    const f = 1800 * Math.exp(-t / 0.08) + 60;
    ph += (2 * Math.PI * f) / SR;
    return Math.sin(ph) * env(t, 0.002, 0.25) * 0.8 + (r() * 2 - 1) * env(t, 0.001, 0.05) * 0.5;
  }, 3);
  return wav([normalize(a)]);
}

export function explosion(): string {
  let ph = 0;
  const a = render(2.4, (t, _i, r) => {
    ph += (2 * Math.PI * (48 + 40 * Math.exp(-t / 0.15))) / SR;
    return (r() * 2 - 1) * env(t, 0.004, 0.45) + Math.sin(ph) * env(t, 0.002, 0.35) * 1.2;
  }, 11);
  lowpass(a, (t) => 5000 * Math.exp(-t / 0.18) + 180);
  return wav([normalize(a)]);
}

export function impact(): string {
  const a = render(0.08, (t, _i, r) => (r() * 2 - 1) * env(t, 0.0005, 0.012), 5);
  highpass(a, 1800);
  return wav([normalize(a, 0.6)]);
}

export function thud(): string {
  let ph = 0;
  const a = render(0.16, (t, _i, r) => {
    ph += (2 * Math.PI * (90 + 120 * Math.exp(-t / 0.02))) / SR;
    return Math.sin(ph) * env(t, 0.001, 0.04) + (r() * 2 - 1) * env(t, 0.001, 0.01) * 0.3;
  }, 9);
  return wav([normalize(a, 0.8)]);
}

export function persuadeHum(): string {
  let ph = 0;
  const a = render(0.5, (t) => {
    const f = 330 + Math.sin(t * 2 * Math.PI * 7) * 60 + Math.sin(t * 2 * Math.PI * 31) * 25;
    ph += (2 * Math.PI * f) / SR;
    return Math.sin(ph + Math.sin(ph * 2.01) * 1.4) * Math.sin(Math.PI * (t / 0.5)) * 0.6;
  });
  return wav([normalize(a, 0.5)]);
}

export function chime(notes: number[], step = 0.09, decay = 0.35): string {
  const dur = notes.length * step + decay * 3;
  const a = render(dur, (t) => {
    let s = 0;
    notes.forEach((f, k) => {
      const tt = t - k * step;
      if (tt < 0) return;
      s += (Math.sin(2 * Math.PI * f * tt) + 0.3 * Math.sin(2 * Math.PI * f * 2.005 * tt)) * env(tt, 0.004, decay);
    });
    return s;
  });
  return wav([normalize(a, 0.55)]);
}

export function radioBlip(): string {
  const a = render(0.22, (t, _i, r) => {
    const tone = t < 0.06 ? Math.sign(Math.sin(2 * Math.PI * 1400 * t)) * 0.25 : 0;
    const hiss = (r() * 2 - 1) * 0.35 * (t > 0.05 ? env(t - 0.05, 0.005, 0.05) : 0);
    return tone + hiss;
  }, 13);
  lowpass(a, () => 3500);
  return wav([normalize(a, 0.4)]);
}

export function siren(): string {
  let ph = 0;
  const a = render(1.6, (t) => {
    const f = 700 + 350 * Math.sin(2 * Math.PI * 1.25 * t);
    ph += (2 * Math.PI * f) / SR;
    return Math.sign(Math.sin(ph)) * 0.3 * Math.min(1, t * 8, (1.6 - t) * 8);
  });
  lowpass(a, () => 2400);
  return wav([normalize(a, 0.35)]);
}

export function flatline(): string {
  const a = render(1.4, (t) => Math.sin(2 * Math.PI * 988 * t) * (t < 1.2 ? 1 : (1.4 - t) * 5) * 0.4);
  return wav([normalize(a, 0.4)]);
}

export function click(): string {
  const a = render(0.05, (t) => Math.sin(2 * Math.PI * 2200 * t) * env(t, 0.0005, 0.008));
  return wav([normalize(a, 0.4)]);
}

/** Rain bed: stereo filtered noise, loops seamlessly because it has no structure. */
export function rainLoop(): string {
  const L = render(6, (_t, _i, r) => r() * 2 - 1, 21);
  const R = render(6, (_t, _i, r) => r() * 2 - 1, 22);
  for (const ch of [L, R]) {
    lowpass(ch, () => 2600);
    highpass(ch, 300);
    normalize(ch, 0.3);
  }
  // Soft crossfade of the loop seam.
  const fade = Math.floor(SR * 0.2);
  for (const ch of [L, R]) {
    for (let i = 0; i < fade; i++) {
      const k = i / fade;
      ch[i] = ch[i] * k + ch[ch.length - fade + i] * (1 - k);
    }
  }
  return wav([L.subarray(0, L.length - fade), R.subarray(0, R.length - fade)]);
}

/** Dark synth pad in D minor. Frequencies snap to whole cycles per loop so it loops cleanly. */
export function padLoop(): string {
  const dur = 16;
  const snap = (f: number) => Math.round(f * dur) / dur;
  const chords = [
    [73.42, 146.83, 174.61, 220.0, 293.66],
    [58.27, 116.54, 174.61, 233.08, 277.18],
    [65.41, 130.81, 164.81, 196.0, 261.63],
    [55.0, 110.0, 164.81, 220.0, 261.63],
  ].map((c) => c.map(snap));
  const n = dur * SR;
  const L = new Float32Array(n);
  const R = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    const seg = Math.floor((t / dur) * 4);
    const local = (t / dur) * 4 - seg;
    const xf = Math.min(1, local * 6, (1 - local) * 6);
    let l = 0;
    let r = 0;
    for (const f of chords[seg]) {
      for (const d of [-0.12, 0.12]) {
        const ff = f + d;
        const saw = ((t * ff) % 1) * 2 - 1;
        l += saw * (d < 0 ? 0.7 : 0.3);
        r += saw * (d < 0 ? 0.3 : 0.7);
      }
    }
    L[i] = l * xf;
    R[i] = r * xf;
  }
  lowpass(L, (t) => 700 + 400 * Math.sin((2 * Math.PI * t) / dur));
  lowpass(R, (t) => 700 + 400 * Math.cos((2 * Math.PI * t) / dur));
  lowpass(L, () => 1200);
  lowpass(R, () => 1200);
  normalize(L, 0.35);
  normalize(R, 0.35);
  return wav([L, R]);
}

/** Pulsing bass + ticking hats that fades in when the alarm is raised. */
export function combatLoop(): string {
  const bpm = 120;
  const beat = 60 / bpm;
  const dur = beat * 16;
  const a = render(dur, (t, _i, r) => {
    const b = t / beat;
    const eighth = (b * 2) % 1;
    const bassF = [36.71, 36.71, 43.65, 32.7][Math.floor(b / 4) % 4] * 2;
    const bass = Math.sin(2 * Math.PI * bassF * t) * env(eighth * beat * 0.5, 0.003, 0.09) * 0.8;
    const kick = b % 1 < 0.25 ? Math.sin(2 * Math.PI * (50 + 120 * Math.exp(-(b % 1) * beat / 0.03)) * (b % 1) * beat) * env((b % 1) * beat, 0.001, 0.12) : 0;
    const hat = (r() * 2 - 1) * env(((b * 4) % 1) * (beat / 4), 0.0005, 0.012) * 0.25;
    return bass + kick + hat;
  }, 31);
  return wav([normalize(a, 0.5)]);
}

/** Two-tone car horn with a slightly detuned, squashed square wave. */
export function horn(): string {
  const a = render(0.55, (t) => {
    const env = Math.min(1, t * 40, (0.55 - t) * 12);
    const sq = (f: number) => Math.tanh(Math.sin(2 * Math.PI * f * t) * 4);
    return (sq(392) + sq(494) * 0.8) * env * 0.35;
  });
  lowpass(a, () => 2600);
  return wav([normalize(a, 0.45)]);
}

/** Car impact: metallic crunch over a body thud. */
export function carCrash(): string {
  let ph = 0;
  const a = render(0.5, (t, _i, r) => {
    ph += (2 * Math.PI * (70 + 90 * Math.exp(-t / 0.04))) / SR;
    const thud = Math.sin(ph) * env(t, 0.001, 0.09);
    const crunch = (r() * 2 - 1) * env(t, 0.001, 0.07) * (0.6 + 0.4 * Math.sin(2 * Math.PI * 1830 * t));
    return thud + crunch * 0.8;
  }, 17);
  lowpass(a, (t) => 6000 * Math.exp(-t / 0.1) + 500);
  return wav([normalize(a, 0.8)]);
}
