import * as THREE from 'three';
import { hash2 } from '../sim/rng.ts';
import type { World } from '../sim/world.ts';
import { radialTexture } from './textures.ts';

const CAP = 48;
const PAINTS = ['#1b1e2a', '#5a0f1f', '#20252f', '#0d3040', '#3a3a44', '#46205a', '#c9c6bd', '#0f3a2c', '#6a4a12'];

/** Road traffic: instanced bodies, cabins, head/tail lights and headlight pools on the wet road. */
export class Vehicles {
  readonly group = new THREE.Group();
  private body: THREE.InstancedMesh;
  private cabin: THREE.InstancedMesh;
  private head: THREE.InstancedMesh;
  private tail: THREE.InstancedMesh;
  private beams: THREE.InstancedMesh;
  private fire: THREE.InstancedMesh;
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private v = new THREE.Vector3();
  private s = new THREE.Vector3(1, 1, 1);
  private c = new THREE.Color();
  private up = new THREE.Vector3(0, 1, 0);
  private offset = new THREE.Matrix4();

  constructor() {
    const mk = (geo: THREE.BufferGeometry, mat: THREE.Material, count = CAP) => {
      const m = new THREE.InstancedMesh(geo, mat, count);
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      m.frustumCulled = false;
      m.count = 0;
      return m;
    };
    this.body = mk(
      new THREE.BoxGeometry(1.8, 0.7, 3.9).translate(0, 0.55, 0),
      new THREE.MeshStandardMaterial({ color: 0xffffff, metalness: 0.75, roughness: 0.22 }),
    );
    this.body.castShadow = true;
    this.cabin = mk(
      new THREE.BoxGeometry(1.6, 0.55, 2.0).translate(0, 1.15, -0.25),
      new THREE.MeshStandardMaterial({ color: 0x07080c, metalness: 0.9, roughness: 0.08 }),
    );
    const glow = () => new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false });
    this.head = mk(new THREE.BoxGeometry(1.6, 0.14, 0.06).translate(0, 0.66, 1.96), glow());
    this.tail = mk(new THREE.BoxGeometry(1.7, 0.12, 0.06).translate(0, 0.7, -1.96), glow());
    this.beams = mk(
      new THREE.PlaneGeometry(3.4, 7).rotateX(-Math.PI / 2).translate(0, 0.04, 5.2),
      new THREE.MeshBasicMaterial({
        map: radialTexture(),
        color: new THREE.Color(0.55, 0.55, 0.5),
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        toneMapped: false,
      }),
    );
    this.fire = mk(new THREE.IcosahedronGeometry(0.5, 1).translate(0, 1.3, 0.8), glow());
    this.group.add(this.body, this.cabin, this.head, this.tail, this.beams, this.fire);
  }

  update(world: World, alpha: number, time: number): void {
    let n = 0;
    let fires = 0;
    for (const car of world.traffic.vehicles) {
      if (n >= CAP) break;
      const x = car.px + (car.x - car.px) * alpha;
      const z = car.py + (car.y - car.py) * alpha;
      let dh = car.heading - car.pheading;
      while (dh > Math.PI) dh -= Math.PI * 2;
      while (dh < -Math.PI) dh += Math.PI * 2;
      const heading = car.pheading + dh * alpha;
      this.q.setFromAxisAngle(this.up, Math.PI / 2 - heading);
      this.m.compose(this.v.set(x, 0, z), this.q, this.s);
      this.body.setMatrixAt(n, this.m);
      this.cabin.setMatrixAt(n, this.m);
      this.head.setMatrixAt(n, this.m);
      this.tail.setMatrixAt(n, this.m);
      this.beams.setMatrixAt(n, this.m);

      const paint = PAINTS[Math.floor(hash2(car.seed, 1) * PAINTS.length)];
      this.body.setColorAt(n, car.wrecked ? this.c.set('#0c0b0b') : this.c.set(paint));
      this.head.setColorAt(n, car.wrecked ? this.c.setRGB(0, 0, 0) : this.c.setRGB(2.6, 2.6, 3));
      const brake = car.braking || car.speed < 0.5;
      this.tail.setColorAt(n, car.wrecked ? this.c.setRGB(0, 0, 0) : this.c.setRGB(brake ? 4 : 1.6, 0.08, 0.12));
      this.beams.setColorAt(n, car.wrecked ? this.c.setRGB(0, 0, 0) : this.c.setRGB(0.5, 0.5, 0.46));

      if (car.wrecked) {
        const flick = 0.7 + 0.3 * Math.sin(time * 19 + car.seed) * Math.sin(time * 7 + car.seed * 0.3);
        const fade = Math.max(0, 1 - (world.time - car.wreckedAt) / 30);
        this.offset.compose(this.v.set(0, 0, 0), new THREE.Quaternion(), this.s.setScalar(0.6 + flick * 0.5));
        this.fire.setMatrixAt(fires, this.m.multiply(this.offset));
        this.s.set(1, 1, 1);
        this.fire.setColorAt(fires++, this.c.setRGB(3.2 * flick * fade, 1.1 * flick * fade, 0.2 * fade));
      }
      n++;
    }
    for (const mesh of [this.body, this.cabin, this.head, this.tail, this.beams]) {
      mesh.count = n;
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
    this.fire.count = fires;
    this.fire.instanceMatrix.needsUpdate = true;
    if (this.fire.instanceColor) this.fire.instanceColor.needsUpdate = true;
  }
}

/** A signal pole on each corner of every intersection; lamps show the aspect for one traffic axis. */
export class TrafficLights {
  readonly group = new THREE.Group();
  private lamps: THREE.InstancedMesh;
  private meta: { node: number; axis: number }[] = [];
  private c = new THREE.Color();

  constructor(world: World) {
    const t = world.traffic;
    const n = t.nodeCount * 4;
    const poles = new THREE.InstancedMesh(
      new THREE.CylinderGeometry(0.07, 0.09, 3.6, 6).translate(0, 1.8, 0),
      new THREE.MeshStandardMaterial({ color: 0x1b1c22, metalness: 0.8, roughness: 0.4 }),
      n,
    );
    this.lamps = new THREE.InstancedMesh(
      new THREE.BoxGeometry(0.34, 0.5, 0.34),
      new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false }),
      n,
    );
    const m = new THREE.Matrix4();
    const off = world.map.roadsX.length ? (world.map.roadsX[0].end - world.map.roadsX[0].start) / 2 + 0.6 : 4.6;
    let k = 0;
    for (let node = 0; node < t.nodeCount; node++) {
      const p = t.nodePosition(node);
      const corners: [number, number, number][] = [
        [1, -1, 0],
        [-1, 1, 0],
        [-1, -1, 1],
        [1, 1, 1],
      ];
      for (const [sx, sy, axis] of corners) {
        const x = p.x + sx * off;
        const z = p.y + sy * off;
        poles.setMatrixAt(k, m.makeTranslation(x, 0, z));
        this.lamps.setMatrixAt(k, m.makeTranslation(x, 3.7, z));
        this.lamps.setColorAt(k, this.c.setRGB(1, 0, 0));
        this.meta.push({ node, axis });
        k++;
      }
    }
    poles.castShadow = true;
    this.group.add(poles, this.lamps);
  }

  update(world: World): void {
    const t = world.traffic;
    this.meta.forEach((l, i) => {
      const a = t.signalAspect(l.node, l.axis, world.time);
      if (a === 2) this.c.setRGB(0.2, 3.2, 0.9);
      else if (a === 1) this.c.setRGB(3.4, 1.9, 0.2);
      else this.c.setRGB(3.4, 0.15, 0.15);
      this.lamps.setColorAt(i, this.c);
    });
    if (this.lamps.instanceColor) this.lamps.instanceColor.needsUpdate = true;
  }
}
