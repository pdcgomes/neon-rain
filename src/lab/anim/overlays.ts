import * as THREE from 'three';
import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils.js';
import type { AnimEntry, AnimPlayer } from './player.ts';

/** Debug overlays for animation review: skeletons, foot contacts, onion-skin ghosts, root trail. */
export class AnimOverlays {
  readonly group = new THREE.Group();
  private skeletons: THREE.SkeletonHelper[] = [];
  private contacts: THREE.InstancedMesh;
  private ghosts: { root: THREE.Object3D; entry: AnimEntry; source: AnimEntry; offset: number }[] = [];
  private trail: THREE.Line;
  private trailPts: THREE.Vector3[] = [];
  skeleton = false;
  contactsOn = false;
  ghostsOn = false;
  trailOn = true;
  private selectedEntry: AnimEntry | null = null;
  private tmp = new THREE.Vector3();

  constructor() {
    this.contacts = new THREE.InstancedMesh(
      new THREE.RingGeometry(0.06, 0.1, 16).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(0.3, 3, 1.2), toneMapped: false, depthTest: false, transparent: true }),
      256,
    );
    this.contacts.count = 0;
    this.contacts.renderOrder = 998;
    this.contacts.frustumCulled = false;
    const tg = new THREE.BufferGeometry();
    tg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(3 * 600), 3));
    this.trail = new THREE.Line(tg, new THREE.LineBasicMaterial({ color: new THREE.Color(2, 0.6, 3), toneMapped: false, transparent: true, opacity: 0.8 }));
    this.trail.frustumCulled = false;
    this.group.add(this.contacts, this.trail);
  }

  rebuild(player: AnimPlayer): void {
    for (const s of this.skeletons) {
      this.group.remove(s);
      s.dispose();
    }
    this.skeletons = [];
    if (this.skeleton) {
      for (const e of player.entries) {
        const h = new THREE.SkeletonHelper(e.target);
        (h.material as THREE.LineBasicMaterial).depthTest = false;
        h.renderOrder = 997;
        this.skeletons.push(h);
        this.group.add(h);
      }
    }
    this.setGhostTarget(this.selectedEntry);
  }

  setGhostTarget(entry: AnimEntry | null): void {
    for (const g of this.ghosts) g.root.parent?.remove(g.root);
    this.ghosts = [];
    this.selectedEntry = entry;
    this.trailPts = [];
    if (!entry || !this.ghostsOn) return;
    const tints = [new THREE.Color('#ff2bd6'), new THREE.Color('#1ff4ff')];
    [-0.14, 0.14].forEach((offset, i) => {
      const root = SkeletonUtils.clone(entry.target);
      const m = new THREE.MeshBasicMaterial({ color: tints[i], transparent: true, opacity: 0.22, depthWrite: false });
      root.traverse((o) => {
        const mm = o as THREE.Mesh;
        if (mm.isMesh) {
          mm.material = m;
          mm.castShadow = false;
        }
      });
      entry.target.parent?.add(root);
      root.position.copy(entry.target.position);
      root.rotation.copy(entry.target.rotation);
      const ghostEntry: AnimEntry = { ...entry, target: root, mixer: new THREE.AnimationMixer(root), actions: new Map() };
      this.ghosts.push({ root, entry: ghostEntry, source: entry, offset });
    });
  }

  update(player: AnimPlayer): void {
    for (const g of this.ghosts) {
      g.root.position.copy(g.source.target.position);
      g.root.rotation.copy(g.source.target.rotation);
      player.evaluate(g.entry, player.time + g.entry.offset + g.offset);
    }
    // Foot contact markers: feet within 6 cm of the floor.
    let n = 0;
    const m = new THREE.Matrix4();
    if (this.contactsOn) {
      for (const e of player.entries) {
        for (const foot of ['mixamorigLeftFoot', 'mixamorigRightFoot']) {
          const b = e.target.getObjectByName(foot);
          if (!b || n >= 256) continue;
          b.getWorldPosition(this.tmp);
          if (this.tmp.y < 0.14) {
            m.makeTranslation(this.tmp.x, 0.02, this.tmp.z);
            this.contacts.setMatrixAt(n++, m);
          }
        }
      }
    }
    this.contacts.count = n;
    this.contacts.instanceMatrix.needsUpdate = true;

    // Root trail of the selected character (most useful on the treadmill).
    const sel = this.selectedEntry;
    const hips = sel?.target.getObjectByName('mixamorigHips');
    if (this.trailOn && hips) {
      hips.getWorldPosition(this.tmp);
      const last = this.trailPts[this.trailPts.length - 1];
      if (!last || last.distanceTo(this.tmp) > 0.05) {
        if (last && last.distanceTo(this.tmp) > 3) this.trailPts = [];
        this.trailPts.push(this.tmp.clone().setY(0.03));
        if (this.trailPts.length > 600) this.trailPts.shift();
      }
    } else this.trailPts = [];
    const attr = this.trail.geometry.attributes.position as THREE.BufferAttribute;
    this.trailPts.forEach((p, i) => attr.setXYZ(i, p.x, p.y, p.z));
    attr.needsUpdate = true;
    this.trail.geometry.setDrawRange(0, this.trailPts.length);
  }
}
