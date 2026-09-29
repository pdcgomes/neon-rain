/**
 * Combat tuning knobs in one place, so the balance harness (scripts/balance.ts) can sweep them.
 * Weapon stats live in src/content/weapons.json and agent stats in src/content/agents.json.
 */
export const balance = {
  /** Extra spread on every shot fired by non-player units (1: everyone shoots alike). */
  npcSpread: 1,
  /** Multiplier on the damage of every shot fired by non-player units. */
  npcDamage: 1,
  /** Extra spread on shots agents fire on their own (not by the player's order). */
  autoFireSpread: 1,

  /**
   * Partial cover. A bullet reaching someone half hidden behind a wall or corner within `coverReach`
   * metres of them is stopped with probability `coverBlock` times the hidden fraction of their body.
   */
  coverBlock: 0,
  coverReach: 2.5,

  /** Seconds a bullet hit stops the victim firing (the original's hit reaction). */
  hitStagger: 0.25,

  /** HP per second agents with a V2+ chest self-repair once they've gone `repairDelay` seconds unhurt. */
  repairRate: 1.6,
  repairDelay: 4,

  /** Seconds between an agent's target scans when it fires on its own. */
  agentScan: 0.2,
  /** Seconds an agent at neutral Adrenaline takes to open fire on its own at a target it has just spotted. */
  agentReact: 0.45,
  /** How far an agent at neutral Perception looks for targets on its own (FreeSynd: ~6 tiles). */
  autoRange: 18,

  /**
   * IPA drugs. Each bar's strength is the gap between dose and dependency: x(1 + gap) above it,
   * 1/(1 + gap) below. Timings from FreeSynd's observation of the original, per second: the effect
   * catches up with the dose, then the dose wears off toward dependency; dependency creeps toward
   * the dose; a dose and dependency that have met drift back to neutral together.
   */
  ipaTakeHold: 0.01,
  ipaWearOff: 0.01,
  ipaDependency: 0.0022,
  ipaRecovery: 0.0022,
  /** How much each drug's strength moves each stat (0: not at all, 1: one for one, as in the original). */
  ipaSpeed: 1,
  ipaFireRate: 1,
  ipaReaction: 1.5,
  ipaAim: 1,
  ipaAwareness: 1,
  ipaPersuasion: 1,
  /** Extra spread per unit of Adrenaline strength above Intelligence strength ("fires wide or too soon"). */
  ipaErratic: 0.6,
  /**
   * Intelligence strength an agent needs to, acting alone: pick the enemies shooting at the squad
   * first; hold fire until in effective range; not fire with a civilian in the line; duck out of
   * sight when badly hurt. Below iBlind in both Intelligence and Perception it doesn't react until hit.
   */
  iPrioritise: 1.15,
  iPatient: 1.05,
  iDiscipline: 0.95,
  iRetreat: 1.2,
  iBlind: 0.8,

  /**
   * Seconds between an enemy spotting a target and opening fire, by class, times a random
   * 1..1+reactJitter. Missions scale these with `enemyReaction` (American Revolt: 0.5).
   */
  reactRival: 0.5,
  reactGuard: 0.9,
  reactPolice: 1.5,
  reactJitter: 0.5,
  /** Scales every enemy reaction on top of the class and mission values (for sweeps). */
  reactScale: 1,
  /** Enemies spot the squad at their weapon's range times this, up to sightMax; calm ones at sightCalmMul of that. */
  sightWeaponMul: 1.5,
  // 36 m made The Alleyway unwinnable even with the intended plan; 22 m let a rush through.
  sightMax: 28,
  sightCalmMul: 0.7,
  /** Calm guards and police ignore holstered agents farther away than this (rival agents don't). */
  holsteredNotice: 6,
  /** Chance a rival agent carries the squad's second-best gun instead of its best (FreeSynd's guess: 0.22). */
  rivalSecondGun: 0.22,
  /** An enemy who spots the squad alerts armed allies within this radius, who don't pass it on. */
  allyAlert: 16,
  /** Posted guards won't chase or search further than this from their post. */
  guardLeash: 10,
  /** Seconds an enemy keeps hunting where it last saw the squad. */
  searchTime: 9,
};

export type Balance = typeof balance;

/** Damage absorbed by chest mod version 0 (none) to 3, as in the original. */
export const CHEST_ARMOR = [0, 0.1, 0.25, 0.4] as const;

export const BALANCE_DEFAULTS: Readonly<Balance> = { ...balance };
