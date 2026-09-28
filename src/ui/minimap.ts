import { targetCanEscape } from '../sim/systems/objectives.ts';
import type { World } from '../sim/world.ts';

const SIZE = 210;

export class Minimap {
  readonly el: HTMLCanvasElement;
  private base: HTMLCanvasElement;
  private g: CanvasRenderingContext2D;
  private k: number;

  constructor(world: World) {
    this.el = document.createElement('canvas');
    this.el.width = this.el.height = SIZE * 2;
    this.el.className = 'minimap';
    this.g = this.el.getContext('2d')!;
    const { map } = world;
    this.k = (SIZE * 2) / Math.max(map.w, map.h);
    this.base = document.createElement('canvas');
    this.base.width = this.base.height = SIZE * 2;
    const b = this.base.getContext('2d')!;
    b.fillStyle = '#0b0c16';
    b.fillRect(0, 0, SIZE * 2, SIZE * 2);
    b.fillStyle = '#1b1d2e';
    for (let y = 0; y < map.h; y++) {
      for (let x = 0; x < map.w; x++) {
        const g = map.ground[y * map.w + x];
        if (g === 1 || g === 2 || g === 3) b.fillRect(x * this.k, y * this.k, this.k + 0.3, this.k + 0.3);
      }
    }
    for (const bl of map.buildings) {
      b.fillStyle = bl.height > 40 ? '#3a3f63' : '#2a2d48';
      b.fillRect(bl.x * this.k, bl.y * this.k, bl.w * this.k, bl.h * this.k);
    }
    b.strokeStyle = 'rgba(255, 79, 184, 0.5)';
    b.lineWidth = 2;
    const p = map.plaza;
    if (p.w > 0) b.strokeRect(p.x * this.k, p.y * this.k, p.w * this.k, p.h * this.k);
  }

  draw(world: World, yaw: number, cx: number, cz: number, time: number): void {
    const g = this.g;
    const S = SIZE * 2;
    const k = this.k;
    g.save();
    g.clearRect(0, 0, S, S);
    g.beginPath();
    g.arc(S / 2, S / 2, S / 2 - 2, 0, Math.PI * 2);
    g.clip();
    g.fillStyle = '#05050b';
    g.fillRect(0, 0, S, S);
    g.translate(S / 2, S / 2);
    const fwd = Math.atan2(-Math.cos(yaw), -Math.sin(yaw));
    g.rotate(-Math.PI / 2 - fwd);
    const zoom = 1.25;
    g.scale(zoom, zoom);
    g.translate(-cx * k, -cz * k);
    g.drawImage(this.base, 0, 0);

    const dot = (x: number, y: number, r: number, c: string) => {
      g.fillStyle = c;
      g.beginPath();
      g.arc(x * k, y * k, r, 0, Math.PI * 2);
      g.fill();
    };
    const pulse = 0.5 + 0.5 * Math.sin(time * 6);
    const ex = world.map.extraction;
    g.strokeStyle = world.phase === 'extract' ? `rgba(80,255,170,${0.5 + pulse * 0.5})` : 'rgba(80,255,170,0.35)';
    g.lineWidth = 3;
    g.beginPath();
    g.arc(ex.x * k, ex.y * k, 4.5 * k, 0, Math.PI * 2);
    g.stroke();
    if (world.alarm && targetCanEscape(world)) {
      const es = world.map.escape;
      g.strokeStyle = `rgba(255,60,80,${0.4 + pulse * 0.6})`;
      g.beginPath();
      g.arc(es.x * k, es.y * k, 3 * k, 0, Math.PI * 2);
      g.stroke();
    }

    for (const e of world.entities) {
      if (!e.alive) continue;
      if (e.kind === 'agent') continue;
      if (e.faction === 'player') dot(e.x, e.y, 3, '#c77dff');
      else if (e.kind === 'target') dot(e.x, e.y, 5 + pulse * 2, '#ffd34d');
      else if (e.faction === 'enemy') dot(e.x, e.y, 3.2, '#ff3b5c');
      else if (e.faction === 'police') dot(e.x, e.y, 3.2, e.kind === 'enforcer' ? '#7fb2ff' : '#3d7bff');
      else dot(e.x, e.y, 1.6, e.panic > 0 ? '#c9a0a0' : '#6a6f86');
    }
    for (const a of world.livingAgents()) dot(a.x, a.y, 4.5, a.team === 0 ? '#1ff4ff' : '#ffb627');
    g.restore();

    g.strokeStyle = 'rgba(31,244,255,0.5)';
    g.lineWidth = 2;
    g.beginPath();
    g.arc(S / 2, S / 2, S / 2 - 2, 0, Math.PI * 2);
    g.stroke();
    g.fillStyle = 'rgba(31,244,255,0.8)';
    g.beginPath();
    g.moveTo(S / 2, S / 2 - 12);
    g.lineTo(S / 2 - 7, S / 2 + 8);
    g.lineTo(S / 2 + 7, S / 2 + 8);
    g.closePath();
    g.globalAlpha = 0.35;
    g.fill();
    g.globalAlpha = 1;
  }
}
