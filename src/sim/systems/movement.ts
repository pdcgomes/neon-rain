import { DT } from '../time.ts';
import type { Entity } from '../types.ts';
import type { World } from '../world.ts';
import { speedMul } from './ipa.ts';

const TRAIL_STEP = 0.45;
const TRAIL_MAX = 120;
const AGENT_SPACING = 1.25;
const PERSUADED_OFFSET = 4.2;
const PERSUADED_SPACING = 0.9;

/** Point `back` metres behind the leader along its breadcrumb trail. */
export function trailPoint(leader: Entity, back: number): { x: number; y: number } {
  let px = leader.x;
  let py = leader.y;
  let remaining = back;
  const t = leader.trail;
  for (let i = t.length - 2; i >= 0; i -= 2) {
    const qx = t[i];
    const qy = t[i + 1];
    const seg = Math.hypot(qx - px, qy - py);
    if (seg >= remaining) {
      const f = seg > 0 ? remaining / seg : 0;
      return { x: px + (qx - px) * f, y: py + (qy - py) * f };
    }
    remaining -= seg;
    px = qx;
    py = qy;
  }
  return { x: px, y: py };
}

export function goTo(world: World, e: Entity, x: number, y: number, repathEvery = 0.8): void {
  const end = e.path && e.path.length ? e.path[e.path.length - 1] : null;
  const moved = !end || Math.hypot(end.x - x, end.y - y) > 1.5;
  if (!e.path || (moved && world.time >= e.repathAt)) {
    e.path = world.nav.findPath(e.x, e.y, x, y, e.radius, 6000);
    e.pathIdx = 0;
    e.repathAt = world.time + repathEvery;
  }
}

function steerPath(e: Entity): void {
  if (!e.path) return;
  while (e.pathIdx < e.path.length) {
    const wp = e.path[e.pathIdx];
    const last = e.pathIdx === e.path.length - 1;
    const d = Math.hypot(wp.x - e.x, wp.y - e.y);
    if (d < (last ? 0.25 : 0.6)) {
      e.pathIdx++;
      continue;
    }
    const f = last ? Math.min(1, d / 1.0) : 1;
    e.dvx = ((wp.x - e.x) / d) * f;
    e.dvy = ((wp.y - e.y) / d) * f;
    return;
  }
  e.path = null;
  e.moveTarget = null;
  e.dvx = 0;
  e.dvy = 0;
}

function persuadedIndex(world: World, e: Entity, leader: Entity): number {
  let n = 0;
  for (const o of world.entities) {
    if (o === e) break;
    if (o.alive && o.followId === leader.id && o.kind !== 'agent') n++;
  }
  return n;
}

function promoteLeaders(world: World): void {
  for (const e of world.entities) {
    if (!e.alive || e.followId < 0) continue;
    const leader = world.get(e.followId);
    if (leader && leader.alive) continue;
    // Leader is gone. Persuaded units latch onto the nearest living agent; others close ranks.
    if (e.kind !== 'agent' && e.faction === 'player') {
      let best: Entity | null = null;
      let bestD = Infinity;
      for (const a of world.livingAgents()) {
        const d = Math.hypot(a.x - e.x, a.y - e.y);
        if (d < bestD) {
          bestD = d;
          best = a;
        }
      }
      e.followId = best ? best.id : -1;
      continue;
    }
    const orphans = world.entities
      .filter((o) => o.alive && o.followId === e.followId && o.faction === e.faction && o.kind === e.kind)
      .sort((a, b) => a.followRank - b.followRank);
    const [head, ...others] = orphans;
    head.followId = -1;
    head.path = null;
    head.trail = leader ? [...leader.trail] : [];
    others.forEach((o, i) => {
      o.followId = head.id;
      o.followRank = i + 1;
    });
  }
}

function steerFollow(world: World, e: Entity, leader: Entity): void {
  const back =
    e.kind === 'agent'
      ? e.followRank * AGENT_SPACING
      : PERSUADED_OFFSET + persuadedIndex(world, e, leader) * PERSUADED_SPACING;
  const t = trailPoint(leader, back);
  const d = Math.hypot(t.x - e.x, t.y - e.y);
  if (d < 0.35) {
    e.path = null;
    return;
  }
  if (world.nav.clearPath(e.x, e.y, t.x, t.y, e.radius)) {
    e.path = null;
    const catchUp = d > 3 ? 1.2 : Math.min(1, d / 0.9);
    e.dvx = ((t.x - e.x) / d) * catchUp;
    e.dvy = ((t.y - e.y) / d) * catchUp;
    return;
  }
  goTo(world, e, t.x, t.y, 0.6);
  steerPath(e);
}

export function movementSystem(world: World): void {
  promoteLeaders(world);
  const { nav } = world;

  for (const e of world.entities) {
    if (!e.alive) {
      e.vx *= 0.8;
      e.vy *= 0.8;
      continue;
    }

    if (e.followId >= 0) {
      const leader = world.get(e.followId);
      if (leader) steerFollow(world, e, leader);
    } else if (e.path) {
      steerPath(e);
    }

    // Accelerate toward desired velocity. Agents are snappy: no wind-up, no turning delay.
    const w = world.weapon(e);
    const firingSlow = (e.firing || e.autoFire) && w ? w.moveMul : 1;
    const maxSpeed = e.speed * speedMul(e) * firingSlow;
    const accel = e.kind === 'agent' ? 60 : 24;
    const tx = e.dvx * maxSpeed;
    const ty = e.dvy * maxSpeed;
    let ax = tx - e.vx;
    let ay = ty - e.vy;
    const al = Math.hypot(ax, ay);
    const maxA = accel * DT;
    if (al > maxA) {
      ax = (ax / al) * maxA;
      ay = (ay / al) * maxA;
    }
    e.vx += ax;
    e.vy += ay;

    // Soft separation so squads and crowds flow around each other.
    let sx = 0;
    let sy = 0;
    world.query(e.x, e.y, 1.2, (o, d2) => {
      if (o === e) return;
      const min = e.radius + o.radius + 0.08;
      if (d2 >= min * min || d2 < 1e-6) return;
      const d = Math.sqrt(d2);
      const push = (min - d) / min;
      sx += ((e.x - o.x) / d) * push;
      sy += ((e.y - o.y) / d) * push;
    });

    const dx = (e.vx + sx * 3.5) * DT;
    const dy = (e.vy + sy * 3.5) * DT;
    const next = nav.slide(e.x, e.y, dx, dy, e.radius);
    const wanted = Math.hypot(dx, dy);
    const got = Math.hypot(next.x - e.x, next.y - e.y);
    e.stuckTicks = e.path && wanted > 0.02 && got < wanted * 0.2 ? e.stuckTicks + 1 : 0;
    if (e.stuckTicks > 12 && e.path) {
      const end = e.path[e.path.length - 1];
      e.path = nav.findPath(next.x, next.y, end.x, end.y, e.radius);
      e.pathIdx = 0;
      e.stuckTicks = 0;
    }
    if (got < wanted * 0.5) {
      e.vx = (next.x - e.x) / DT;
      e.vy = (next.y - e.y) / DT;
    }
    e.x = next.x;
    e.y = next.y;

    // Facing: toward the aim point while shooting (move-and-shoot), else toward travel.
    let face = e.facing;
    if (e.firing || e.autoFire) face = Math.atan2(e.aimY - e.y, e.aimX - e.x);
    else if (e.vx * e.vx + e.vy * e.vy > 0.2) face = Math.atan2(e.vy, e.vx);
    let diff = face - e.facing;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    e.facing += diff * Math.min(1, (e.kind === 'agent' ? 22 : 10) * DT);

    // Breadcrumbs for anyone who might be followed.
    if (e.faction === 'player' || e.kind === 'rival') {
      const t = e.trail;
      const lx = t.length ? t[t.length - 2] : NaN;
      const ly = t.length ? t[t.length - 1] : NaN;
      if (!t.length || Math.hypot(e.x - lx, e.y - ly) > TRAIL_STEP) {
        t.push(e.x, e.y);
        if (t.length > TRAIL_MAX * 2) t.splice(0, 2);
      }
    }

    e.dvx = 0;
    e.dvy = 0;
  }
}
