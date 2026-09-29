import { DT } from '../time.ts';
import { persuadeMul } from './ipa.ts';
import type { Entity, Kind } from '../types.ts';
import type { World } from '../world.ts';

const REQUIRED: Partial<Record<Kind, number>> = {
  civilian: 0.45,
  police: 1.4,
  guard: 2.0,
  rival: 3.0,
  enforcer: 2.6,
};
const MAX_FOLLOWERS = 16;

function followerCount(world: World): number {
  let n = 0;
  for (const e of world.entities) if (e.alive && e.faction === 'player' && e.kind !== 'agent') n++;
  return n;
}

function convert(world: World, e: Entity, by: Entity): void {
  e.faction = 'player';
  e.ai = 'follow';
  e.followId = by.id;
  e.persuadedBy = by.id;
  e.persuadedAt = world.time;
  e.persuadeProgress = 0;
  e.firing = false;
  e.targetId = -1;
  e.path = null;
  e.panic = 0;
  e.post = null;
  if (e.kind === 'civilian' && e.patrol.length) {
    // A scripted walker stops strolling its route and keeps up with the squad.
    e.patrol = [];
    e.pace = 1;
  }
  e.holstered = false;
  world.stats.persuaded++;
  if (e.kind === 'guard') world.stats.guardsPersuaded++;
  for (const o of world.entities) {
    if (o.followId === e.id && o.faction !== 'player') o.followId = -1;
  }
  world.emit({ t: 'persuaded', id: e.id, by: by.id });
}

export function persuadeSystem(world: World): void {
  let followers = -1;
  let shieldWarned = false;

  for (const a of world.entities) {
    if (!a.alive || a.kind !== 'agent' || !a.firing) continue;
    const w = world.weapon(a);
    if (!w || w.type !== 'persuade') continue;
    a.holstered = false;
    if (world.tick % 9 === a.slot) world.emit({ t: 'persuading', by: a.id, x: a.aimX, y: a.aimY });
    if (followers < 0) followers = followerCount(world);
    const boost = (1 + Math.min(followers, 10) * 0.07) * persuadeMul(a);

    world.query(a.x, a.y, w.range, (c) => {
      if (c.faction === 'player') return;
      if (Math.hypot(c.x - a.aimX, c.y - a.aimY) > w.splash) return;
      if (!world.nav.los(a.x, a.y, c.x, c.y)) return;
      if (c.kind === 'target') {
        if (!shieldWarned && world.tick % 60 === 0) {
          shieldWarned = true;
          const text = world.content.mission.barks?.targetShielded ?? 'Voss has a neural shield. Persuasion is useless on him.';
          world.emit({ t: 'bark', id: c.id, text, tone: 'hq' });
        }
        return;
      }
      const req = REQUIRED[c.kind];
      if (!req || followers >= MAX_FOLLOWERS) return;
      c.persuadeProgress += (DT / req) * boost;
      c.persuadeTick = world.tick;
      if (c.persuadeProgress >= 1) {
        convert(world, c, a);
        followers++;
      }
    });
  }

  for (const e of world.entities) {
    if (e.persuadeProgress > 0 && e.persuadeTick !== world.tick) {
      e.persuadeProgress = Math.max(0, e.persuadeProgress - DT * 0.35);
    }
  }
}
