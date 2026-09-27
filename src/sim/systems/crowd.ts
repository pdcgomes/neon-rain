import { nearestSidewalk, spawnCivilian } from '../setup.ts';
import { DT } from '../time.ts';
import type { Entity } from '../types.ts';
import { GROUND_ROAD } from '../map.ts';
import type { World } from '../world.ts';

const WALK = 0.34;
const PATROL = 0.3;
const ARRIVE = 30;

/**
 * Calm pedestrians wait at the kerb: they cross on the walk signal (the crossed road has a red with
 * time to spare) and still check for oncoming cars before stepping out.
 */
function waitForTraffic(world: World, e: Entity): void {
  if (e.dvx === 0 && e.dvy === 0) return;
  const { map } = world;
  const hereIdx = Math.floor(e.y) * map.w + Math.floor(e.x);
  const dl = Math.hypot(e.dvx, e.dvy);
  const nx = e.x + (e.dvx / dl) * 0.9;
  const ny = e.y + (e.dvy / dl) * 0.9;
  const next = Math.floor(ny) * map.w + Math.floor(nx);
  if (map.ground[next] !== GROUND_ROAD) return;
  const kind = map.crosswalk[next];
  // Already crossing: keep going, unless about to start a second crossing at the corner.
  if (map.ground[hereIdx] === GROUND_ROAD) {
    const hereKind = map.crosswalk[hereIdx];
    if (kind === 0 || (kind === hereKind && map.crosswalkNode[next] === map.crosswalkNode[hereIdx])) return;
  }
  const redLight = kind > 0 && !world.traffic.canCross(map.crosswalkNode[next], kind - 1, world.time);
  if (redLight || world.traffic.dangerAt(nx, ny)) {
    e.dvx = 0;
    e.dvy = 0;
  }
}

function wander(world: World, e: Entity, pace: number): void {
  if (e.flowIdx < 0 || world.nav.flowDistance(e.flowIdx, e.x, e.y) < ARRIVE) {
    e.flowIdx = world.rng.pick(world.flowWander);
  }
  const d = world.nav.flowDir(e.flowIdx, e.x, e.y);
  e.dvx = d.x * pace;
  e.dvy = d.y * pace;
  waitForTraffic(world, e);
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
      // Panicked people run without looking, and will jaywalk.
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
    const onRoad = world.map.ground[Math.floor(e.y) * world.map.w + Math.floor(e.x)] === GROUND_ROAD;
    if (!onRoad && world.rng.chance(0.0015)) {
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
      spawnCivilian(world, nearestSidewalk(world, p));
    }
  }
}
