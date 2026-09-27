import type { Entity, Ipa } from '../types.ts';
import { DT } from '../time.ts';
import type { World } from '../world.ts';

const OVERDRIVE_DRAIN = 7;
const REPAIR_RATE = 1.6;
const OVERDRIVE_TIME_SCALE = 0.4;

export function effectiveIpa(e: Entity): Ipa {
  if (e.kind !== 'agent') return { a: 0.5, p: 0.5, i: 0.5 };
  if (e.overdrive) return { a: 1, p: 1, i: 1 };
  return e.ipa;
}

/** Overdrive also speeds agents up relative to the slowed world, so it feels like bullet time. */
export function speedMul(e: Entity): number {
  const { a } = effectiveIpa(e);
  return (0.8 + 0.45 * a) * (e.overdrive ? 1.45 : 1);
}

export function fireIntervalMul(e: Entity): number {
  const { a } = effectiveIpa(e);
  return (1.2 - 0.4 * a) * (e.overdrive ? 0.7 : 1);
}

export function spreadMul(e: Entity): number {
  const { i } = effectiveIpa(e);
  return 1.4 - 0.8 * i;
}

export function autoRange(e: Entity): number {
  const { p } = effectiveIpa(e);
  return 7 + 8 * p;
}

export function ipaSystem(world: World): void {
  let anyOverdrive = false;
  for (const e of world.agents()) {
    if (!e.alive) continue;
    if (e.overdrive) {
      anyOverdrive = true;
      e.hp -= OVERDRIVE_DRAIN * DT;
      if (e.hp < 22) e.overdrive = false;
      continue;
    }
    const excess = Math.max(0, e.ipa.a + e.ipa.p + e.ipa.i - 1.5);
    if (excess > 0 && e.hp > 30) e.hp -= excess * 1.5 * DT;
    if (world.time - e.lastDamagedAt > 4) e.hp = Math.min(e.maxHp, e.hp + REPAIR_RATE * DT);
  }
  world.timeScale = anyOverdrive ? OVERDRIVE_TIME_SCALE : 1;
}
