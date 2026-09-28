export interface Vec2 {
  x: number;
  y: number;
}

/** Who an entity currently fights for. Persuaded units flip to 'player'. */
export type Faction = 'player' | 'enemy' | 'police' | 'civ';

export type Kind = 'agent' | 'civilian' | 'police' | 'enforcer' | 'rival' | 'guard' | 'target';

export type AiState =
  | 'idle'
  | 'wander'
  | 'patrol'
  | 'guard'
  | 'flee'
  | 'combat'
  | 'follow'
  | 'escape';

export interface Ipa {
  /** Adrenaline: speed and rate of fire. */
  a: number;
  /** Perception: auto-targeting range and reaction. */
  p: number;
  /** Intelligence: accuracy. */
  i: number;
}

export interface Entity {
  id: number;
  kind: Kind;
  faction: Faction;
  name: string;
  x: number;
  y: number;
  px: number;
  py: number;
  vx: number;
  vy: number;
  /** Desired velocity written by controllers, consumed by movement. */
  dvx: number;
  dvy: number;
  facing: number;
  radius: number;
  speed: number;
  /** Fraction of top speed the AI wants right now (strolling vs running). */
  pace: number;
  hp: number;
  maxHp: number;
  armor: number;
  alive: boolean;
  deadAt: number;
  lastDamagedAt: number;

  weapons: string[];
  weaponIdx: number;
  cooldown: number;
  spin: number;
  ammo: number;
  grenades: number;
  holstered: boolean;
  lastShotAt: number;

  path: Vec2[] | null;
  pathIdx: number;
  moveTarget: Vec2 | null;
  repathAt: number;
  stuckTicks: number;
  followId: number;
  followRank: number;
  /** Flat [x0,y0,x1,y1,...] breadcrumb trail, newest last. */
  trail: number[];

  aimX: number;
  aimY: number;
  firing: boolean;
  autoFire: boolean;
  wantsSecondary: boolean;

  team: number;
  slot: number;
  ipa: Ipa;
  overdrive: boolean;

  ai: AiState;
  targetId: number;
  thinkAt: number;
  lastSeenX: number;
  lastSeenY: number;
  lastSeenAt: number;
  reactAt: number;
  strafeDir: number;
  strafeUntil: number;
  flowIdx: number;
  post: Vec2 | null;
  patrol: Vec2[];
  patrolIdx: number;
  panic: number;
  warnedAt: number;
  witnessedAt: number;
  carHitAt: number;
  persuadeProgress: number;
  persuadeTick: number;
  persuadedBy: number;
  persuadedAt: number;
}

export type ProjectileKind = 'bullet' | 'rocket' | 'grenade';

export interface Projectile {
  id: number;
  kind: ProjectileKind;
  weapon: string;
  x: number;
  y: number;
  z: number;
  px: number;
  py: number;
  pz: number;
  vx: number;
  vy: number;
  vz: number;
  ownerId: number;
  faction: Faction;
  damage: number;
  splash: number;
  ttl: number;
  fuse: number;
  landed: boolean;
}

export type SimEvent =
  | { t: 'shot'; x: number; y: number; dx: number; dy: number; weapon: string; owner: number; faction: Faction }
  | { t: 'hit'; x: number; y: number; target: number; damage: number }
  | { t: 'impact'; x: number; y: number }
  | { t: 'death'; id: number; kind: Kind; x: number; y: number; by: number }
  | { t: 'explosion'; x: number; y: number; r: number }
  | { t: 'throw'; owner: number }
  | { t: 'persuaded'; id: number; by: number }
  | { t: 'persuading'; by: number; x: number; y: number }
  | { t: 'bark'; id: number; text: string; tone: 'police' | 'enemy' | 'hq' | 'civ' }
  | { t: 'objective'; text: string }
  | { t: 'alarm' }
  | { t: 'horn'; x: number; y: number }
  | { t: 'carHit'; x: number; y: number; speed: number; victim: number; calm: boolean }
  | { t: 'mission'; result: 'success' | 'fail'; reason: string };

export interface MissionStats {
  shotsFired: number;
  shotsHit: number;
  killsEnemy: number;
  killsPolice: number;
  killsCivilian: number;
  persuaded: number;
  guardsPersuaded: number;
  agentsLost: string[];
  grenades: number;
}

/** 'active' while objectives remain; 'extract' once only the extraction is left. */
export type MissionPhase = 'active' | 'extract' | 'success' | 'fail';
