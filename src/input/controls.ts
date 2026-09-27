import * as THREE from 'three';
import type { Command } from '../sim/commands.ts';
import type { World } from '../sim/world.ts';
import type { GameRenderer } from '../render/renderer.ts';

export interface ControlHooks {
  onPause(): void;
  onToggleStats(): void;
  onMove(x: number, z: number): void;
}

const STEER_INTERVAL = 0.15;
const PAN_SPEED = 38;
const ORBIT_SENSITIVITY = 0.0055;
const KEY_ORBIT_SPEED = 1.9;

/**
 * Cannon Fodder-style scheme:
 *   Left click / hold   move the selected squad (hold to steer)
 *   Right click / hold  fire at the cursor (move and shoot at the same time)
 *   Left + Right        throw a grenade at the cursor
 *   Middle drag / Alt+Left drag   orbit the camera
 */
export class Controls {
  readonly selected = new Set<number>();
  cursor: THREE.Vector3 | null = null;
  overdrive = false;
  private queue: Command[] = [];
  private mx = 0;
  private my = 0;
  private hasMouse = false;
  private lmb = false;
  private rmb = false;
  private chord = false;
  private wasFiring = false;
  private lastSteer = 0;
  private orbiting = false;
  private keys = new Set<string>();
  private world: World;
  private view: GameRenderer;
  private hooks: ControlHooks;
  enabled = true;
  private abort = new AbortController();

  constructor(canvas: HTMLCanvasElement, world: World, view: GameRenderer, hooks: ControlHooks) {
    this.world = world;
    this.view = view;
    this.hooks = hooks;
    for (const a of world.agents()) this.selected.add(a.id);

    const signal = this.abort.signal;
    canvas.addEventListener('contextmenu', (e) => e.preventDefault(), { signal });
    canvas.addEventListener('mousedown', (e) => this.onDown(e), { signal });
    window.addEventListener('mouseup', (e) => this.onUp(e), { signal });
    window.addEventListener('mousemove', (e) => {
      if (this.orbiting) view.rig.orbit(-e.movementX * ORBIT_SENSITIVITY, e.movementY * ORBIT_SENSITIVITY);
      this.mx = e.clientX;
      this.my = e.clientY;
      this.hasMouse = true;
    }, { signal });
    canvas.addEventListener('auxclick', (e) => e.preventDefault(), { signal });
    canvas.addEventListener('mouseleave', () => (this.hasMouse = false), { signal });
    canvas.addEventListener('mouseenter', () => (this.hasMouse = true), { signal });
    canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      if (e.shiftKey) view.rig.orbit(0, -(e.deltaY || e.deltaX) * 0.0015);
      else view.rig.zoom(e.deltaY);
    }, { passive: false, signal });
    window.addEventListener('keydown', (e) => this.onKey(e, true), { signal });
    window.addEventListener('keyup', (e) => this.onKey(e, false), { signal });
    window.addEventListener('blur', () => {
      this.lmb = this.rmb = false;
      this.orbiting = false;
      this.keys.clear();
      if (this.overdrive) this.setOverdrive(false);
    }, { signal });
  }

  private ids(): number[] {
    return [...this.selected];
  }

  private push(c: Command): void {
    if (this.enabled) this.queue.push(c);
  }

  private onDown(e: MouseEvent): void {
    if (e.button === 1 || (e.button === 0 && e.altKey)) {
      e.preventDefault();
      this.orbiting = true;
      return;
    }
    if (!this.enabled) return;
    this.updateCursor();
    if (e.button === 0) this.lmb = true;
    if (e.button === 2) this.rmb = true;
    if (this.lmb && this.rmb) {
      this.chord = true;
      if (this.cursor) this.push({ type: 'secondary', agents: this.ids(), x: this.cursor.x, y: this.cursor.z });
      return;
    }
    if (e.button === 0) this.issueMove(true);
  }

  private onUp(e: MouseEvent): void {
    if (e.button === 1 || (this.orbiting && e.button === 0)) {
      this.orbiting = false;
      return;
    }
    if (e.button === 0) this.lmb = false;
    if (e.button === 2) this.rmb = false;
    if (!this.lmb && !this.rmb) this.chord = false;
  }

  private issueMove(pulse: boolean): void {
    if (!this.cursor || this.selected.size === 0) return;
    this.push({ type: 'move', agents: this.ids(), x: this.cursor.x, y: this.cursor.z });
    this.lastSteer = performance.now() / 1000;
    if (pulse) this.hooks.onMove(this.cursor.x, this.cursor.z);
  }

  private setOverdrive(on: boolean): void {
    this.overdrive = on;
    this.push({ type: 'overdrive', agents: this.world.agentIds, active: on });
  }

  selectSlot(slot: number, additive: boolean): void {
    const a = this.world.agents().find((x) => x.slot === slot);
    if (!a || !a.alive) return;
    if (!additive) this.selected.clear();
    if (additive && this.selected.has(a.id) && this.selected.size > 1) this.selected.delete(a.id);
    else this.selected.add(a.id);
  }

  selectAll(): void {
    this.selected.clear();
    for (const a of this.world.livingAgents()) this.selected.add(a.id);
  }

  /** Splits the current selection into Bravo team; splitting everyone merges back into Alpha. */
  split(): void {
    const living = this.world.livingAgents();
    const all = living.every((a) => this.selected.has(a.id));
    if (all) {
      this.push({ type: 'team', agents: living.map((a) => a.id), team: 0 });
      return;
    }
    const rest = living.filter((a) => !this.selected.has(a.id)).map((a) => a.id);
    this.push({ type: 'team', agents: this.ids(), team: 1 });
    this.push({ type: 'team', agents: rest, team: 0 });
  }

  switchTeam(): void {
    const living = this.world.livingAgents();
    const current = living.find((a) => this.selected.has(a.id))?.team ?? 0;
    const other = living.filter((a) => a.team !== current);
    if (!other.length) return;
    this.selected.clear();
    for (const a of other) this.selected.add(a.id);
  }

  setIpa(channel: 'a' | 'p' | 'i', value: number, agents?: number[]): void {
    this.push({ type: 'ipa', agents: agents ?? this.ids(), channel, value });
  }

  weapon(slot: number): void {
    this.push({ type: 'weapon', agents: this.ids(), slot });
  }

  private onKey(e: KeyboardEvent, down: boolean): void {
    if (e.code === 'Tab') e.preventDefault();
    if (down) this.keys.add(e.code);
    else this.keys.delete(e.code);
    if (!down || e.repeat) {
      if (!down && e.code === 'Space' && this.overdrive) this.setOverdrive(false);
      return;
    }
    if (e.code === 'Escape' || e.code === 'KeyP') {
      this.hooks.onPause();
      return;
    }
    if (!this.enabled) return;
    switch (e.code) {
      case 'Digit1':
      case 'Digit2':
      case 'Digit3':
      case 'Digit4':
        this.selectSlot(Number(e.code.slice(5)) - 1, e.shiftKey);
        break;
      case 'Tab':
      case 'Backquote':
        this.selectAll();
        break;
      case 'KeyG':
        this.split();
        break;
      case 'KeyT':
        this.switchTeam();
        break;
      case 'KeyZ':
        this.weapon(0);
        break;
      case 'KeyX':
        this.weapon(1);
        break;
      case 'KeyC':
        this.weapon(2);
        break;
      case 'KeyV':
        this.weapon(3);
        break;
      case 'KeyR':
        this.push({ type: 'cycleWeapon', agents: this.ids() });
        break;
      case 'KeyH':
        this.push({ type: 'holster', agents: this.ids() });
        break;
      case 'Space':
        e.preventDefault();
        this.setOverdrive(true);
        break;
      case 'KeyF':
        this.view.rig.resetView();
        break;
      case 'KeyY':
        this.view.rig.toggleTopDown();
        break;
      case 'KeyO':
        this.hooks.onToggleStats();
        break;
    }
  }

  private updateCursor(): void {
    this.cursor = this.hasMouse ? this.view.pick(this.mx, this.my) : null;
  }

  get aiming(): boolean {
    return this.rmb && !this.chord;
  }

  /** Per-frame: camera panning and cursor tracking. */
  frame(dt: number): void {
    this.updateCursor();
    let px = 0;
    let py = 0;
    if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) px -= 1;
    if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) px += 1;
    if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) py += 1;
    if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) py -= 1;
    if (px || py) this.view.rig.panBy(px * PAN_SPEED * dt, py * PAN_SPEED * dt);
    let orbit = 0;
    if (this.keys.has('KeyQ')) orbit += 1;
    if (this.keys.has('KeyE')) orbit -= 1;
    let tilt = 0;
    if (this.keys.has('PageUp')) tilt += 1;
    if (this.keys.has('PageDown')) tilt -= 1;
    if (orbit || tilt) this.view.rig.orbit(orbit * KEY_ORBIT_SPEED * dt, tilt * KEY_ORBIT_SPEED * 0.5 * dt);
  }

  /** Per-sim-tick: continuous orders, then drain the queue. */
  tick(): Command[] {
    for (const id of [...this.selected]) {
      const e = this.world.get(id);
      if (!e || !e.alive) this.selected.delete(id);
    }
    if (this.selected.size === 0) {
      const first = this.world.livingAgents()[0];
      if (first) for (const a of this.world.livingAgents().filter((x) => x.team === first.team)) this.selected.add(a.id);
    }

    if (this.enabled && this.cursor) {
      const now = performance.now() / 1000;
      if (this.lmb && !this.chord && now - this.lastSteer > STEER_INTERVAL) this.issueMove(false);
      const firing = this.aiming;
      if (firing) {
        this.push({ type: 'aim', agents: this.ids(), x: this.cursor.x, y: this.cursor.z, firing: true });
        const stray = this.world.agents().filter((a) => a.firing && !this.selected.has(a.id)).map((a) => a.id);
        if (stray.length) this.push({ type: 'aim', agents: stray, x: this.cursor.x, y: this.cursor.z, firing: false });
      } else if (this.wasFiring) {
        this.push({ type: 'aim', agents: this.world.agentIds, x: this.cursor.x, y: this.cursor.z, firing: false });
      }
      this.wasFiring = firing;
    } else if (this.wasFiring) {
      this.push({ type: 'aim', agents: this.world.agentIds, x: 0, y: 0, firing: false });
      this.wasFiring = false;
    }
    const out = this.queue;
    this.queue = [];
    return out;
  }

  release(): void {
    this.lmb = this.rmb = false;
    this.chord = false;
    if (this.overdrive) this.setOverdrive(false);
  }

  dispose(): void {
    this.abort.abort();
  }
}
