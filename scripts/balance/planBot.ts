/**
 * A hand-authored plan on a real mission: the plan's steps first (routes, splits, holds), then a
 * scripted squad finishes whatever objectives are left. A plan without steps is that squad alone.
 */
import type { Command } from '../../src/sim/commands.ts';
import type { Vec2 } from '../../src/sim/types.ts';
import type { World } from '../../src/sim/world.ts';
import { Bot, type Plan } from './bot.ts';
import { MissionBot } from './missionBot.ts';

export class PlanRunner {
  private readonly steps: Bot;
  private readonly finish: MissionBot;
  private readonly scripted: boolean;

  constructor(world: World, plan: Plan, points: Record<string, Vec2>) {
    this.finish = new MissionBot(world, plan.bot ?? 'expert');
    this.steps = new Bot(world, plan, points, () => this.finish.goal());
    this.scripted = (plan.steps?.length ?? 0) > 0;
  }

  get stepIdx(): number {
    return this.steps.stepIdx;
  }

  commands(): Command[] {
    if (!this.scripted || this.steps.done) return this.finish.commands();
    const cmds = this.steps.commands();
    return this.steps.handingOff ? this.finish.commands() : cmds;
  }
}
