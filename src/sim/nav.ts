import { GROUND_ROAD, type CityMap } from './map.ts';
import type { Vec2 } from './types.ts';

class MinHeap {
  private idx: Int32Array;
  private key: Float32Array;
  size = 0;

  constructor(cap: number) {
    this.idx = new Int32Array(cap);
    this.key = new Float32Array(cap);
  }

  clear() {
    this.size = 0;
  }

  push(i: number, k: number) {
    if (this.size >= this.idx.length) {
      const ni = new Int32Array(this.idx.length * 2);
      ni.set(this.idx);
      const nk = new Float32Array(this.key.length * 2);
      nk.set(this.key);
      this.idx = ni;
      this.key = nk;
    }
    let n = this.size++;
    while (n > 0) {
      const p = (n - 1) >> 1;
      if (this.key[p] <= k) break;
      this.idx[n] = this.idx[p];
      this.key[n] = this.key[p];
      n = p;
    }
    this.idx[n] = i;
    this.key[n] = k;
  }

  pop(): number {
    const top = this.idx[0];
    const lastI = this.idx[--this.size];
    const lastK = this.key[this.size];
    let n = 0;
    for (;;) {
      let c = n * 2 + 1;
      if (c >= this.size) break;
      if (c + 1 < this.size && this.key[c + 1] < this.key[c]) c++;
      if (this.key[c] >= lastK) break;
      this.idx[n] = this.idx[c];
      this.key[n] = this.key[c];
      n = c;
    }
    this.idx[n] = lastI;
    this.key[n] = lastK;
    return top;
  }
}

const DIRS = [
  [1, 0, 1],
  [-1, 0, 1],
  [0, 1, 1],
  [0, -1, 1],
  [1, 1, Math.SQRT2],
  [1, -1, Math.SQRT2],
  [-1, 1, Math.SQRT2],
  [-1, -1, Math.SQRT2],
] as const;

export class Nav {
  readonly w: number;
  readonly h: number;
  readonly blocked: Uint8Array;
  private ground: Uint8Array;
  private crosswalk: Uint8Array;
  /** Extra traversal cost near walls so paths keep off building faces. */
  private penalty: Float32Array;
  private g: Float32Array;
  private from: Int32Array;
  private stamp: Uint32Array;
  private closed: Uint32Array;
  private gen = 1;
  private heap: MinHeap;
  readonly flowTargets: Vec2[] = [];
  private flows: Uint32Array[] = [];

  constructor(map: CityMap) {
    this.w = map.w;
    this.h = map.h;
    this.blocked = map.blocked;
    this.ground = map.ground;
    this.crosswalk = map.crosswalk;
    const n = this.w * this.h;
    this.penalty = new Float32Array(n);
    this.g = new Float32Array(n);
    this.from = new Int32Array(n);
    this.stamp = new Uint32Array(n);
    this.closed = new Uint32Array(n);
    this.heap = new MinHeap(4096);
    for (let y = 0; y < this.h; y++) {
      for (let x = 0; x < this.w; x++) {
        if (this.blocked[y * this.w + x]) continue;
        let near = 0;
        for (const [dx, dy] of DIRS) if (this.isBlocked(x + dx, y + dy)) near++;
        this.penalty[y * this.w + x] = near > 0 ? 0.6 : 0;
      }
    }
  }

  isBlocked(cx: number, cy: number): boolean {
    if (cx < 0 || cy < 0 || cx >= this.w || cy >= this.h) return true;
    return this.blocked[cy * this.w + cx] === 1;
  }

  isBlockedAt(x: number, y: number): boolean {
    return this.isBlocked(Math.floor(x), Math.floor(y));
  }

  /** Does a circle at (x,y) overlap any blocked cell? */
  circleBlocked(x: number, y: number, r: number): boolean {
    const x0 = Math.floor(x - r);
    const x1 = Math.floor(x + r);
    const y0 = Math.floor(y - r);
    const y1 = Math.floor(y + r);
    for (let cy = y0; cy <= y1; cy++) {
      for (let cx = x0; cx <= x1; cx++) {
        if (!this.isBlocked(cx, cy)) continue;
        const nx = Math.max(cx, Math.min(x, cx + 1));
        const ny = Math.max(cy, Math.min(y, cy + 1));
        if ((nx - x) * (nx - x) + (ny - y) * (ny - y) < r * r) return true;
      }
    }
    return false;
  }

  /** Moves a circle by (dx,dy), sliding along walls. Returns the resolved position. */
  slide(x: number, y: number, dx: number, dy: number, r: number): Vec2 {
    if (!this.circleBlocked(x + dx, y + dy, r)) return { x: x + dx, y: y + dy };
    const out = { x, y };
    if (!this.circleBlocked(x + dx, y, r)) out.x = x + dx;
    if (!this.circleBlocked(out.x, y + dy, r)) out.y = y + dy;
    return out;
  }

  nearestWalkable(x: number, y: number, maxR = 12): Vec2 {
    const cx = Math.floor(x);
    const cy = Math.floor(y);
    if (!this.isBlocked(cx, cy)) return { x, y };
    for (let r = 1; r <= maxR; r++) {
      let bestD = Infinity;
      let best: Vec2 | null = null;
      for (let oy = -r; oy <= r; oy++) {
        for (let ox = -r; ox <= r; ox++) {
          if (Math.max(Math.abs(ox), Math.abs(oy)) !== r) continue;
          if (this.isBlocked(cx + ox, cy + oy)) continue;
          const px = cx + ox + 0.5;
          const py = cy + oy + 0.5;
          const d = (px - x) ** 2 + (py - y) ** 2;
          if (d < bestD) {
            bestD = d;
            best = { x: px, y: py };
          }
        }
      }
      if (best) return best;
    }
    return { x, y };
  }

  /** Grid DDA ray. Returns the fraction [0,1] of the segment travelled before hitting a wall. */
  raycast(x0: number, y0: number, x1: number, y1: number): number {
    const dx = x1 - x0;
    const dy = y1 - y0;
    let cx = Math.floor(x0);
    let cy = Math.floor(y0);
    const ex = Math.floor(x1);
    const ey = Math.floor(y1);
    if (this.isBlocked(cx, cy)) return 0;
    const stepX = dx > 0 ? 1 : -1;
    const stepY = dy > 0 ? 1 : -1;
    const tdx = dx !== 0 ? Math.abs(1 / dx) : Infinity;
    const tdy = dy !== 0 ? Math.abs(1 / dy) : Infinity;
    let tmx = dx !== 0 ? (dx > 0 ? cx + 1 - x0 : x0 - cx) * tdx : Infinity;
    let tmy = dy !== 0 ? (dy > 0 ? cy + 1 - y0 : y0 - cy) * tdy : Infinity;
    let guard = 0;
    while ((cx !== ex || cy !== ey) && guard++ < 512) {
      let t: number;
      if (tmx < tmy) {
        t = tmx;
        tmx += tdx;
        cx += stepX;
      } else {
        t = tmy;
        tmy += tdy;
        cy += stepY;
      }
      if (t > 1) break;
      if (this.isBlocked(cx, cy)) return Math.max(0, t);
    }
    return 1;
  }

  los(x0: number, y0: number, x1: number, y1: number): boolean {
    return this.raycast(x0, y0, x1, y1) >= 1;
  }

  /** Line of sight for a body of radius r (checks two parallel rays). */
  clearPath(x0: number, y0: number, x1: number, y1: number, r: number): boolean {
    const dx = x1 - x0;
    const dy = y1 - y0;
    const len = Math.hypot(dx, dy) || 1;
    const nx = (-dy / len) * r;
    const ny = (dx / len) * r;
    return this.los(x0 + nx, y0 + ny, x1 + nx, y1 + ny) && this.los(x0 - nx, y0 - ny, x1 - nx, y1 - ny);
  }

  /**
   * A* over the walkability grid. `roadCost` > 0 makes non-crosswalk road cells expensive (and stops
   * path smoothing from cutting across them), so NPCs keep to sidewalks and cross at crosswalks.
   */
  findPath(sx: number, sy: number, tx: number, ty: number, radius = 0.35, maxExpand = 12000, roadCost = 0): Vec2[] | null {
    const start = this.nearestWalkable(sx, sy);
    const goal = this.nearestWalkable(tx, ty);
    const W = this.w;
    const s = Math.floor(start.y) * W + Math.floor(start.x);
    const t = Math.floor(goal.y) * W + Math.floor(goal.x);
    const gx = t % W;
    const gy = (t / W) | 0;
    if (s === t) return [{ x: goal.x, y: goal.y }];
    const gen = ++this.gen;
    const heap = this.heap;
    heap.clear();
    this.g[s] = 0;
    this.stamp[s] = gen;
    this.from[s] = -1;
    heap.push(s, 0);
    let expanded = 0;
    let found = false;
    while (heap.size > 0) {
      const cur = heap.pop();
      if (this.closed[cur] === gen) continue;
      this.closed[cur] = gen;
      if (cur === t) {
        found = true;
        break;
      }
      if (++expanded > maxExpand) break;
      const cx = cur % W;
      const cy = (cur / W) | 0;
      for (const [dx, dy, cost] of DIRS) {
        const nx = cx + dx;
        const ny = cy + dy;
        if (this.isBlocked(nx, ny)) continue;
        if (dx !== 0 && dy !== 0 && (this.isBlocked(cx + dx, cy) || this.isBlocked(cx, cy + dy))) continue;
        const ni = ny * W + nx;
        if (this.closed[ni] === gen) continue;
        const road = roadCost > 0 && this.ground[ni] === GROUND_ROAD ? (this.crosswalk[ni] ? roadCost * 0.1 : roadCost) : 0;
        const ng = this.g[cur] + cost + this.penalty[ni] + road;
        if (this.stamp[ni] === gen && ng >= this.g[ni]) continue;
        this.stamp[ni] = gen;
        this.g[ni] = ng;
        this.from[ni] = cur;
        const hx = Math.abs(nx - gx);
        const hy = Math.abs(ny - gy);
        const h = Math.max(hx, hy) + (Math.SQRT2 - 1) * Math.min(hx, hy);
        heap.push(ni, ng + h * 1.05);
      }
    }
    if (!found) return null;
    const cells: Vec2[] = [];
    for (let c = t; c !== -1; c = this.from[c]) cells.push({ x: (c % W) + 0.5, y: ((c / W) | 0) + 0.5 });
    cells.reverse();
    cells[cells.length - 1] = { x: goal.x, y: goal.y };
    return this.smooth(cells, radius, roadCost > 0);
  }

  /** String-pulls a cell path, keeping only the waypoints needed to stay clear of walls. */
  /** True if the straight line a->b stays off road cells that aren't crosswalks. */
  private offRoad(ax: number, ay: number, bx: number, by: number): boolean {
    const len = Math.hypot(bx - ax, by - ay);
    const n = Math.ceil(len / 0.5);
    for (let i = 0; i <= n; i++) {
      const t = n ? i / n : 0;
      const c = Math.floor(ay + (by - ay) * t) * this.w + Math.floor(ax + (bx - ax) * t);
      if (this.ground[c] === GROUND_ROAD && !this.crosswalk[c]) return false;
    }
    return true;
  }

  private smooth(cells: Vec2[], r: number, keepToSidewalks = false): Vec2[] {
    if (cells.length <= 2) return cells.slice(1);
    const out: Vec2[] = [];
    let anchor = cells[0];
    let i = 1;
    while (i < cells.length) {
      let j = i;
      while (
        j + 1 < cells.length &&
        this.clearPath(anchor.x, anchor.y, cells[j + 1].x, cells[j + 1].y, r + 0.05) &&
        (!keepToSidewalks || this.offRoad(anchor.x, anchor.y, cells[j + 1].x, cells[j + 1].y) || !this.offRoad(cells[j].x, cells[j].y, cells[j + 1].x, cells[j + 1].y))
      )
        j++;
      out.push(cells[j]);
      anchor = cells[j];
      i = j + 1;
    }
    return out;
  }

  /**
   * Precomputes a Dijkstra distance field toward `target`. Returns its index.
   * 'walk': calm pedestrians keep to sidewalks and cross only at crosswalks.
   * 'flee': panicked pedestrians still prefer sidewalks but will jaywalk.
   */
  addFlowTarget(target: Vec2, mode: 'any' | 'walk' | 'flee' = 'any'): number {
    const roadCost = mode === 'walk' ? 900 : mode === 'flee' ? 6 : 0;
    const crossCost = mode === 'walk' ? 8 : roadCost;
    const W = this.w;
    const n = W * this.h;
    const dist = new Uint32Array(n).fill(0xffffffff);
    const heap = new MinHeap(8192);
    const t = this.nearestWalkable(target.x, target.y);
    const ti = Math.floor(t.y) * W + Math.floor(t.x);
    dist[ti] = 0;
    heap.push(ti, 0);
    while (heap.size > 0) {
      const cur = heap.pop();
      const cx = cur % W;
      const cy = (cur / W) | 0;
      const d = dist[cur];
      for (const [dx, dy, cost] of DIRS) {
        const nx = cx + dx;
        const ny = cy + dy;
        if (this.isBlocked(nx, ny)) continue;
        if (dx !== 0 && dy !== 0 && (this.isBlocked(cx + dx, cy) || this.isBlocked(cx, cy + dy))) continue;
        const ni = ny * W + nx;
        const road = this.ground[ni] === GROUND_ROAD;
        const nd = d + Math.round(cost * 10 + this.penalty[ni] * 10) + (road ? (this.crosswalk[ni] ? crossCost : roadCost) : 0);
        if (nd < dist[ni]) {
          dist[ni] = nd;
          heap.push(ni, nd);
        }
      }
    }
    this.flowTargets.push({ ...t });
    this.flows.push(dist);
    return this.flows.length - 1;
  }

  flowDistance(field: number, x: number, y: number): number {
    const cx = Math.floor(x);
    const cy = Math.floor(y);
    if (cx < 0 || cy < 0 || cx >= this.w || cy >= this.h) return 0xffffffff;
    return this.flows[field][cy * this.w + cx];
  }

  /** Direction of steepest descent on a flow field at (x,y). */
  flowDir(field: number, x: number, y: number): Vec2 {
    const dist = this.flows[field];
    const W = this.w;
    const cx = Math.floor(x);
    const cy = Math.floor(y);
    let best = cx >= 0 && cy >= 0 && cx < W && cy < this.h ? dist[cy * W + cx] : 0xffffffff;
    let bx = 0;
    let by = 0;
    for (const [dx, dy] of DIRS) {
      const nx = cx + dx;
      const ny = cy + dy;
      if (this.isBlocked(nx, ny)) continue;
      if (dx !== 0 && dy !== 0 && (this.isBlocked(cx + dx, cy) || this.isBlocked(cx, cy + dy))) continue;
      const d = dist[ny * W + nx];
      if (d < best) {
        best = d;
        bx = nx + 0.5 - x;
        by = ny + 0.5 - y;
      }
    }
    const len = Math.hypot(bx, by);
    return len > 0 ? { x: bx / len, y: by / len } : { x: 0, y: 0 };
  }

  get flowCount(): number {
    return this.flows.length;
  }
}
