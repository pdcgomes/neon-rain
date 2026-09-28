import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { City } from '../../../render/cityBuilder.ts';
import type { Stage } from '../../stage.ts';
import { SPAWN_COLORS } from './canvas2d.ts';
import type { MissionDoc } from './doc.ts';

function dispose(o: THREE.Object3D): void {
  o.traverse((c) => {
    const m = c as THREE.Mesh;
    m.geometry?.dispose();
    const mats = Array.isArray(m.material) ? m.material : m.material ? [m.material] : [];
    for (const mt of mats) {
      for (const v of Object.values(mt)) if (v instanceof THREE.Texture) v.dispose();
      mt.dispose();
    }
  });
}

/** The game's own city renderer on the Lab's shared stage, plus simple markers for spawns. */
export class Preview3D {
  private stage: Stage;
  private controls: OrbitControls | null = null;
  private city: City | null = null;
  private group = new THREE.Group();
  private active = false;
  private raf = 0;
  private last = 0;
  private clock = 0;
  private env: THREE.Texture | null = null;

  constructor(stage: Stage) {
    this.stage = stage;
  }

  show(host: HTMLElement, doc: MissionDoc): void {
    const stage = this.stage;
    host.appendChild(stage.canvas);
    stage.resize();
    stage.setFloor(false);
    stage.setPreset('neon');
    stage.setAccents(false);
    stage.setRain(false);
    stage.setSilhouette(false);
    stage.setPixel(1);
    if (!this.controls) {
      this.controls = new OrbitControls(stage.camera, stage.canvas);
      this.controls.enableDamping = true;
      this.controls.screenSpacePanning = false;
      this.controls.maxPolarAngle = Math.PI / 2 - 0.05;
    }
    this.controls.enabled = true;
    this.rebuild(doc, true);
    this.active = true;
    this.last = performance.now();
    const loop = (now: number) => {
      if (!this.active) return;
      this.raf = requestAnimationFrame(loop);
      const dt = Math.min(0.1, (now - this.last) / 1000);
      this.last = now;
      this.clock += dt;
      this.controls!.update();
      this.city?.update(this.clock);
      stage.render(dt, this.controls!.target);
    };
    this.raf = requestAnimationFrame(loop);
  }

  rebuild(doc: MissionDoc, frame = false): void {
    const stage = this.stage;
    stage.content.remove(this.group);
    dispose(this.group);
    this.group = new THREE.Group();
    const map = doc.city();
    this.city = new City(map);
    this.city.setLighting(1, 1);
    this.city.setWetness(0.3);
    this.group.add(this.city.group);
    const pin = new THREE.CylinderGeometry(0.35, 0.35, 1.8, 10).translate(0, 0.9, 0);
    for (const s of doc.spawns) {
      const m = new THREE.Mesh(pin, new THREE.MeshBasicMaterial({ color: new THREE.Color(SPAWN_COLORS[s.kind]).multiplyScalar(1.6), toneMapped: false }));
      m.position.set(s.x, 0, s.y);
      this.group.add(m);
    }
    const squad = new THREE.Mesh(new THREE.ConeGeometry(0.8, 2.2, 4).translate(0, 1.1, 0), new THREE.MeshBasicMaterial({ color: new THREE.Color(0.2, 2.4, 2.8), toneMapped: false }));
    squad.position.set(map.spawn.x, 0, map.spawn.y);
    this.group.add(squad);
    stage.content.add(this.group);
    // The Lab's fog suits small boards; thin it out so a whole city stays visible from afar.
    const bg = (stage.scene.background as THREE.Color | null) ?? new THREE.Color('#0a0918');
    stage.scene.fog = new THREE.FogExp2(bg.getHex(), 0.9 / Math.max(map.w, map.h) / 2.2);
    // Seen from this far out, the puddles mirror the neon sky's magenta horizon over the whole map.
    if (stage.scene.environment) this.env = stage.scene.environment;
    stage.scene.environment = null;
    const bounds = new THREE.Box3(new THREE.Vector3(0, 0, 0), new THREE.Vector3(map.w, 20, map.h));
    stage.frame(bounds);
    if (frame && this.controls) {
      // Whole map at a 3/4 angle from the south-east, like the game camera but further out.
      const c = new THREE.Vector3(map.w / 2, 0, map.h / 2);
      const r = Math.max(map.w, map.h);
      this.controls.target.copy(c);
      stage.camera.position.set(c.x + r * 0.55, r * 0.95, c.z + r * 0.75);
      stage.camera.fov = 32;
      stage.camera.zoom = 1;
      stage.camera.near = 0.5;
      stage.camera.far = 1500;
      stage.camera.updateProjectionMatrix();
      this.controls.maxDistance = r * 2.5;
    }
  }

  hide(): void {
    if (!this.active) return;
    this.active = false;
    cancelAnimationFrame(this.raf);
    if (this.controls) this.controls.enabled = false;
    this.stage.content.remove(this.group);
    dispose(this.group);
    this.group = new THREE.Group();
    this.city = null;
    if (this.env) this.stage.scene.environment = this.env;
    this.stage.setFloor(true);
    this.stage.canvas.remove();
  }

  resize(): void {
    if (this.active) this.stage.resize();
  }
}
