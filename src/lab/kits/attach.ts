import * as THREE from 'three';

export interface AttachSpec {
  /** Manifest id of the held asset. */
  asset: string;
  /** Rig bone to parent to (Mixamo name without prefix). */
  bone?: string;
  /** Length of the weapon along its barrel, metres. */
  length?: number;
  /** Which way the barrel points in the source file. */
  muzzle?: '+x' | '-x' | '+z' | '-z';
  /** Grip position as fractions of the weapon's extent: [from the rear, from the bottom]. */
  grip?: [number, number];
  /** Clip whose pose defines the aim: the barrel points from the grip hand towards the other hand. */
  aimClip?: string;
  aimTime?: number;
  /** Barrel direction in the aim pose: towards the support hand (long guns) or along the forearm (pistols). */
  aim?: 'support' | 'forearm';
}

const MUZZLE: Record<NonNullable<AttachSpec['muzzle']>, THREE.Vector3> = {
  '+x': new THREE.Vector3(1, 0, 0),
  '-x': new THREE.Vector3(-1, 0, 0),
  '+z': new THREE.Vector3(0, 0, 1),
  '-z': new THREE.Vector3(0, 0, -1),
};

function findBone(root: THREE.Object3D, name: string): THREE.Bone | undefined {
  let found: THREE.Bone | undefined;
  root.traverse((o) => {
    if (!found && (o as THREE.Bone).isBone && (o.name === name || o.name === `mixamorig${name}` || o.name === `mixamorig:${name}`)) found = o as THREE.Bone;
  });
  return found;
}

/**
 * Puts `item` in the character's hand. The weapon is rebuilt around its grip (barrel along +Z,
 * up +Y), then oriented so that in the aim pose the barrel runs from the grip hand towards the
 * support hand and stays upright; from then on it simply follows the hand bone.
 */
export function attachToHand(character: THREE.Object3D, item: THREE.Object3D, clips: THREE.AnimationClip[], spec: AttachSpec): boolean {
  const boneName = spec.bone ?? 'RightHand';
  const hand = findBone(character, boneName);
  if (!hand) return false;
  const other = findBone(character, boneName.startsWith('Right') ? boneName.replace('Right', 'Left') : boneName.replace('Left', 'Right'));
  const fingers = findBone(character, boneName.replace('Hand', 'HandMiddle1'));
  const forearm = findBone(character, boneName.replace('Hand', 'ForeArm'));

  // Weapon in its canonical frame, grip at the origin.
  item.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(item, true);
  const size = box.getSize(new THREE.Vector3());
  const muzzle = MUZZLE[spec.muzzle ?? '-x'];
  const along = Math.abs(muzzle.x) > 0 ? size.x : size.z;
  const k = (spec.length ?? 0.5) / along;
  const [u, v] = spec.grip ?? [0.45, 0.25];
  const centre = box.getCenter(new THREE.Vector3());
  const grip = centre.clone().addScaledVector(muzzle, -along / 2 + u * along);
  grip.y = box.min.y + v * size.y;
  const canon = new THREE.Quaternion().setFromUnitVectors(muzzle, new THREE.Vector3(0, 0, 1));
  const inner = new THREE.Group();
  inner.add(item);
  item.scale.multiplyScalar(k);
  item.quaternion.premultiply(canon);
  item.position.sub(grip).multiplyScalar(k).applyQuaternion(canon);

  // Hand orientation in the aim pose, in character space.
  const skinned: THREE.SkinnedMesh[] = [];
  character.traverse((o) => (o as THREE.SkinnedMesh).isSkinnedMesh && skinned.push(o as THREE.SkinnedMesh));
  const aim = clips.find((c) => c.name === (spec.aimClip ?? 'shoot_smg'));
  const mixer = new THREE.AnimationMixer(character);
  if (aim) {
    const action = mixer.clipAction(aim).play();
    action.time = spec.aimTime ?? aim.duration * 0.3;
    mixer.update(0);
  }
  character.updateMatrixWorld(true);
  const rootInv = character.matrixWorld.clone().invert();
  const inChar = (o: THREE.Object3D) => new THREE.Matrix4().multiplyMatrices(rootInv, o.matrixWorld);
  const handM = inChar(hand);
  const handPos = new THREE.Vector3();
  const handQ = new THREE.Quaternion();
  const handS = new THREE.Vector3();
  handM.decompose(handPos, handQ, handS);
  let forward = new THREE.Vector3(0, 0, 1);
  const from = spec.aim === 'forearm' ? forearm : undefined;
  const to = spec.aim === 'forearm' ? hand : other;
  if (to) {
    const d = new THREE.Vector3().setFromMatrixPosition(inChar(to)).sub(from ? new THREE.Vector3().setFromMatrixPosition(inChar(from)) : handPos);
    if (d.lengthSq() > 1e-6) forward = d.normalize();
  }
  const up = new THREE.Vector3(0, 1, 0);
  const right = new THREE.Vector3().crossVectors(up, forward).normalize();
  up.crossVectors(forward, right).normalize();
  const want = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(right, up, forward));
  mixer.stopAllAction();
  mixer.uncacheRoot(character);
  for (const s of skinned) s.skeleton.pose();
  character.updateMatrixWorld(true);

  const holder = new THREE.Group();
  holder.name = `held:${spec.asset}`;
  holder.add(inner);
  holder.quaternion.copy(handQ).invert().multiply(want);
  holder.scale.setScalar(1 / handS.x);
  // Grip sits in the palm, part-way from the wrist to the knuckles.
  if (fingers) holder.position.copy(fingers.position).multiplyScalar(0.6);
  hand.add(holder);
  return true;
}
