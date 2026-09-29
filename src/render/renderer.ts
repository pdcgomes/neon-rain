import * as THREE from 'three';
import { targetCanEscape } from '../sim/systems/objectives.ts';
import type { SimEvent } from '../sim/types.ts';
import type { World } from '../sim/world.ts';
import { Actors } from './actors.ts';
import { AgentModels } from './agentModels.ts';
import { TrafficLights, Vehicles } from './vehicles.ts';
import { CameraRig } from './camera.ts';
import { type BuildingBox, City } from './cityBuilder.ts';
import { Fx } from './fx.ts';
import { PostFX } from './postfx.ts';
import { type Palette, paletteAt, RainTrack, resolveAtmosphere } from './atmosphere.ts';
import { Rain } from './weather.ts';

export interface ViewState {
  selected: ReadonlySet<number>;
  cursor: THREE.Vector3 | null;
  aiming: boolean;
  overdrive: boolean;
}

export function neonEnvironment(renderer: THREE.WebGLRenderer, sky: Pick<Palette, 'skyLow' | 'skyHigh' | 'horizon'> = paletteAt(22)): THREE.Texture {
  const scene = new THREE.Scene();
  // Palette sky colours are authored as raw values written straight into the (linear) env map.
  const raw = (c: THREE.Color) => {
    const o = c.getRGB({ r: 0, g: 0, b: 0 }, THREE.SRGBColorSpace);
    return new THREE.Vector3(o.r, o.g, o.b);
  };
  const dome = new THREE.Mesh(
    new THREE.SphereGeometry(50, 32, 16),
    new THREE.ShaderMaterial({
      side: THREE.BackSide,
      uniforms: { uLow: { value: raw(sky.skyLow) }, uHigh: { value: raw(sky.skyHigh) }, uHorizon: { value: raw(sky.horizon) } },
      vertexShader: /* glsl */ `varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
      fragmentShader: /* glsl */ `uniform vec3 uLow; uniform vec3 uHigh; uniform vec3 uHorizon; varying vec3 vP; void main(){
        float h = normalize(vP).y;
        vec3 c = mix(uLow, uHigh, smoothstep(-0.2,0.6,h));
        c += uHorizon * smoothstep(0.25,0.0,abs(h-0.05));
        gl_FragColor = vec4(c,1.0); }`,
    }),
  );
  scene.add(dome);
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
  private agentModels = new AgentModels();
  private vehicles = new Vehicles();
  private lights: TrafficLights;
  private rain = new Rain();
  private post: PostFX;
  private moon: THREE.DirectionalLight;
  private palette: Palette;
  private rainTrack: RainTrack;
  private wetness = 0;
  /** Current rain intensity, 0 dry .. 1 heavy. */
  rainLevel = 0;
  private squadLight = new THREE.PointLight(0xc4dcff, 45, 18, 1.6);
  private canvas: HTMLCanvasElement;
  private world: World;
  private abort = new AbortController();
  private rainTime = 0;
  private occBox = new THREE.Box3();
  private occRay = new THREE.Ray();
  private occHit = new THREE.Vector3();
  private occDir = new THREE.Vector3();
  private occPts: THREE.Vector3[] = Array.from({ length: 24 }, () => new THREE.Vector3());
  private occMargins = new Float32Array(24);

  constructor(canvas: HTMLCanvasElement, world: World) {
    this.canvas = canvas;
    this.world = world;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', stencil: false });
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    const mission = world.content.mission;
    const atmo = resolveAtmosphere(mission.atmosphere);
    const pal = (this.palette = paletteAt(atmo.hour));
    this.rainTrack = new RainTrack(mission.seed, atmo.rain, atmo.fixedRain);
    this.renderer.setClearColor(pal.fog);

    this.scene.fog = new THREE.FogExp2(pal.fog, pal.fogDensity);
    this.scene.background = pal.fog.clone();
    this.scene.environment = neonEnvironment(this.renderer, pal);
    this.scene.environmentIntensity = pal.envIntensity;

    this.scene.add(new THREE.HemisphereLight(pal.hemiSky, pal.hemiGround, pal.hemi));
    this.moon = new THREE.DirectionalLight(pal.key, pal.keyIntensity);
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
    const rim = new THREE.DirectionalLight(pal.rim, pal.rimIntensity);
    rim.position.set(-60, 40, -30);
    this.scene.add(rim, this.squadLight);

    this.rig = new CameraRig(1, { w: world.map.w, h: world.map.h });
    this.city = new City(world.map);
    this.city.setLighting(pal.windows, pal.lamps);
    this.rainLevel = this.rainTrack.at(0);
    this.wetness = Math.max(this.rainLevel, 0.6);
    this.fx = new Fx(this.scene, world);
    this.lights = new TrafficLights(world);
    this.scene.add(this.city.group, this.actors.group, this.agentModels.group, this.vehicles.group, this.lights.group, this.fx.group, this.rain.group);

    this.post = new PostFX(this.renderer, this.scene, this.rig.camera);
    this.post.setGrade(pal.bloom, pal.bloomThreshold);
    this.resize();
    window.addEventListener('resize', () => this.resize(), { signal: this.abort.signal });

    const lead = world.livingAgents()[0];
    if (lead) this.rig.setFocus(lead.x, lead.y, true);
  }

  /** Builds every agent rig, compiles all shaders and draws one frame so play starts without hitches. */
  async warmup(): Promise<void> {
    this.agentModels.update(this.world, 1, 0);
    await this.renderer.compileAsync(this.scene, this.rig.camera);
    this.render(0, 0, 0, { selected: new Set(), cursor: null, aiming: false, overdrive: false });
  }

  /** Draws a different world of the same mission, e.g. a replay rewound to its start. */
  setWorld(world: World): void {
    this.world = world;
    this.fx.clear();
  }

  get renderScale(): number {
    return this.post.scale;
  }

  /** Fits the canvas's own size: the whole window in the game, a panel in the Lab. */
  resize(): void {
    const w = this.canvas.clientWidth || window.innerWidth;
    const h = this.canvas.clientHeight || window.innerHeight;
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

  /**
   * Ghosts any building that sits between the camera and something the player needs to see:
   * each agent (feet and head), the camera focus, the cursor, and the target when nearby.
   * Boxes are widened so walls hugging an agent also fade, and stay faded briefly to avoid flicker.
   */
  private updateOcclusion(view: ViewState, time: number): void {
    const cam = this.rig.camera.position;
    const pts = this.occPts;
    const margins = this.occMargins;
    let n = 0;
    const add = (x: number, y: number, z: number, m: number) => {
      if (n >= pts.length) return;
      pts[n].set(x, y, z);
      margins[n++] = m;
    };
    add(this.rig.target.x, 1, this.rig.target.z, 2.5);
    for (const a of this.world.livingAgents()) {
      add(a.x, 0.3, a.y, 2.2);
      add(a.x, 1.8, a.y, 1.4);
    }
    if (view.cursor) add(view.cursor.x, 0.5, view.cursor.z, 1.2);
    const target = this.world.get(this.world.targetId);
    if (target && target.alive && Math.hypot(target.x - this.rig.target.x, target.y - this.rig.target.z) < 30) {
      add(target.x, 1, target.y, 1.5);
    }
    const box = this.occBox;
    const ray = this.occRay;
    const hit = this.occHit;
    const fade = (b: BuildingBox) => {
      let occludes = false;
      for (let i = 0; i < n && !occludes; i++) {
        const m = margins[i];
        box.min.set(b.min.x - m, b.min.y, b.min.z - m);
        box.max.set(b.max.x + m, b.max.y + 0.5, b.max.z + m);
        const d = this.occDir.subVectors(pts[i], cam);
        const len = d.length();
        ray.set(cam, d.divideScalar(len));
        if (ray.intersectBox(box, hit) && hit.distanceTo(cam) < len - 0.3 && pts[i].y < b.max.y) occludes = true;
      }
      if (occludes) b.holdUntil = time + 0.6;
      b.target = occludes || time < b.holdUntil ? 0 : 1;
    };
    for (const b of this.city.boxes) fade(b);
    // Backdrop towers must also keep the middle of the screen clear, not just the squad.
    const t = this.rig.target;
    const r = cam.distanceTo(t) * 0.35;
    for (let k = 0; k < 8; k++) add(t.x + Math.cos((k * Math.PI) / 4) * r, 0.5, t.z + Math.sin((k * Math.PI) / 4) * r, 1);
    for (const b of this.city.skyline) fade(b);
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
    const e = this.palette.keyElevation;
    this.moon.position.set(t.x + 84.8 * Math.cos(e), 100 * Math.sin(e), t.z + 53 * Math.cos(e));
    this.moon.target.position.copy(t);

    this.updateOcclusion(view, time);
    this.city.update(time);
    const ex = this.city.vtolBeam;
    const extracting = world.phase === 'extract';
    (ex.material as THREE.MeshBasicMaterial).opacity = extracting ? 0.22 + Math.sin(time * 4) * 0.06 : 0.05;
    this.city.vtolPad.scale.setScalar(extracting ? 1 + Math.sin(time * 5) * 0.03 : 1);
    this.city.escapeBeam.visible = world.alarm && targetCanEscape(world);

    this.agentModels.update(world, alpha, dt);
    this.actors.update(world, alpha, dt, time, view.selected, this.agentModels.ids);
    this.vehicles.update(world, alpha, time);
    this.lights.update(world);
    this.fx.update(world, alpha, dt, time, view);
    this.updateWeather(time, dt);
    this.rainTime += dt * (view.overdrive ? 0.3 : 1);
    this.rain.update(this.rainTime, t, this.rig.camera.position);
    this.post.setOverdrive(view.overdrive ? 1 : 0);
    this.post.render(dt, time);
  }

  /** Rain drifts over time; streets soak quickly and dry slowly, so they stay slick after a shower. */
  private updateWeather(time: number, dt: number): void {
    const level = (this.rainLevel = this.rainTrack.at(time));
    this.wetness += (level - this.wetness) * Math.min(1, dt / (level > this.wetness ? 6 : 70));
    this.city.setWetness(Math.max(0.25, this.wetness));
    this.rain.setLook(level, this.palette.rain);
    (this.scene.fog as THREE.FogExp2).density = this.palette.fogDensity * (1 + 0.3 * level);
  }

  dispose(): void {
    this.abort.abort();
    this.post.composer.dispose();
    this.renderer.dispose();
  }
}
