import type { Command } from './commands.ts';
import type { AgentDef, Content, WeaponDef } from './content.ts';
import { generateCity, type CityMap } from './map.ts';
import { Nav } from './nav.ts';
import { Rng } from './rng.ts';
import type { Entity, Faction, Kind, MissionPhase, MissionStats, Projectile, SimEvent } from './types.ts';
import { applyCommand } from './systems/orders.ts';
import { aiSystem } from './systems/ai.ts';
import { movementSystem } from './systems/movement.ts';
import { combatSystem, projectileSystem } from './systems/combat.ts';
import { persuadeSystem } from './systems/persuade.ts';
import { policeSystem } from './systems/police.ts';
import { ipaSystem } from './systems/ipa.ts';
import { crowdSystem } from './systems/crowd.ts';
import { objectiveSystem } from './systems/objectives.ts';
import { populate } from './setup.ts';
import { DT } from './time.ts';

export { DT, TICK_HZ } from './time.ts';
const CELL = 4;

export class World {
  readonly content: Content;
  readonly map: CityMap;
  readonly nav: Nav;
  readonly rng: Rng;
  tick = 0;
  time = 0;
  entities: Entity[] = [];
  projectiles: Projectile[] = [];
  events: SimEvent[] = [];
  heat = 0;
  lastViolenceAt = -99;
  policeHostile = false;
  hostileSince = -1;
  alarm = false;
  phase: MissionPhase = 'eliminate';
  resultReason = '';
  targetId = -1;
  agentIds: number[] = [];
  extractTimer = 0;
  nextEnforcerAt = 0;
  timeScale = 1;
  projectileSeq = 1;
  civTarget = 0;
  flowWander: number[] = [];
  flowExits: number[] = [];
  stats: MissionStats = {
    shotsFired: 0,
    shotsHit: 0,
    killsEnemy: 0,
    killsPolice: 0,
    killsCivilian: 0,
    persuaded: 0,
    guardsPersuaded: 0,
    agentsLost: [],
    grenades: 0,
  };

  private byId = new Map<number, Entity>();
  private toRemove = new Set<number>();
  private nextId = 1;
  private gw: number;
  private gh: number;
  private buckets: number[][];

  constructor(content: Content, squad: AgentDef[], seed = content.mission.seed) {
    this.content = content;
    this.rng = new Rng(seed ^ 0x9e3779b9);
    this.map = generateCity(content.mission.seed, content.mission.map);
    this.nav = new Nav(this.map);
    this.gw = Math.ceil(this.map.w / CELL);
    this.gh = Math.ceil(this.map.h / CELL);
    this.buckets = Array.from({ length: this.gw * this.gh }, () => []);
    populate(this, squad);
    this.rebuildGrid();
  }

  step(commands: readonly Command[]): void {
    this.events = [];
    for (const e of this.entities) {
      e.px = e.x;
      e.py = e.y;
    }
    for (const p of this.projectiles) {
      p.px = p.x;
      p.py = p.y;
      p.pz = p.z;
    }
    if (this.phase === 'eliminate' || this.phase === 'extract') {
      for (const c of commands) applyCommand(this, c);
    }
    this.rebuildGrid();
    aiSystem(this);
    crowdSystem(this);
    movementSystem(this);
    combatSystem(this);
    projectileSystem(this);
    persuadeSystem(this);
    policeSystem(this);
    ipaSystem(this);
    objectiveSystem(this);
    this.flushRemovals();
    this.tick++;
    this.time = this.tick * DT;
  }

  // ---------------------------------------------------------------- entities

  spawn(kind: Kind, faction: Faction, x: number, y: number, name = ''): Entity {
    const p = this.nav.nearestWalkable(x, y);
    const e: Entity = {
      id: this.nextId++,
      kind,
      faction,
      name,
      x: p.x,
      y: p.y,
      px: p.x,
      py: p.y,
      vx: 0,
      vy: 0,
      dvx: 0,
      dvy: 0,
      facing: this.rng.range(0, Math.PI * 2),
      radius: 0.32,
      speed: 4.5,
      hp: 50,
      maxHp: 50,
      armor: 0,
      alive: true,
      deadAt: -1,
      lastDamagedAt: -99,
      weapons: [],
      weaponIdx: 0,
      cooldown: 0,
      spin: 0,
      ammo: 0,
      grenades: 0,
      holstered: true,
      lastShotAt: -99,
      path: null,
      pathIdx: 0,
      moveTarget: null,
      repathAt: 0,
      stuckTicks: 0,
      followId: -1,
      followRank: 0,
      trail: [],
      aimX: p.x,
      aimY: p.y,
      firing: false,
      autoFire: false,
      wantsSecondary: false,
      team: 0,
      slot: -1,
      ipa: { a: 0.5, p: 0.5, i: 0.5 },
      overdrive: false,
      ai: 'idle',
      targetId: -1,
      thinkAt: this.rng.range(0, 0.5),
      lastSeenX: 0,
      lastSeenY: 0,
      lastSeenAt: -99,
      reactAt: 0,
      strafeDir: 1,
      strafeUntil: 0,
      flowIdx: -1,
      post: null,
      patrol: [],
      patrolIdx: 0,
      panic: 0,
      warnedAt: 0,
      witnessedAt: -99,
      persuadeProgress: 0,
      persuadeTick: -1,
      persuadedBy: -1,
      persuadedAt: -1,
    };
    this.entities.push(e);
    this.byId.set(e.id, e);
    return e;
  }

  get(id: number): Entity | undefined {
    return this.byId.get(id);
  }

  /** Removal is deferred to the end of the tick so spatial-hash indices stay valid. */
  remove(e: Entity): void {
    this.toRemove.add(e.id);
  }

  private flushRemovals(): void {
    if (this.toRemove.size === 0) return;
    this.entities = this.entities.filter((e) => !this.toRemove.has(e.id));
    for (const id of this.toRemove) this.byId.delete(id);
    this.toRemove.clear();
  }

  agents(): Entity[] {
    const out: Entity[] = [];
    for (const id of this.agentIds) {
      const e = this.byId.get(id);
      if (e) out.push(e);
    }
    return out;
  }

  livingAgents(): Entity[] {
    return this.agents().filter((a) => a.alive);
  }

  emit(ev: SimEvent): void {
    this.events.push(ev);
  }

  weapon(e: Entity): WeaponDef | null {
    const id = e.weapons[e.weaponIdx];
    return id ? this.content.weapons[id] : null;
  }

  // ------------------------------------------------------------ spatial hash

  private rebuildGrid(): void {
    for (const b of this.buckets) b.length = 0;
    for (let i = 0; i < this.entities.length; i++) {
      const e = this.entities[i];
      if (!e.alive) continue;
      const gx = Math.min(this.gw - 1, Math.max(0, Math.floor(e.x / CELL)));
      const gy = Math.min(this.gh - 1, Math.max(0, Math.floor(e.y / CELL)));
      this.buckets[gy * this.gw + gx].push(i);
    }
  }

  /** Visits living entities within radius r of (x,y). Uses positions from the start of the tick's grid build. */
  query(x: number, y: number, r: number, fn: (e: Entity, d2: number) => void): void {
    const x0 = Math.max(0, Math.floor((x - r) / CELL));
    const x1 = Math.min(this.gw - 1, Math.floor((x + r) / CELL));
    const y0 = Math.max(0, Math.floor((y - r) / CELL));
    const y1 = Math.min(this.gh - 1, Math.floor((y + r) / CELL));
    const r2 = r * r;
    for (let gy = y0; gy <= y1; gy++) {
      for (let gx = x0; gx <= x1; gx++) {
        for (const i of this.buckets[gy * this.gw + gx]) {
          const e = this.entities[i];
          if (!e || !e.alive) continue;
          const d2 = (e.x - x) ** 2 + (e.y - y) ** 2;
          if (d2 <= r2) fn(e, d2);
        }
      }
    }
  }

  // ------------------------------------------------------------ relations

  isHostile(a: Entity, b: Entity): boolean {
    if (!a.alive || !b.alive || a.faction === b.faction) return false;
    const pair = (f1: Faction, f2: Faction) =>
      (a.faction === f1 && b.faction === f2) || (a.faction === f2 && b.faction === f1);
    if (pair('player', 'enemy')) return true;
    if (pair('player', 'police')) return this.policeHostile;
    return false;
  }

  // ------------------------------------------------------------ violence

  damage(target: Entity, amount: number, sourceId: number): void {
    if (!target.alive) return;
    const src = this.get(sourceId);
    target.hp -= amount * (1 - target.armor);
    target.lastDamagedAt = this.time;
    this.emit({ t: 'hit', x: target.x, y: target.y, target: target.id, damage: amount });

    if (src && src.faction === 'player' && target.faction !== 'player') {
      this.lastViolenceAt = this.time;
      if (target.faction === 'civ') this.heat += 3;
      if (target.faction === 'police') this.heat = Math.max(this.heat, this.content.mission.policeHostileAt + 10);
      if (target.kind === 'agent') return;
    }
    if (target.kind === 'civilian' && target.faction === 'civ') this.panicAt(target, src?.x ?? target.x, src?.y ?? target.y);
    if ((target.faction === 'enemy' || target.faction === 'police') && src && this.isHostile(src, target)) {
      target.ai = 'combat';
      target.targetId = src.id;
      target.lastSeenX = src.x;
      target.lastSeenY = src.y;
      target.lastSeenAt = this.time;
      if (target.faction === 'enemy') this.raiseAlarm();
    }
    if (target.hp <= 0) this.kill(target, sourceId);
  }

  kill(e: Entity, by: number): void {
    if (!e.alive) return;
    e.alive = false;
    e.hp = 0;
    e.deadAt = this.tick;
    e.firing = false;
    e.autoFire = false;
    e.overdrive = false;
    e.path = null;
    e.followId = -1;
    this.emit({ t: 'death', id: e.id, kind: e.kind, x: e.x, y: e.y, by });
    const src = this.get(by);
    const byPlayer = src?.faction === 'player';
    if (e.kind === 'agent') {
      this.stats.agentsLost.push(e.name);
      this.emit({ t: 'bark', id: e.id, text: `Agent ${e.name} has flatlined.`, tone: 'hq' });
    } else if (byPlayer) {
      if (e.kind === 'civilian') {
        this.stats.killsCivilian++;
        this.heat += 10;
      } else if (e.kind === 'police' || e.kind === 'enforcer') {
        this.stats.killsPolice++;
        this.heat += 20;
      } else {
        this.stats.killsEnemy++;
      }
    }
  }

  explode(x: number, y: number, r: number, damage: number, sourceId: number): void {
    this.emit({ t: 'explosion', x, y, r });
    this.query(x, y, r, (e, d2) => {
      const d = Math.sqrt(d2);
      if (d > 0.8 && !this.nav.los(x, y, e.x, e.y)) return;
      const f = Math.pow(1 - d / r, 0.7);
      const nx = d > 0.01 ? (e.x - x) / d : 1;
      const ny = d > 0.01 ? (e.y - y) / d : 0;
      e.vx += nx * 9 * f;
      e.vy += ny * 9 * f;
      this.damage(e, damage * f, sourceId);
    });
    this.noise(x, y, 28, sourceId);
  }

  /** A loud event: panics civilians, alerts rivals, and draws police attention. */
  noise(x: number, y: number, radius: number, sourceId: number): void {
    const src = this.get(sourceId);
    const fromPlayer = src?.faction === 'player';
    if (fromPlayer) this.lastViolenceAt = this.time;
    this.query(x, y, radius * 1.3, (e, d2) => {
      if (e.faction === 'civ' && d2 < radius * radius) this.panicAt(e, x, y);
      if (!fromPlayer || !src) return;
      const hears = d2 < radius * radius * 0.36 || (d2 < radius * radius && this.nav.los(e.x, e.y, x, y));
      if (e.faction === 'enemy' && hears && e.ai !== 'combat' && e.ai !== 'escape') {
        e.ai = 'combat';
        e.targetId = -1;
        e.lastSeenX = x;
        e.lastSeenY = y;
        e.lastSeenAt = this.time;
        this.raiseAlarm();
      }
      if (e.faction === 'police' && d2 < radius * radius && src.witnessedAt < this.time - 1.5) {
        if (this.nav.los(e.x, e.y, x, y)) {
          src.witnessedAt = this.time;
          this.heat += 5;
        }
      }
    });
    const target = this.get(this.targetId);
    if (fromPlayer && target && target.alive && Math.hypot(target.x - x, target.y - y) < radius * 1.5) this.raiseAlarm();
  }

  panicAt(e: Entity, x: number, y: number): void {
    if (e.faction !== 'civ' || !e.alive) return;
    if (e.panic <= 0) {
      e.ai = 'flee';
      e.flowIdx = this.pickFleeExit(x, y, e);
    }
    e.panic = Math.max(e.panic, this.rng.range(8, 13));
    e.lastSeenX = x;
    e.lastSeenY = y;
  }

  pickFleeExit(dx: number, dy: number, e: Entity): number {
    let best = this.flowExits[0];
    let bestScore = -Infinity;
    for (const f of this.flowExits) {
      const t = this.nav.flowTargets[f];
      const away = Math.hypot(t.x - dx, t.y - dy);
      const near = Math.hypot(t.x - e.x, t.y - e.y);
      const score = away - near * 0.6 + this.rng.range(0, 8);
      if (score > bestScore) {
        bestScore = score;
        best = f;
      }
    }
    return best;
  }

  raiseAlarm(): void {
    if (this.alarm) return;
    this.alarm = true;
    this.emit({ t: 'alarm' });
    const target = this.get(this.targetId);
    if (target && target.alive && target.faction === 'enemy') {
      target.ai = 'escape';
      target.path = null;
      this.emit({ t: 'bark', id: target.id, text: 'Voss is running for his limousine. Cut him off!', tone: 'hq' });
    }
  }

  /** Cheap deterministic fingerprint of sim state, for desync checks. */
  checksum(): number {
    let h = this.tick | 0;
    for (const e of this.entities) {
      h = (Math.imul(h, 31) + Math.round(e.x * 100)) | 0;
      h = (Math.imul(h, 31) + Math.round(e.y * 100)) | 0;
      h = (Math.imul(h, 31) + Math.round(e.hp * 10)) | 0;
    }
    return h >>> 0;
  }
}
