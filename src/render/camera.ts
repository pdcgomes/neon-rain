import * as THREE from 'three';

const PITCH = 1.0;
const MIN_DIST = 22;
const MAX_DIST = 95;

/** Isometric-leaning 3/4 camera with 90-degree rotation steps, zoom, pan and shake. */
export class CameraRig {
  readonly camera: THREE.PerspectiveCamera;
  readonly target = new THREE.Vector3();
  private focus = new THREE.Vector3();
  private pan = new THREE.Vector3();
  private yawIndex = 0;
  private yaw = Math.PI / 4;
  private distance = 44;
  private desiredDistance = 44;
  private shakeAmt = 0;
  private raycaster = new THREE.Raycaster();
  private ground = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  private bounds: { w: number; h: number };

  constructor(aspect: number, bounds: { w: number; h: number }) {
    this.camera = new THREE.PerspectiveCamera(30, aspect, 1, 600);
    this.bounds = bounds;
  }

  rotate(dir: 1 | -1): void {
    this.yawIndex = (this.yawIndex + dir + 4) % 4;
  }

  /** Current yaw snapped to the rotation step, used to rotate screen-space input. */
  get yawAngle(): number {
    return this.yaw;
  }

  zoom(delta: number): void {
    this.desiredDistance = THREE.MathUtils.clamp(this.desiredDistance * Math.pow(1.0012, delta), MIN_DIST, MAX_DIST);
  }

  /** Pans in screen space: x = right, y = up the screen. */
  panBy(dx: number, dy: number): void {
    const fwd = new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    const right = new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    const k = this.distance / 58;
    this.pan.addScaledVector(right, dx * k).addScaledVector(fwd, dy * k);
    this.pan.clampLength(0, 45);
  }

  recenter(): void {
    this.pan.set(0, 0, 0);
  }

  shake(amount: number): void {
    this.shakeAmt = Math.min(1.5, this.shakeAmt + amount);
  }

  setFocus(x: number, z: number, snap = false): void {
    this.focus.set(x, 0, z);
    if (snap) this.target.copy(this.focus);
  }

  update(dt: number, time: number): void {
    const targetYaw = Math.PI / 4 + this.yawIndex * (Math.PI / 2);
    let d = targetYaw - this.yaw;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    this.yaw += d * Math.min(1, dt * 9);

    this.distance += (this.desiredDistance - this.distance) * Math.min(1, dt * 8);
    const goal = this.focus.clone().add(this.pan);
    goal.x = THREE.MathUtils.clamp(goal.x, 4, this.bounds.w - 4);
    goal.z = THREE.MathUtils.clamp(goal.z, 4, this.bounds.h - 4);
    this.target.lerp(goal, Math.min(1, dt * 5));

    const off = new THREE.Vector3(
      Math.sin(this.yaw) * Math.cos(PITCH),
      Math.sin(PITCH),
      Math.cos(this.yaw) * Math.cos(PITCH),
    ).multiplyScalar(this.distance);
    this.camera.position.copy(this.target).add(off);
    if (this.shakeAmt > 0.001) {
      const s = this.shakeAmt * 0.6;
      this.camera.position.x += Math.sin(time * 91) * s;
      this.camera.position.y += Math.sin(time * 73 + 1) * s * 0.6;
      this.camera.position.z += Math.cos(time * 83) * s;
      this.shakeAmt *= Math.pow(0.02, dt);
    }
    this.camera.lookAt(this.target);
  }

  resize(aspect: number): void {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }

  /** Screen (NDC) -> point on the ground plane. */
  pick(ndcX: number, ndcY: number): THREE.Vector3 | null {
    this.raycaster.setFromCamera(new THREE.Vector2(ndcX, ndcY), this.camera);
    const out = new THREE.Vector3();
    return this.raycaster.ray.intersectPlane(this.ground, out);
  }
}
