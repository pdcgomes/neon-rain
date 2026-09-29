import type { ObjectiveDef } from '../content.ts';
import { spawnRival } from '../setup.ts';
import { DT } from '../time.ts';
import type { Entity } from '../types.ts';
import type { World } from '../world.ts';

const EXTRACT_RADIUS = 4.5;
const EXTRACT_HOLD = 1.5;
const REACH_RADIUS = 2.5;

function finish(world: World, result: 'success' | 'fail', reason: string): void {
  world.phase = result;
  world.resultReason = reason;
  for (const e of world.entities) {
    e.firing = false;
    e.autoFire = false;
    e.overdrive = false;
  }
  world.timeScale = 1;
  world.emit({ t: 'mission', result, reason });
}

/** Entities an objective refers to; missing ones (removed from the world) come back as undefined. */
export function objectiveTargets(world: World, o: ObjectiveDef): (Entity | undefined)[] {
  if (!o.targets?.length) return [world.get(world.targetId)];
  return o.targets.map((id) => {
    const eid = world.spawnIds.get(id);
    return eid === undefined ? undefined : world.get(eid);
  });
}

/** People the squad still has to persuade: agents never pick them as targets on their own. */
export function persuadeTargetIds(world: World): Set<number> {
  const out = new Set<number>();
  const list = world.content.mission.objectives;
  for (let k = world.objectiveIdx; k < list.length; k++) {
    if (list[k].type !== 'persuade') continue;
    for (const e of objectiveTargets(world, list[k])) if (e && e.alive && e.faction !== 'player') out.add(e.id);
  }
  return out;
}

export function currentObjective(world: World): ObjectiveDef | undefined {
  return world.content.mission.objectives[world.objectiveIdx];
}

/**
 * A protect objective with no destination doesn't block progress; it only fails the mission if a
 * protectee dies. With a destination it completes once they get there.
 */
function skipStanding(world: World): void {
  const list = world.content.mission.objectives;
  while (world.objectiveIdx < list.length && list[world.objectiveIdx].type === 'protect' && !list[world.objectiveIdx].at) world.objectiveIdx++;
  const cur = list[world.objectiveIdx];
  if (world.phase === 'active' || world.phase === 'extract') world.phase = cur?.type === 'extract' ? 'extract' : 'active';
}

export function startObjectives(world: World): void {
  world.objectiveIdx = 0;
  skipStanding(world);
}

function complete(world: World, o: ObjectiveDef): void {
  if (missionOver(world)) return;
  const list = world.content.mission.objectives;
  world.objectiveIdx++;
  skipStanding(world);
  const next = list[world.objectiveIdx];
  if (!next) {
    finish(world, 'success', o.successText ?? 'Objectives complete. Squad extracted.');
    return;
  }
  world.extractTimer = 0;
  world.emit({ t: 'objective', text: o.doneText ?? next.text });
  if (o.doneBark) world.emit({ t: 'bark', id: -1, text: o.doneBark, tone: 'hq' });
  if (o.reinforce) {
    const at = o.reinforce.near === 'spawn' ? world.map.spawn : world.map.extraction;
    for (let i = 0; i < o.reinforce.count; i++) {
      const r = spawnRival(world, { x: at.x + (i - 1) * 3, y: at.y + 6 });
      r.ai = 'combat';
      r.lastSeenX = at.x;
      r.lastSeenY = at.y;
      r.lastSeenAt = world.time;
    }
  }
}

const dead = (e: Entity | undefined) => !e || !e.alive;

export function objectiveSystem(world: World): void {
  if (world.phase === 'success' || world.phase === 'fail') return;

  if (world.livingAgents().length === 0) {
    finish(world, 'fail', 'All agents lost. Eurocorp will recoup the hardware.');
    return;
  }

  const list = world.content.mission.objectives;
  for (let k = 0; k < list.length; k++) {
    const o = list[k];
    // A protect objective with a destination stops mattering once it has been completed.
    if (o.type !== 'protect' || (o.at && k < world.objectiveIdx)) continue;
    const targets = objectiveTargets(world, o);
    if (targets.some(dead)) {
      finish(world, 'fail', `${targets.find((t) => t && !t.alive)?.name || 'A protected asset'} was killed.`);
      return;
    }
  }

  // A freshly started objective is checked in the same tick (the squad may already be in place).
  for (let guard = 0; guard < 8; guard++) {
    const o = currentObjective(world);
    if (!o || !evaluate(world, o)) return;
    complete(world, o);
    if (missionOver(world)) return;
  }
}

export function missionOver(world: World): boolean {
  return world.phase === 'success' || world.phase === 'fail';
}

/** True while the current objective is a kill whose target can still escape (drives the red escape beam). */
export function targetCanEscape(world: World): boolean {
  const o = currentObjective(world);
  return world.phase === 'active' && o?.type === 'eliminate' && !!o.escapeFails;
}

/** True when the objective is met this tick. May end the mission with a failure. */
function evaluate(world: World, o: ObjectiveDef): boolean {
  const targets = objectiveTargets(world, o);
  switch (o.type) {
    case 'eliminate': {
      if (targets.every(dead)) return true;
      const es = world.map.escape;
      if (o.escapeFails && targets.some((t) => t && t.alive && Math.hypot(t.x - es.x, t.y - es.y) < 2.2)) {
        finish(world, 'fail', o.escapeFails);
      }
      return false;
    }
    case 'persuade': {
      if (targets.some(dead)) {
        finish(world, 'fail', 'The persuasion target was killed.');
        return false;
      }
      return targets.every((t) => t!.faction === 'player');
    }
    case 'protect': {
      const at = o.at!;
      const r = o.radius ?? REACH_RADIUS;
      return targets.every((t) => t && Math.hypot(t.x - at.x, t.y - at.y) < r);
    }
    case 'sweep': {
      const sides: string[] = o.factions?.length ? o.factions : ['enemy'];
      return !world.entities.some((e) => e.alive && sides.includes(e.faction));
    }
    case 'reach': {
      const at = o.at ?? world.map.extraction;
      const r = o.radius ?? REACH_RADIUS;
      return world.livingAgents().some((a) => Math.hypot(a.x - at.x, a.y - at.y) < r);
    }
    case 'extract': {
      const at = o.at ?? world.map.extraction;
      const r = o.radius ?? EXTRACT_RADIUS;
      const escorts = o.targets?.length ? targets : [];
      if (escorts.some(dead)) {
        finish(world, 'fail', 'An escort was killed before extraction.');
        return false;
      }
      const inside = (e: Entity) => Math.hypot(e.x - at.x, e.y - at.y) < r;
      const all = world.livingAgents().every(inside) && escorts.every((e) => inside(e!));
      world.extractTimer = all ? world.extractTimer + DT : 0;
      return world.extractTimer >= EXTRACT_HOLD;
    }
    default:
      return false;
  }
}
