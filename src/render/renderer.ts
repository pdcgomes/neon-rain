import * as THREE from 'three';
import type { SimEvent } from '../sim/types.ts';
import type { World } from '../sim/world.ts';
import { Actors } from './actors.ts';
import { CameraRig } from './camera.ts';
import { City } from './cityBuilder.ts';
import { Fx } from './fx.ts';
import { PostFX } from './postfx.ts';
import { Rain } from './weather.ts';

export interface ViewState {
  selected: ReadonlySet<number>;
  cursor: THREE.Vector3 | null;
  aiming: boolean;
  overdrive: boolean;
}

const FOG = 0x0a0918;

function neonEnvironment(renderer: THREE.WebGLRenderer): THREE.Texture {
  const scene = new THREE.Scene();
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(50, 32, 16),
    new THREE.ShaderMaterial({
      side: THREE.BackSide,
      vertexShader: /* glsl */ `varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
      fragmentShader: /* glsl */ `varying vec3 vP; void main(){
        float h = normalize(vP).y;
        vec3 c = mix(vec3(0.05,0.03,0.09), vec3(0.08,0.07,0.2), smoothstep(-0.2,0.6,h));
        c += vec3(0.35,0.08,0.3) * smoothstep(0.25,0.0,abs(h-0.05));
        gl_FragColor = vec4(c,1.0); }`,
    }),
  );
  scene.add(sky);
  const panel = (color: THREE.ColorRepresentation, x: number, y: number, z: number, w: number, h: number) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide }));
    m.position.set(x, y, z);
    m.lookAt(0, 0, 0);
    scene.add(m);
  };
  panel(new THREE.Color(4, 0.4, 3), 30, 6, 10, 10, 3);
  panel(new THREE.Color(0.4, 3, 4), -25, 8, -20, 6, 12);
  panel(new THREE.Color(4, 2.2, 0.6), 10, 4, -32, 14, 2);
  panel(new THREE.Color(0.8, 0.5, 4), -30, 5, 22, 8, 5);
  const pmrem = new THREE.PMREMGenerator(renderer);
  const tex = pmrem.fromScene(scene, 0.03).texture;
  pmrem.dispose();
  return tex;
}

export class GameRenderer {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly rig: CameraRig;
  readonly city: City;
  readonly fx: Fx;
  private actors = new Actors();
  private rain = new Rain();
  private post: PostFX;
  private moon: THREE.DirectionalLight;
  private squadLight = new THREE.PointLight(0xc4dcff, 45, 18, 1.6);
  private canvas: HTMLCanvasElement;
  private world: World;
  private abort = new AbortController();
  private rainTime = 0;
  private occBox = new THREE.Box3();
  private occRay = new THREE.Ray();
  private occHit = new THREE.Vector3();
  private occDir = new THREE.Vector3();
  private occPts: THREE.Vector3[] = Array.from({ length: 12 }, () => new THREE.Vector3());

  constructor(canvas: HTMLCanvasElement, world: World) {
    this.canvas = canvas;
    this.world = world;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', stencil: false });
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.setClearColor(FOG);

    this.scene.fog = new THREE.FogExp2(FOG, 0.0105);
    this.scene.background = new THREE.Color(FOG);
    this.scene.environment = neonEnvironment(this.renderer);
    this.scene.environmentIntensity = 0.9;

    this.scene.add(new THREE.HemisphereLight(0x5a5fb0, 0x120818, 0.9));
    this.moon = new THREE.DirectionalLight(0x9fb4ff, 1.1);
    this.moon.castShadow = true;
    this.moon.shadow.mapSize.set(2048, 2048);
    const sc = this.moon.shadow.camera;
    sc.left = -48;
    sc.right = 48;
    sc.top = 48;
    sc.bottom = -48;
    sc.near = 1;
    sc.far = 260;
    this.moon.shadow.bias = -0.0006;
    this.moon.shadow.normalBias = 0.04;
    this.scene.add(this.moon, this.moon.target);
    const rim = new THREE.DirectionalLight(0xff4fb8, 0.35);
    rim.position.set(-60, 40, -30);
    this.scene.add(rim, this.squadLight);

    this.rig = new CameraRig(1, { w: world.map.w, h: world.map.h });
    this.city = new City(world.map);
    this.fx = new Fx(this.scene, world);
    this.scene.add(this.city.group, this.actors.group, this.fx.group, this.rain.mesh);

    this.post = new PostFX(this.renderer, this.scene, this.rig.camera);
    this.resize();
    window.addEventListener('resize', () => this.resize(), { signal: this.abort.signal });

    const lead = world.livingAgents()[0];
    if (lead) this.rig.setFocus(lead.x, lead.y, true);
  }

  get renderScale(): number {
    return this.post.scale;
  }

  resize(): void {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.rig.resize(w / h);
    this.post.setSize(w, h);
    this.fx.setViewportHeight(h * Math.min(window.devicePixelRatio || 1, 2) * this.post.scale);
  }

  onEvents(events: readonly SimEvent[]): void {
    this.fx.onEvents(events, this.world);
  }

  /** Client coords -> world ground point. Clicking a building face resolves to its base. */
  pick(clientX: number, clientY: number): THREE.Vector3 | null {
    const r = this.canvas.getBoundingClientRect();
    const nx = ((clientX - r.left) / r.width) * 2 - 1;
    const ny = -((clientY - r.top) / r.height) * 2 + 1;
    const ground = this.rig.pick(nx, ny);
    if (!ground) return null;
    const origin = this.rig.camera.position;
    const dir = ground.clone().sub(origin);
    const len = dir.length();
    dir.divideScalar(len);
    const ray = new THREE.Ray(origin.clone(), dir);
    let bestT = len;
    let best: THREE.Vector3 | null = null;
    const hit = new THREE.Vector3();
    for (const b of this.city.boxes) {
      if (b.fade < 0.5) continue;
      if (ray.intersectBox(new THREE.Box3(b.min, b.max), hit)) {
        const t = hit.distanceTo(origin);
        if (t < bestT) {
          bestT = t;
          best = hit.clone();
        }
      }
    }
    if (best) best.y = 0;
    return best ?? ground;
  }

  private updateOcclusion(): void {
    const cam = this.rig.camera.position;
    let n = 0;
    this.occPts[n++].set(this.rig.target.x, 1, this.rig.target.z);
    for (const a of this.world.livingAgents()) if (n < this.occPts.length) this.occPts[n++].set(a.x, 1, a.y);
    const box = this.occBox;
    const ray = this.occRay;
    const hit = this.occHit;
    for (const b of this.city.boxes) {
      box.set(b.min, b.max);
      let occludes = false;
      for (let i = 0; i < n; i++) {
        const d = this.occDir.subVectors(this.occPts[i], cam);
        const len = d.length();
        ray.set(cam, d.divideScalar(len));
        if (ray.intersectBox(box, hit) && hit.distanceTo(cam) < len - 0.5) {
          occludes = true;
          break;
        }
      }
      b.target = occludes ? 0 : 1;
    }
  }

  render(alpha: number, dt: number, time: number, view: ViewState): void {
    const world = this.world;
    const sel = [...view.selected].map((id) => world.get(id)).filter((e) => e && e.alive);
    if (sel.length) {
      const cx = sel.reduce((s, e) => s + e!.x, 0) / sel.length;
      const cz = sel.reduce((s, e) => s + e!.y, 0) / sel.length;
      this.rig.setFocus(cx, cz);
      this.squadLight.position.x += (cx - this.squadLight.position.x) * Math.min(1, dt * 6);
      this.squadLight.position.z += (cz - this.squadLight.position.z) * Math.min(1, dt * 6);
      this.squadLight.position.y = 6;
    }
    if (this.fx.shake > 0) {
      this.rig.shake(this.fx.shake);
      this.fx.shake = 0;
    }
    this.rig.update(dt, time);

    const t = this.rig.target;
    this.moon.position.set(t.x + 40, 90, t.z + 25);
    this.moon.target.position.copy(t);

    this.updateOcclusion();
    this.city.update(time);
    const ex = this.city.vtolBeam;
    const extracting = world.phase === 'extract';
    (ex.material as THREE.MeshBasicMaterial).opacity = extracting ? 0.22 + Math.sin(time * 4) * 0.06 : 0.05;
    this.city.vtolPad.scale.setScalar(extracting ? 1 + Math.sin(time * 5) * 0.03 : 1);
    this.city.escapeBeam.visible = world.alarm && world.phase === 'eliminate';

    this.actors.update(world, alpha, dt, time, view.selected);
    this.fx.update(world, alpha, dt, time, view);
    this.rainTime += dt * (view.overdrive ? 0.3 : 1);
    this.rain.update(this.rainTime, t);
    this.post.setOverdrive(view.overdrive ? 1 : 0);
    this.post.render(dt, time);
  }

  dispose(): void {
    this.abort.abort();
    this.post.composer.dispose();
    this.renderer.dispose();
  }
}
