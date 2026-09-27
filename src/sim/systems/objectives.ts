import { spawnRival } from '../setup.ts';
import { DT } from '../time.ts';
import type { World } from '../world.ts';

const EXTRACT_RADIUS = 4.5;
const EXTRACT_HOLD = 1.5;

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

export function objectiveSystem(world: World): void {
  if (world.phase === 'success' || world.phase === 'fail') return;

  if (world.livingAgents().length === 0) {
    finish(world, 'fail', 'All agents lost. Eurocorp will recoup the hardware.');
    return;
  }

  const target = world.get(world.targetId);
  if (world.phase === 'eliminate') {
    if (!target || !target.alive) {
      world.phase = 'extract';
      world.emit({ t: 'objective', text: 'Target eliminated. Proceed to the extraction VTOL.' });
      world.emit({ t: 'bark', id: -1, text: 'Good work. A rival intercept team is moving on the VTOL. Expect resistance.', tone: 'hq' });
      const ex = world.map.extraction;
      for (let i = 0; i < 3; i++) {
        const r = spawnRival(world, { x: ex.x + (i - 1) * 3, y: ex.y + 6 });
        r.ai = 'combat';
        r.lastSeenX = ex.x;
        r.lastSeenY = ex.y;
        r.lastSeenAt = world.time;
      }
    } else if (Math.hypot(target.x - world.map.escape.x, target.y - world.map.escape.y) < 2.2) {
      finish(world, 'fail', 'Voss reached his limousine and escaped the sector.');
      return;
    }
  }

  if (world.phase === 'extract') {
    const ex = world.map.extraction;
    const all = world
      .livingAgents()
      .every((a) => Math.hypot(a.x - ex.x, a.y - ex.y) < EXTRACT_RADIUS);
    world.extractTimer = all ? world.extractTimer + DT : 0;
    if (world.extractTimer >= EXTRACT_HOLD) finish(world, 'success', 'Target terminated. Squad extracted.');
  }
}
