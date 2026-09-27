import { spawnCivilian } from '../setup.ts';
import { DT } from '../time.ts';
import type { Entity } from '../types.ts';
import type { World } from '../world.ts';

const WALK = 0.34;
const PATROL = 0.3;
const ARRIVE = 30;

function wander(world: World, e: Entity, pace: number): void {
  if (e.flowIdx < 0 || world.nav.flowDistance(e.flowIdx, e.x, e.y) < ARRIVE) {
    e.flowIdx = world.rng.pick(world.flowWander);
  }
  const d = world.nav.flowDir(e.flowIdx, e.x, e.y);
  e.dvx = d.x * pace;
  e.dvy = d.y * pace;
}

export function crowdSystem(world: World): void {
  const fled: Entity[] = [];
  let civs = 0;

  for (const e of world.entities) {
    if (!e.alive) continue;

    if (e.kind === 'police' && e.faction === 'police' && e.ai === 'patrol') {
      e.path = null;
      wander(world, e, PATROL);
      continue;
    }
    if (e.faction !== 'civ') continue;
    civs++;

    if (e.panic > 0) {
      e.panic -= DT;
      if (e.panic <= 0) {
        e.ai = 'wander';
        e.flowIdx = world.rng.pick(world.flowWander);
      }
    }

    if (e.ai === 'flee') {
      const d = world.nav.flowDir(e.flowIdx, e.x, e.y);
      e.dvx = d.x;
      e.dvy = d.y;
      if (world.nav.flowDistance(e.flowIdx, e.x, e.y) < 20) fled.push(e);
      if ((world.tick + e.id) % 8 === 0) {
        world.query(e.x, e.y, 2.6, (o) => {
          if (o.faction === 'civ' && o.panic <= 0 && world.rng.chance(0.55)) world.panicAt(o, e.lastSeenX, e.lastSeenY);
        });
      }
      continue;
    }

    if (e.ai === 'idle') {
      if (world.time > e.strafeUntil) e.ai = 'wander';
      continue;
    }

    wander(world, e, WALK);
    if (world.rng.chance(0.0015)) {
      e.ai = 'idle';
      e.strafeUntil = world.time + world.rng.range(1.5, 5);
    }
  }

  for (const e of fled) world.remove(e);

  // Keep the streets alive: new pedestrians wander in from the edges.
  if (world.tick % 40 === 0 && civs < world.civTarget) {
    const agents = world.livingAgents();
    const exits = world.flowExits.filter((f) => {
      const p = world.nav.flowTargets[f];
      return agents.every((a) => Math.hypot(a.x - p.x, a.y - p.y) > 30);
    });
    if (exits.length) {
      const p = world.nav.flowTargets[world.rng.pick(exits)];
      spawnCivilian(world, { x: p.x, y: p.y });
    }
  }
}
