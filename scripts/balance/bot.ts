/**
 * Plays a scenario the way a player would, through the same commands the input layer sends.
 *
 * A plan without steps is a rush: the whole squad walks at the nearest enemy, guns out. A plan with
 * steps moves named teams between waypoints; once the steps run out, each team hunts down whoever
 * is left. Throughout, each team focus-fires (right-click) at the nearest enemy it can see, the way
 * a player clicks on targets; agents that can't see it fall back on auto-fire.
 */
import type { Command } from '../../src/sim/commands.ts';
import { persuadeTargetIds } from '../../src/sim/systems/objectives.ts';
import type { Entity, Vec2 } from '../../src/sim/types.ts';
import type { World } from '../../src/sim/world.ts';
import { IPA_FIGHT, IPA_MAX, IPA_MOVE, type BotName } from './missionBot.ts';

export interface Move {
  team: string;
  to: string;
  /** Holster and stay silent until the enemy raises the alarm. */
  quiet?: boolean;
  /** Keep weapons away even after the alarm (police ignore holstered agents), unless the team is hit. */
  holstered?: boolean;
}

export interface Step {
  /** `to` is a waypoint id, or "goal" for the current objective's target or point. */
  moves: Move[];
  /** Seconds to wait once everyone has arrived. */
  hold?: number;
  /** Then wait until no enemy has been in sight for this many seconds. */
  settle?: number;
  /** Done when the current objective is completed, instead of on arrival. */
  untilObjective?: boolean;
  /** Weapon to switch to for this step. */
  weapon?: string;
  /** Let the finishing squad play until the current objective is done (e.g. a persuasion), then carry on. */
  handOff?: boolean;
  /** IPA for this step, overriding the plan's. */
  ipa?: 'managed' | 'max';
}

export interface Plan {
  /** 'brute' plans should be punished; 'tactic' plans are the intended ways to win. */
  kind: 'brute' | 'tactic';
  about: string;
  /** Weapon to draw (default: the best one carried). */
  weapon?: string;
  /** Loadout to take instead of the default kit (weapons the squad has unlocked). */
  loadout?: string[];
  /** Spawn ids to shoot first whenever they're in sight (a player clicking on the dangerous ones). */
  priority?: string[];
  /** Team name to agent slots (default: everyone in team "all"). */
  teams?: Record<string, number[]>;
  steps?: Step[];
  /** On a real mission: the scripted squad that plays the plan (no steps) or finishes it (after the steps). */
  bot?: BotName;
  /** IPA: "managed" boosts in a fight and eases off otherwise; "max" keeps every bar full. */
  ipa?: 'managed' | 'max';
}

const ARRIVE = 3;
const STEP_TIMEOUT = 90;
/** How far each re-issued move sends a team along its route, like a player clicking ahead. */
const HOP = 25;
export class Bot {
  stepIdx = -1;
  private stepAt = 0;
  private arrivedAt = -1;
  private lastContact = -99;
  private readonly world: World;
  private readonly plan: Plan;
  private readonly points: Record<string, Vec2>;
  private readonly teams: Record<string, number[]>;
  private readonly quiet = new Set<string>();
  private readonly keepHolstered = new Set<string>();
  private readonly goal: () => Vec2;
  private objectiveAt = 0;

  constructor(world: World, plan: Plan, points: Record<string, Vec2>, goal?: () => Vec2) {
    this.world = world;
    this.plan = plan;
    this.points = points;
    this.teams = plan.teams ?? { all: [0, 1, 2, 3] };
    this.goal = goal ?? (() => world.map.extraction);
  }

  /** The current step hands control to the finishing squad. */
  get handingOff(): boolean {
    return !!this.plan.steps?.[this.stepIdx]?.handOff;
  }

  /** All steps played (a plan without steps is never done: it rushes to the end). */
  get done(): boolean {
    const n = this.plan.steps?.length ?? 0;
    return n > 0 && this.stepIdx >= n;
  }

  /** Sends a team toward `p`, one hop along the full route at a time. */
  private moveTo(ms: Entity[], p: Vec2): Command | null {
    if (!ms.length) return null;
    const lead = ms[0];
    let at = p;
    if (Math.hypot(p.x - lead.x, p.y - lead.y) > HOP) {
      const path = this.world.nav.findPath(lead.x, lead.y, p.x, p.y, lead.radius, 400000, 0.4);
      let left = HOP;
      let prev: Vec2 = lead;
      for (const q of path ?? []) {
        const d = Math.hypot(q.x - prev.x, q.y - prev.y);
        if (d >= left) {
          at = { x: prev.x + ((q.x - prev.x) * left) / d, y: prev.y + ((q.y - prev.y) * left) / d };
          break;
        }
        left -= d;
        prev = q;
      }
    }
    return { type: 'move', agents: ms.map((a) => a.id), x: at.x, y: at.y };
  }

  private setIpa(cmds: Command[], a: Entity, v: Record<'a' | 'p' | 'i', number>): void {
    for (const ch of ['a', 'p', 'i'] as const) {
      if (Math.abs(a.ipa[ch] - v[ch]) > 0.01) cmds.push({ type: 'ipa', agents: [a.id], channel: ch, value: v[ch] });
    }
  }

  private members(team: string): Entity[] {
    const out: Entity[] = [];
    for (const slot of this.teams[team] ?? []) {
      const e = this.world.get(this.world.agentIds[slot]);
      if (e && e.alive) out.push(e);
    }
    return out;
  }

  private point(id: string): Vec2 {
    if (id === 'goal') return this.goal();
    const p = this.points[id];
    if (!p) throw new Error(`plan refers to missing waypoint "${id}"`);
    return p;
  }

  /** The step's or plan's weapon, or the best-ranked gun carried. */
  private weaponSlot(a: Entity): number {
    const want = this.plan.steps?.[this.stepIdx]?.weapon ?? this.plan.weapon;
    if (want && a.weapons.includes(want)) return a.weapons.indexOf(want);
    const defs = this.world.content.weapons;
    let best = 0;
    a.weapons.forEach((id, i) => {
      if (defs[id]?.type !== 'persuade' && (defs[id]?.rank ?? -1) > (defs[a.weapons[best]]?.rank ?? -1)) best = i;
    });
    return best;
  }

  private alarmed(): boolean {
    return this.world.alarm || this.world.entities.some((e) => e.alive && e.faction === 'enemy' && e.ai === 'combat');
  }

  private nearestEnemy(from: Vec2): Entity | null {
    let best: Entity | null = null;
    let bestD = Infinity;
    for (const e of this.world.entities) {
      if (!e.alive || e.faction !== 'enemy') continue;
      const d = Math.hypot(e.x - from.x, e.y - from.y);
      if (d < bestD) [best, bestD] = [e, d];
    }
    return best;
  }

  commands(): Command[] {
    const w = this.world;
    const cmds: Command[] = [];
    const steps = this.plan.steps ?? [];

    if (w.tick === 0) {
      for (const a of w.livingAgents()) cmds.push({ type: 'weapon', agents: [a.id], slot: this.weaponSlot(a) });
    }

    // Quiet teams holster until the alarm goes up, then draw; holstered ones until they're hit.
    const alarmed = this.alarmed();
    for (const team of Object.keys(this.teams)) {
      const ms = this.members(team);
      if (!ms.length) continue;
      const hit = ms.some((a) => w.time - a.lastDamagedAt < 2);
      if ((this.quiet.has(team) && !alarmed) || (this.keepHolstered.has(team) && !hit)) {
        if (ms.some((a) => !a.holstered)) cmds.push({ type: 'holster', agents: ms.map((a) => a.id) });
      } else if (ms.some((a) => a.holstered)) {
        for (const a of ms) cmds.push({ type: 'weapon', agents: [a.id], slot: this.weaponSlot(a) });
      }
    }

    // Advance through the plan.
    if (this.stepIdx < steps.length) {
      const step = steps[this.stepIdx];
      if (this.stepIdx < 0 || this.stepDone(step)) {
        this.stepIdx++;
        this.stepAt = w.time;
        this.arrivedAt = -1;
        this.objectiveAt = w.objectiveIdx;
        this.quiet.clear();
        this.keepHolstered.clear();
        const next = steps[this.stepIdx];
        if (next?.weapon) {
          for (const a of w.livingAgents()) if (!a.holstered) cmds.push({ type: 'weapon', agents: [a.id], slot: this.weaponSlot(a) });
        }
        for (const m of next?.moves ?? []) {
          if (m.quiet) this.quiet.add(m.team);
          if (m.holstered) this.keepHolstered.add(m.team);
          const cmd = this.moveTo(this.members(m.team), this.point(m.to));
          if (cmd) cmds.push(cmd);
        }
      } else if (w.tick % 30 === 0) {
        // Re-issue moves for anyone who hasn't made it: the next hop, or a path stalled in a crowd.
        for (const m of step.moves) {
          const ms = this.members(m.team);
          const p = this.point(m.to);
          if (ms.some((a) => Math.hypot(a.x - p.x, a.y - p.y) > ARRIVE)) {
            const cmd = this.moveTo(ms, p);
            if (cmd) cmds.push(cmd);
          }
        }
      }
    } else if (w.tick % 30 === 0) {
      // Out of steps (or a rush): each team walks at the nearest enemy.
      for (const team of Object.keys(this.teams)) {
        const ms = this.members(team);
        if (!ms.length) continue;
        const t = this.nearestEnemy(ms[0]);
        const cmd = t && this.moveTo(ms, t);
        if (cmd) cmds.push(cmd);
      }
    }

    // Focus fire.
    let contact = false;
    for (const team of Object.keys(this.teams)) {
      const ms = this.members(team);
      if (!ms.length || (this.quiet.has(team) && !alarmed)) continue;
      if (this.keepHolstered.has(team) && !ms.some((a) => w.time - a.lastDamagedAt < 2)) continue;
      const t = this.focusTarget(ms);
      if (t) contact = true;
      for (const a of ms) {
        const weapon = w.weapon(a);
        const sees = t && weapon && Math.hypot(t.x - a.x, t.y - a.y) <= weapon.range && w.nav.los(a.x, a.y, t.x, t.y);
        if (sees) cmds.push({ type: 'aim', agents: [a.id], x: t.x, y: t.y, firing: true });
        else if (a.firing) cmds.push({ type: 'aim', agents: [a.id], x: a.aimX, y: a.aimY, firing: false });
      }
    }
    if (contact) this.lastContact = w.time;

    const ipa = this.plan.steps?.[this.stepIdx]?.ipa ?? this.plan.ipa;
    if (ipa) {
      const fighting = w.time - this.lastContact < 3;
      const dose = ipa === 'max' ? IPA_MAX : fighting ? IPA_FIGHT : IPA_MOVE;
      for (const a of w.livingAgents()) this.setIpa(cmds, a, dose);
    }
    return cmds;
  }

  /** The plan's priority targets if any member can see and reach one, else the nearest enemy that one can. */
  private focusTarget(ms: Entity[]): Entity | null {
    const w = this.world;
    const priority = new Set((this.plan.priority ?? []).map((id) => w.spawnIds.get(id)));
    let best: Entity | null = null;
    let bestScore = Infinity;
    const spare = persuadeTargetIds(w);
    for (const e of w.entities) {
      if (!e.alive || e.faction !== 'enemy' || spare.has(e.id)) continue;
      for (const a of ms) {
        const weapon = w.weapon(a);
        const d = Math.hypot(e.x - a.x, e.y - a.y);
        const score = d - (priority.has(e.id) ? 1000 : 0);
        if (!weapon || d > weapon.range || score >= bestScore || !w.nav.los(a.x, a.y, e.x, e.y)) continue;
        if (weapon.pierce && this.wouldPierce(a, e, weapon.range)) continue;
        [best, bestScore] = [e, score];
      }
    }
    return best;
  }

  /** Would a piercing shot from `a` through `t` go on to hit someone the squad needs alive? */
  private wouldPierce(a: Entity, t: Entity, range: number): boolean {
    const w = this.world;
    const d = Math.hypot(t.x - a.x, t.y - a.y) || 1;
    const ux = (t.x - a.x) / d;
    const uy = (t.y - a.y) / d;
    const keep = [...persuadeTargetIds(w)].map((id) => w.get(id)).concat(w.entities.filter((e) => e.alive && e.faction === 'player' && e.kind !== 'agent'));
    return keep.some((k) => {
      if (!k?.alive) return false;
      const along = (k.x - a.x) * ux + (k.y - a.y) * uy;
      const off = Math.abs((k.x - a.x) * uy - (k.y - a.y) * ux);
      return along > 0 && along <= range && off < k.radius + 0.5;
    });
  }

  private stepDone(step: Step): boolean {
    const w = this.world;
    if (w.time - this.stepAt > STEP_TIMEOUT) return true;
    if (step.untilObjective || step.handOff) return w.objectiveIdx > this.objectiveAt;
    if (this.arrivedAt < 0) {
      const arrived = step.moves.every((m) => {
        const p = this.point(m.to);
        const [lead, ...rest] = this.members(m.team);
        const d = (a: Entity) => Math.hypot(a.x - p.x, a.y - p.y);
        return !lead || (d(lead) <= ARRIVE && rest.every((a) => d(a) <= ARRIVE + 2 * a.followRank));
      });
      if (!arrived) return false;
      this.arrivedAt = w.time;
    }
    if (w.time - this.arrivedAt < (step.hold ?? 0)) return false;
    if (step.settle !== undefined && w.time - this.lastContact < step.settle) return false;
    return true;
  }
}
