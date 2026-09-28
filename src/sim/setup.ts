import type { AgentDef, SpawnDef } from './content.ts';
import { GROUND_ALLEY, GROUND_PLAZA, GROUND_SIDEWALK } from './map.ts';
import type { Entity, Vec2 } from './types.ts';
import type { World } from './world.ts';

const CIV_NAMES = ['Citizen'];

export function randomPedestrianSpot(world: World, avoid: Vec2 | null, minDist: number): Vec2 {
  const { map, nav, rng } = world;
  for (let tries = 0; tries < 400; tries++) {
    const x = rng.int(2, map.w - 3);
    const y = rng.int(2, map.h - 3);
    const g = map.ground[y * map.w + x];
    if (g !== GROUND_SIDEWALK && g !== GROUND_PLAZA && g !== GROUND_ALLEY) continue;
    if (nav.isBlocked(x, y)) continue;
    if (avoid && Math.hypot(x - avoid.x, y - avoid.y) < minDist) continue;
    return { x: x + 0.5, y: y + 0.5 };
  }
  return nav.nearestWalkable(map.w / 2, map.h / 2);
}

/** Nearest sidewalk cell to `p` (used so newcomers never appear in a traffic lane). */
export function nearestSidewalk(world: World, p: Vec2, maxR = 10): Vec2 {
  const { map } = world;
  const cx = Math.floor(p.x);
  const cy = Math.floor(p.y);
  for (let r = 0; r <= maxR; r++) {
    for (let oy = -r; oy <= r; oy++) {
      for (let ox = -r; ox <= r; ox++) {
        if (Math.max(Math.abs(ox), Math.abs(oy)) !== r) continue;
        const x = cx + ox;
        const y = cy + oy;
        if (x < 1 || y < 1 || x >= map.w - 1 || y >= map.h - 1) continue;
        if (map.ground[y * map.w + x] === GROUND_SIDEWALK && !map.blocked[y * map.w + x]) return { x: x + 0.5, y: y + 0.5 };
      }
    }
  }
  return p;
}

export function spawnCivilian(world: World, at: Vec2): Entity {
  const e = world.spawn('civilian', 'civ', at.x, at.y, world.rng.pick(CIV_NAMES));
  e.hp = e.maxHp = 25;
  e.speed = world.rng.range(4.2, 4.8);
  e.ai = 'wander';
  e.flowIdx = world.rng.pick(world.flowWander);
  return e;
}

export function spawnPolice(world: World, at: Vec2, tier: 1 | 2): Entity {
  const e = world.spawn(tier === 1 ? 'police' : 'enforcer', 'police', at.x, at.y, tier === 1 ? 'Officer' : 'Enforcer');
  if (tier === 1) {
    e.hp = e.maxHp = 60;
    e.speed = 4.4;
    e.weapons = ['enemyPistol'];
  } else {
    e.hp = e.maxHp = 110;
    e.armor = 0.3;
    e.speed = 4.8;
    e.weapons = ['riotGun'];
  }
  e.holstered = tier === 1;
  e.ai = tier === 1 ? 'patrol' : 'combat';
  e.flowIdx = world.rng.pick(world.flowWander);
  return e;
}

export function spawnRival(world: World, at: Vec2, heavy = false): Entity {
  const e = world.spawn('rival', 'enemy', at.x, at.y, heavy ? 'Heavy' : 'Rival Agent');
  e.hp = e.maxHp = heavy ? 150 : 95;
  e.armor = heavy ? 0.25 : 0.1;
  e.speed = heavy ? 4.2 : 5.0;
  e.weapons = [heavy ? 'enemyGauss' : 'enemyUzi'];
  e.ammo = heavy ? 99 : 0;
  e.holstered = false;
  e.ai = 'patrol';
  return e;
}

export function populate(world: World, squad: AgentDef[]): void {
  const { map, nav, rng, content } = world;
  const mission = content.mission;

  // Pedestrians wander between points spread over sidewalks, alleys and the plaza.
  for (let i = 0; i < 28; i++) world.flowWander.push(nav.addFlowTarget(randomPedestrianSpot(world, null, 0), 'walk'));
  for (const p of map.exits) world.flowExits.push(nav.addFlowTarget(p, 'flee'));

  // Squad.
  const offsets = [
    [-0.8, -0.8],
    [0.8, -0.8],
    [-0.8, 0.8],
    [0.8, 0.8],
  ];
  squad.slice(0, 4).forEach((def, i) => {
    const e = world.spawn('agent', 'player', map.spawn.x + offsets[i][0], map.spawn.y + offsets[i][1], def.name);
    e.hp = e.maxHp = def.hp;
    e.speed = def.speed;
    e.radius = 0.34;
    e.armor = 0.35;
    e.weapons = [...def.loadout];
    e.grenades = def.grenades;
    e.slot = i;
    e.facing = -Math.PI / 4;
    e.holstered = true;
    world.agentIds.push(e.id);
  });
  const leader = world.get(world.agentIds[0]);
  world.agents().forEach((a, i) => {
    if (i > 0 && leader) {
      a.followId = leader.id;
      a.followRank = i;
    }
  });

  if (mission.spawns) placeSpawns(world, mission.spawns);
  else placeNeonRain(world);

  // Civilians.
  world.civTarget = mission.population.civilians;
  for (let i = 0; i < mission.population.civilians; i++) {
    const c = spawnCivilian(world, randomPedestrianSpot(world, map.spawn, 6));
    c.facing = rng.range(0, Math.PI * 2);
  }

  world.nextEnforcerAt = 0;
}

function spawnTarget(world: World, at: Vec2, name: string): Entity {
  const target = world.spawn('target', 'enemy', at.x, at.y, name);
  target.hp = target.maxHp = 70;
  target.speed = 3.1;
  target.ai = 'idle';
  target.post = { x: target.x, y: target.y };
  if (world.targetId < 0) world.targetId = target.id;
  return target;
}

function spawnGuard(world: World, at: Vec2, facing: number): Entity {
  const g = world.spawn('guard', 'enemy', at.x, at.y, 'Bodyguard');
  g.hp = g.maxHp = 90;
  g.armor = 0.15;
  g.speed = 5.0;
  g.weapons = ['enemyUzi'];
  g.holstered = false;
  g.ai = 'guard';
  g.post = { x: g.x, y: g.y };
  g.facing = facing;
  return g;
}

/** Places a mission's authored spawns exactly where the file says. */
function placeSpawns(world: World, spawns: SpawnDef[]): void {
  const mission = world.content.mission;
  for (const s of spawns) {
    const at = { x: s.x, y: s.y };
    let e: Entity;
    switch (s.kind) {
      case 'civilian':
        e = spawnCivilian(world, at);
        break;
      case 'police':
        e = spawnPolice(world, at, 1);
        break;
      case 'enforcer':
        e = spawnPolice(world, at, 2);
        break;
      case 'rival':
        e = spawnRival(world, at);
        break;
      case 'heavy':
        e = spawnRival(world, at, true);
        e.ai = 'guard';
        e.post = { x: e.x, y: e.y };
        break;
      case 'guard':
        e = spawnGuard(world, at, s.facing ?? 0);
        break;
      case 'target':
        e = spawnTarget(world, at, s.name ?? mission.targetName);
        break;
    }
    if (s.name) e.name = s.name;
    if (s.facing !== undefined) e.facing = s.facing;
    if (s.weapons?.length) e.weapons = [...s.weapons];
    if (s.hp) e.hp = e.maxHp = s.hp;
    if (s.armor !== undefined) e.armor = s.armor;
    if (s.holds && e.kind !== 'civilian' && e.kind !== 'police') {
      e.ai = e.kind === 'target' ? 'idle' : 'guard';
      e.post = { x: e.x, y: e.y };
    } else if (s.patrol?.length && e.kind !== 'police' && e.kind !== 'target') {
      // Armed units loop their route; a civilian (a VIP, say) walks it once.
      if (e.kind !== 'civilian') {
        e.ai = 'patrol';
        e.post = null;
      }
      e.patrol = s.patrol.map((p) => ({ ...p }));
      e.patrolIdx = 0;
    }
    world.spawnIds.set(s.id, e.id);
  }
}

/** Neon Rain's hand-written placement: Voss and his detail in the plaza, rival pairs, police. */
function placeNeonRain(world: World): void {
  const { map, nav } = world;
  const mission = world.content.mission;
  // Target and bodyguards in the plaza.
  const pz = map.plaza;
  const pc = { x: pz.x + pz.w / 2, y: pz.y + pz.h / 2 };
  const target = spawnTarget(world, { x: pc.x + 2.6, y: pc.y + 0.5 }, mission.targetName);

  for (let i = 0; i < mission.population.guards; i++) {
    const a = (i / mission.population.guards) * Math.PI * 2 + 0.4;
    spawnGuard(world, { x: target.x + Math.cos(a) * 2.2, y: target.y + Math.sin(a) * 2.2 }, a);
  }

  // Rival syndicate patrols: pairs looping between intersections around the plaza.
  const byDist = [...map.intersections].sort(
    (a, b) => Math.hypot(a.x - pc.x, a.y - pc.y) - Math.hypot(b.x - pc.x, b.y - pc.y),
  );
  const ring = byDist.slice(0, Math.min(6, byDist.length));
  for (let i = 0; i < mission.population.rivals; i += 2) {
    const start = ring[(i / 2) % ring.length];
    const route = [start, ring[(i / 2 + 1) % ring.length], ring[(i / 2 + 3) % ring.length]].map((p, k) =>
      nearestSidewalk(world, { x: p.x + (k % 2 ? 5 : -5), y: p.y + (k < 2 ? 5 : -5) }),
    );
    const lead = spawnRival(world, route[0]);
    lead.patrol = route;
    lead.patrolIdx = 1;
    if (i + 1 < mission.population.rivals) {
      const mate = spawnRival(world, { x: route[0].x + 0.8, y: route[0].y + 0.8 });
      mate.patrol = route;
      mate.patrolIdx = 1;
      mate.followId = lead.id;
      mate.followRank = 1;
    }
  }
  for (let i = 0; i < mission.population.heavies; i++) {
    const spot = nav.nearestWalkable(pz.x + pz.w + 1, pc.y);
    const h = spawnRival(world, spot, true);
    h.ai = 'guard';
    h.post = { ...spot };
  }

  // Police patrols.
  for (let i = 0; i < mission.population.police; i++) {
    spawnPolice(world, randomPedestrianSpot(world, map.spawn, 20), 1);
  }
}
