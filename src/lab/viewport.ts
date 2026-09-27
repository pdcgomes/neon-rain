import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

export type ViewPreset = 'front' | 'side' | 'top' | 'threeq' | 'game';

export const VIEW_LABELS: Record<ViewPreset, string> = {
  front: 'Front',
  side: 'Side',
  top: 'Top',
  threeq: '3/4',
  game: 'Game',
};

/** The game's default camera: 30° FOV, 1.0 rad pitch, 44 m out, yaw 45°. */
export const GAME_CAMERA = { fov: 30, pitch: 1.0, distance: 44, yaw: Math.PI / 4 };

export interface Pickable {
  root: THREE.Object3D;
  id: string;
}

/** Orbit / pan / zoom camera with presets, board framing and hover + click picking. */
export class Viewport {
  readonly controls: OrbitControls;
  private camera: THREE.PerspectiveCamera;
  private dom: HTMLElement;
  private raycaster = new THREE.Raycaster();
  private pickables: Pickable[] = [];
  private hoverBox: THREE.BoxHelper;
  private selectBox: THREE.BoxHelper;
  private bounds = new THREE.Box3(new THREE.Vector3(-2, 0, -2), new THREE.Vector3(2, 2, 2));
  preset: ViewPreset = 'threeq';
  hovered: Pickable | null = null;
  selected: Pickable | null = null;
  onSelect: (p: Pickable | null) => void = () => {};
  onHover: (p: Pickable | null) => void = () => {};
  onChange: () => void = () => {};

  constructor(camera: THREE.PerspectiveCamera, dom: HTMLElement, overlay: THREE.Object3D) {
    this.camera = camera;
    this.dom = dom;
    this.controls = new OrbitControls(camera, dom);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.12;
    this.controls.screenSpacePanning = true;
    this.controls.maxPolarAngle = Math.PI / 2 - 0.02;
    this.controls.addEventListener('change', () => this.onChange());
    this.hoverBox = new THREE.BoxHelper(new THREE.Object3D(), 0x6ab4ff);
    this.selectBox = new THREE.BoxHelper(new THREE.Object3D(), 0x0a84ff);
    for (const b of [this.hoverBox, this.selectBox]) {
      (b.material as THREE.LineBasicMaterial).depthTest = false;
      (b.material as THREE.LineBasicMaterial).transparent = true;
      b.renderOrder = 999;
      b.visible = false;
      overlay.add(b);
    }
    (this.hoverBox.material as THREE.LineBasicMaterial).opacity = 0.5;

    let downAt = { x: 0, y: 0 };
    dom.addEventListener('pointerdown', (e) => (downAt = { x: e.clientX, y: e.clientY }));
    dom.addEventListener('pointermove', (e) => this.hover(e));
    dom.addEventListener('pointerup', (e) => {
      if (e.button !== 0 || Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y) > 4) return;
      this.select(this.pick(e));
    });
    dom.addEventListener('dblclick', (e) => {
      const p = this.pick(e);
      if (p) this.frameObject(p.root);
      else this.frameBoard();
    });
  }

  setPickables(list: Pickable[]): void {
    this.pickables = list;
    this.hovered = null;
    this.selected = null;
    this.hoverBox.visible = false;
    this.selectBox.visible = false;
  }

  setBounds(b: THREE.Box3): void {
    this.bounds.copy(b);
  }

  private pick(e: PointerEvent | MouseEvent): Pickable | null {
    const r = this.dom.getBoundingClientRect();
    const ndc = new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.camera);
    let best: Pickable | null = null;
    let bestD = Infinity;
    for (const p of this.pickables) {
      const hits = this.raycaster.intersectObject(p.root, true);
      if (hits.length && hits[0].distance < bestD) {
        bestD = hits[0].distance;
        best = p;
      }
    }
    return best;
  }

  private hover(e: PointerEvent): void {
    if (e.buttons) return;
    const p = this.pick(e);
    if (p === this.hovered) return;
    this.hovered = p;
    this.hoverBox.visible = !!p && p !== this.selected;
    if (p) this.hoverBox.setFromObject(p.root);
    this.onHover(p);
  }

  select(p: Pickable | null): void {
    this.selected = p;
    this.selectBox.visible = !!p;
    if (p) this.selectBox.setFromObject(p.root);
    this.hoverBox.visible = false;
    this.onSelect(p);
  }

  /** Keeps highlight boxes glued to animated assets. */
  updateHighlights(): void {
    if (this.selected && this.selectBox.visible) this.selectBox.setFromObject(this.selected.root);
    if (this.hovered && this.hoverBox.visible) this.hoverBox.setFromObject(this.hovered.root);
  }

  private fit(box: THREE.Box3, azimuth: number, polar: number, padding = 1.04): void {
    const center = box.getCenter(new THREE.Vector3());
    const radius = Math.max(0.5, box.getSize(new THREE.Vector3()).length() / 2);
    const dir = new THREE.Vector3(Math.sin(polar) * Math.sin(azimuth), Math.cos(polar), Math.sin(polar) * Math.cos(azimuth));
    // Tight fit: the distance at which every corner of the box projects inside the frustum.
    const tanV = Math.tan(THREE.MathUtils.degToRad(this.camera.fov) / 2);
    const tanH = tanV * this.camera.aspect;
    const fwd = dir.clone().negate();
    const right = new THREE.Vector3().crossVectors(fwd, new THREE.Vector3(0, 1, 0));
    if (right.lengthSq() < 1e-6) right.set(1, 0, 0);
    right.normalize();
    const up = new THREE.Vector3().crossVectors(right, fwd).normalize();
    let dist = 0;
    for (let i = 0; i < 8; i++) {
      const p = new THREE.Vector3(i & 1 ? box.max.x : box.min.x, i & 2 ? box.max.y : box.min.y, i & 4 ? box.max.z : box.min.z).sub(center);
      const depth = p.dot(fwd);
      dist = Math.max(dist, depth + Math.abs(p.dot(right)) / tanH, depth + Math.abs(p.dot(up)) / tanV);
    }
    dist *= padding;
    this.controls.target.copy(center);
    this.camera.position.copy(center).addScaledVector(dir, dist);
    this.controls.minDistance = radius * 0.2;
    this.controls.maxDistance = Math.max(200, dist * 6);
    this.controls.update();
  }

  applyPreset(p: ViewPreset, polarOverride?: number): void {
    this.preset = p;
    this.camera.fov = p === 'game' ? GAME_CAMERA.fov : 32;
    this.camera.zoom = 1;
    this.camera.updateProjectionMatrix();
    const b = this.bounds;
    switch (p) {
      case 'front':
        this.fit(b, 0, polarOverride ?? Math.PI / 2 - 0.12);
        break;
      case 'side':
        this.fit(b, Math.PI / 2, Math.PI / 2 - 0.12);
        break;
      case 'top':
        this.fit(b, 0, 0.001);
        break;
      case 'threeq':
        this.fit(b, 0.6, polarOverride ?? 1.08);
        break;
      case 'game': {
        const c = b.getCenter(new THREE.Vector3());
        c.y = 0.9;
        const polar = Math.PI / 2 - GAME_CAMERA.pitch;
        const dir = new THREE.Vector3(Math.sin(polar) * Math.sin(GAME_CAMERA.yaw), Math.cos(polar), Math.sin(polar) * Math.cos(GAME_CAMERA.yaw));
        this.controls.target.copy(c);
        this.camera.position.copy(c).addScaledVector(dir, GAME_CAMERA.distance);
        this.controls.update();
        break;
      }
    }
    this.onChange();
  }

  frameBoard(): void {
    this.applyPreset(this.preset);
  }

  frameObject(obj: THREE.Object3D): void {
    const box = new THREE.Box3().setFromObject(obj, true);
    const az = this.controls.getAzimuthalAngle();
    const pol = this.controls.getPolarAngle();
    this.fit(box, az, pol, 1.3);
    this.onChange();
  }

  frameSelection(): void {
    if (this.selected) this.frameObject(this.selected.root);
    else this.frameBoard();
  }

  /** Serialised camera state for deep links: azimuth, polar, distance, target. */
  serialize(): string {
    const t = this.controls.target;
    const d = this.camera.position.distanceTo(t);
    const f = (n: number) => n.toFixed(2);
    return [f(this.controls.getAzimuthalAngle()), f(this.controls.getPolarAngle()), f(d), f(t.x), f(t.y), f(t.z)].join(',');
  }

  restore(s: string): boolean {
    const v = s.split(',').map(Number);
    if (v.length !== 6 || v.some((n) => !Number.isFinite(n))) return false;
    const [az, pol, d, x, y, z] = v;
    this.controls.target.set(x, y, z);
    const dir = new THREE.Vector3(Math.sin(pol) * Math.sin(az), Math.cos(pol), Math.sin(pol) * Math.cos(az));
    this.camera.position.set(x, y, z).addScaledVector(dir, d);
    this.controls.update();
    return true;
  }

  update(): void {
    this.controls.update();
  }
}
