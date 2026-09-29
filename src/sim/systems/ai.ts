import { balance } from '../balance.ts';
import type { WeaponDef } from '../content.ts';
import type { Entity, AiState } from '../types.ts';
import type { World } from '../world.ts';
import { autoRange, judgement, reactTime } from './ipa.ts';
import { goTo } from './movement.ts';
import { persuadeTargetIds } from './objectives.ts';

const NONE: ReadonlySet<number> = new Set();

function findHostile(world: World, e: Entity, range: number, requireActive: boolean, spare = NONE): Entity | null {
  let best: Entity | null = null;
  let bestD = Infinity;
  const notice = balance.holsteredNotice;
  world.query(e.x, e.y, range, (o, d2) => {
    if (!world.isHostile(e, o) || spare.has(o.id)) return;
    if (requireActive && o.ai !== 'combat' && o.ai !== 'escape' && o.kind !== 'agent') return;
    // Rival cyborgs see through a holstered agent's cover; guards and police don't.
    if (e.faction === 'enemy' && e.kind !== 'rival' && o.kind === 'agent' && o.holstered && e.ai !== 'combat') {
      if (d2 > notice * notice) return;
    }
    // Police never fire on someone whose weapon is away, as in the original.
    if (e.faction === 'police' && o.faction === 'player' && o.holstered) return;
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

/** A smart agent's target: whoever is shooting at the squad, then rival agents, then the nearest. */
function prioritisedHostile(world: World, e: Entity, range: number, requireActive: boolean, spare: ReadonlySet<number>): Entity | null {
  let best: Entity | null = null;
  let bestScore = Infinity;
  world.query(e.x, e.y, range, (o, d2) => {
    if (!world.isHostile(e, o) || spare.has(o.id)) return;
    if (requireActive && o.ai !== 'combat' && o.ai !== 'escape') return;
    let score = Math.sqrt(d2);
    if (o.ai === 'combat' && world.get(o.targetId)?.faction === 'player') score -= 8;
    if (o.kind === 'rival') score -= 4;
    if (!o.weapons.length) score += 20;
    if (score < bestScore && world.nav.los(e.x, e.y, o.x, o.y)) [best, bestScore] = [o, score];
  });
  return best;
}

/** Is a civilian standing in the line of fire from `e` to `t`? */
function civilianInLine(world: World, e: Entity, t: Entity): boolean {
  const dx = t.x - e.x;
  const dy = t.y - e.y;
  const len2 = dx * dx + dy * dy || 1;
  let blocked = false;
  world.query((e.x + t.x) / 2, (e.y + t.y) / 2, Math.sqrt(len2) / 2 + 1, (c) => {
    if (blocked || c.faction !== 'civ') return;
    const u = ((c.x - e.x) * dx + (c.y - e.y) * dy) / len2;
    if (u <= 0 || u >= 1) return;
    if (Math.hypot(e.x + dx * u - c.x, e.y + dy * u - c.y) < c.radius + 0.35) blocked = true;
  });
  return blocked;
}

/** The nearest spot within a few metres that `from` can't see: where a hurt agent ducks out of the fight. */
function hidingSpot(world: World, e: Entity, from: Entity): { x: number; y: number } | null {
  let best: { x: number; y: number } | null = null;
  let bestD = Infinity;
  for (let oy = -5; oy <= 5; oy++) {
    for (let ox = -5; ox <= 5; ox++) {
      const d = Math.hypot(ox, oy);
      if (d > 5 || d >= bestD) continue;
      const x = e.x + ox;
      const y = e.y + oy;
      if (world.nav.circleBlocked(x, y, e.radius) || world.nav.los(from.x, from.y, x, y)) continue;
      [best, bestD] = [{ x, y }, d];
    }
  }
  return best;
}

/**
 * An agent's own fire when the player isn't directing it. Perception sets how far it looks,
 * Adrenaline how fast it reacts, and Intelligence how well it judges what to do.
 */
function supportFire(world: World, e: Entity, range: number, requireActive: boolean, spare: ReadonlySet<number>): void {
  e.autoFire = false;
  if (e.firing) return;
  const w = world.weapon(e);
  if (!w || w.type === 'persuade') return;
  const j = e.kind === 'agent' ? judgement(e) : null;
  const underFire = world.time - e.lastDamagedAt < 2;
  if (j?.blind && !underFire) {
    e.targetId = -1;
    return;
  }
  if (world.time >= e.thinkAt) {
    e.thinkAt = world.time + balance.agentScan;
    const reach = Math.min(range, w.range);
    const active = requireActive && e.holstered;
    const t = j?.prioritise ? prioritisedHostile(world, e, reach, active, spare) : findHostile(world, e, reach, active, spare);
    const id = t ? t.id : -1;
    // Reaction time is the delay before opening fire; switching targets mid-fight is free.
    if (id >= 0 && id !== e.targetId && world.time - e.lastShotAt > 1) e.reactAt = world.time + reactTime(e);
    e.targetId = id;
    // Hurt and under fire with nowhere it was told to go: a sensible agent gets out of sight.
    if (t && j && underFire && e.hp < e.maxHp * j.retreatBelow && !e.path && e.followId < 0) {
      const spot = hidingSpot(world, e, t);
      if (spot) goTo(world, e, spot.x, spot.y);
    }
  }
  const t = world.get(e.targetId);
  if (!t || !t.alive || !world.isHostile(e, t) || spare.has(t.id)) {
    e.targetId = -1;
    return;
  }
  aimAt(e, t, w.speed);
  if (world.time < e.reactAt) return;
  if (j?.patient && !underFire && Math.hypot(t.x - e.x, t.y - e.y) > w.range * 0.75) return;
  if (j?.discipline && civilianInLine(world, e, t)) return;
  e.autoFire = true;
}

/** How far an enemy with this weapon spots the squad; longer guns watch further, as in the original. */
export function sightRange(w: WeaponDef, alert: boolean): number {
  return Math.min(balance.sightMax, w.range * balance.sightWeaponMul) * (alert ? 1 : balance.sightCalmMul);
}

/** Seconds between spotting a target and opening fire, by class, scaled by the mission's tier. */
function enemyReaction(world: World, e: Entity): number {
  const base = e.kind === 'rival' ? balance.reactRival : e.kind === 'police' || e.kind === 'enforcer' ? balance.reactPolice : balance.reactGuard;
  return base * (world.content.mission.enemyReaction ?? 1) * balance.reactScale * (1 + world.rng.next() * balance.reactJitter);
}

/** Posted guards (and heavies) that hold their ground rather than chase. */
function leashed(e: Entity): boolean {
  return !!e.post && e.kind !== 'rival' && e.kind !== 'police' && e.kind !== 'enforcer';
}

function combatAi(world: World, e: Entity): void {
  const w = world.weapon(e);
  if (!w) return;

  if (world.time >= e.thinkAt) {
    e.thinkAt = world.time + 0.22 + world.rng.next() * 0.1;
    const t = findHostile(world, e, sightRange(w, e.ai === 'combat'), false);
    if (t) {
      if (e.ai !== 'combat' || e.targetId !== t.id) e.reactAt = world.time + enemyReaction(world, e);
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
      // One hop: allies who are told don't pass it on.
      world.query(e.x, e.y, balance.allyAlert, (o) => {
        if (o.faction !== e.faction || o.ai === 'combat' || o.kind === 'target' || o.weapons.length === 0) return;
        o.ai = 'combat';
        o.followId = -1;
        o.lastSeenX = t.x;
        o.lastSeenY = t.y;
        o.lastSeenAt = world.time;
        o.reactAt = world.time + enemyReaction(world, o);
      });
    } else {
      e.targetId = -1;
    }
  }

  e.pace = e.ai === 'combat' ? 1 : 0.4;
  if (e.ai === 'combat') {
    const t = world.get(e.targetId);
    if (t && t.alive) {
      const dx = t.x - e.x;
      const dy = t.y - e.y;
      const d = Math.hypot(dx, dy) || 1;
      aimAt(e, t, w.speed);
      e.firing = world.time >= e.reactAt && d <= w.range * 0.95;
      if (d > w.range * 0.85) {
        // Guards hold their post: they won't chase further than the leash allows.
        if (leashed(e) && Math.hypot(t.x - e.post!.x, t.y - e.post!.y) > balance.guardLeash + w.range) goTo(world, e, e.post!.x, e.post!.y);
        else goTo(world, e, t.x, t.y);
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
    const searchable = !leashed(e) || Math.hypot(e.lastSeenX - e.post!.x, e.lastSeenY - e.post!.y) <= balance.guardLeash;
    if (world.time - e.lastSeenAt < balance.searchTime && searchable) {
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
  } else if (e.ai === 'patrol' && e.kind !== 'police' && e.followId < 0 && e.patrol.length) {
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
  // Voss runs for his limousine, limping as he takes hits.
  e.pace = e.ai === 'escape' ? 0.55 + 0.45 * (e.hp / e.maxHp) : 0.35;
  if (e.ai === 'escape') {
    // Flee along the precomputed field to the limousine's exit; no pathfinding needed.
    if (e.flowIdx < 0 || !world.flowExits.includes(e.flowIdx)) {
      const es = world.map.escape;
      e.flowIdx = world.flowExits.reduce((best, f) => {
        const a = world.nav.flowTargets[f];
        const b = world.nav.flowTargets[best];
        return Math.hypot(a.x - es.x, a.y - es.y) < Math.hypot(b.x - es.x, b.y - es.y) ? f : best;
      }, world.flowExits[0]);
    }
    e.path = null;
    const d = world.nav.flowDir(e.flowIdx, e.x, e.y);
    e.dvx = d.x;
    e.dvy = d.y;
    return;
  }
  if (world.time >= e.thinkAt && e.post) {
    e.thinkAt = world.time + world.rng.range(3, 6);
    const a = world.rng.range(0, Math.PI * 2);
    goTo(world, e, e.post.x + Math.cos(a) * 1.5, e.post.y + Math.sin(a) * 1.5, 0);
  }
}

export function aiSystem(world: World): void {
  const spare = persuadeTargetIds(world);
  for (const e of world.entities) {
    if (!e.alive) continue;
    if (e.kind === 'agent') {
      supportFire(world, e, autoRange(e), true, spare);
      continue;
    }
    if (e.kind === 'civilian') continue;
    if (e.kind === 'target') {
      targetAi(world, e);
      continue;
    }
    if (e.faction === 'player') {
      supportFire(world, e, 12, false, spare);
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
