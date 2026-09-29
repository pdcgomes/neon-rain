/** Balance diagnostic: walk the squad toward the plaza (optionally with weapons drawn) and log what happens. */
import { readFileSync } from 'node:fs';
import { resolveWeapons, type AgentDef, type Content, type MissionDef, type WeaponDef } from '../src/sim/content.ts';
import { World } from '../src/sim/world.ts';

const load = (p: string) => JSON.parse(readFileSync(new URL(p, import.meta.url), 'utf8'));
const content: Content = {
  weapons: resolveWeapons(load('../src/content/weapons.json') as Record<string, Partial<WeaponDef>>),
  agents: [],
  mission: load('../src/content/missions/01_downtown.json') as MissionDef,
};
const tpl = load('../src/content/agents.json').template;
const squad: AgentDef[] = ['Kade', 'Ivo', 'Rhee', 'Mara'].map((name) => ({ name, ...tpl }));
const world = new World(content, squad);
const t = world.get(world.targetId)!;
const drawn = process.argv.includes('--drawn');
world.step([
  { type: 'move', agents: world.agentIds, x: t.x - 14, y: t.y + 6 },
  ...(drawn ? [{ type: 'weapon' as const, agents: world.agentIds, slot: 0 }] : []),
]);
const agentSet = new Set(world.agentIds);
for (let i = 0; i < 30 * 30; i++) {
  world.step([]);
  for (const ev of world.events) {
    if (ev.t === 'bark') console.log(`${world.time.toFixed(1)}s [${ev.tone}] ${ev.text}`);
    if (ev.t === 'death' && agentSet.has(ev.id)) console.log(`${world.time.toFixed(1)}s agent died`);
  }
  if (world.livingAgents().length === 0) break;
}
const shooters: Record<string, number> = {};
for (const e of world.entities) if (e.faction !== 'player' && e.ai === 'combat') shooters[e.kind] = (shooters[e.kind] ?? 0) + 1;
console.log('time', world.time.toFixed(1), 'heat', world.heat.toFixed(0), 'hostile', world.policeHostile, 'alarm', world.alarm);
console.log('in combat vs player:', shooters);
console.log('agents', world.agents().map((a) => `${a.name}:${a.alive ? Math.round(a.hp) : 'KIA'}`).join(' '));
