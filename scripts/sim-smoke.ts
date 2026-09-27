/**
 * Headless sim check: runs the mission with scripted commands twice and verifies
 * both runs produce identical checksums (determinism), and that the systems
 * actually do something (movement, combat, deaths, persuasion).
 *
 *   node scripts/sim-smoke.ts
 */
import { readFileSync } from 'node:fs';
import { resolveWeapons, type AgentDef, type Content, type MissionDef, type WeaponDef } from '../src/sim/content.ts';
import type { Command } from '../src/sim/commands.ts';
import { World } from '../src/sim/world.ts';

const load = (p: string) => JSON.parse(readFileSync(new URL(p, import.meta.url), 'utf8'));
const weapons = resolveWeapons(load('../src/content/weapons.json') as Record<string, Partial<WeaponDef>>);
const agentsJson = load('../src/content/agents.json');
const mission = load('../src/content/missions/01_downtown.json') as MissionDef;
const content: Content = { weapons, agents: [], mission };
const squad: AgentDef[] = ['Kade', 'Ivo', 'Rhee', 'Mara'].map((name) => ({ name, ...agentsJson.template }));

function script(world: World): Command[] {
  const ids = world.agentIds;
  const target = world.get(world.targetId)!;
  const cmds: Command[] = [];
  const t = world.tick;
  if (t === 1) cmds.push({ type: 'move', agents: ids, x: target.x, y: target.y });
  if (t % 30 === 0 && target.alive) cmds.push({ type: 'move', agents: ids, x: target.x, y: target.y });
  if (t === 1) cmds.push({ type: 'weapon', agents: ids, slot: 2 });
  const lead = world.livingAgents()[0];
  if (!lead) return cmds;
  let threat = null as null | { x: number; y: number; d: number };
  for (const e of world.entities) {
    if (!e.alive || !world.isHostile(lead, e)) continue;
    const d = Math.hypot(e.x - lead.x, e.y - lead.y);
    if (d < 16 && world.nav.los(lead.x, lead.y, e.x, e.y) && (!threat || d < threat.d)) threat = { x: e.x, y: e.y, d };
  }
  const td = Math.hypot(target.x - lead.x, target.y - lead.y);
  if (target.alive && td < 16 && world.nav.los(lead.x, lead.y, target.x, target.y)) {
    threat = { x: target.x, y: target.y, d: td };
  }
  if (threat) cmds.push({ type: 'aim', agents: ids, x: threat.x, y: threat.y, firing: true });
  else cmds.push({ type: 'aim', agents: ids, x: lead.x, y: lead.y, firing: false });
  if (!target.alive && t % 60 === 0) {
    cmds.push({ type: 'move', agents: ids, x: world.map.extraction.x, y: world.map.extraction.y });
  }
  return cmds;
}

function run(ticks: number) {
  const world = new World(content, squad);
  const counts: Record<string, number> = {};
  const t0 = performance.now();
  for (let i = 0; i < ticks && world.phase !== 'success' && world.phase !== 'fail'; i++) {
    world.step(script(world));
    for (const ev of world.events) counts[ev.t] = (counts[ev.t] ?? 0) + 1;
  }
  const ms = performance.now() - t0;
  return { world, counts, ms };
}

const TICKS = 30 * 150;
const a = run(TICKS);
const b = run(TICKS);
const w = a.world;
console.log('map', w.map.w, 'x', w.map.h, 'buildings', w.map.buildings.length, 'props', w.map.props.length);
console.log('entities', w.entities.length, 'ticks', w.tick, `(${(a.ms / w.tick).toFixed(3)} ms/tick)`);
console.log('phase', w.phase, w.resultReason);
console.log('events', a.counts);
console.log('stats', w.stats, 'heat', w.heat.toFixed(1));
console.log('agents', w.agents().map((e) => `${e.name}:${e.alive ? Math.round(e.hp) : 'KIA'}@${e.x.toFixed(1)},${e.y.toFixed(1)}`).join(' '));
const same = a.world.checksum() === b.world.checksum() && a.world.tick === b.world.tick;
console.log('deterministic', same, a.world.checksum(), b.world.checksum());
if (!same) process.exit(1);
if (!a.counts.shot || !a.counts.death) {
  console.error('Expected combat to happen');
  process.exit(1);
}
