import { balance } from '../balance.ts';
import type { Entity, Ipa } from '../types.ts';
import { DT } from '../time.ts';
import type { World } from '../world.ts';

const OVERDRIVE_DRAIN = 7;
const OVERDRIVE_TIME_SCALE = 0.4;
const CHANNELS = ['a', 'p', 'i'] as const;

/**
 * Strength of one drug, 0.5..2: 1 when the dose matches dependency. Only agents take drugs;
 * everyone else is neutral.
 */
export function ipaStrength(e: Entity, ch: keyof Ipa): number {
  if (e.kind !== 'agent') return 1;
  const gap = e.ipa[ch] - e.ipaDep[ch];
  return gap >= 0 ? 1 + gap : 1 / (1 - gap);
}

/** Applies a strength to a stat with sensitivity k: k=1 passes it through, k=0 ignores it. */
function scaled(m: number, k: number): number {
  return m >= 1 ? 1 + k * (m - 1) : 1 / (1 + k * (1 / m - 1));
}

/** Overdrive also speeds agents up relative to the slowed world, so it feels like bullet time. */
export function speedMul(e: Entity): number {
  return scaled(ipaStrength(e, 'a'), balance.ipaSpeed) * (e.overdrive ? 1.45 : 1);
}

export function fireIntervalMul(e: Entity): number {
  const quick = scaled(ipaStrength(e, 'a'), balance.ipaFireRate) * scaled(ipaStrength(e, 'i'), balance.ipaFireRate * 0.3);
  return (e.overdrive ? 0.7 : 1) / quick;
}

/** Perception steadies the aim; Adrenaline running ahead of Intelligence spoils it. */
export function spreadMul(e: Entity): number {
  const erratic = Math.max(0, ipaStrength(e, 'a') - ipaStrength(e, 'i'));
  return (1 + balance.ipaErratic * erratic) / scaled(ipaStrength(e, 'p'), balance.ipaAim);
}

/** How far an agent looks for targets when left to its own devices. */
export function autoRange(e: Entity): number {
  return balance.autoRange * scaled(ipaStrength(e, 'p'), balance.ipaAwareness);
}

/** How long an agent takes to open fire on a target it has just spotted. */
export function reactTime(e: Entity): number {
  return balance.agentReact / scaled(ipaStrength(e, 'a'), balance.ipaReaction);
}

export function persuadeMul(e: Entity): number {
  return scaled(ipaStrength(e, 'p'), balance.ipaPersuasion);
}

/** What an agent's Intelligence and Perception let it do on its own. */
export interface Judgement {
  /** Picks the enemies shooting at the squad, and rival agents, over whoever is nearest. */
  prioritise: boolean;
  /** Waits until a target is in effective range instead of firing too soon. */
  patient: boolean;
  /** Won't fire with a civilian in the line of fire. */
  discipline: boolean;
  /** Health fraction below which it gets out of the line of fire; 0 never. */
  retreatBelow: number;
  /** Doesn't react until it is hit ("walks blindly into certain death"). */
  blind: boolean;
}

export function judgement(e: Entity): Judgement {
  const i = ipaStrength(e, 'i');
  const p = ipaStrength(e, 'p');
  return {
    prioritise: i >= balance.iPrioritise,
    patient: i >= balance.iPatient,
    discipline: i >= balance.iDiscipline,
    retreatBelow: i >= balance.iRetreat ? 0.25 + 0.2 * Math.min(1, p - 1 + 0.5) : 0,
    blind: i < balance.iBlind && p < balance.iBlind,
  };
}

function step(from: number, to: number, rate: number): number {
  const d = rate * DT;
  return from < to ? Math.min(to, from + d) : Math.max(to, from - d);
}

export function ipaSystem(world: World): void {
  let anyOverdrive = false;
  for (const e of world.agents()) {
    if (!e.alive) continue;
    if (e.overdrive) {
      anyOverdrive = true;
      for (const ch of CHANNELS) e.ipa[ch] = 1;
      e.hp -= OVERDRIVE_DRAIN * DT;
      if (e.hp < 22) e.overdrive = false;
    }
    for (const ch of CHANNELS) {
      const dose = e.ipa[ch];
      const dep = e.ipaDep[ch];
      if (Math.abs(e.ipaEff[ch] - dose) > 1e-6) e.ipaEff[ch] = step(e.ipaEff[ch], dose, balance.ipaTakeHold);
      else if (Math.abs(dose - dep) > 1e-6) e.ipa[ch] = e.ipaEff[ch] = step(dose, dep, balance.ipaWearOff);
      if (Math.abs(e.ipaDep[ch] - e.ipa[ch]) > 1e-6) e.ipaDep[ch] = step(dep, e.ipa[ch], balance.ipaDependency);
      else {
        e.ipa[ch] = e.ipaEff[ch] = e.ipaDep[ch] = step(dep, 0.5, balance.ipaRecovery);
      }
    }
    if (e.chest >= 2 && world.time - e.lastDamagedAt > balance.repairDelay) e.hp = Math.min(e.maxHp, e.hp + balance.repairRate * DT);
  }
  world.timeScale = anyOverdrive ? OVERDRIVE_TIME_SCALE : 1;
}
