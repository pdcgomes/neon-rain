import * as THREE from 'three';

const MIN_PITCH = 0.38;
const MAX_PITCH = Math.PI / 2 - 0.004;
const DEFAULT_PITCH = 1.0;
const DEFAULT_YAW = Math.PI / 4;
const MIN_DIST = 20;
const MAX_DIST = 95;

/** Free-orbit camera: continuous yaw, pitch from low 3/4 angle to straight top-down, zoom, pan and shake. */
export class CameraRig {
  readonly camera: THREE.PerspectiveCamera;
  readonly target = new THREE.Vector3();
  private focus = new THREE.Vector3();
  private pan = new THREE.Vector3();
  private yaw = DEFAULT_YAW;
  private desiredYaw = DEFAULT_YAW;
  private pitch = DEFAULT_PITCH;
  private desiredPitch = DEFAULT_PITCH;
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

  /** Orbit by angle deltas in radians (yaw around the focus, pitch up/down). */
  orbit(dYaw: number, dPitch: number): void {
    this.desiredYaw += dYaw;
    this.desiredPitch = THREE.MathUtils.clamp(this.desiredPitch + dPitch, MIN_PITCH, MAX_PITCH);
  }

  resetView(): void {
    this.pan.set(0, 0, 0);
    const turns = Math.round((this.desiredYaw - DEFAULT_YAW) / (Math.PI * 2));
    this.desiredYaw = DEFAULT_YAW + turns * Math.PI * 2;
    this.desiredPitch = DEFAULT_PITCH;
  }

  /** Toggles between a straight top-down view and the default 3/4 view. */
  toggleTopDown(): void {
    this.desiredPitch = this.desiredPitch > MAX_PITCH - 0.05 ? DEFAULT_PITCH : MAX_PITCH;
  }

  get yawAngle(): number {
    return this.yaw;
  }

  get pitchAngle(): number {
    return this.pitch;
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

  /** Moves the focus itself by the current pan, so a free camera can travel the whole map. */
  commitPan(): void {
    this.focus.add(this.pan);
    this.focus.x = THREE.MathUtils.clamp(this.focus.x, 4, this.bounds.w - 4);
    this.focus.z = THREE.MathUtils.clamp(this.focus.z, 4, this.bounds.h - 4);
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
    const k = Math.min(1, dt * 14);
    this.yaw += (this.desiredYaw - this.yaw) * k;
    this.pitch += (this.desiredPitch - this.pitch) * k;
    this.distance += (this.desiredDistance - this.distance) * Math.min(1, dt * 8);

    const goal = this.focus.clone().add(this.pan);
    goal.x = THREE.MathUtils.clamp(goal.x, 4, this.bounds.w - 4);
    goal.z = THREE.MathUtils.clamp(goal.z, 4, this.bounds.h - 4);
    this.target.lerp(goal, Math.min(1, dt * 5));

    const off = new THREE.Vector3(
      Math.sin(this.yaw) * Math.cos(this.pitch),
      Math.sin(this.pitch),
      Math.cos(this.yaw) * Math.cos(this.pitch),
    ).multiplyScalar(this.distance);
    this.camera.position.copy(this.target).add(off);
    if (this.shakeAmt > 0.001) {
      const s = this.shakeAmt * 0.6;
      this.camera.position.x += Math.sin(time * 91) * s;
      this.camera.position.y += Math.sin(time * 73 + 1) * s * 0.6;
      this.camera.position.z += Math.cos(time * 83) * s;
      this.shakeAmt *= Math.pow(0.02, dt);
    }
    // Screen-up follows the horizontal view direction, so looking straight down never flips.
    this.camera.up.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
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
