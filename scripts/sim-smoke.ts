/**
 * Headless sim check: runs each mission with scripted commands twice and verifies both runs produce
 * identical checksums (determinism). Neon Rain must also show real combat (shots and deaths).
 *
 *   node scripts/sim-smoke.ts                 # every bundled mission plus any in content-local/missions
 *   node scripts/sim-smoke.ts synd_01 synd_03 # just these
 *   node scripts/sim-smoke.ts --full          # local missions get the full 150 s too (default 40 s)
 *
 * Neon Rain always runs the full 150 s so its checksum stays comparable between versions.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { kitFor, resolveWeapons, upgradeMission, type AgentDef, type Content, type MissionDef, type RawWeapons } from '../src/sim/content.ts';
import type { Command } from '../src/sim/commands.ts';
import { currentObjective, objectiveTargets } from '../src/sim/systems/objectives.ts';
import { World } from '../src/sim/world.ts';

const root = new URL('..', import.meta.url);
const load = (p: string) => JSON.parse(readFileSync(new URL(p, root), 'utf8'));
const weapons = resolveWeapons(load('src/content/weapons.json') as RawWeapons);
const agentsJson = load('src/content/agents.json');
// Eight missions in: long-range rifle, Uzi, minigun and Persuadertron, so the minigun sits in slot 2.
const kit = kitFor(agentsJson.template.loadout, agentsJson.progression, weapons, 8);
const squad: AgentDef[] = ['Kade', 'Ivo', 'Rhee', 'Mara'].map((name) => ({ name, ...agentsJson.template, ...kit }));

const args = process.argv.slice(2);
const quick = !args.includes('--full');
const only = args.filter((a) => !a.startsWith('--'));
const files: string[] = [];
for (const dir of ['src/content/missions', 'content-local/missions']) {
  const d = new URL(`${dir}/`, root);
  if (!existsSync(d)) continue;
  for (const f of readdirSync(d).filter((n) => n.endsWith('.json')).sort()) files.push(`${dir}/${f}`);
}
const selected = files.filter((f) => !only.length || only.some((o) => f.includes(o)));

/** Where the squad should head: the current objective's first living target, its point, or the extraction. */
function goal(world: World): { x: number; y: number } {
  const o = currentObjective(world);
  if (!o) return world.map.extraction;
  if (o.type === 'eliminate' || o.type === 'persuade') {
    const t = objectiveTargets(world, o).find((e) => e && e.alive);
    if (t) return t;
  }
  if (o.type === 'sweep') {
    const lead = world.livingAgents()[0];
    let best: { x: number; y: number } | null = null;
    let bestD = Infinity;
    for (const e of world.entities) {
      if (!e.alive || !(o.factions ?? ['enemy']).includes(e.faction as 'enemy')) continue;
      const d = lead ? Math.hypot(e.x - lead.x, e.y - lead.y) : 0;
      if (d < bestD) [best, bestD] = [e, d];
    }
    if (best) return best;
  }
  return o.at ?? world.map.extraction;
}

function script(world: World): Command[] {
  const ids = world.agentIds;
  const cmds: Command[] = [];
  const t = world.tick;
  const g = goal(world);
  if (t === 1 || t % 30 === 0) cmds.push({ type: 'move', agents: ids, x: g.x, y: g.y });
  if (t === 1) cmds.push({ type: 'weapon', agents: ids, slot: 2 });
  const lead = world.livingAgents()[0];
  if (!lead) return cmds;
  let threat = null as null | { x: number; y: number; d: number };
  for (const e of world.entities) {
    if (!e.alive || !world.isHostile(lead, e)) continue;
    const d = Math.hypot(e.x - lead.x, e.y - lead.y);
    if (d < 16 && world.nav.los(lead.x, lead.y, e.x, e.y) && (!threat || d < threat.d)) threat = { x: e.x, y: e.y, d };
  }
  const target = world.get(world.targetId);
  if (target?.alive) {
    const td = Math.hypot(target.x - lead.x, target.y - lead.y);
    if (td < 16 && world.nav.los(lead.x, lead.y, target.x, target.y)) threat = { x: target.x, y: target.y, d: td };
  }
  if (threat) cmds.push({ type: 'aim', agents: ids, x: threat.x, y: threat.y, firing: true });
  else cmds.push({ type: 'aim', agents: ids, x: lead.x, y: lead.y, firing: false });
  return cmds;
}

function run(content: Content, ticks: number) {
  const t0 = performance.now();
  const world = new World(content, squad);
  const buildMs = performance.now() - t0;
  const counts: Record<string, number> = {};
  const t1 = performance.now();
  for (let i = 0; i < ticks && world.phase !== 'success' && world.phase !== 'fail'; i++) {
    world.step(script(world));
    for (const ev of world.events) counts[ev.t] = (counts[ev.t] ?? 0) + 1;
  }
  return { world, counts, buildMs, tickMs: (performance.now() - t1) / Math.max(1, world.tick) };
}

let failed = 0;
for (const file of selected) {
  const mission = upgradeMission(load(file) as MissionDef);
  const content: Content = { weapons, agents: [], mission };
  const neon = mission.id === '01_downtown';
  const ticks = quick && !neon ? 30 * 40 : 30 * 150;
  try {
    const a = run(content, ticks);
    const b = run(content, ticks);
    const w = a.world;
    const same = w.checksum() === b.world.checksum() && w.tick === b.world.tick;
    const combat = !!a.counts.shot && !!a.counts.death;
    const ok = same && (!neon || combat);
    if (!ok) failed++;
    console.log(
      `${ok ? 'ok  ' : 'FAIL'} ${mission.id.padEnd(14)} ${`${w.map.w}x${w.map.h}`.padEnd(8)} ${String(w.entities.length).padStart(4)} ents  build ${a.buildMs.toFixed(0).padStart(4)} ms  ${a.tickMs.toFixed(2)} ms/tick  ` +
        `t=${w.tick} ${w.phase}${w.resultReason ? ` (${w.resultReason})` : ''}  shots ${a.counts.shot ?? 0} deaths ${a.counts.death ?? 0}  #${w.checksum()}${same ? '' : ` != #${b.world.checksum()}`}`,
    );
    if (neon && selected.length === 1) console.log('stats', w.stats, 'heat', w.heat.toFixed(1));
  } catch (e) {
    failed++;
    console.log(`FAIL ${mission.id}: ${(e as Error).stack}`);
  }
}
if (failed) {
  console.error(`${failed} mission(s) failed`);
  process.exit(1);
}
