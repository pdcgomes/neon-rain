import { spawnPolice } from '../setup.ts';
import { DT } from '../time.ts';
import type { World } from '../world.ts';

const WARN_RANGE = 9;
const WARN_GRACE = 5;
const ENFORCER_DELAY = 20;
const COOL_OFF = 6;
const ENFORCER_INTERVAL = 22;
const MAX_ENFORCERS = 9;

export function policeSystem(world: World): void {
  const m = world.content.mission;

  // Patrol officers tell agents with drawn weapons to put them away.
  if (world.tick % 10 === 0 && !world.policeHostile) {
    for (const a of world.livingAgents()) {
      if (a.holstered) {
        a.warnedAt = 0;
        continue;
      }
      let witness = -1;
      world.query(a.x, a.y, WARN_RANGE, (p) => {
        if (witness < 0 && p.faction === 'police' && world.nav.los(p.x, p.y, a.x, a.y)) witness = p.id;
      });
      if (witness < 0) continue;
      if (a.warnedAt === 0) {
        a.warnedAt = world.time;
        world.emit({ t: 'bark', id: witness, text: 'Police! Put your weapon away, now!', tone: 'police' });
      } else if (world.time - a.warnedAt > WARN_GRACE) {
        world.heat = Math.max(world.heat, m.policeHostileAt + 5);
        world.lastViolenceAt = world.time;
        world.emit({ t: 'bark', id: witness, text: 'Suspect is non-compliant. Open fire!', tone: 'police' });
      }
    }
  }

  if (world.time - world.lastViolenceAt > COOL_OFF) world.heat = Math.max(0, world.heat - 2.5 * DT);
  world.heat = Math.min(100, world.heat);

  if (!world.policeHostile && world.heat >= m.policeHostileAt) {
    world.policeHostile = true;
    world.hostileSince = world.time;
    world.emit({ t: 'bark', id: -1, text: 'ALL UNITS: armed cyborgs in Sector 7. Lethal force authorised.', tone: 'police' });
  } else if (world.policeHostile && world.heat < 15) {
    world.policeHostile = false;
    for (const a of world.livingAgents()) a.warnedAt = 0;
    world.emit({ t: 'bark', id: -1, text: 'Dispatch: situation contained. Units resume patrol.', tone: 'police' });
  }

  // Heavy response once the city is really angry.
  const hostileFor = world.policeHostile ? world.time - world.hostileSince : 0;
  if (world.heat >= m.enforcersAt && hostileFor >= ENFORCER_DELAY && world.time >= world.nextEnforcerAt) {
    const alive = world.entities.filter((e) => e.alive && e.kind === 'enforcer' && e.faction === 'police').length;
    const agents = world.livingAgents();
    if (alive < MAX_ENFORCERS && agents.length) {
      const exits = world.map.exits
        .map((p) => ({ p, d: Math.min(...agents.map((a) => Math.hypot(a.x - p.x, a.y - p.y))) }))
        .filter((x) => x.d > 30)
        .sort((a, b) => a.d - b.d);
      if (exits.length) {
        const at = exits[0].p;
        for (let i = 0; i < 3; i++) {
          const e = spawnPolice(world, { x: at.x + (i - 1) * 1.2, y: at.y }, 2);
          e.lastSeenX = agents[0].x;
          e.lastSeenY = agents[0].y;
          e.lastSeenAt = world.time;
        }
        world.emit({ t: 'bark', id: -1, text: 'Enforcer squad deployed. Hold your ground.', tone: 'police' });
      }
    }
    world.nextEnforcerAt = world.time + ENFORCER_INTERVAL;
  }
}
