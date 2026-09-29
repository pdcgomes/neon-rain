/**
 * Scripted squads that play whole missions through the normal command stream.
 *
 *   rush     group mode, best gun out, walk at the objective and shoot whatever is in the way
 *   panic    a rush with every IPA bar at maximum (the original's Panic Mode)
 *   careful  moves holstered in short bounds; on contact each agent takes the best cover spot
 *            nearby that still has a shot, wounded agents break line of sight, and the squad only
 *            moves on once nothing has been in sight for a few seconds
 *   expert   careful, plus IPA management: rested while moving, boosted in a fight
 *
 * Every style persuades a persuasion target when it gets close, and otherwise heads for the
 * current objective: its target, its point, or the extraction.
 */
import type { Command } from '../../src/sim/commands.ts';
import { currentObjective, objectiveTargets, persuadeTargetIds } from '../../src/sim/systems/objectives.ts';
import { coverAt, roundsLeft } from '../../src/sim/systems/combat.ts';
import type { WeaponDef } from '../../src/sim/content.ts';
import type { Entity, Ipa, Vec2 } from '../../src/sim/types.ts';
import type { World } from '../../src/sim/world.ts';

export const BOTS = ['rush', 'panic', 'careful', 'expert'] as const;
export type BotName = (typeof BOTS)[number];

/** How far ahead a rushing squad is sent with each click. */
const HOP = 25;
/** How far ahead the careful squad bounds before stopping to look. */
const BOUND = 12;
/** Enemies inside this range with line of sight count as contact. */
const CONTACT = 24;
/** Seconds without anything in sight before a careful squad moves on. */
const CLEAR_AFTER = 3;
const WOUNDED = 0.35;
/** Seconds in contact with nobody in reach before a careful squad presses forward, and how far. */
const PRESS_AFTER = 5;
const PRESS_BOUND = 6;

type IpaSet = Record<keyof Ipa, number>;
export const IPA_REST: IpaSet = { a: 0.35, p: 0.35, i: 0.35 };
export const IPA_MOVE: IpaSet = { a: 0.6, p: 0.5, i: 0.5 };
export const IPA_FIGHT: IpaSet = { a: 0.75, p: 0.95, i: 0.9 };
export const IPA_MAX: IpaSet = { a: 1, p: 1, i: 1 };

export class MissionBot {
  readonly name: BotName;
  private readonly world: World;
  private cmds: Command[] = [];
  private contact = false;
  private lastSeen = -99;
  private boundAt: Vec2 | null = null;
  private nextThink = 0;
  private lastInRange = -99;
  private spare: Set<number> | null = null;

  constructor(world: World, name: BotName) {
    this.world = world;
    this.name = name;
  }

  get inContact(): boolean {
    return this.contact;
  }

  private get careful(): boolean {
    return this.name === 'careful' || this.name === 'expert';
  }

  commands(): Command[] {
    const w = this.world;
    this.cmds = [];
    this.spare = null;
    const squad = w.livingAgents();
    if (!squad.length) return this.cmds;

    if (w.tick === 0 && this.name === 'panic') for (const a of squad) this.setIpa(a, IPA_MAX);

    const hostiles = this.visibleHostiles(squad);
    if (hostiles.length) this.lastSeen = w.time;
    const wasContact = this.contact;
    this.contact = this.careful ? w.time - this.lastSeen < CLEAR_AFTER : hostiles.length > 0;

    const persuader = this.persuade(squad);
    const think = w.time >= this.nextThink;
    if (think) this.nextThink = w.time + 1;

    const fleeing = this.fleeingTarget();
    if (!this.careful || fleeing) {
      if (think) this.move(squad.filter((a) => a !== persuader), fleeing ?? this.goal());
      for (const a of squad) if (a !== persuader) this.draw(a);
    } else if (!this.contact) {
      if (wasContact) this.boundAt = null;
      if (think) this.advance(squad.filter((a) => a !== persuader));
      for (const a of squad) {
        if (a === persuader) continue;
        if (w.alarm || w.policeHostile) this.draw(a);
        else this.holster(a);
        if (this.name === 'expert') this.setIpa(a, w.time - this.lastSeen > 10 ? IPA_REST : IPA_MOVE);
      }
    } else {
      const fighters = squad.filter((a) => a !== persuader);
      if (this.inRange(fighters, hostiles)) this.lastInRange = w.time;
      if (think) {
        // Enemies that stay out of reach (posted guards) have to be pressed, a short bound at a time.
        const threat = nearest(fighters[0] ?? squad[0], hostiles);
        if (threat && w.time - this.lastInRange > PRESS_AFTER) {
          this.move(fighters, threat, PRESS_BOUND);
          this.lastInRange = w.time;
        } else this.takeCover(fighters, hostiles);
      }
      for (const a of squad) {
        if (a === persuader) continue;
        this.draw(a);
        if (this.name === 'expert') this.setIpa(a, IPA_FIGHT);
      }
    }

    this.fireAll(squad.filter((a) => a !== persuader));
    return this.cmds;
  }

  // ------------------------------------------------------------------ goals

  /** Where the squad should head: the current objective's first living target, its point, or the extraction. */
  goal(): Vec2 {
    const w = this.world;
    const o = currentObjective(w);
    if (!o) return w.map.extraction;
    if (o.type === 'eliminate' || o.type === 'persuade' || o.type === 'protect') {
      const t = objectiveTargets(w, o).find((e) => e && e.alive && e.faction !== 'player');
      if (t) return t;
    }
    if (o.type === 'sweep') {
      const lead = w.livingAgents()[0];
      let best: Entity | null = null;
      let bestD = Infinity;
      for (const e of w.entities) {
        if (!e.alive || !(o.factions ?? ['enemy']).includes(e.faction as 'enemy')) continue;
        const d = Math.hypot(e.x - lead.x, e.y - lead.y);
        if (d < bestD) [best, bestD] = [e, d];
      }
      if (best) return best;
    }
    return o.at ?? w.map.extraction;
  }

  /** An assassination target making a run for it: even a careful squad has to chase. */
  private fleeingTarget(): Entity | null {
    const w = this.world;
    const o = currentObjective(w);
    if (o?.type !== 'eliminate') return null;
    return objectiveTargets(w, o).find((e) => e && e.alive && e.ai === 'escape') ?? null;
  }

  /** The agent nearest a persuasion target walks up and uses the Persuadertron on it. */
  private persuade(squad: Entity[]): Entity | null {
    const w = this.world;
    const o = currentObjective(w);
    if (o?.type !== 'persuade') return null;
    const t = objectiveTargets(w, o).find((e) => e && e.alive && e.faction !== 'player');
    if (!t) return null;
    const slot = (a: Entity) => a.weapons.indexOf('persuadertron');
    const a = squad.filter((x) => slot(x) >= 0).sort((x, y) => Math.hypot(x.x - t.x, x.y - t.y) - Math.hypot(y.x - t.x, y.y - t.y))[0];
    if (!a) return null;
    const range = w.content.weapons.persuadertron?.range ?? 8;
    const d = Math.hypot(a.x - t.x, a.y - t.y);
    if (d > range * 0.8 || !w.nav.los(a.x, a.y, t.x, t.y)) return null;
    if (a.weaponIdx !== slot(a) || a.holstered) this.cmds.push({ type: 'weapon', agents: [a.id], slot: slot(a) });
    this.cmds.push({ type: 'aim', agents: [a.id], x: t.x, y: t.y, firing: true });
    return a;
  }

  // ------------------------------------------------------------------ movement

  /** Group move toward `to`, one hop at a time, the way a player clicks a screen or so ahead. */
  private move(agents: Entity[], to: Vec2, hop = HOP): void {
    if (!agents.length) return;
    const at = this.along(agents[0], to, hop);
    this.cmds.push({ type: 'move', agents: agents.map((a) => a.id), x: at.x, y: at.y });
  }

  /** The point `dist` metres along the full route from `from` to `to` (or `to` itself if closer). */
  private along(from: Vec2, to: Vec2, dist: number): Vec2 {
    if (Math.hypot(to.x - from.x, to.y - from.y) <= dist) return to;
    const path = this.world.nav.findPath(from.x, from.y, to.x, to.y, 0.34, 400000, 0.4);
    if (!path) return to;
    let left = dist;
    let prev: Vec2 = from;
    for (const p of path) {
      const d = Math.hypot(p.x - prev.x, p.y - prev.y);
      if (d >= left) return { x: prev.x + ((p.x - prev.x) * left) / d, y: prev.y + ((p.y - prev.y) * left) / d };
      left -= d;
      prev = p;
    }
    return to;
  }

  /** Bounds toward the goal: walk BOUND metres along the route, stop, look, repeat. */
  private advance(agents: Entity[]): void {
    const lead = agents[0];
    if (!lead) return;
    if (this.boundAt && Math.hypot(lead.x - this.boundAt.x, lead.y - this.boundAt.y) > 2.5 && lead.path) return;
    this.boundAt = this.along(lead, this.goal(), BOUND);
    this.cmds.push({ type: 'move', agents: agents.map((a) => a.id), x: this.boundAt.x, y: this.boundAt.y });
  }

  /**
   * Each agent picks the spot within a few metres that keeps a shot on the nearest threat while
   * hiding the most of its body; wounded agents pick the nearest spot out of its sight instead.
   */
  private takeCover(agents: Entity[], hostiles: Entity[]): void {
    const w = this.world;
    const taken: Vec2[] = [];
    for (const a of agents) {
      const threat = nearest(a, hostiles.length ? hostiles : this.knownHostiles());
      if (!threat) continue;
      const weapon = w.weapon(a);
      const range = (weapon?.range ?? 15) * 0.9;
      const wounded = a.hp < a.maxHp * WOUNDED;
      const here = Math.hypot(threat.x - a.x, threat.y - a.y);
      const hasShot = here <= range && w.nav.los(a.x, a.y, threat.x, threat.y);
      let best: Vec2 | null = null;
      let bestScore = -Infinity;
      for (let oy = -5; oy <= 5; oy++) {
        for (let ox = -5; ox <= 5; ox++) {
          const x = a.x + ox;
          const y = a.y + oy;
          const move = Math.hypot(ox, oy);
          if (move > 5 || w.nav.circleBlocked(x, y, a.radius)) continue;
          if (taken.some((p) => Math.hypot(p.x - x, p.y - y) < 1.2)) continue;
          const d = Math.hypot(threat.x - x, threat.y - y);
          const sees = w.nav.los(x, y, threat.x, threat.y);
          let score: number;
          if (wounded) score = sees ? -100 - move : 50 - move;
          else {
            // Hold ground: let them come, don't creep toward them spot by spot.
            if (!sees || d > range || (hasShot && d < here - 0.5)) continue;
            score = coverAt(w, x, y, a.radius, (x - threat.x) / d, (y - threat.y) / d) * 10 - move * 0.6;
          }
          if (score > bestScore) [best, bestScore] = [{ x, y }, score];
        }
      }
      if (!best) {
        // No spot with a shot: hold where it is rather than keep walking into the fight.
        if (a.path) this.cmds.push({ type: 'move', agents: [a.id], x: a.x, y: a.y });
        continue;
      }
      taken.push(best);
      if (Math.hypot(best.x - a.x, best.y - a.y) > 0.8) this.cmds.push({ type: 'move', agents: [a.id], x: best.x, y: best.y });
    }
  }

  // ------------------------------------------------------------------ weapons

  /** Close-range guns when someone is close, otherwise the best-ranked gun carried. */
  private draw(a: Entity): void {
    const w = this.world;
    const guns = a.weapons.map((id, slot) => ({ id, slot, def: w.content.weapons[id] })).filter((g) => g.def && g.def.type !== 'persuade' && g.def.type !== 'grenade');
    if (!guns.length) return;
    const near = this.nearestThreat(a);
    const d = near ? Math.hypot(near.x - a.x, near.y - a.y) : Infinity;
    const usable = guns.filter((g) => (g.def.ammo <= 0 || roundsLeft(a, g.id, g.def) > 0) && g.def.range >= Math.min(d, 12));
    const pool = usable.length ? usable : guns;
    const best = pool.reduce((x, y) => (rank(y.def, d) > rank(x.def, d) ? y : x));
    // Keep the gun in hand while it still reaches, rather than swapping every time the range changes.
    const current = pool.find((g) => g.slot === a.weaponIdx);
    const keep = current && !a.holstered && current.def.range >= d && rank(best.def, d) - rank(current.def, d) < 4;
    if (!keep && (a.holstered || a.weaponIdx !== best.slot)) this.cmds.push({ type: 'weapon', agents: [a.id], slot: best.slot });
  }

  private nearestThreat(a: Entity): Entity | null {
    let best: Entity | null = null;
    let bestD = Infinity;
    for (const e of this.world.entities) {
      if (!this.isThreat(a, e)) continue;
      const d = Math.hypot(e.x - a.x, e.y - a.y);
      if (d < bestD) [best, bestD] = [e, d];
    }
    return best;
  }

  private holster(a: Entity): void {
    if (!a.holstered) this.cmds.push({ type: 'holster', agents: [a.id] });
  }

  /**
   * The player has one mouse. In group mode (rush, panic) every agent fires at the one target
   * the player clicks; careful players steer only their lead agent's fire and leave the others to
   * fight on their own, which is where IPA levels decide how well they do.
   */
  private fireAll(squad: Entity[]): void {
    const group = !this.careful;
    const lead = squad[0];
    const focus = group ? this.focusTarget(squad) : null;
    for (const a of squad) {
      const weapon = this.world.weapon(a);
      const t = group ? focus : a === lead ? this.nearestShot(a) : null;
      const ok = t && weapon && weapon.type !== 'persuade' && !a.holstered && Math.hypot(t.x - a.x, t.y - a.y) <= weapon.range && this.world.nav.los(a.x, a.y, t.x, t.y);
      if (ok) this.cmds.push({ type: 'aim', agents: [a.id], x: t.x, y: t.y, firing: true });
      else if (a.firing) this.cmds.push({ type: 'aim', agents: [a.id], x: a.aimX, y: a.aimY, firing: false });
    }
  }

  private shootable(a: Entity, e: Entity): boolean {
    this.spare ??= persuadeTargetIds(this.world);
    return e.alive && this.world.isHostile(a, e) && !this.spare.has(e.id);
  }

  /** The hostile nearest the agent that it can see and reach. */
  private nearestShot(a: Entity): Entity | null {
    const w = this.world;
    const weapon = w.weapon(a);
    if (!weapon || weapon.type === 'persuade') return null;
    let best: Entity | null = null;
    let bestD = weapon.range;
    for (const e of w.entities) {
      if (!this.shootable(a, e)) continue;
      const d = Math.hypot(e.x - a.x, e.y - a.y);
      if (d <= bestD && w.nav.los(a.x, a.y, e.x, e.y)) [best, bestD] = [e, d];
    }
    return best;
  }

  /** Group mode's click: the hostile nearest the squad that at least one agent can hit. */
  private focusTarget(squad: Entity[]): Entity | null {
    let best: Entity | null = null;
    let bestD = Infinity;
    for (const a of squad) {
      const t = this.nearestShot(a);
      if (!t) continue;
      const d = Math.hypot(t.x - a.x, t.y - a.y);
      if (d < bestD) [best, bestD] = [t, d];
    }
    return best;
  }

  private setIpa(a: Entity, v: IpaSet): void {
    for (const ch of ['a', 'p', 'i'] as const) {
      if (Math.abs(a.ipa[ch] - v[ch]) > 0.01) this.cmds.push({ type: 'ipa', agents: [a.id], channel: ch, value: v[ch] });
    }
  }

  // ------------------------------------------------------------------ perception

  /** Can anyone in the squad shoot one of these hostiles right now? */
  private inRange(agents: Entity[], hostiles: Entity[]): boolean {
    const w = this.world;
    return agents.some((a) => {
      const r = w.weapon(a)?.range ?? 0;
      return hostiles.some((e) => Math.hypot(e.x - a.x, e.y - a.y) <= r && w.nav.los(a.x, a.y, e.x, e.y));
    });
  }

  private isThreat(a: Entity, e: Entity): boolean {
    return e.alive && this.world.isHostile(a, e) && e.weapons.length > 0;
  }

  private visibleHostiles(squad: Entity[]): Entity[] {
    const w = this.world;
    const out: Entity[] = [];
    for (const e of w.entities) {
      if (!e.alive || e.faction === 'player' || e.faction === 'civ') continue;
      if (squad.some((a) => this.isThreat(a, e) && Math.hypot(e.x - a.x, e.y - a.y) < CONTACT && w.nav.los(a.x, a.y, e.x, e.y))) out.push(e);
    }
    return out;
  }

  private knownHostiles(): Entity[] {
    const lead = this.world.livingAgents()[0];
    return this.world.entities.filter((e) => lead && this.isThreat(lead, e) && e.ai === 'combat');
  }
}

/** How much a player would want this gun at distance `d`: rank, with short-range guns favoured up close. */
function rank(w: WeaponDef, d: number): number {
  const close = w.range <= 12 && d <= w.range * 0.8 ? 6 : 0;
  return (w.rank < 0 ? 0 : w.rank === 0 ? 5.5 : w.rank) + close;
}

function nearest(a: Vec2, list: Entity[]): Entity | null {
  let best: Entity | null = null;
  let bestD = Infinity;
  for (const e of list) {
    const d = Math.hypot(e.x - a.x, e.y - a.y);
    if (d < bestD) [best, bestD] = [e, d];
  }
  return best;
}
