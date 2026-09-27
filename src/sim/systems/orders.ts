import type { Command } from '../commands.ts';
import type { Entity } from '../types.ts';
import type { World } from '../world.ts';

function ownAgents(world: World, ids: number[]): Entity[] {
  const out: Entity[] = [];
  for (const id of ids) {
    const e = world.get(id);
    if (e && e.alive && e.kind === 'agent') out.push(e);
  }
  return out.sort((a, b) => a.slot - b.slot);
}

export function applyCommand(world: World, cmd: Command): void {
  const agents = ownAgents(world, cmd.agents);
  if (agents.length === 0) return;

  switch (cmd.type) {
    case 'move': {
      const [leader, ...rest] = agents;
      leader.followId = -1;
      leader.path = world.nav.findPath(leader.x, leader.y, cmd.x, cmd.y, leader.radius);
      leader.pathIdx = 0;
      leader.stuckTicks = 0;
      leader.moveTarget = { x: cmd.x, y: cmd.y };
      if (leader.trail.length === 0) leader.trail.push(leader.x, leader.y);
      rest.forEach((a, i) => {
        a.followId = leader.id;
        a.followRank = i + 1;
        a.path = null;
      });
      break;
    }
    case 'aim': {
      for (const a of agents) {
        a.aimX = cmd.x;
        a.aimY = cmd.y;
        a.firing = cmd.firing;
        if (cmd.firing) a.holstered = false;
      }
      break;
    }
    case 'secondary': {
      const thrower = agents.find((a) => a.grenades > 0);
      if (thrower) {
        thrower.wantsSecondary = true;
        thrower.aimX = cmd.x;
        thrower.aimY = cmd.y;
      }
      break;
    }
    case 'weapon': {
      for (const a of agents) {
        if (cmd.slot >= 0 && cmd.slot < a.weapons.length) {
          a.weaponIdx = cmd.slot;
          a.holstered = false;
          a.spin = 0;
        }
      }
      break;
    }
    case 'cycleWeapon': {
      for (const a of agents) {
        a.weaponIdx = (a.weaponIdx + 1) % a.weapons.length;
        a.holstered = false;
        a.spin = 0;
      }
      break;
    }
    case 'holster': {
      const drawn = agents.some((a) => !a.holstered);
      for (const a of agents) {
        a.holstered = drawn;
        if (drawn) a.firing = false;
      }
      break;
    }
    case 'team': {
      for (const a of agents) a.team = cmd.team;
      // Anyone following an agent that is now on another team stops following.
      for (const a of world.agents()) {
        const leader = world.get(a.followId);
        if (leader && leader.kind === 'agent' && leader.team !== a.team) {
          a.followId = -1;
          a.path = null;
        }
      }
      break;
    }
    case 'ipa': {
      const v = Math.max(0, Math.min(1, cmd.value));
      for (const a of agents) a.ipa[cmd.channel] = v;
      break;
    }
    case 'overdrive': {
      for (const a of agents) a.overdrive = cmd.active && a.hp > 25;
      break;
    }
  }
}
