import * as THREE from 'three';
import { BONE_NAMES, boneNode, buildRig, type BoneName } from '../rig.ts';
import { proceduralClips } from './procedural.ts';

/**
 * Some exporters (Tripo's web rig among them) write every joint node at the origin and keep
 * the real rest pose only in the skin's inverse bind matrices. Rebuilds the joints' local
 * transforms from those, so the skeleton can actually be posed.
 */
export function repairRestPose(root: THREE.Object3D): boolean {
  let repaired = false;
  root.updateMatrixWorld(true);
  root.traverse((o) => {
    const sm = o as THREE.SkinnedMesh;
    if (!sm.isSkinnedMesh) return;
    const bones = sm.skeleton.bones;
    const collapsed = bones.length > 2 && bones.every((b) => b.position.lengthSq() < 1e-10);
    if (!collapsed) return;
    const worlds = new Map<THREE.Bone, THREE.Matrix4>();
    bones.forEach((b, i) => worlds.set(b, new THREE.Matrix4().multiplyMatrices(sm.bindMatrix, sm.skeleton.boneInverses[i].clone().invert())));
    const inv = new THREE.Matrix4();
    for (const b of bones) {
      const w = worlds.get(b)!;
      const parentWorld = b.parent && worlds.get(b.parent as THREE.Bone);
      const local = parentWorld ? inv.copy(parentWorld).invert().multiply(w) : w.clone();
      local.decompose(b.position, b.quaternion, b.scale);
    }
    root.updateMatrixWorld(true);
    repaired = true;
  });
  return repaired;
}

const CHILD: Partial<Record<BoneName, BoneName>> = {
  Hips: 'Spine',
  Spine: 'Spine1',
  Spine1: 'Neck',
  Neck: 'Head',
  LeftShoulder: 'LeftArm',
  LeftArm: 'LeftForeArm',
  LeftForeArm: 'LeftHand',
  RightShoulder: 'RightArm',
  RightArm: 'RightForeArm',
  RightForeArm: 'RightHand',
  LeftUpLeg: 'LeftLeg',
  LeftLeg: 'LeftFoot',
  RightUpLeg: 'RightLeg',
  RightLeg: 'RightFoot',
};
const PARENT_FOR_END: Partial<Record<BoneName, BoneName>> = { Head: 'Neck', LeftHand: 'LeftForeArm', RightHand: 'RightForeArm', LeftFoot: 'LeftLeg', RightFoot: 'RightLeg' };

/**
 * Retargets the lab's procedural clips (authored on a rig with arms hanging down and identity
 * joint frames) onto any Mixamo-named skeleton, whatever its rest pose (usually a T-pose).
 * Each bone's world rotation is transferred after aligning the rest directions of the limbs.
 */
export function retargetProcedural(target: THREE.Object3D): THREE.AnimationClip[] {
  target.updateMatrixWorld(true);
  const tBones = new Map<BoneName, THREE.Bone>();
  const all: THREE.Bone[] = [];
  target.traverse((o) => {
    if (!(o as THREE.Bone).isBone) return;
    all.push(o as THREE.Bone);
    const name = BONE_NAMES.find((b) => o.name === boneNode(b) || o.name === `mixamorig:${b}`);
    if (name) tBones.set(name, o as THREE.Bone);
  });
  if (!tBones.has('Hips') || !tBones.has('LeftArm') || !tBones.has('LeftUpLeg')) return [];

  const rootInv = target.matrixWorld.clone().invert();
  const rel = (o: THREE.Object3D) => new THREE.Matrix4().multiplyMatrices(rootInv, o.matrixWorld);
  const pos = (o: THREE.Object3D) => new THREE.Vector3().setFromMatrixPosition(rel(o));
  const rot = (o: THREE.Object3D) => {
    const q = new THREE.Quaternion();
    rel(o).decompose(new THREE.Vector3(), q, new THREE.Vector3());
    return q;
  };

  const src = buildRig();
  src.root.updateMatrixWorld(true);
  const sPos = (b: BoneName) => new THREE.Vector3().setFromMatrixPosition(src.bones[b].matrixWorld);

  // Rest alignment per bone: rotation taking the target's rest limb direction onto the source's.
  const align = new Map<BoneName, THREE.Quaternion>();
  for (const b of BONE_NAMES) {
    const c = CHILD[b];
    if (!c || !tBones.has(b) || !tBones.has(c)) continue;
    const dT = pos(tBones.get(c)!).sub(pos(tBones.get(b)!)).normalize();
    const dS = sPos(c).sub(sPos(b)).normalize();
    align.set(b, new THREE.Quaternion().setFromUnitVectors(dT, dS));
  }
  for (const [b, p] of Object.entries(PARENT_FOR_END) as [BoneName, BoneName][]) align.set(b, (align.get(p) ?? new THREE.Quaternion()).clone());

  // Rest data of the target, in model space.
  const restWorld = new Map<THREE.Object3D, THREE.Quaternion>();
  const restLocal = new Map<THREE.Object3D, THREE.Quaternion>();
  for (const b of all) {
    restWorld.set(b, rot(b));
    restLocal.set(b, b.quaternion.clone());
  }
  const hips = tBones.get('Hips')!;
  const hipsRestPos = hips.position.clone();
  const hipsParentWorld = hips.parent ? rel(hips.parent) : new THREE.Matrix4();
  const hipsParentRot = new THREE.Quaternion();
  const hipsParentScale = new THREE.Vector3();
  hipsParentWorld.decompose(new THREE.Vector3(), hipsParentRot, hipsParentScale);
  const scale = pos(hips).y / src.seg.hipsY;

  const clips = proceduralClips({ hipsY: src.seg.hipsY });
  const mixer = new THREE.AnimationMixer(src.root);
  const out: THREE.AnimationClip[] = [];
  const nameOf = new Map<THREE.Bone, BoneName>([...tBones].map(([k, v]) => [v, k]));
  const worldOf = new Map<THREE.Object3D, THREE.Quaternion>();
  const tmpQ = new THREE.Quaternion();
  const sW = new THREE.Quaternion();

  for (const clip of clips) {
    const times = Array.from((clip.tracks[0] as THREE.KeyframeTrack).times);
    const qv = new Map<THREE.Bone, number[]>();
    const pv: number[] = [];
    const action = mixer.clipAction(clip);
    action.play();
    for (const t of times) {
      action.time = t;
      mixer.update(0);
      src.root.updateMatrixWorld(true);
      worldOf.clear();
      for (const b of all) {
        const parentW = worldOf.get(b.parent!) ?? (b.parent ? rot(b.parent) : new THREE.Quaternion());
        const name = nameOf.get(b);
        let w: THREE.Quaternion;
        if (name && align.has(name)) {
          src.bones[name].getWorldQuaternion(sW);
          w = sW.clone().multiply(align.get(name)!).multiply(restWorld.get(b)!);
        } else if (name === 'Hips') {
          src.bones.Hips.getWorldQuaternion(sW);
          w = sW.clone().multiply(restWorld.get(b)!);
        } else w = parentW.clone().multiply(restLocal.get(b)!);
        worldOf.set(b, w);
        const local = tmpQ.copy(parentW).invert().multiply(w);
        const arr = qv.get(b) ?? [];
        arr.push(local.x, local.y, local.z, local.w);
        qv.set(b, arr);
      }
      // Hips translation: source offset from rest, scaled to the target's size, in the parent's frame.
      const off = src.bones.Hips.position.clone().sub(new THREE.Vector3(0, src.seg.hipsY, 0)).multiplyScalar(scale);
      off.applyQuaternion(hipsParentRot.clone().invert()).divide(hipsParentScale);
      const p = hipsRestPos.clone().add(off);
      pv.push(p.x, p.y, p.z);
    }
    action.stop();
    const tracks: THREE.KeyframeTrack[] = [];
    for (const [b, v] of qv) if (nameOf.has(b) || b === hips) tracks.push(new THREE.QuaternionKeyframeTrack(`${b.name}.quaternion`, times, v));
    tracks.push(new THREE.VectorKeyframeTrack(`${hips.name}.position`, times, pv));
    out.push(new THREE.AnimationClip(clip.name, clip.duration, tracks));
  }
  return out;
}
