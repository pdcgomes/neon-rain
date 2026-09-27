import * as THREE from 'three';
import { BONE_NAMES, boneNode, type BoneName } from '../rig.ts';
import { CATALOGUE, type ClipSpec } from './catalogue.ts';

/**
 * Procedural placeholder clips for the shared rig. Conventions (rest pose, character faces +Z):
 * - limbs hang down, so a NEGATIVE x-rotation swings them forward;
 * - the spine and head point up, so a POSITIVE x-rotation leans them forward;
 * - a positive x-rotation on a Leg (shin) bends the knee; a negative one on a ForeArm bends the elbow.
 */
type Euler3 = [number, number, number];
interface Pose {
  rot: Partial<Record<BoneName, Euler3>>;
  /** Hips offset from rest height (m). */
  hipsY: number;
  hipsZ: number;
}

const TAU = Math.PI * 2;
const ease = (x: number) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));

function gait(t: number, period: number, stride: number, knee: number, arm: number, bounce: number): Pose {
  const ph = (t / period) * TAU;
  const s = Math.sin(ph);
  const c = Math.cos(ph);
  return {
    rot: {
      LeftUpLeg: [-stride * s, 0, 0],
      RightUpLeg: [stride * s, 0, 0],
      LeftLeg: [knee * Math.max(0, -Math.sin(ph - 0.9)), 0, 0],
      RightLeg: [knee * Math.max(0, Math.sin(ph - 0.9)), 0, 0],
      LeftFoot: [0.25 * stride * s, 0, 0],
      RightFoot: [-0.25 * stride * s, 0, 0],
      LeftArm: [arm * s, 0, 0.08],
      RightArm: [-arm * s, 0, -0.08],
      LeftForeArm: [-0.25 - 0.2 * Math.max(0, -s), 0, 0],
      RightForeArm: [-0.25 - 0.2 * Math.max(0, s), 0, 0],
      Spine: [0.03, 0.08 * s, 0],
      Spine1: [0, -0.06 * s, 0],
    },
    hipsY: -bounce * Math.abs(c) + bounce * 0.5,
    hipsZ: 0,
  };
}

function aimArms(pose: Pose, two = true, raise = 1.47, recoil = 0): Pose {
  pose.rot.RightArm = [-raise + recoil, 0.1, 0.05];
  pose.rot.RightForeArm = [-0.1 - recoil * 0.4, 0, 0];
  if (two) {
    pose.rot.LeftArm = [-raise + 0.2 + recoil * 0.6, -0.5, 0];
    pose.rot.LeftForeArm = [-0.55, 0, 0];
  }
  pose.rot.Spine1 = [0.02, 0.12, 0];
  pose.rot.Head = [0, -0.1, 0];
  return pose;
}

const base = (): Pose => ({ rot: {}, hipsY: 0, hipsZ: 0 });

const kick = (t: number, period: number, sharp = 22) => Math.exp(-((t % period) / period) * sharp);

const POSES: Record<string, (t: number, spec: ClipSpec) => Pose> = {
  idle: (t) => {
    const b = Math.sin((t / 2.4) * TAU);
    const p = base();
    p.rot.Spine = [0.02 + 0.015 * b, 0, 0];
    p.rot.Spine1 = [0.01 * b, 0, 0];
    p.rot.Head = [0.02, 0.12 * Math.sin((t / 2.4) * TAU * 0.5), 0];
    p.rot.LeftArm = [0.02 * b, 0, 0.1];
    p.rot.RightArm = [0.02 * b, 0, -0.1];
    p.rot.LeftForeArm = [-0.18, 0, 0];
    p.rot.RightForeArm = [-0.18, 0, 0];
    p.rot.LeftUpLeg = [0, 0, 0.04];
    p.rot.RightUpLeg = [0, 0, -0.04];
    p.hipsY = -0.006 * (b + 1);
    return p;
  },
  walk: (t) => gait(t, 1.0, 0.42, 0.7, 0.32, 0.03),
  run: (t) => {
    const p = gait(t, 0.64, 0.75, 1.5, 0.7, 0.07);
    p.rot.Spine = [0.22, (p.rot.Spine ?? [0, 0, 0])[1], 0];
    p.rot.LeftForeArm = [-1.3, 0, 0];
    p.rot.RightForeArm = [-1.3, 0, 0];
    p.rot.Head = [-0.12, 0, 0];
    return p;
  },
  aim_walk: (t) => aimArms(gait(t, 1.0, 0.36, 0.6, 0, 0.025)),
  strafe: (t) => {
    const ph = (t / 0.8) * TAU;
    const p = aimArms(base());
    p.rot.LeftUpLeg = [0, 0, 0.28 * Math.max(0, Math.sin(ph))];
    p.rot.RightUpLeg = [0, 0, -0.28 * Math.max(0, -Math.sin(ph))];
    p.rot.LeftLeg = [0.3 * Math.max(0, Math.sin(ph)), 0, 0];
    p.rot.RightLeg = [0.3 * Math.max(0, -Math.sin(ph)), 0, 0];
    p.hipsY = -0.03 * Math.abs(Math.cos(ph));
    return p;
  },
  shoot_pistol: (t) => {
    const p = aimArms(base(), false, 1.5, 0.35 * kick(t, 0.6));
    p.rot.LeftArm = [0.05, 0, 0.12];
    p.rot.Spine = [-0.03 * kick(t, 0.6), 0, 0];
    return p;
  },
  shoot_smg: (t) => {
    const p = aimArms(base(), true, 1.45, 0.14 * kick(t, 0.09, 8));
    p.rot.Spine = [-0.02 * kick(t, 0.09, 8), 0.02 * Math.sin(t * 90), 0];
    return p;
  },
  shoot_minigun: (t) => {
    const p = base();
    const j = Math.sin(t * 140) * 0.012;
    p.rot.RightArm = [-0.75, 0.2, -0.1];
    p.rot.RightForeArm = [-0.9, 0, 0];
    p.rot.LeftArm = [-0.95, -0.45, 0.2];
    p.rot.LeftForeArm = [-0.7, 0, 0];
    p.rot.Spine = [-0.08 + j, 0, 0];
    p.rot.Spine1 = [0, 0.05, j];
    p.rot.LeftUpLeg = [-0.25, 0, 0.1];
    p.rot.RightUpLeg = [0.2, 0, -0.1];
    p.rot.LeftLeg = [0.3, 0, 0];
    p.rot.RightLeg = [0.15, 0, 0];
    p.hipsY = -0.05 + j;
    return p;
  },
  throw: (t) => {
    const p = base();
    const wind = ease(t / 0.45);
    const release = ease((t - 0.45) / 0.2);
    const settle = ease((t - 0.75) / 0.35);
    const rx = -0.2 - 2.5 * wind + 1.8 * release - 0.4 * settle * 0;
    p.rot.RightArm = [rx * (1 - settle) + -0.1 * settle, 0, -0.2 * wind];
    p.rot.RightForeArm = [-1.2 * wind * (1 - release) - 0.2, 0, 0];
    p.rot.LeftArm = [-0.9 * wind * (1 - release) - 0.3 * release * (1 - settle), 0, 0.15];
    p.rot.Spine = [-0.15 * wind + 0.35 * release * (1 - settle), 0.35 * wind - 0.5 * release * (1 - settle), 0];
    p.rot.LeftUpLeg = [-0.4 * release * (1 - settle), 0, 0];
    p.rot.RightUpLeg = [0.25 * release * (1 - settle), 0, 0];
    return p;
  },
  persuade: (t) => {
    const p = base();
    const w = Math.sin((t / 1.6) * TAU);
    p.rot.RightArm = [-1.35, 0.1, -0.15 + 0.15 * w];
    p.rot.LeftArm = [-1.35, -0.1, 0.15 + 0.15 * w];
    p.rot.RightForeArm = [-0.25, 0, 0];
    p.rot.LeftForeArm = [-0.25, 0, 0];
    p.rot.Head = [0.05 * Math.sin((t / 0.8) * TAU), 0, 0];
    p.rot.Spine = [0.06, 0, 0];
    return p;
  },
  hit: (t) => {
    const p = base();
    const k = Math.sin(Math.min(1, t / 0.5) * Math.PI) * Math.exp(-t * 3);
    p.rot.Spine = [-0.45 * k, 0.2 * k, 0];
    p.rot.Head = [-0.4 * k, 0, 0];
    p.rot.LeftArm = [0.3 * k, 0, 0.5 * k];
    p.rot.RightArm = [0.3 * k, 0, -0.5 * k];
    p.hipsZ = -0.08 * k;
    return p;
  },
  death_a: (t) => {
    const p = base();
    const f = ease(t / 0.75);
    const knees = ease(t / 0.3);
    p.rot.Hips = [-1.5 * f, 0, 0.1 * f];
    p.rot.LeftLeg = [0.6 * knees * (1 - f * 0.7), 0, 0];
    p.rot.RightLeg = [0.3 * knees * (1 - f * 0.7), 0, 0];
    p.rot.LeftArm = [0.2, 0, 1.2 * f];
    p.rot.RightArm = [0.2, 0, -1.4 * f];
    p.rot.Head = [-0.3 * f, 0.4 * f, 0];
    p.hipsY = -0.78 * f;
    p.hipsZ = -0.45 * f;
    return p;
  },
  death_b: (t) => {
    const p = base();
    const kneel = ease(t / 0.55);
    const fall = ease((t - 0.5) / 0.7);
    p.rot.LeftUpLeg = [-1.2 * kneel * (1 - fall) - 0.1 * fall, 0, 0];
    p.rot.RightUpLeg = [-0.3 * kneel * (1 - fall), 0, 0];
    p.rot.LeftLeg = [2.0 * kneel * (1 - fall), 0, 0];
    p.rot.RightLeg = [1.4 * kneel * (1 - fall), 0, 0];
    p.rot.Hips = [1.45 * fall, 0, 0];
    p.rot.Spine = [0.5 * kneel * (1 - fall), 0, 0];
    p.rot.LeftArm = [-0.4 * kneel - 1.8 * fall, 0, 0.3];
    p.rot.RightArm = [-0.3 * kneel - 1.6 * fall, 0, -0.3];
    p.hipsY = -0.45 * kneel * (1 - fall) - 0.8 * fall;
    p.hipsZ = 0.3 * fall;
    return p;
  },
  panic_run: (t) => {
    const p = gait(t, 0.5, 0.8, 1.6, 0, 0.08);
    const w = Math.sin((t / 0.5) * TAU * 2);
    p.rot.LeftArm = [-2.6 + 0.2 * w, 0, 0.5];
    p.rot.RightArm = [-2.6 - 0.2 * w, 0, -0.5];
    p.rot.LeftForeArm = [-1.1, 0, 0];
    p.rot.RightForeArm = [-1.1, 0, 0];
    p.rot.Spine = [0.3, 0, 0];
    return p;
  },
  cower: (t) => {
    const p = base();
    const tr = Math.sin(t * 40) * 0.015;
    p.rot.LeftUpLeg = [-1.9, 0, 0.25];
    p.rot.RightUpLeg = [-1.9, 0, -0.25];
    p.rot.LeftLeg = [2.4, 0, 0];
    p.rot.RightLeg = [2.4, 0, 0];
    p.rot.LeftFoot = [-0.5, 0, 0];
    p.rot.RightFoot = [-0.5, 0, 0];
    p.rot.Spine = [0.75 + tr, 0, 0];
    p.rot.Spine1 = [0.3, 0, 0];
    p.rot.Head = [0.4, 0, 0];
    p.rot.LeftArm = [-2.8, 0, 0.6];
    p.rot.RightArm = [-2.8, 0, -0.6];
    p.rot.LeftForeArm = [-1.8, 0, 0];
    p.rot.RightForeArm = [-1.8, 0, 0];
    p.hipsY = -0.52 + tr;
    p.hipsZ = -0.12;
    return p;
  },
  umbrella_walk: (t) => {
    const p = gait(t, 1.1, 0.36, 0.6, 0.28, 0.025);
    p.rot.RightArm = [-0.55, -0.2, -0.05];
    p.rot.RightForeArm = [-1.5, 0, 0];
    return p;
  },
  persuaded_shuffle: (t) => {
    const p = gait(t, 1.4, 0.22, 0.35, 0.05, 0.015);
    p.rot.Head = [0.45, 0, 0];
    p.rot.Spine = [0.12, 0, 0];
    p.rot.LeftArm = [0.05, 0, 0.02];
    p.rot.RightArm = [0.05, 0, -0.02];
    return p;
  },
};

export interface ProceduralOptions {
  /** Frames per second to sample; low values plus `stepped` give a retro look. */
  fps?: number;
  stepped?: boolean;
  /** Rest height of the hips bone, needed for the absolute position track. */
  hipsY: number;
  /** Stride/motion amplitude multiplier (heavier characters move less). */
  amplitude?: number;
}

/** Builds every catalogue clip for a rig built with `buildRig`. */
export function proceduralClips(opts: ProceduralOptions): THREE.AnimationClip[] {
  const fps = opts.fps ?? 30;
  const amp = opts.amplitude ?? 1;
  const out: THREE.AnimationClip[] = [];
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  for (const spec of CATALOGUE) {
    const fn = POSES[spec.id];
    if (!fn) continue;
    const frames = Math.max(2, Math.round(spec.duration * fps) + 1);
    const times = new Float32Array(frames);
    const rot: Record<string, Float32Array> = {};
    for (const b of BONE_NAMES) rot[b] = new Float32Array(frames * 4);
    const pos = new Float32Array(frames * 3);
    for (let f = 0; f < frames; f++) {
      const t = (f / (frames - 1)) * spec.duration;
      times[f] = t;
      const pose = fn(t, spec);
      for (const b of BONE_NAMES) {
        const r = pose.rot[b] ?? [0, 0, 0];
        e.set(r[0] * amp, r[1] * amp, r[2] * amp, 'XYZ');
        q.setFromEuler(e);
        rot[b].set([q.x, q.y, q.z, q.w], f * 4);
      }
      pos.set([0, opts.hipsY + pose.hipsY * amp, pose.hipsZ], f * 3);
    }
    const interp = opts.stepped ? THREE.InterpolateDiscrete : THREE.InterpolateLinear;
    const tracks: THREE.KeyframeTrack[] = [];
    for (const b of BONE_NAMES) {
      const tr = new THREE.QuaternionKeyframeTrack(`${boneNode(b)}.quaternion`, times, rot[b]);
      tr.setInterpolation(interp);
      tracks.push(tr);
    }
    const pt = new THREE.VectorKeyframeTrack(`${boneNode('Hips')}.position`, times, pos);
    pt.setInterpolation(interp);
    tracks.push(pt);
    out.push(new THREE.AnimationClip(spec.id, spec.duration, tracks));
  }
  return out;
}
