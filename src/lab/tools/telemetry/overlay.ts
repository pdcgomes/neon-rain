import * as THREE from 'three';
import type { GameRenderer } from '../../../render/renderer.ts';
import { sightRange } from '../../../sim/systems/ai.ts';
import type { Recording } from '../../../sim/telemetry.ts';
import type { Timeline } from '../../../sim/telemetryAnalysis.ts';
import type { World } from '../../../sim/world.ts';

export type Layer = 'trails' | 'enemies' | 'hits' | 'deaths' | 'vision' | 'aim' | 'labels';

export const LAYERS: { id: Layer; key: string; label: string; title: string }[] = [
  { id: 'trails', key: 'KeyT', label: 'Trails', title: 'Where each agent has been (T)' },
  { id: 'enemies', key: 'KeyR', label: 'Hunters', title: 'Paths of enemies while they hunted the squad (R)' },
  { id: 'hits', key: 'KeyH', label: 'Hits', title: 'Where agents were hit, with a line to the shooter (H)' },
  { id: 'deaths', key: 'KeyK', label: 'Deaths', title: 'Agent deaths, with a line to the killer (K)' },
  { id: 'vision', key: 'KeyV', label: 'Vision', title: 'How far each nearby enemy sees: amber calm, red alerted, blue police (V)' },
  { id: 'aim', key: 'KeyL', label: 'Aim', title: 'Aim lines: solid on the player\'s order, dashed on the agent\'s own (L)' },
  { id: 'labels', key: 'KeyN', label: 'Labels', title: 'Names, health and IPA (N)' },
];

/** Replay-wide data from the analysis pass, for the layers the live world can't show. */
export interface OverlayData {
  hits: Timeline['hits'];
  enemyTrails: Timeline['enemyTrails'];
}

const AGENT_COLORS = ['#5ad7ff', '#ffd24d', '#7dff9a', '#ff8ad8'];
/** Enemies further than this from the camera focus aren't drawn in the vision layer. */
const VISION_RADIUS = 70;

/** Data drawn over the replayed scene: projected from sim coordinates with the scene's camera. */
export class Overlay {
  readonly canvas = document.createElement('canvas');
  readonly on = new Set<Layer>(['trails', 'deaths', 'aim']);
  private ctx: CanvasRenderingContext2D;
  private v = new THREE.Vector3();

  constructor(parent: HTMLElement) {
    this.canvas.className = 'replay-overlay';
    parent.appendChild(this.canvas);
    this.ctx = this.canvas.getContext('2d')!;
  }

  dispose(): void {
    this.canvas.remove();
  }

  /** Sim (x, y) at height h to CSS pixels, or null behind the camera. */
  private project(view: GameRenderer, x: number, y: number, h = 0): [number, number] | null {
    this.v.set(x, h, y).project(view.rig.camera);
    if (this.v.z > 1) return null;
    return [((this.v.x + 1) / 2) * this.canvas.clientWidth, ((1 - this.v.y) / 2) * this.canvas.clientHeight];
  }

  draw(view: GameRenderer, world: World, rec: Recording, data?: OverlayData): void {
    const c = this.canvas;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    if (c.width !== Math.round(c.clientWidth * dpr) || c.height !== Math.round(c.clientHeight * dpr)) {
      c.width = Math.round(c.clientWidth * dpr);
      c.height = Math.round(c.clientHeight * dpr);
    }
    const g = this.ctx;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, c.clientWidth, c.clientHeight);
    g.lineWidth = 1.5;
    g.font = '11px "Share Tech Mono", monospace';
    const now = world.tick;
    const slot = new Map(world.agents().map((a) => [a.id, a.slot]));

    if (this.on.has('vision')) {
      const t = view.rig.target;
      for (const e of world.entities) {
        if (!e.alive || !e.weapons.length || (e.faction !== 'enemy' && e.faction !== 'police')) continue;
        if (Math.hypot(e.x - t.x, e.y - t.z) > VISION_RADIUS) continue;
        const w = world.weapon(e);
        if (!w) continue;
        const alert = e.ai === 'combat';
        const r = sightRange(w, alert);
        g.strokeStyle = alert ? 'rgba(255,70,90,0.55)' : e.faction === 'police' ? 'rgba(120,170,255,0.35)' : 'rgba(255,190,80,0.35)';
        this.ring(view, e.x, e.y, r);
      }
    }

    if (this.on.has('trails')) {
      for (const a of world.agents()) {
        const pts = rec.samples.filter((s) => s.tick <= now).flatMap((s) => s.agents.filter((x) => x.id === a.id && x.hp > 0));
        g.strokeStyle = AGENT_COLORS[a.slot] ?? '#fff';
        g.globalAlpha = 0.7;
        g.beginPath();
        let started = false;
        for (const p of [...pts, a.alive ? { x: a.x, y: a.y } : null]) {
          if (!p) continue;
          const s = this.project(view, p.x, p.y, 0.05);
          if (!s) continue;
          if (started) g.lineTo(s[0], s[1]);
          else g.moveTo(s[0], s[1]);
          started = true;
        }
        g.stroke();
        g.globalAlpha = 1;
      }
    }

    if (this.on.has('enemies') && data) {
      g.strokeStyle = 'rgba(255,90,90,0.55)';
      for (const trail of data.enemyTrails.values()) {
        g.beginPath();
        let started = false;
        for (const p of trail) {
          if (p.tick > now) break;
          const s = this.project(view, p.x, p.y, 0.05);
          if (!s) continue;
          if (started) g.lineTo(s[0], s[1]);
          else g.moveTo(s[0], s[1]);
          started = true;
        }
        g.stroke();
      }
    }

    if (this.on.has('hits') && data) {
      for (const h of data.hits) {
        if (h.tick > now) continue;
        const s = this.project(view, h.x, h.y, 0.1);
        if (!s) continue;
        const fresh = now - h.tick < 60;
        const from = this.project(view, h.fromX, h.fromY, 1);
        if (from && fresh) {
          g.strokeStyle = 'rgba(255,150,60,0.7)';
          g.beginPath();
          g.moveTo(from[0], from[1]);
          g.lineTo(s[0], s[1]);
          g.stroke();
        }
        g.fillStyle = fresh ? 'rgba(255,120,40,0.95)' : 'rgba(255,120,40,0.45)';
        g.beginPath();
        g.arc(s[0], s[1], Math.min(9, 2 + h.amount / 12), 0, Math.PI * 2);
        g.fill();
      }
    }

    if (this.on.has('aim')) {
      for (const e of world.entities) {
        if (!e.alive || !(e.firing || e.autoFire)) continue;
        const a = this.project(view, e.x, e.y, 1.2);
        const b = this.project(view, e.aimX, e.aimY, 1.0);
        if (!a || !b) continue;
        g.strokeStyle = e.faction === 'player' ? (e.firing ? 'rgba(90,215,255,0.9)' : 'rgba(90,215,255,0.45)') : 'rgba(255,80,80,0.8)';
        g.setLineDash(e.faction === 'player' && !e.firing ? [4, 4] : []);
        g.beginPath();
        g.moveTo(a[0], a[1]);
        g.lineTo(b[0], b[1]);
        g.stroke();
        g.setLineDash([]);
      }
    }

    if (this.on.has('deaths')) {
      for (const d of rec.deaths) {
        if (d.tick > now || d.kind !== 'agent') continue;
        const s = this.project(view, d.x, d.y, 0.1);
        if (!s) continue;
        g.strokeStyle = AGENT_COLORS[slot.get(d.id) ?? 0];
        g.lineWidth = 2.5;
        g.beginPath();
        g.moveTo(s[0] - 7, s[1] - 7);
        g.lineTo(s[0] + 7, s[1] + 7);
        g.moveTo(s[0] + 7, s[1] - 7);
        g.lineTo(s[0] - 7, s[1] + 7);
        g.stroke();
        g.lineWidth = 1.5;
        if (d.by) {
          const k = this.project(view, d.by.x, d.by.y, 1);
          if (k) {
            g.strokeStyle = 'rgba(255,80,80,0.8)';
            g.setLineDash([2, 3]);
            g.beginPath();
            g.moveTo(s[0], s[1]);
            g.lineTo(k[0], k[1]);
            g.stroke();
            g.setLineDash([]);
          }
        }
        const dist = d.by ? ` ${Math.round(Math.hypot(d.by.x - d.x, d.by.y - d.y))}m` : '';
        this.label(s[0] + 9, s[1] - 9, `${d.name} ✝ ${d.by ? `${d.by.name || d.by.kind} · ${d.by.weapon}${dist}` : ''}`, '#ff8a8a');
      }
    }

    if (this.on.has('labels')) {
      for (const e of world.entities) {
        if (!e.alive || e.kind === 'civilian') continue;
        const s = this.project(view, e.x, e.y, 2.3);
        if (!s) continue;
        if (e.kind === 'agent') {
          const ipa = `A${e.ipa.a.toFixed(1)} P${e.ipa.p.toFixed(1)} I${e.ipa.i.toFixed(1)}`;
          this.label(s[0], s[1], `${e.name} ${Math.round(e.hp)} · ${ipa}`, AGENT_COLORS[e.slot] ?? '#fff', true);
        } else if (e.faction === 'enemy' || e.faction === 'police' || e.faction === 'player') {
          const hostile = e.faction !== 'player';
          const t = `${e.name || e.kind} ${Math.round(e.hp)}${e.ai === 'combat' ? ' !' : ''}`;
          this.label(s[0], s[1], t, hostile ? (e.ai === 'combat' ? '#ff6a6a' : '#e0b070') : '#9ad0ff', true);
        }
      }
    }
  }

  private ring(view: GameRenderer, x: number, y: number, r: number): void {
    const g = this.ctx;
    g.beginPath();
    let started = false;
    for (let k = 0; k <= 32; k++) {
      const a = (k / 32) * Math.PI * 2;
      const s = this.project(view, x + Math.cos(a) * r, y + Math.sin(a) * r, 0.05);
      if (!s) continue;
      if (started) g.lineTo(s[0], s[1]);
      else g.moveTo(s[0], s[1]);
      started = true;
    }
    g.stroke();
  }

  private label(x: number, y: number, text: string, color: string, center = false): void {
    const g = this.ctx;
    const w = g.measureText(text).width;
    const lx = center ? x - w / 2 : x;
    g.fillStyle = 'rgba(0,0,0,0.6)';
    g.fillRect(lx - 3, y - 11, w + 6, 14);
    g.fillStyle = color;
    g.fillText(text, lx, y);
  }
}
