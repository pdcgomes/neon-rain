import * as THREE from 'three';

/**
 * Shared humanoid skeleton with Mixamo bone names (GLTFLoader turns "mixamorig:Hips" into
 * "mixamorigHips"), so procedural kits and imported Mixamo rigs speak the same language.
 * Character faces +Z, its left is +X. Rest pose: standing, arms hanging.
 */
export const BONE_NAMES = [
  'Hips',
  'Spine',
  'Spine1',
  'Neck',
  'Head',
  'LeftShoulder',
  'LeftArm',
  'LeftForeArm',
  'LeftHand',
  'RightShoulder',
  'RightArm',
  'RightForeArm',
  'RightHand',
  'LeftUpLeg',
  'LeftLeg',
  'LeftFoot',
  'RightUpLeg',
  'RightLeg',
  'RightFoot',
] as const;

export type BoneName = (typeof BONE_NAMES)[number];

export const boneNode = (b: BoneName): string => `mixamorig${b}`;

export interface Proportions {
  height: number;
  /** Shoulder width (m). */
  shoulders: number;
  /** Hip width (m). */
  hips: number;
  /** Overall girth multiplier. */
  bulk: number;
}

export const DEFAULT_PROPORTIONS: Proportions = { height: 1.8, shoulders: 0.44, hips: 0.26, bulk: 1 };

export interface Rig {
  root: THREE.Group;
  bones: Record<BoneName, THREE.Bone>;
  /** Segment lengths, so kits can size limb meshes. */
  seg: { upperArm: number; foreArm: number; thigh: number; shin: number; hipsY: number };
  prop: Proportions;
}

export function buildRig(p: Proportions = DEFAULT_PROPORTIONS): Rig {
  const s = p.height / 1.8;
  const bones = {} as Record<BoneName, THREE.Bone>;
  const mk = (name: BoneName, parent: THREE.Object3D | null, x: number, y: number, z = 0) => {
    const b = new THREE.Bone();
    b.name = boneNode(name);
    b.position.set(x, y, z);
    bones[name] = b;
    parent?.add(b);
    return b;
  };
  const seg = { upperArm: 0.29 * s, foreArm: 0.27 * s, thigh: 0.44 * s, shin: 0.43 * s, hipsY: 0.96 * s };
  const hips = mk('Hips', null, 0, seg.hipsY);
  const spine = mk('Spine', hips, 0, 0.1 * s);
  const spine1 = mk('Spine1', spine, 0, 0.19 * s);
  const neck = mk('Neck', spine1, 0, 0.2 * s);
  mk('Head', neck, 0, 0.08 * s);
  for (const [side, sx] of [
    ['Left', 1],
    ['Right', -1],
  ] as const) {
    const sh = mk(`${side}Shoulder` as BoneName, spine1, sx * 0.06 * s, 0.15 * s);
    const arm = mk(`${side}Arm` as BoneName, sh, sx * (p.shoulders / 2 - 0.06 * s), 0.01 * s);
    const fore = mk(`${side}ForeArm` as BoneName, arm, 0, -seg.upperArm);
    mk(`${side}Hand` as BoneName, fore, 0, -seg.foreArm);
    const up = mk(`${side}UpLeg` as BoneName, hips, sx * (p.hips / 2), -0.04 * s);
    const leg = mk(`${side}Leg` as BoneName, up, 0, -seg.thigh);
    mk(`${side}Foot` as BoneName, leg, 0, -seg.shin);
  }
  const root = new THREE.Group();
  root.add(hips);
  root.userData.rig = true;
  return { root, bones, seg, prop: p };
}

/** Attaches a mesh to a bone; the mesh keeps its local transform relative to the bone. */
export function attach(rig: Rig, bone: BoneName, obj: THREE.Object3D): THREE.Object3D {
  rig.bones[bone].add(obj);
  return obj;
}
