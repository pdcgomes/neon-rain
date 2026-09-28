import * as THREE from 'three';
import { PostFX } from '../render/postfx.ts';
import { neonEnvironment } from '../render/renderer.ts';
import { Rain } from '../render/weather.ts';

export type LightPreset = 'neon' | 'dusk' | 'studio';

interface PresetDef {
  bg: string;
  fog: number;
  hemiSky: string;
  hemiGround: string;
  hemi: number;
  key: string;
  keyI: number;
  keyDir: [number, number, number];
  rim: string;
  rimI: number;
  accents: number;
  floor: string;
  env: number;
}

const PRESETS: Record<LightPreset, PresetDef> = {
  neon: { bg: '#0a0918', fog: 0.009, hemiSky: '#7a80d0', hemiGround: '#1a0c22', hemi: 1.5, key: '#b4c4ff', keyI: 2.2, keyDir: [30, 60, 45], rim: '#ff4fb8', rimI: 1.6, accents: 1, floor: '#15151e', env: 1.1 },
  dusk: { bg: '#3b3246', fog: 0.007, hemiSky: '#ffb38a', hemiGround: '#2a2233', hemi: 1.1, key: '#ffcf9e', keyI: 2.4, keyDir: [-60, 28, 30], rim: '#7fb2ff', rimI: 0.6, accents: 0.25, floor: '#2c2830', env: 0.45 },
  studio: { bg: '#2b2d31', fog: 0, hemiSky: '#ffffff', hemiGround: '#3a3a40', hemi: 1.0, key: '#ffffff', keyI: 2.6, keyDir: [30, 60, 45], rim: '#ffffff', rimI: 1.1, accents: 0, floor: '#4a4c52', env: 0.3 },
};

function gridTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d')!;
  g.fillStyle = '#808080';
  g.fillRect(0, 0, 256, 256);
  g.strokeStyle = 'rgba(255,255,255,0.22)';
  g.lineWidth = 2;
  g.strokeRect(1, 1, 254, 254);
  g.strokeStyle = 'rgba(255,255,255,0.08)';
  g.lineWidth = 1;
  for (let i = 64; i < 256; i += 64) {
    g.beginPath();
    g.moveTo(i, 0);
    g.lineTo(i, 256);
    g.moveTo(0, i);
    g.lineTo(256, i);
    g.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(100, 100);
  t.anisotropy = 8;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export class Stage {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(32, 1, 0.1, 800);
  readonly content = new THREE.Group();
  readonly post: PostFX;
  readonly canvas: HTMLCanvasElement;
  private hemi = new THREE.HemisphereLight();
  private key = new THREE.DirectionalLight();
  private rim = new THREE.DirectionalLight();
  private accents: THREE.DirectionalLight[] = [];
  private floor: THREE.Mesh;
  private floorMat: THREE.MeshStandardMaterial;
  private floorOn = true;
  private rain = new Rain();
  private silhouetteMat = new THREE.MeshBasicMaterial({ color: '#0b0b0f' });
  private env: THREE.Texture;
  preset: LightPreset = 'neon';
  rainOn = true;
  wet = true;
  silhouette = false;
  pixel = 1;
  private rainTime = 0;
  private dpr = Math.min(window.devicePixelRatio || 1, 2);

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', preserveDrawingBuffer: false });
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.env = neonEnvironment(this.renderer);
    this.scene.environment = this.env;

    this.key.castShadow = true;
    this.key.shadow.mapSize.set(2048, 2048);
    this.key.shadow.bias = -0.0004;
    this.key.shadow.normalBias = 0.03;
    this.scene.add(this.hemi, this.key, this.key.target, this.rim);
    // Coloured rim lights from behind: neon spill without hot spots on the wet floor.
    for (const c of ['#ff2bd6', '#1ff4ff']) {
      const l = new THREE.DirectionalLight(c, 0);
      this.accents.push(l);
      this.scene.add(l, l.target);
    }

    this.floorMat = new THREE.MeshStandardMaterial({ color: '#15151e', map: gridTexture(), roughness: 0.2, metalness: 0.3 });
    this.floor = new THREE.Mesh(new THREE.PlaneGeometry(400, 400).rotateX(-Math.PI / 2), this.floorMat);
    this.floor.receiveShadow = true;
    this.scene.add(this.floor, this.content, this.rain.group);

    this.post = new PostFX(this.renderer, this.scene, this.camera, { dynamicResolution: false });
    this.setPreset('neon');
    this.resize();
  }

  setPreset(p: LightPreset): void {
    this.preset = p;
    const d = PRESETS[p];
    this.scene.background = new THREE.Color(d.bg);
    this.scene.fog = d.fog > 0 ? new THREE.FogExp2(d.bg, d.fog) : null;
    this.hemi.color.set(d.hemiSky);
    this.hemi.groundColor.set(d.hemiGround);
    this.hemi.intensity = d.hemi;
    this.key.color.set(d.key);
    this.key.intensity = d.keyI;
    this.key.userData.dir = d.keyDir;
    this.rim.color.set(d.rim);
    this.rim.intensity = d.rimI;
    this.rim.position.set(-20, 50, -25);
    this.accents.forEach((l) => (l.intensity = 1.8 * d.accents));
    this.floorMat.color.set(d.floor);
    this.scene.environmentIntensity = d.env;
    this.applyFloor();
  }

  /** Plain light backdrop with no floor or fog: clean input images for image-to-3D. */
  setReferenceBackdrop(on: boolean): void {
    this.floor.visible = !on;
    if (on) {
      this.scene.background = new THREE.Color('#d9dae0');
      this.scene.fog = null;
    } else this.setPreset(this.preset);
  }

  /** Coloured rim and accent lights flatter single assets but glare off a city's wet puddles. */
  setAccents(on: boolean): void {
    const d = PRESETS[this.preset];
    this.rim.intensity = on ? d.rimI : 0;
    this.accents.forEach((l) => (l.intensity = on ? 1.8 * d.accents : 0));
  }

  /** The grid floor would z-fight with content that brings its own ground (a city preview). */
  setFloor(on: boolean): void {
    this.floorOn = on;
    this.floor.visible = on;
  }

  setWet(on: boolean): void {
    this.wet = on;
    this.applyFloor();
  }

  private applyFloor(): void {
    const wet = this.wet && this.preset !== 'studio';
    // The neon environment has very bright panels; at grazing angles a glossy floor mirrors
    // them as huge blobs, so the floor only takes a fraction of it.
    this.floorMat.roughness = wet ? 0.45 : 0.92;
    this.floorMat.metalness = wet ? 0.2 : 0.02;
    this.floorMat.envMapIntensity = wet ? 0.12 : 0.05;
  }

  setRain(on: boolean): void {
    this.rainOn = on;
  }

  setSilhouette(on: boolean): void {
    this.silhouette = on;
  }

  setPixel(k: number): void {
    this.pixel = Math.max(1, k);
    this.canvas.classList.toggle('pixelated', this.pixel > 1);
    this.post.setBasePixelRatio(this.dpr / this.pixel);
  }

  /** Aims the key light's shadow frustum and accent lights at the current board. */
  frame(bounds: THREE.Box3): void {
    const c = bounds.getCenter(new THREE.Vector3());
    const size = bounds.getSize(new THREE.Vector3());
    const r = Math.max(8, Math.max(size.x, size.z) * 0.6 + 4);
    const dir = (this.key.userData.dir as [number, number, number]) ?? [40, 90, 25];
    this.key.position.set(c.x + dir[0], c.y + dir[1], c.z + dir[2]);
    this.key.target.position.copy(c);
    const sc = this.key.shadow.camera;
    sc.left = -r;
    sc.right = r;
    sc.top = r;
    sc.bottom = -r;
    sc.near = 1;
    sc.far = 300;
    sc.updateProjectionMatrix();
    // Steep elevation keeps their mirror reflection on the floor out of normal camera angles.
    this.accents[0].position.set(c.x - 6, 45, c.z - 6);
    this.accents[1].position.set(c.x + 6, 45, c.z - 6);
    for (const l of this.accents) l.target.position.copy(c);
  }

  resize(): void {
    const w = this.canvas.clientWidth || 1;
    const h = this.canvas.clientHeight || 1;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.post.setSize(w, h);
  }

  render(dt: number, focus: THREE.Vector3): void {
    this.rainTime += dt;
    this.rain.group.visible = this.rainOn && !this.silhouette;
    this.rain.update(this.rainTime, focus, this.camera.position);
    if (this.silhouette) {
      const bg = this.scene.background;
      const fog = this.scene.fog;
      this.scene.background = new THREE.Color('#e9e9ee');
      this.scene.fog = null;
      this.scene.overrideMaterial = this.silhouetteMat;
      this.floor.visible = false;
      // Board decorations (plinths, rulers, backdrops) would read as solid blocks.
      const hidden: THREE.Object3D[] = [];
      this.content.traverse((o) => {
        if (o.userData.decor && o.visible) {
          o.visible = false;
          hidden.push(o);
        }
      });
      this.renderer.render(this.scene, this.camera);
      for (const o of hidden) o.visible = true;
      this.scene.overrideMaterial = null;
      this.scene.background = bg;
      this.scene.fog = fog;
      this.floor.visible = this.floorOn;
      return;
    }
    this.post.render(dt, performance.now() / 1000);
  }

  /** Raw render without post-processing (no grain or bloom): clean input for image-to-3D. */
  captureClean(type = 'image/jpeg', quality = 0.92): string {
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.render(this.scene, this.camera);
    const url = this.canvas.toDataURL(type, quality);
    this.renderer.toneMapping = THREE.NoToneMapping;
    return url;
  }

  capturePNG(dt: number, focus: THREE.Vector3): string {
    this.render(dt, focus);
    return this.canvas.toDataURL('image/png');
  }
}
