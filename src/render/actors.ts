import * as THREE from 'three';
import { hash2 } from '../sim/rng.ts';
import type { Entity } from '../sim/types.ts';
import type { World } from '../sim/world.ts';

const CAP = 720;

interface Look {
  coat: THREE.Color;
  skin: THREE.Color;
  visor: THREE.Color | null;
  scale: number;
  coatLen: number;
  umbrella: THREE.Color | null;
  siren: boolean;
}

interface Anim {
  phase: number;
  fall: number;
}

const CIV_COATS = ['#2b2f3a', '#3d2a36', '#1f3340', '#4a4238', '#2d2d2d', '#5b1e3a', '#1c4a4a', '#6b5a3a', '#383a52', '#8a8f99'];
const SKINS = ['#e0c3a8', '#c49a7c', '#8d5f45', '#5a3c2c', '#f1d6c2', '#a87858'];
const UMBRELLA = ['#1ff4ff', '#ff2bd6', '#ffb627', '#7dff5c', '#a66bff', '#ffffff'];

function lookFor(e: Entity): Look {
  const h = (k: number) => hash2(e.id, k, 77);
  const skin = new THREE.Color(SKINS[Math.floor(h(1) * SKINS.length)]);
  switch (e.kind) {
    case 'agent':
      return { coat: new THREE.Color('#121318'), skin, visor: new THREE.Color(0.4, 2.6, 3.2), scale: 1.08, coatLen: 1.2, umbrella: null, siren: false };
    case 'rival':
      return { coat: new THREE.Color('#4a4e58'), skin, visor: new THREE.Color(3.2, 0.3, 0.5), scale: 1.08, coatLen: 1.2, umbrella: null, siren: false };
    case 'guard':
      return { coat: new THREE.Color('#1a1e2b'), skin, visor: new THREE.Color(3, 1.8, 0.3), scale: 1.12, coatLen: 1.0, umbrella: null, siren: false };
    case 'target':
      return { coat: new THREE.Color('#e9e4d4'), skin, visor: null, scale: 1.05, coatLen: 1.0, umbrella: new THREE.Color(3, 2.4, 0.6), siren: false };
    case 'police':
      return { coat: new THREE.Color('#1d3b82'), skin, visor: new THREE.Color(0.6, 1.4, 3), scale: 1.05, coatLen: 1.0, umbrella: null, siren: true };
    case 'enforcer':
      return { coat: new THREE.Color('#2a303b'), skin, visor: new THREE.Color(0.6, 1.4, 3), scale: 1.2, coatLen: 1.05, umbrella: null, siren: true };
    default:
      return {
        coat: new THREE.Color(CIV_COATS[Math.floor(h(2) * CIV_COATS.length)]),
        skin,
        visor: null,
        scale: 0.92 + h(3) * 0.14,
        coatLen: 0.8 + h(4) * 0.25,
        umbrella: h(5) < 0.38 ? new THREE.Color(UMBRELLA[Math.floor(h(6) * UMBRELLA.length)]).multiplyScalar(2.4) : null,
        siren: false,
      };
  }
}

/** Fresnel rim light so dark coats read against wet, dark streets. */
function rimify<T extends THREE.MeshStandardMaterial>(mat: T, color: THREE.Color, strength: number): T {
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uRim = { value: color.clone().multiplyScalar(strength) };
    shader.fragmentShader = 'uniform vec3 uRim;\n' + shader.fragmentShader.replace(
      '#include <emissivemap_fragment>',
      `#include <emissivemap_fragment>
      float rimF = pow(1.0 - abs(dot(normalize(normal), normalize(vViewPosition))), 2.2);
      totalEmissiveRadiance += uRim * rimF * diffuseColor.rgb * 3.0 + uRim * rimF * 0.25;`,
    );
  };
  return mat;
}

function inst(geo: THREE.BufferGeometry, mat: THREE.Material, count = CAP, shadow = true): THREE.InstancedMesh {
  const m = new THREE.InstancedMesh(geo, mat, count);
  m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  m.castShadow = shadow;
  m.frustumCulled = false;
  m.count = 0;
  return m;
}

export class Actors {
  readonly group = new THREE.Group();
  private torso: THREE.InstancedMesh;
  private head: THREE.InstancedMesh;
  private legs: THREE.InstancedMesh;
  private visor: THREE.InstancedMesh;
  private gun: THREE.InstancedMesh;
  private canopy: THREE.InstancedMesh;
  private rim: THREE.InstancedMesh;
  private siren: THREE.InstancedMesh;
  private rings: THREE.InstancedMesh;
  private progress: THREE.InstancedMesh;
  private marks: THREE.InstancedMesh;
  private targetMarker: THREE.Mesh;
  private looks = new Map<number, Look>();
  private anims = new Map<number, Anim>();

  private tmp = new THREE.Matrix4();
  private root = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private qx = new THREE.Quaternion();
  private v = new THREE.Vector3();
  private s = new THREE.Vector3();
  private c = new THREE.Color();
  private xAxis = new THREE.Vector3(1, 0, 0);
  private yAxis = new THREE.Vector3(0, 1, 0);
  private m2 = new THREE.Matrix4();
  private m3 = new THREE.Matrix4();
  private qIdent = new THREE.Quaternion();
  private white = new THREE.Color(1, 1, 1);
  private persuadedVisor = new THREE.Color(2.2, 0.6, 3.2);
  private sirenRed = new THREE.Color(4, 0.2, 0.2);
  private sirenBlue = new THREE.Color(0.3, 0.6, 4);
  private sirenIdle = new THREE.Color(0.3, 0.5, 1.4);
  private ringA = new THREE.Color(0.25, 1.5, 1.9);
  private ringB = new THREE.Color(1.9, 1.0, 0.2);
  private cc = new THREE.Color();

  private local = {
    torso: new THREE.Matrix4().makeTranslation(0, 1.0, 0),
    head: new THREE.Matrix4().makeTranslation(0, 1.74, 0),
    visor: new THREE.Matrix4().makeTranslation(0, 1.76, 0.14),
    gun: new THREE.Matrix4().makeTranslation(0.2, 1.22, 0.42),
    canopy: new THREE.Matrix4().makeTranslation(0.1, 2.35, 0),
    rim: new THREE.Matrix4().makeTranslation(0.1, 2.22, 0),
    siren: new THREE.Matrix4().makeTranslation(-0.22, 1.5, 0),
  };

  constructor() {
    const rimColor = new THREE.Color(0.55, 0.75, 1.0);
    const std = (color = 0xffffff, rough = 0.7, metal = 0.2) =>
      rimify(new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal }), rimColor, 0.9);
    const glow = () => new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false });

    this.torso = inst(new THREE.CylinderGeometry(0.24, 0.34, 1.05, 8), std(0xffffff, 0.45, 0.3));
    this.head = inst(new THREE.IcosahedronGeometry(0.17, 1), std(0xffffff, 0.6, 0.1));
    this.legs = inst(new THREE.BoxGeometry(0.14, 0.78, 0.15).translate(0, -0.39, 0), std(0x15161b, 0.6, 0.2), CAP * 2);
    this.visor = inst(new THREE.BoxGeometry(0.3, 0.055, 0.1), glow(), CAP, false);
    this.gun = inst(new THREE.BoxGeometry(0.1, 0.12, 0.55), std(0x0c0c10, 0.3, 0.8));
    this.canopy = inst(
      new THREE.ConeGeometry(0.85, 0.32, 12, 1, true),
      new THREE.MeshStandardMaterial({ color: 0x14141c, roughness: 0.2, metalness: 0.3, transparent: true, opacity: 0.75, side: THREE.DoubleSide }),
    );
    this.rim = inst(new THREE.TorusGeometry(0.84, 0.03, 4, 24).rotateX(Math.PI / 2), glow(), CAP, false);
    this.siren = inst(new THREE.BoxGeometry(0.12, 0.09, 0.14), glow(), CAP, false);
    const ringMat = new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false, transparent: true, depthWrite: false });
    this.rings = inst(new THREE.RingGeometry(0.5, 0.56, 40).rotateX(-Math.PI / 2), ringMat, 32, false);
    this.progress = inst(new THREE.RingGeometry(0.75, 0.9, 32).rotateX(-Math.PI / 2), ringMat.clone(), 64, false);
    this.marks = inst(new THREE.OctahedronGeometry(0.14, 0), glow(), 64, false);
    this.torso.receiveShadow = true;

    this.targetMarker = new THREE.Mesh(
      new THREE.ConeGeometry(0.35, 0.7, 4).rotateX(Math.PI),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(3.2, 0.4, 0.3), toneMapped: false }),
    );

    this.group.add(
      this.torso,
      this.head,
      this.legs,
      this.visor,
      this.gun,
      this.canopy,
      this.rim,
      this.siren,
      this.rings,
      this.progress,
      this.marks,
      this.targetMarker,
    );
  }

  update(world: World, alpha: number, dt: number, time: number, selected: ReadonlySet<number>): void {
    let n = 0;
    let legN = 0;
    let visorN = 0;
    let gunN = 0;
    let umbN = 0;
    let sirenN = 0;
    let ringN = 0;
    let progN = 0;
    let markN = 0;

    const living = world.entities.filter((e) => e.alive);
    const dead = world.entities.filter((e) => !e.alive).sort((a, b) => b.deadAt - a.deadAt);
    const list = living.concat(dead).slice(0, CAP);
    const siren = Math.sin(time * 14) > 0;

    for (const e of list) {
      let look = this.looks.get(e.id);
      if (!look) {
        look = lookFor(e);
        this.looks.set(e.id, look);
      }
      let an = this.anims.get(e.id);
      if (!an) {
        an = { phase: hash2(e.id, 9) * 6.28, fall: 0 };
        this.anims.set(e.id, an);
      }
      const x = e.px + (e.x - e.px) * alpha;
      const z = e.py + (e.y - e.py) * alpha;
      const speed = Math.hypot(e.vx, e.vy);
      if (e.alive) an.phase += speed * dt * 3.4;
      an.fall = e.alive ? 0 : Math.min(1, an.fall + dt * 4.5);
      const move = Math.min(1, speed / 3.5);
      const bob = e.alive ? Math.abs(Math.sin(an.phase)) * 0.06 * move : 0;

      // Root: position, facing, fall-over and lean.
      this.q.setFromAxisAngle(this.yAxis, Math.PI / 2 - e.facing);
      const fallAng = -an.fall * (Math.PI / 2) * 0.96 + (e.alive ? move * 0.12 : 0);
      this.qx.setFromAxisAngle(this.xAxis, fallAng);
      this.q.multiply(this.qx);
      this.v.set(x, bob + an.fall * 0.18, z);
      this.s.setScalar(look.scale);
      this.root.compose(this.v, this.q, this.s);

      // Torso (coat) with hit flash and persuasion tint.
      this.tmp.copy(this.root).multiply(this.local.torso);
      this.tmp.multiply(this.m2.makeScale(1, look.coatLen, 1));
      this.torso.setMatrixAt(n, this.tmp);
      const flash = e.alive ? Math.max(0, 1 - (world.time - e.lastDamagedAt) / 0.12) : 0;
      this.c.copy(look.coat);
      if (!e.alive) this.c.multiplyScalar(0.55);
      if (flash > 0) this.c.lerp(this.white, flash);
      this.torso.setColorAt(n, this.c);

      this.tmp.copy(this.root).multiply(this.local.head);
      this.head.setMatrixAt(n, this.tmp);
      this.head.setColorAt(n, look.skin);
      n++;

      // Legs swing from the hip.
      const swing = e.alive ? Math.sin(an.phase) * 0.7 * move : 0;
      for (const side of [-1, 1]) {
        this.tmp.copy(this.root);
        this.tmp.multiply(this.m2.makeTranslation(side * 0.12, 0.78, 0));
        this.tmp.multiply(this.m3.makeRotationX(swing * side));
        this.legs.setMatrixAt(legN++, this.tmp);
      }

      const persuaded = e.faction === 'player' && e.kind !== 'agent';
      const visorColor = persuaded ? this.persuadedVisor : look.visor;
      if (visorColor && e.alive) {
        this.tmp.copy(this.root).multiply(this.local.visor);
        this.visor.setMatrixAt(visorN, this.tmp);
        this.visor.setColorAt(visorN++, visorColor);
      }

      if (e.alive && e.weapons.length && !e.holstered) {
        const wid = e.weapons[e.weaponIdx];
        const gl = wid === 'minigun' || wid === 'gauss' ? 1.9 : wid === 'uzi' || wid === 'enemyUzi' || wid === 'riotGun' ? 1.2 : 0.7;
        const gw = wid === 'minigun' || wid === 'gauss' ? 1.8 : 1;
        this.tmp.copy(this.root).multiply(this.local.gun);
        this.tmp.multiply(this.m2.makeScale(gw, gw, gl));
        this.gun.setMatrixAt(gunN++, this.tmp);
      }

      if (look.umbrella && e.alive && e.ai !== 'flee' && !persuaded) {
        this.tmp.copy(this.root).multiply(this.local.canopy);
        this.canopy.setMatrixAt(umbN, this.tmp);
        this.tmp.copy(this.root).multiply(this.local.rim);
        this.rim.setMatrixAt(umbN, this.tmp);
        this.rim.setColorAt(umbN++, look.umbrella);
      }

      if (look.siren && e.alive) {
        this.tmp.copy(this.root).multiply(this.local.siren);
        this.siren.setMatrixAt(sirenN, this.tmp);
        const hostile = world.policeHostile || e.ai === 'combat';
        this.siren.setColorAt(sirenN++, hostile ? (siren ? this.sirenRed : this.sirenBlue) : this.sirenIdle);
      }

      if (e.alive && e.kind === 'agent' && ringN < 32) {
        const sel = selected.has(e.id);
        this.tmp.compose(this.v.set(x, 0.04, z), this.qIdent, this.s.setScalar(sel ? 1 : 0.8));
        this.rings.setMatrixAt(ringN, this.tmp);
        this.cc.copy(e.team === 0 ? this.ringA : this.ringB);
        this.rings.setColorAt(ringN++, sel ? this.cc : this.cc.multiplyScalar(0.25));
      }

      if (e.alive && e.persuadeProgress > 0.01 && progN < 64) {
        const p = e.persuadeProgress;
        this.tmp.compose(this.v.set(x, 0.05, z), this.qIdent, this.s.set(0.4 + p * 0.8, 1, 0.4 + p * 0.8));
        this.progress.setMatrixAt(progN, this.tmp);
        this.progress.setColorAt(progN++, this.cc.setRGB(1.6 * p + 0.4, 0.4, 3 * p + 0.6));
      }

      if (e.alive && persuaded && markN < 64) {
        this.q.setFromAxisAngle(this.yAxis, time * 3 + e.id);
        this.tmp.compose(this.v.set(x, 2.35 + Math.sin(time * 4 + e.id) * 0.08, z), this.q, this.s.setScalar(1));
        this.marks.setMatrixAt(markN, this.tmp);
        this.marks.setColorAt(markN++, this.persuadedVisor);
      }
    }

    const set = (m: THREE.InstancedMesh, count: number) => {
      m.count = count;
      m.instanceMatrix.needsUpdate = true;
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
    };
    set(this.torso, n);
    set(this.head, n);
    set(this.legs, legN);
    set(this.visor, visorN);
    set(this.gun, gunN);
    set(this.canopy, umbN);
    set(this.rim, umbN);
    set(this.siren, sirenN);
    set(this.rings, ringN);
    set(this.progress, progN);
    set(this.marks, markN);

    const target = world.get(world.targetId);
    this.targetMarker.visible = !!target && target.alive;
    if (target) {
      const x = target.px + (target.x - target.px) * alpha;
      const z = target.py + (target.y - target.py) * alpha;
      this.targetMarker.position.set(x, 2.9 + Math.sin(time * 4) * 0.15, z);
      this.targetMarker.rotation.y = time * 2;
    }

    if (this.looks.size > CAP * 2) {
      const alive = new Set(world.entities.map((e) => e.id));
      for (const id of this.looks.keys()) if (!alive.has(id)) this.looks.delete(id);
      for (const id of this.anims.keys()) if (!alive.has(id)) this.anims.delete(id);
    }
  }
}
