import * as THREE from 'three';
import { hash2 } from '../sim/rng.ts';
import type { SimEvent } from '../sim/types.ts';
import type { World } from '../sim/world.ts';
import { radialTexture } from './textures.ts';

const MAX_PARTICLES = 4000;
const MAX_SMOKE = 600;
const MAX_DECALS = 260;
const LIGHTS = 6;

interface Particle {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  life: number;
  max: number;
  size: number;
  r: number;
  g: number;
  b: number;
  drag: number;
  grav: number;
}

class ParticleSystem {
  readonly points: THREE.Points;
  private list: Particle[] = [];
  private pos: Float32Array;
  private col: Float32Array;
  private size: Float32Array;
  private cap: number;

  constructor(cap: number, additive: boolean) {
    this.cap = cap;
    this.pos = new Float32Array(cap * 3);
    this.col = new Float32Array(cap * 4);
    this.size = new Float32Array(cap);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aColor', new THREE.BufferAttribute(this.col, 4).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      uniforms: { uScale: { value: 600 } },
      vertexShader: /* glsl */ `
        uniform float uScale;
        attribute vec4 aColor;
        attribute float aSize;
        varying vec4 vC;
        void main() {
          vC = aColor;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = aSize * uScale / -mv.z;
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */ `
        varying vec4 vC;
        void main() {
          vec2 d = gl_PointCoord - 0.5;
          float a = smoothstep(0.5, 0.0, length(d));
          gl_FragColor = vec4(vC.rgb, vC.a * a);
        }`,
    });
    this.points = new THREE.Points(geo, mat);
    this.points.frustumCulled = false;
  }

  emit(p: Particle): void {
    if (this.list.length >= this.cap) this.list.shift();
    this.list.push(p);
  }

  update(dt: number): void {
    let n = 0;
    const keep: Particle[] = [];
    for (const p of this.list) {
      p.life -= dt;
      if (p.life <= 0) continue;
      p.vz -= p.grav * dt;
      const d = Math.pow(p.drag, dt);
      p.vx *= d;
      p.vy *= d;
      p.vz *= d;
      p.x += p.vx * dt;
      p.y += p.vz * dt;
      p.z += p.vy * dt;
      if (p.y < 0.02) {
        p.y = 0.02;
        p.vz *= -0.3;
      }
      keep.push(p);
      const t = p.life / p.max;
      this.pos[n * 3] = p.x;
      this.pos[n * 3 + 1] = p.y;
      this.pos[n * 3 + 2] = p.z;
      this.col[n * 4] = p.r;
      this.col[n * 4 + 1] = p.g;
      this.col[n * 4 + 2] = p.b;
      this.col[n * 4 + 3] = Math.min(1, t * 1.5);
      this.size[n] = p.size * (0.4 + 0.6 * t);
      n++;
    }
    this.list = keep;
    const geo = this.points.geometry;
    geo.setDrawRange(0, n);
    geo.attributes.position.needsUpdate = true;
    geo.attributes.aColor.needsUpdate = true;
    geo.attributes.aSize.needsUpdate = true;
  }

  setScale(h: number): void {
    (this.points.material as THREE.ShaderMaterial).uniforms.uScale.value = h * 0.9;
  }
}

interface Blast {
  mesh: THREE.Mesh;
  ring: THREE.Mesh;
  t: number;
  r: number;
}

interface Pulse {
  mesh: THREE.Mesh;
  t: number;
}

export class Fx {
  readonly group = new THREE.Group();
  private sparks = new ParticleSystem(MAX_PARTICLES, true);
  private smoke = new ParticleSystem(MAX_SMOKE, false);
  private tracers: THREE.InstancedMesh;
  private grenades: THREE.InstancedMesh;
  private decals: THREE.InstancedMesh;
  private decalIdx = 0;
  private lights: THREE.PointLight[] = [];
  private blasts: Blast[] = [];
  private pulses: Pulse[] = [];
  private lasers: THREE.LineSegments;
  private beams: THREE.LineSegments;
  cursor: THREE.Mesh;
  private aimRing: THREE.Mesh;
  private spinners: THREE.InstancedMesh;
  private spinnerLights: THREE.InstancedMesh;
  private spinnerData: { x: number; z: number; y: number; dir: number; axis: 0 | 1; speed: number }[] = [];
  private mapSize: number;
  /** Set by the renderer; read back to shake the camera. */
  shake = 0;

  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private v = new THREE.Vector3();
  private s = new THREE.Vector3();

  constructor(scene: THREE.Scene, world: World) {
    this.mapSize = Math.max(world.map.w, world.map.h);
    this.group.add(this.sparks.points, this.smoke.points);

    this.tracers = new THREE.InstancedMesh(
      new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false }),
      600,
    );
    this.tracers.frustumCulled = false;
    this.tracers.count = 0;
    this.grenades = new THREE.InstancedMesh(
      new THREE.SphereGeometry(0.14, 8, 6),
      new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false }),
      64,
    );
    this.grenades.frustumCulled = false;
    this.grenades.count = 0;

    const decalTex = radialTexture('rgba(255,255,255,1)', 'rgba(255,255,255,0)');
    this.decals = new THREE.InstancedMesh(
      new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ map: decalTex, transparent: true, depthWrite: false, color: 0xffffff }),
      MAX_DECALS,
    );
    this.decals.count = 0;
    this.decals.renderOrder = 2;
    this.decals.frustumCulled = false;

    for (let i = 0; i < LIGHTS; i++) {
      const l = new THREE.PointLight(0xffaa55, 0, 12, 2);
      l.position.set(0, -50, 0);
      this.lights.push(l);
      scene.add(l);
    }

    for (let i = 0; i < 6; i++) {
      const mesh = new THREE.Mesh(
        new THREE.IcosahedronGeometry(1, 2),
        new THREE.MeshBasicMaterial({
          color: new THREE.Color(3.2, 0.9, 0.25),
          transparent: true,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
          toneMapped: false,
        }),
      );
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(0.93, 1, 48).rotateX(-Math.PI / 2),
        new THREE.MeshBasicMaterial({
          color: new THREE.Color(3, 1.8, 0.8),
          transparent: true,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
          toneMapped: false,
        }),
      );
      mesh.visible = ring.visible = false;
      this.blasts.push({ mesh, ring, t: 1, r: 1 });
      this.group.add(mesh, ring);
    }
    for (let i = 0; i < 8; i++) {
      const mesh = new THREE.Mesh(
        new THREE.RingGeometry(0.6, 0.75, 32).rotateX(-Math.PI / 2),
        new THREE.MeshBasicMaterial({ color: new THREE.Color(0.4, 2.6, 3), transparent: true, depthWrite: false, toneMapped: false }),
      );
      mesh.visible = false;
      this.pulses.push({ mesh, t: 1 });
      this.group.add(mesh);
    }

    const lineMat = (c: THREE.Color, o: number) =>
      new THREE.LineBasicMaterial({ color: c, transparent: true, opacity: o, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
    this.lasers = new THREE.LineSegments(new THREE.BufferGeometry(), lineMat(new THREE.Color(3, 0.2, 0.25), 0.5));
    this.lasers.geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(16 * 6), 3).setUsage(THREE.DynamicDrawUsage));
    this.lasers.frustumCulled = false;
    this.beams = new THREE.LineSegments(new THREE.BufferGeometry(), lineMat(new THREE.Color(2.2, 0.7, 3.4), 0.85));
    this.beams.geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(64 * 14 * 6), 3).setUsage(THREE.DynamicDrawUsage));
    this.beams.frustumCulled = false;

    this.cursor = new THREE.Mesh(
      new THREE.RingGeometry(0.35, 0.45, 32).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(0.4, 2.4, 3), transparent: true, opacity: 0.8, depthWrite: false, toneMapped: false }),
    );
    this.aimRing = new THREE.Mesh(
      new THREE.RingGeometry(0.96, 1, 64).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(2.2, 0.7, 3.4), transparent: true, opacity: 0.6, depthWrite: false, toneMapped: false }),
    );
    this.aimRing.visible = false;

    // Flying traffic high above the streets.
    const N = 22;
    this.spinners = new THREE.InstancedMesh(
      new THREE.BoxGeometry(1.4, 0.5, 3.2),
      new THREE.MeshStandardMaterial({ color: 0x1a1c24, metalness: 0.8, roughness: 0.3 }),
      N,
    );
    this.spinnerLights = new THREE.InstancedMesh(
      new THREE.BoxGeometry(1.5, 0.08, 0.1),
      new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false }),
      N * 2,
    );
    const roads = [...world.map.roadsX.map((r) => ({ c: (r.start + r.end) / 2, axis: 0 as const })), ...world.map.roadsY.map((r) => ({ c: (r.start + r.end) / 2, axis: 1 as const }))];
    // Without grid roads the sky lanes just cross the map at a few fixed offsets.
    if (!roads.length) for (let k = 1; k <= 3; k++) roads.push({ c: (world.map.w * k) / 4, axis: 0 }, { c: (world.map.h * k) / 4, axis: 1 });
    for (let i = 0; i < N; i++) {
      const road = roads[Math.floor(hash2(i, 1, 4) * roads.length)];
      const along = hash2(i, 2, 4) * this.mapSize;
      this.spinnerData.push({
        x: road.axis === 0 ? road.c + (hash2(i, 3, 4) - 0.5) * 4 : along,
        z: road.axis === 1 ? road.c + (hash2(i, 3, 4) - 0.5) * 4 : along,
        y: 48 + hash2(i, 5, 4) * 26,
        dir: hash2(i, 6, 4) > 0.5 ? 1 : -1,
        axis: road.axis,
        speed: 10 + hash2(i, 7, 4) * 14,
      });
      this.spinnerLights.setColorAt(i * 2, new THREE.Color(2.4, 2.4, 3));
      this.spinnerLights.setColorAt(i * 2 + 1, new THREE.Color(3.4, 0.2, 0.4));
    }

    this.group.add(this.tracers, this.grenades, this.decals, this.lasers, this.beams, this.cursor, this.aimRing, this.spinners, this.spinnerLights);
  }

  setViewportHeight(h: number): void {
    this.sparks.setScale(h);
    this.smoke.setScale(h);
  }

  private flashLight(x: number, y: number, z: number, color: number, intensity: number, dist: number): void {
    let best = this.lights[0];
    for (const l of this.lights) if (l.intensity < best.intensity) best = l;
    best.position.set(x, y, z);
    best.color.setHex(color);
    best.intensity = intensity;
    best.distance = dist;
  }

  private decal(x: number, z: number, size: number, color: THREE.Color): void {
    const i = this.decalIdx++ % MAX_DECALS;
    this.q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.random() * 6.28);
    this.m.compose(this.v.set(x, 0.035 + (i % 7) * 0.001, z), this.q, this.s.set(size, 1, size * (0.7 + Math.random() * 0.5)));
    this.decals.setMatrixAt(i, this.m);
    this.decals.setColorAt(i, color);
    this.decals.count = Math.min(MAX_DECALS, Math.max(this.decals.count, i + 1));
    this.decals.instanceMatrix.needsUpdate = true;
    if (this.decals.instanceColor) this.decals.instanceColor.needsUpdate = true;
  }

  private burst(x: number, y: number, z: number, n: number, speed: number, color: [number, number, number], size: number, life: number, grav = 12): void {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const u = Math.random() * 2 - 1;
      const s = speed * (0.3 + Math.random() * 0.7);
      const h = Math.sqrt(1 - u * u);
      this.sparks.emit({
        x,
        y,
        z,
        vx: Math.cos(a) * h * s,
        vy: Math.sin(a) * h * s,
        vz: Math.abs(u) * s,
        life: life * (0.5 + Math.random() * 0.5),
        max: life,
        size,
        r: color[0],
        g: color[1],
        b: color[2],
        drag: 0.2,
        grav,
      });
    }
  }

  onEvents(events: readonly SimEvent[], world: World): void {
    for (const ev of events) {
      switch (ev.t) {
        case 'shot': {
          const w = world.content.weapons[ev.weapon];
          const c = new THREE.Color(w?.color ?? '#ffcc88');
          this.sparks.emit({ x: ev.x + ev.dx * 0.15, y: 1.25, z: ev.y + ev.dy * 0.15, vx: ev.dx * 2, vy: ev.dy * 2, vz: 0, life: 0.06, max: 0.06, size: 0.9, r: c.r * 4, g: c.g * 4, b: c.b * 4, drag: 0.1, grav: 0 });
          if (Math.random() < 0.6) this.flashLight(ev.x, 1.4, ev.y, c.getHex(), 5, 9);
          if (ev.faction === 'player' && ev.weapon === 'minigun') this.shake += 0.02;
          break;
        }
        case 'carHit':
          this.burst(ev.x, 0.9, ev.y, 12, 5, [2.6, 2.2, 1.6], 0.12, 0.4);
          this.shake += Math.min(0.4, ev.speed * 0.03);
          break;
        case 'impact':
          this.burst(ev.x, 1.2, ev.y, 5, 5, [3, 2.2, 1.2], 0.12, 0.35);
          break;
        case 'hit':
          this.burst(ev.x, 1.1, ev.y, 5, 3, [0.9, 0.05, 0.08], 0.16, 0.45, 9);
          break;
        case 'death': {
          const agentLike = ev.kind === 'agent' || ev.kind === 'rival' || ev.kind === 'enforcer';
          this.decal(ev.x, ev.y, 1.8 + Math.random(), new THREE.Color(0.25, 0.01, 0.02));
          if (agentLike) this.burst(ev.x, 1.2, ev.y, 18, 6, [2.5, 1.4, 0.5], 0.14, 0.6);
          break;
        }
        case 'explosion': {
          const b = this.blasts.find((x) => x.t >= 1) ?? this.blasts[0];
          b.t = 0;
          b.r = ev.r;
          b.mesh.position.set(ev.x, 0.8, ev.y);
          b.ring.position.set(ev.x, 0.06, ev.y);
          b.mesh.visible = b.ring.visible = true;
          this.flashLight(ev.x, 2.5, ev.y, 0xff8a3d, 60, ev.r * 5);
          this.burst(ev.x, 0.6, ev.y, 70, 16, [3.5, 1.6, 0.4], 0.24, 0.9, 16);
          this.burst(ev.x, 0.6, ev.y, 30, 7, [3, 0.9, 0.2], 0.5, 0.4, 2);
          for (let i = 0; i < 26; i++) {
            const a = Math.random() * Math.PI * 2;
            const s = 1 + Math.random() * 3;
            this.smoke.emit({ x: ev.x, y: 0.8, z: ev.y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, vz: 1.5 + Math.random() * 2.5, life: 2.5, max: 2.5, size: 2.4, r: 0.05, g: 0.05, b: 0.07, drag: 0.5, grav: -0.6 });
          }
          this.decal(ev.x, ev.y, ev.r * 1.6, new THREE.Color(0.01, 0.01, 0.01));
          this.shake += 0.7;
          break;
        }
        case 'persuaded': {
          const e = world.get(ev.id);
          if (e) this.burst(e.x, 1.4, e.y, 30, 4, [2.2, 0.6, 3.4], 0.14, 0.8, -2);
          break;
        }
        default:
          break;
      }
    }
  }

  movePulse(x: number, z: number): void {
    const p = this.pulses.find((q) => q.t >= 1) ?? this.pulses[0];
    p.t = 0;
    p.mesh.position.set(x, 0.05, z);
    p.mesh.visible = true;
  }

  update(world: World, alpha: number, dt: number, time: number, view: {
    selected: ReadonlySet<number>;
    cursor: THREE.Vector3 | null;
    aiming: boolean;
  }): void {
    this.sparks.update(dt);
    this.smoke.update(dt);

    for (const l of this.lights) l.intensity *= Math.pow(0.0005, dt);

    for (const b of this.blasts) {
      if (b.t >= 1) continue;
      b.t = Math.min(1, b.t + dt * 3.2);
      const k = 1 - Math.pow(1 - b.t, 3);
      b.mesh.scale.setScalar(0.4 + k * b.r * 0.45);
      (b.mesh.material as THREE.MeshBasicMaterial).opacity = Math.pow(1 - b.t, 2.5) * 0.85;
      b.ring.scale.setScalar(0.5 + k * b.r * 1.3);
      (b.ring.material as THREE.MeshBasicMaterial).opacity = Math.pow(1 - b.t, 2) * 0.6;
      if (b.t >= 1) b.mesh.visible = b.ring.visible = false;
    }
    for (const p of this.pulses) {
      if (p.t >= 1) continue;
      p.t = Math.min(1, p.t + dt * 2.2);
      p.mesh.scale.setScalar(1.6 - p.t);
      (p.mesh.material as THREE.MeshBasicMaterial).opacity = 1 - p.t;
      if (p.t >= 1) p.mesh.visible = false;
    }

    // Projectiles.
    let tn = 0;
    let gn = 0;
    for (const p of world.projectiles) {
      const x = p.px + (p.x - p.px) * alpha;
      const z = p.py + (p.y - p.py) * alpha;
      const y = p.pz + (p.z - p.pz) * alpha;
      if (p.kind === 'grenade') {
        this.grenades.setMatrixAt(gn, this.m.makeTranslation(x, y, z));
        const blink = Math.sin(time * 30) > 0 ? 3 : 0.3;
        this.grenades.setColorAt(gn++, new THREE.Color(blink, 0.2, 0.15));
        continue;
      }
      const sp = Math.hypot(p.vx, p.vy) || 1;
      const len = p.kind === 'rocket' ? 1.2 : Math.min(2.6, sp * 0.04);
      const ang = Math.atan2(p.vx, p.vy);
      this.q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), ang);
      const thick = p.kind === 'rocket' ? 0.22 : 0.05;
      this.m.compose(this.v.set(x - (p.vx / sp) * len * 0.5, y, z - (p.vy / sp) * len * 0.5), this.q, this.s.set(thick, thick, len));
      if (tn < 600) {
        this.tracers.setMatrixAt(tn, this.m);
        const w = world.content.weapons[p.weapon];
        const c = new THREE.Color(w?.color ?? '#ffcc88').multiplyScalar(p.kind === 'rocket' ? 5 : 3.2);
        this.tracers.setColorAt(tn++, c);
      }
      if (p.kind === 'rocket') {
        this.smoke.emit({ x, y, z, vx: 0, vy: 0, vz: 0.4, life: 1.2, max: 1.2, size: 0.9, r: 0.2, g: 0.22, b: 0.28, drag: 0.5, grav: -0.3 });
        this.sparks.emit({ x, y, z, vx: 0, vy: 0, vz: 0, life: 0.15, max: 0.15, size: 0.7, r: 0.8, g: 3, b: 3.4, drag: 1, grav: 0 });
      }
    }
    this.tracers.count = tn;
    this.tracers.instanceMatrix.needsUpdate = true;
    if (this.tracers.instanceColor) this.tracers.instanceColor.needsUpdate = true;
    this.grenades.count = gn;
    this.grenades.instanceMatrix.needsUpdate = true;
    if (this.grenades.instanceColor) this.grenades.instanceColor.needsUpdate = true;

    // Laser sights and persuasion beams.
    const lp = this.lasers.geometry.attributes.position as THREE.BufferAttribute;
    const bp = this.beams.geometry.attributes.position as THREE.BufferAttribute;
    let ln = 0;
    let bn = 0;
    let persuadeAim: THREE.Vector3 | null = null;
    for (const id of view.selected) {
      const a = world.get(id);
      if (!a || !a.alive || a.holstered) continue;
      const w = world.weapon(a);
      const ax = a.px + (a.x - a.px) * alpha;
      const az = a.py + (a.y - a.py) * alpha;
      const tx = a.aimX;
      const tz = a.aimY;
      if (w?.type === 'persuade') {
        if (!a.firing) continue;
        persuadeAim = new THREE.Vector3(tx, 0.06, tz);
        for (const e of world.entities) {
          if (!e.alive || e.persuadeProgress <= 0 || Math.hypot(e.x - a.x, e.y - a.y) > w.range + 1) continue;
          const segs = 12;
          for (let k = 0; k < segs && bn < 64 * 14 * 2 - 2; k++) {
            const t0 = k / segs;
            const t1 = (k + 1) / segs;
            const wob = (t: number) => Math.sin(t * 18 - time * 20 + e.id) * 0.18 * Math.sin(t * Math.PI);
            bp.setXYZ(bn++, ax + (e.x - ax) * t0, 1.4 + wob(t0), az + (e.y - az) * t0 + wob(t0));
            bp.setXYZ(bn++, ax + (e.x - ax) * t1, 1.4 + wob(t1), az + (e.y - az) * t1 + wob(t1));
          }
        }
        continue;
      }
      if (!view.aiming || !view.cursor || ln >= 30) continue;
      lp.setXYZ(ln++, ax, 1.25, az);
      lp.setXYZ(ln++, view.cursor.x, 1.0, view.cursor.z);
    }
    lp.needsUpdate = true;
    bp.needsUpdate = true;
    this.lasers.geometry.setDrawRange(0, ln);
    this.beams.geometry.setDrawRange(0, bn);

    const ar = this.aimRing;
    ar.visible = !!persuadeAim;
    if (persuadeAim) {
      const w = world.content.weapons.persuadertron;
      ar.position.copy(persuadeAim);
      ar.scale.setScalar(w.splash * (0.95 + Math.sin(time * 10) * 0.05));
    }

    if (view.cursor) {
      this.cursor.visible = true;
      this.cursor.position.set(view.cursor.x, 0.06, view.cursor.z);
      (this.cursor.material as THREE.MeshBasicMaterial).color.set(view.aiming ? new THREE.Color(3, 0.3, 0.35) : new THREE.Color(0.4, 2.4, 3));
      this.cursor.scale.setScalar(view.aiming ? 1.3 + Math.sin(time * 16) * 0.1 : 1);
    } else this.cursor.visible = false;

    // Spinners.
    this.spinnerData.forEach((s, i) => {
      if (s.axis === 0) s.z += s.dir * s.speed * dt;
      else s.x += s.dir * s.speed * dt;
      const L = this.mapSize;
      // Wrap inside the city bounds so flying traffic never crosses the skyline ring outside it.
      if (s.x < -4) s.x += L + 8;
      if (s.x > L + 4) s.x -= L + 8;
      if (s.z < -4) s.z += L + 8;
      if (s.z > L + 4) s.z -= L + 8;
      const yaw = s.axis === 0 ? (s.dir > 0 ? 0 : Math.PI) : s.dir > 0 ? Math.PI / 2 : -Math.PI / 2;
      this.q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
      this.m.compose(this.v.set(s.x, s.y + Math.sin(time + i) * 0.3, s.z), this.q, this.s.set(1, 1, 1));
      this.spinners.setMatrixAt(i, this.m);
      const fwd = new THREE.Vector3(0, 0, 1).applyQuaternion(this.q);
      const base = this.v.clone();
      this.spinnerLights.setMatrixAt(i * 2, this.m.compose(base.clone().addScaledVector(fwd, 1.62), this.q, this.s.set(1, 1, 1)));
      this.spinnerLights.setMatrixAt(i * 2 + 1, this.m.compose(base.clone().addScaledVector(fwd, -1.62), this.q, this.s.set(1, 1, 1)));
    });
    this.spinners.instanceMatrix.needsUpdate = true;
    this.spinnerLights.instanceMatrix.needsUpdate = true;
  }
}
