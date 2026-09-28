import { GROUND_ROAD } from './map.ts';
import { DT } from './time.ts';
import type { Vec2 } from './types.ts';
import type { World } from './world.ts';

/**
 * Road traffic. Cars drive on the right-hand lane of the road grid, pick a direction at each
 * intersection, queue behind each other, brake for pedestrians when they can, and hit anyone
 * they can't stop for.
 */

export interface Vehicle {
  id: number;
  x: number;
  y: number;
  px: number;
  py: number;
  heading: number;
  pheading: number;
  speed: number;
  cruise: number;
  seed: number;
  /** Remaining route, consumed from the front. */
  route: Vec2[];
  /** Waypoints left when the car clears the intersection it has claimed. */
  releaseAt: number;
  /** Intersection claimed while crossing it (-1 if none). */
  claim: number;
  /** Intersection the car is queued at, waiting to cross (-1 if none). */
  waitingAt: number;
  exitsMap: boolean;
  /** Direction chosen for the next intersection, decided before asking to enter it. */
  nextHx: number;
  nextHy: number;
  planned: boolean;
  braking: boolean;
  wrecked: boolean;
  wreckedAt: number;
  stuckFor: number;
  hornAt: number;
  /** Seconds spent held up by pedestrians; after a while the car creeps through. */
  pedWait: number;
  /** How long a pedestrian has been in view ahead; drivers only brake after reacting. */
  pedSeen: number;
  /** Direction of travel on the current road and the node it is heading to. */
  hx: number;
  hy: number;
  ni: number;
  nj: number;
}

const LANE = 1.05;
const CAR_LEN = 3.9;
const CAR_WID = 1.85;
const ACCEL = 5;
const BRAKE = 11;
const TURN_SPEED = 5.2;
const APPROACH_SPEED = 6.5;
/** Traffic signal cycle (seconds): x-axis green, all-red clearance, y-axis green, all-red. */
export const SIGNAL_CYCLE = 28;
const SIGNAL_GREEN = 12;
const SIGNAL_CLEAR = 2;
/** Pedestrians only start crossing if the red they are relying on lasts this long per metre of road. */
const WALK_TIME_PER_M = 7 / 8;

/** How far ahead (seconds) drivers anticipate where people crossing will be. */
const ANTICIPATE = [0, 0.7, 1.4];
const REACTION = 0.45;

/** Distance along `path` to the first point within `r` of (x,y), or Infinity if the path misses it. */
function alongPath(path: Vec2[], x: number, y: number, r: number): number {
  let acc = 0;
  for (let i = 0; i + 1 < path.length; i++) {
    const a = path[i];
    const b = path[i + 1];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy);
    if (len < 1e-6) continue;
    const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (y - a.y) * dy) / (len * len)));
    const cx = a.x + dx * t;
    const cy = a.y + dy * t;
    if (Math.hypot(x - cx, y - cy) < r) return acc + len * t;
    acc += len;
  }
  return Infinity;
}

export class Traffic {
  vehicles: Vehicle[] = [];
  private xs: number[];
  private ys: number[];
  /** Cars currently crossing each intersection, and how they cross it. */
  private occupancy: { id: number; axis: number; straight: boolean }[][];
  private seq = 1;
  private target: number;
  private w: number;
  private h: number;
  /** Where a car's centre stops so its nose stays behind the crosswalk (road half-width + crosswalk + margin + half length). */
  private stopLine: number;
  private halfRoad: number;
  private walkTime: number;

  constructor(world: World, count: number) {
    const { map } = world;
    const road = map.roadsX.length ? map.roadsX[0].end - map.roadsX[0].start : 8;
    this.halfRoad = road / 2;
    this.stopLine = this.halfRoad + 2 + 0.4 + CAR_LEN / 2;
    this.walkTime = road * WALK_TIME_PER_M;
    this.xs = map.roadsX.map((r) => (r.start + r.end) / 2);
    this.ys = map.roadsY.map((r) => (r.start + r.end) / 2);
    this.occupancy = Array.from({ length: this.xs.length * this.ys.length }, () => []);
    this.target = count;
    this.w = map.w;
    this.h = map.h;
    for (let i = 0; i < count * 4 && this.vehicles.length < count; i++) this.spawnOnRoad(world);
  }

  private node(i: number, j: number): Vec2 {
    return { x: this.xs[i], y: this.ys[j] };
  }

  private inRange(i: number, j: number): boolean {
    return i >= 0 && j >= 0 && i < this.xs.length && j < this.ys.length;
  }

  /** Point on the right-hand lane for heading (hx,hy) passing through (x,y). */
  private lane(x: number, y: number, hx: number, hy: number, along: number): Vec2 {
    return { x: x + hx * along - hy * LANE, y: y + hy * along + hx * LANE };
  }

  private makeVehicle(world: World, at: Vec2, hx: number, hy: number, ni: number, nj: number): Vehicle {
    const cruise = world.rng.range(8.5, 12);
    return {
      id: this.seq++,
      x: at.x,
      y: at.y,
      px: at.x,
      py: at.y,
      heading: Math.atan2(hy, hx),
      pheading: Math.atan2(hy, hx),
      speed: cruise * 0.6,
      cruise,
      seed: world.rng.int(1, 1 << 30),
      route: [],
      releaseAt: -1,
      claim: -1,
      waitingAt: -1,
      exitsMap: false,
      nextHx: hx,
      nextHy: hy,
      planned: false,
      braking: false,
      wrecked: false,
      wreckedAt: 0,
      stuckFor: 0,
      hornAt: -99,
      pedWait: 0,
      pedSeen: 0,
      hx,
      hy,
      ni,
      nj,
    };
  }

  /** Appends the straight run from the current position to the approach of the next node (or the map edge). */
  private routeToNext(v: Vehicle, fromX: number, fromY: number): void {
    if (this.inRange(v.ni, v.nj)) {
      const n = this.node(v.ni, v.nj);
      v.route.push(this.lane(n.x, n.y, v.hx, v.hy, -this.stopLine));
      v.exitsMap = false;
    } else {
      v.route.push({
        x: v.hx > 0 ? this.w + 2 : v.hx < 0 ? -2 : fromX,
        y: v.hy > 0 ? this.h + 2 : v.hy < 0 ? -2 : fromY,
      });
      v.exitsMap = true;
    }
  }

  private spawnOnRoad(world: World): void {
    const rng = world.rng;
    const vertical = rng.chance(0.5);
    const i = rng.int(0, this.xs.length - 1);
    const j = rng.int(0, this.ys.length - 1);
    const dir = rng.sign();
    const hx = vertical ? 0 : dir;
    const hy = vertical ? dir : 0;
    const n = this.node(i, j);
    const back = rng.range(this.stopLine + 1, this.halfRoad + 10);
    const at = this.lane(n.x, n.y, hx, hy, -back);
    if (at.x < 3 || at.y < 3 || at.x > this.w - 3 || at.y > this.h - 3) return;
    if (this.vehicles.some((o) => Math.hypot(o.x - at.x, o.y - at.y) < 7)) return;
    const v = this.makeVehicle(world, at, hx, hy, i, j);
    this.routeToNext(v, at.x, at.y);
    this.vehicles.push(v);
  }

  private spawnAtEdge(world: World): void {
    const rng = world.rng;
    const vertical = rng.chance(0.5);
    const fromStart = rng.chance(0.5);
    let at: Vec2;
    let hx = 0;
    let hy = 0;
    let ni: number;
    let nj: number;
    if (vertical) {
      ni = rng.int(0, this.xs.length - 1);
      hy = fromStart ? 1 : -1;
      nj = fromStart ? 0 : this.ys.length - 1;
      at = this.lane(this.xs[ni], fromStart ? -1 : this.h + 1, hx, hy, 0);
    } else {
      nj = rng.int(0, this.ys.length - 1);
      hx = fromStart ? 1 : -1;
      ni = fromStart ? 0 : this.xs.length - 1;
      at = this.lane(fromStart ? -1 : this.w + 1, this.ys[nj], hx, hy, 0);
    }
    if (this.vehicles.some((o) => Math.hypot(o.x - at.x, o.y - at.y) < 9)) return;
    const v = this.makeVehicle(world, at, hx, hy, ni, nj);
    this.routeToNext(v, at.x, at.y);
    this.vehicles.push(v);
  }

  /** Choose straight / left / right for the upcoming intersection. */
  private chooseTurn(world: World, v: Vehicle): void {
    const options: [number, number, number][] = [
      [v.hx, v.hy, 0.56],
      [v.hy, -v.hx, 0.22],
      [-v.hy, v.hx, 0.22],
    ];
    let r = world.rng.next();
    let pick = options[0];
    for (const o of options) {
      if (r < o[2]) {
        pick = o;
        break;
      }
      r -= o[2];
    }
    v.nextHx = pick[0];
    v.nextHy = pick[1];
    v.planned = true;
  }

  /** Lay down the route through the intersection: a smooth curve for turns, a straight line otherwise. */
  private planTurn(v: Vehicle): void {
    const n = this.node(v.ni, v.nj);
    const hx = v.nextHx;
    const hy = v.nextHy;
    v.planned = false;
    const exit = this.lane(n.x, n.y, hx, hy, this.stopLine);
    if (hx !== v.hx || hy !== v.hy) {
      const a = { x: v.x, y: v.y };
      const c = { x: n.x - v.hy * LANE - hy * LANE, y: n.y + v.hx * LANE + hx * LANE };
      for (let k = 1; k <= 6; k++) {
        const t = k / 6;
        const u = 1 - t;
        v.route.push({
          x: u * u * a.x + 2 * u * t * c.x + t * t * exit.x,
          y: u * u * a.y + 2 * u * t * c.y + t * t * exit.y,
        });
      }
    } else {
      v.route.push(exit);
    }
    v.hx = hx;
    v.hy = hy;
    v.ni += hx;
    v.nj += hy;
    this.routeToNext(v, exit.x, exit.y);
    v.releaseAt = 1;
  }

  private release(v: Vehicle): void {
    if (v.claim >= 0) this.occupancy[v.claim] = this.occupancy[v.claim].filter((o) => o.id !== v.id);
    v.claim = -1;
  }

  /** Don't block the box: only enter if there is room in the exit lane beyond the intersection. */
  private exitClear(v: Vehicle): boolean {
    const n = this.node(v.ni, v.nj);
    const hx = v.nextHx;
    const hy = v.nextHy;
    const start = this.lane(n.x, n.y, hx, hy, 0);
    for (const o of this.vehicles) {
      if (o === v) continue;
      const rx = o.x - start.x;
      const ry = o.y - start.y;
      const along = rx * hx + ry * hy;
      const lat = Math.abs(-rx * hy + ry * hx);
      if (lat < 1.2 && along > this.stopLine - CAR_LEN && along < this.stopLine + CAR_LEN + 1.5) return false;
    }
    return true;
  }

  private signalPhase(node: number, time: number): number {
    return (time + ((node * 7.7) % SIGNAL_CYCLE)) % SIGNAL_CYCLE;
  }

  /** Is traffic moving along `axis` (0 = x, 1 = y) allowed into intersection `node`? */
  isGreen(node: number, axis: number, time: number): boolean {
    const p = this.signalPhase(node, time);
    const start = axis === 0 ? 0 : SIGNAL_GREEN + SIGNAL_CLEAR;
    return p >= start && p < start + SIGNAL_GREEN;
  }

  /** Signal aspect for rendering: 0 red, 1 amber (green about to end), 2 green. */
  signalAspect(node: number, axis: number, time: number): number {
    const p = this.signalPhase(node, time);
    const start = axis === 0 ? 0 : SIGNAL_GREEN + SIGNAL_CLEAR;
    if (p < start || p >= start + SIGNAL_GREEN) return 0;
    return p >= start + SIGNAL_GREEN - 2.5 ? 1 : 2;
  }

  /** Seconds until traffic along `axis` gets green again (0 if green now). */
  redRemaining(node: number, axis: number, time: number): number {
    const p = this.signalPhase(node, time);
    const start = axis === 0 ? 0 : SIGNAL_GREEN + SIGNAL_CLEAR;
    if (p >= start && p < start + SIGNAL_GREEN) return 0;
    return (start - p + SIGNAL_CYCLE) % SIGNAL_CYCLE;
  }

  /** Walk signal for a crosswalk: the road being crossed must be red for long enough to get across. */
  canCross(node: number, trafficAxis: number, time: number): boolean {
    return this.redRemaining(node, trafficAxis, time) >= this.walkTime;
  }

  get nodeCount(): number {
    return this.xs.length * this.ys.length;
  }

  nodePosition(node: number): Vec2 {
    return this.node(Math.floor(node / this.ys.length), node % this.ys.length);
  }

  /** Straight-through traffic on the same axis can share an intersection; anything else waits. */
  private canEnter(key: number, axis: number, straight: boolean): boolean {
    const occ = this.occupancy[key];
    if (occ.length === 0) return true;
    return straight && occ.every((o) => o.straight && o.axis === axis);
  }

  wreck(v: Vehicle, time: number): void {
    if (v.wrecked) return;
    v.wrecked = true;
    v.wreckedAt = time;
    v.speed = 0;
    this.release(v);
  }

  update(world: World): void {
    const keep: Vehicle[] = [];
    for (const v of this.vehicles) {
      v.px = v.x;
      v.py = v.y;
      v.pheading = v.heading;
      if (v.wrecked) {
        this.collide(world, v);
        if (world.time - v.wreckedAt < 45) keep.push(v);
        continue;
      }
      if (this.drive(world, v)) keep.push(v);
      else this.release(v);
    }
    this.vehicles = keep;

    if (world.tick % 45 === 0 && this.vehicles.filter((v) => !v.wrecked).length < this.target) this.spawnAtEdge(world);
  }

  /** Returns false when the car has left the map or been cleared away. */
  private drive(world: World, v: Vehicle): boolean {
    // Queue at the intersection until it is clear, then claim it and plan the turn.
    if (v.route.length === 0) {
      if (v.exitsMap) return false;
      if (!v.planned) this.chooseTurn(world, v);
      const key = v.ni * this.ys.length + v.nj;
      const straight = v.nextHx === v.hx && v.nextHy === v.hy;
      const axis = v.hx !== 0 ? 0 : 1;
      if (!this.isGreen(key, axis, world.time) || !this.canEnter(key, axis, straight) || !this.exitClear(v)) {
        v.waitingAt = key;
      } else {
        this.occupancy[key].push({ id: v.id, axis, straight });
        v.claim = key;
        v.waitingAt = -1;
        this.planTurn(v);
      }
    }

    const dirX = Math.cos(v.heading);
    const dirY = Math.sin(v.heading);
    let limit = v.route.length > 2 && v.releaseAt > 0 ? TURN_SPEED : v.cruise;
    if (v.route.length === 0) limit = 0;
    if (v.route.length === 1 && !v.exitsMap) {
      const wp = v.route[0];
      if (Math.hypot(wp.x - v.x, wp.y - v.y) < 9) limit = Math.min(limit, APPROACH_SPEED);
    }
    const stopDist = (v.speed * v.speed) / (2 * BRAKE);
    const look = stopDist + CAR_LEN + 5;

    // Cars ahead in the same lane. Cross traffic is handled by intersection occupancy, so only
    // follow cars heading roughly our way (and wrecks, which block everyone).
    for (const o of this.vehicles) {
      if (o === v) continue;
      if (!o.wrecked && Math.cos(o.heading - v.heading) < 0.4) continue;
      const rx = o.x - v.x;
      const ry = o.y - v.y;
      const fwd = rx * dirX + ry * dirY;
      if (fwd <= 0 || fwd > look + CAR_LEN) continue;
      const lat = Math.abs(-rx * dirY + ry * dirX);
      if (lat > CAR_WID) continue;
      limit = Math.min(limit, Math.max(0, (fwd - CAR_LEN - 1.6) * 1.4));
    }

    // Pedestrians on the road ahead, measured along the actual route (so turns see the crosswalk
    // they are turning into). Drivers yield to anyone they can see coming, but a fast runner who
    // darts out only gets a reaction once the driver notices, and braking still takes distance.
    v.braking = false;
    const path = this.probe(v, look);
    let pedLimit = Infinity;
    let surprise = false;
    world.query(v.x, v.y, look + 3, (e) => {
      let best = Infinity;
      const { map } = world;
      // Nobody can anticipate a sprinter: those are only seen once they are actually in the road.
      const fast = e.vx * e.vx + e.vy * e.vy > 12;
      for (const k of fast ? [0] : ANTICIPATE) {
        const px = e.x + e.vx * k;
        const py = e.y + e.vy * k;
        // People on the sidewalk (e.g. waiting at the kerb) are not in a car's way.
        const cx = Math.floor(px);
        const cy = Math.floor(py);
        if (cx >= 0 && cy >= 0 && cx < map.w && cy < map.h && map.ground[cy * map.w + cx] !== GROUND_ROAD) continue;
        const along = alongPath(path, px, py, CAR_WID * 0.5 + e.radius + (k > 0 ? 0.7 : 0.45));
        if (along < best) best = along;
      }
      if (best === Infinity) return;
      if (fast) surprise = true;
      pedLimit = Math.min(pedLimit, Math.max(0, (best - CAR_LEN * 0.5 - 1.4) * 1.3));
      if (e.kind === 'agent' && v.speed > 5 && world.time - v.hornAt > 2.5) {
        v.hornAt = world.time;
        world.emit({ t: 'horn', x: v.x, y: v.y });
      }
    });

    v.pedSeen = pedLimit < Infinity ? v.pedSeen + DT : 0;
    if (surprise && v.pedSeen < REACTION) pedLimit = Infinity;
    if (pedLimit < limit) {
      v.pedWait += DT;
      // Only nudge forward if someone has been loitering in the lane for a long time.
      limit = v.pedWait > 8 ? Math.min(limit, Math.max(pedLimit, 1.2)) : pedLimit;
    } else v.pedWait = 0;

    if (v.speed > limit) {
      v.speed = Math.max(limit, v.speed - BRAKE * DT);
      v.braking = true;
    } else v.speed = Math.min(limit, v.speed + ACCEL * DT);

    // Follow the route.
    let travel = v.speed * DT;
    while (travel > 0 && v.route.length) {
      const wp = v.route[0];
      const dx = wp.x - v.x;
      const dy = wp.y - v.y;
      const d = Math.hypot(dx, dy);
      if (d < 1e-3) {
        v.route.shift();
        continue;
      }
      const step = Math.min(travel, d);
      v.x += (dx / d) * step;
      v.y += (dy / d) * step;
      travel -= step;
      let target = Math.atan2(dy, dx);
      let diff = target - v.heading;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      target = v.heading + diff;
      v.heading += (target - v.heading) * Math.min(1, DT * 10);
      if (step >= d - 1e-6) v.route.shift();
    }
    if (v.claim >= 0 && v.route.length <= v.releaseAt) this.release(v);

    v.stuckFor = v.speed < 0.3 && v.waitingAt < 0 ? v.stuckFor + DT : 0;
    if (v.stuckFor > 25) return false;

    this.collide(world, v);
    return true;
  }

  /** Cars are solid: push people out, and hurt them if the car is moving. */
  private collide(world: World, v: Vehicle): void {
    const dirX = Math.cos(v.heading);
    const dirY = Math.sin(v.heading);
    world.query(v.x, v.y, CAR_LEN * 0.5 + 1, (e) => {
      const rx = e.x - v.x;
      const ry = e.y - v.y;
      const f = rx * dirX + ry * dirY;
      const l = -rx * dirY + ry * dirX;
      const hf = CAR_LEN * 0.5 + e.radius;
      const hl = CAR_WID * 0.5 + e.radius;
      if (Math.abs(f) >= hf || Math.abs(l) >= hl) return;
      // Only the front of a moving car hits; brushing its side just pushes you away.
      if (v.speed > 4 && f > CAR_LEN * 0.15 && world.time - e.carHitAt > 1) {
        e.carHitAt = world.time;
        const side = l >= 0 ? 1 : -1;
        e.vx += dirX * v.speed * 0.9 - dirY * side * 5;
        e.vy += dirY * v.speed * 0.9 + dirX * side * 5;
        const calm = e.faction === 'civ' ? e.panic <= 0 : e.kind === 'police' && e.ai === 'patrol';
        world.emit({ t: 'carHit', x: e.x, y: e.y, speed: v.speed, victim: e.id, calm });
        world.damage(e, v.speed * v.speed * 0.55, -1);
        v.speed *= 0.55;
      }
      const pl = hl - Math.abs(l);
      const pf = hf - Math.abs(f);
      let px: number;
      let py: number;
      if (pl < pf) {
        const s = l >= 0 ? pl : -pl;
        px = -dirY * s;
        py = dirX * s;
      } else {
        const s = f >= 0 ? pf : -pf;
        px = dirX * s;
        py = dirY * s;
      }
      const out = world.nav.slide(e.x, e.y, px, py, e.radius);
      e.x = out.x;
      e.y = out.y;
    });
  }

  /** The next `dist` metres of the car's route as a polyline starting at the car. */
  private probe(v: Vehicle, dist: number): Vec2[] {
    const pts: Vec2[] = [{ x: v.x, y: v.y }];
    let left = dist;
    let px = v.x;
    let py = v.y;
    for (const wp of v.route) {
      const d = Math.hypot(wp.x - px, wp.y - py);
      if (d >= left) {
        pts.push({ x: px + ((wp.x - px) / d) * left, y: py + ((wp.y - py) / d) * left });
        return pts;
      }
      pts.push(wp);
      left -= d;
      px = wp.x;
      py = wp.y;
    }
    if (pts.length === 1) pts.push({ x: v.x + Math.cos(v.heading) * dist, y: v.y + Math.sin(v.heading) * dist });
    return pts;
  }

  /** Is a moving car about to pass within `r` of (x,y) in the next `horizon` seconds? */
  dangerAt(x: number, y: number, r = 2.4, horizon = 3.4): boolean {
    for (const v of this.vehicles) {
      if (v.wrecked) continue;
      // A car that has been waiting for people to cross gets its turn: don't step out in front of it.
      const waiting = v.speed < 1.5 && v.pedWait > 1;
      if (v.speed < 1.5 && !waiting) continue;
      const dirX = Math.cos(v.heading);
      const dirY = Math.sin(v.heading);
      const rx = x - v.x;
      const ry = y - v.y;
      const f = rx * dirX + ry * dirY;
      const reach = waiting ? CAR_LEN + 6 : v.speed * horizon + CAR_LEN;
      if (f < -CAR_LEN * 0.5 || f > reach) continue;
      if (Math.abs(-rx * dirY + ry * dirX) < r) return true;
    }
    return false;
  }

  wreckNear(x: number, y: number, r: number, time: number): void {
    for (const v of this.vehicles) if (Math.hypot(v.x - x, v.y - y) < r + 1.5) this.wreck(v, time);
  }

  checksum(h: number): number {
    for (const v of this.vehicles) {
      h = (Math.imul(h, 31) + Math.round(v.x * 100)) | 0;
      h = (Math.imul(h, 31) + Math.round(v.y * 100)) | 0;
    }
    return h;
  }
}
