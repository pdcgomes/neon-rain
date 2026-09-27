import type { Entity, AiState } from '../types.ts';
import type { World } from '../world.ts';
import { autoRange } from './ipa.ts';
import { goTo } from './movement.ts';

const SIGHT_CALM = 13;
const SIGHT_ALERT = 18;
const HOLSTERED_NOTICE = 6;

function findHostile(world: World, e: Entity, range: number, requireActive: boolean): Entity | null {
  let best: Entity | null = null;
  let bestD = Infinity;
  world.query(e.x, e.y, range, (o, d2) => {
    if (!world.isHostile(e, o)) return;
    if (requireActive && o.ai !== 'combat' && o.ai !== 'escape' && o.kind !== 'agent') return;
    if (e.faction === 'enemy' && o.kind === 'agent' && o.holstered && e.ai !== 'combat') {
      if (d2 > HOLSTERED_NOTICE * HOLSTERED_NOTICE) return;
    }
    if (d2 < bestD && world.nav.los(e.x, e.y, o.x, o.y)) {
      bestD = d2;
      best = o;
    }
  });
  return best;
}

function aimAt(e: Entity, t: Entity, projectileSpeed: number): void {
  const d = Math.hypot(t.x - e.x, t.y - e.y);
  const lead = (d / Math.max(10, projectileSpeed)) * 0.6;
  e.aimX = t.x + t.vx * lead;
  e.aimY = t.y + t.vy * lead;
}

function baseState(e: Entity): AiState {
  if (e.kind === 'enforcer') return 'combat';
  if (e.kind === 'police') return 'patrol';
  if (e.post) return 'guard';
  return 'patrol';
}

/** Perception-driven return fire for agents and armed persuaded followers. */
function supportFire(world: World, e: Entity, range: number, requireActive: boolean): void {
  e.autoFire = false;
  if (e.firing) return;
  const w = world.weapon(e);
  if (!w || w.type === 'persuade') return;
  if (world.time >= e.thinkAt) {
    e.thinkAt = world.time + 0.2;
    const t = findHostile(world, e, Math.min(range, w.range), requireActive && e.holstered);
    e.targetId = t ? t.id : -1;
  }
  const t = world.get(e.targetId);
  if (!t || !t.alive || !world.isHostile(e, t)) {
    e.targetId = -1;
    return;
  }
  aimAt(e, t, w.speed);
  e.autoFire = true;
}

function combatAi(world: World, e: Entity): void {
  const w = world.weapon(e);
  if (!w) return;

  if (world.time >= e.thinkAt) {
    e.thinkAt = world.time + 0.22 + world.rng.next() * 0.1;
    const range = e.ai === 'combat' ? SIGHT_ALERT : SIGHT_CALM;
    const t = findHostile(world, e, range, false);
    if (t) {
      if (e.ai !== 'combat' || e.targetId !== t.id) e.reactAt = world.time + 0.35 + world.rng.next() * 0.4;
      if (e.ai !== 'combat') {
        if (e.faction === 'enemy') world.raiseAlarm();
        if (e.kind === 'rival' && world.rng.chance(0.4)) {
          world.emit({ t: 'bark', id: e.id, text: 'Eurocorp agents! Take them down.', tone: 'enemy' });
        }
      }
      e.ai = 'combat';
      e.targetId = t.id;
      e.lastSeenX = t.x;
      e.lastSeenY = t.y;
      e.lastSeenAt = world.time;
      e.followId = -1;
      world.query(e.x, e.y, 12, (o) => {
        if (o.faction !== e.faction || o.ai === 'combat' || o.kind === 'target' || o.weapons.length === 0) return;
        o.ai = 'combat';
        o.followId = -1;
        o.lastSeenX = t.x;
        o.lastSeenY = t.y;
        o.lastSeenAt = world.time;
        o.reactAt = world.time + 0.6;
      });
    } else {
      e.targetId = -1;
    }
  }

  if (e.ai === 'combat') {
    const t = world.get(e.targetId);
    if (t && t.alive) {
      const dx = t.x - e.x;
      const dy = t.y - e.y;
      const d = Math.hypot(dx, dy) || 1;
      aimAt(e, t, w.speed);
      e.firing = world.time >= e.reactAt && d <= w.range * 0.95;
      if (d > w.range * 0.85) {
        goTo(world, e, t.x, t.y);
      } else if (d < 3.5) {
        e.path = null;
        e.dvx = (-dx / d) * 0.8;
        e.dvy = (-dy / d) * 0.8;
      } else {
        e.path = null;
        if (world.time > e.strafeUntil) {
          e.strafeDir = world.rng.pick([-1, 0, 1, 1, -1]);
          e.strafeUntil = world.time + world.rng.range(0.7, 1.8);
        }
        e.dvx = (-dy / d) * e.strafeDir * 0.55;
        e.dvy = (dx / d) * e.strafeDir * 0.55;
      }
      return;
    }
    e.firing = false;
    if (e.kind === 'enforcer' && world.time - e.lastSeenAt > 3) {
      const prey = nearestAgent(world, e);
      if (prey) {
        e.lastSeenX = prey.x;
        e.lastSeenY = prey.y;
        e.lastSeenAt = world.time;
      }
    }
    if (world.time - e.lastSeenAt < 9) {
      if (Math.hypot(e.lastSeenX - e.x, e.lastSeenY - e.y) > 1.2) goTo(world, e, e.lastSeenX, e.lastSeenY);
      else e.path = null;
      return;
    }
    e.ai = baseState(e);
    e.path = null;
  }

  e.firing = false;
  if (e.ai === 'guard' && e.post) {
    if (Math.hypot(e.post.x - e.x, e.post.y - e.y) > 1.2) goTo(world, e, e.post.x, e.post.y);
    else e.path = null;
  } else if (e.ai === 'patrol' && e.kind === 'rival' && e.followId < 0 && e.patrol.length) {
    const wp = e.patrol[e.patrolIdx % e.patrol.length];
    if (Math.hypot(wp.x - e.x, wp.y - e.y) < 2) e.patrolIdx++;
    goTo(world, e, wp.x, wp.y, 1.5);
  }
}

function nearestAgent(world: World, e: Entity): Entity | null {
  let best: Entity | null = null;
  let bestD = Infinity;
  for (const a of world.livingAgents()) {
    const d = Math.hypot(a.x - e.x, a.y - e.y);
    if (d < bestD) {
      bestD = d;
      best = a;
    }
  }
  return best;
}

function targetAi(world: World, e: Entity): void {
  if (e.ai === 'escape') {
    goTo(world, e, world.map.escape.x, world.map.escape.y, 1.5);
    return;
  }
  if (world.time >= e.thinkAt && e.post) {
    e.thinkAt = world.time + world.rng.range(3, 6);
    const a = world.rng.range(0, Math.PI * 2);
    goTo(world, e, e.post.x + Math.cos(a) * 1.5, e.post.y + Math.sin(a) * 1.5, 0);
  }
}

export function aiSystem(world: World): void {
  for (const e of world.entities) {
    if (!e.alive) continue;
    if (e.kind === 'agent') {
      supportFire(world, e, autoRange(e), true);
      continue;
    }
    if (e.kind === 'civilian') continue;
    if (e.kind === 'target') {
      targetAi(world, e);
      continue;
    }
    if (e.faction === 'player') {
      supportFire(world, e, 12, false);
      continue;
    }
    if (e.kind === 'police' && !world.policeHostile) {
      e.firing = false;
      if (e.ai === 'combat') e.ai = 'patrol';
      continue;
    }
    combatAi(world, e);
  }
}
