import { weapons } from '../../../content/data.ts';
import { Nav } from '../../../sim/nav.ts';
import type { Vec2 } from '../../../sim/types.ts';
import type { MissionDoc } from './doc.ts';

export interface Issue {
  level: 'error' | 'warn' | 'info';
  text: string;
  at?: Vec2;
}

const UNREACHABLE = 0xffffffff;
const CELL_BUDGET = 160_000;

/** Checks a draft the way the sim will see it: real walkability grid, real flow field from the squad. */
export function validate(doc: MissionDoc): Issue[] {
  const out: Issue[] = [];
  const m = doc.mission;
  const city = doc.city();
  const nav = new Nav(city);
  const flow = nav.addFlowTarget(city.spawn, 'any');
  const reachable = (p: Vec2) => nav.flowDistance(flow, nav.nearestWalkable(p.x, p.y).x, nav.nearestWalkable(p.x, p.y).y) !== UNREACHABLE;
  const blocked = (p: Vec2) => nav.isBlockedAt(p.x, p.y);

  if (city.w * city.h > CELL_BUDGET) out.push({ level: 'warn', text: `Map is ${city.w}×${city.h} m (${Math.round((city.w * city.h) / 1000)}k cells); over ${CELL_BUDGET / 1000}k slows path finding and flow fields. Consider cropping.` });
  if (blocked(city.spawn)) out.push({ level: 'error', text: 'Squad spawn is inside an obstacle.', at: city.spawn });
  if (!reachable(city.extraction)) out.push({ level: 'error', text: 'The extraction VTOL cannot be reached from the squad spawn.', at: city.extraction });
  if (!m.objectives.length) out.push({ level: 'error', text: 'The mission has no objectives.' });

  const spawnIds = new Set((m.spawns ?? []).map((s) => s.id));
  const hasTarget = (m.spawns ?? []).some((s) => s.kind === 'target');
  const usesProcedural = !m.spawns?.length;
  if (usesProcedural) out.push({ level: 'info', text: 'No explicit spawns: the target, guards, rivals and police are placed procedurally (Neon Rain rules).' });

  const crowdInside: Vec2[] = [];
  for (const s of m.spawns ?? []) {
    const crowd = (s.kind === 'civilian' || s.kind === 'police') && !(m.objectives.some((o) => o.targets?.includes(s.id)));
    if (blocked(s) && crowd) crowdInside.push(s);
    else if (blocked(s)) out.push({ level: 'warn', text: `${s.id} (${s.kind}) stands in an obstacle; it will be moved to the nearest free cell.`, at: s });
    else if ((s.kind === 'target' || s.kind === 'guard') && !reachable(s)) out.push({ level: 'warn', text: `${s.id} (${s.kind}) cannot be reached from the squad spawn.`, at: s });
    for (const w of s.weapons ?? []) if (!weapons[w]) out.push({ level: 'error', text: `${s.id} carries unknown weapon "${w}".`, at: s });
    for (const p of s.patrol ?? []) if (blocked(p)) {
      out.push({ level: 'warn', text: `${s.id}'s patrol route crosses an obstacle.`, at: p });
      break;
    }
  }

  if (crowdInside.length)
    out.push({ level: 'info', text: `${crowdInside.length} civilians and police start inside obstacles and will be moved to the nearest free cell.`, at: crowdInside[0] });

  m.objectives.forEach((o, i) => {
    const label = `Objective ${i + 1} (${o.type ?? o.id})`;
    for (const id of o.targets ?? []) if (!spawnIds.has(id)) out.push({ level: 'error', text: `${label} refers to missing spawn "${id}".` });
    const needsTarget = o.type === 'eliminate' || o.type === 'persuade' || o.type === 'protect';
    if (needsTarget && !o.targets?.length && !usesProcedural && !hasTarget) out.push({ level: 'error', text: `${label} has no targets and the mission has no "target" spawn.` });
    if (o.type === 'protect' && o.at && !reachable(o.at)) out.push({ level: 'warn', text: `${label}: the VIP's destination is unreachable.`, at: o.at });
    if ((o.type === 'reach' || o.type === 'extract') && o.at && !reachable(o.at)) out.push({ level: 'error', text: `${label}: its point cannot be reached.`, at: o.at });
    if (o.type === 'reach' && !o.at) out.push({ level: 'warn', text: `${label} has no point; it defaults to the extraction VTOL.` });
    if (o.todo) out.push({ level: 'info', text: `${label}: ${o.todo}` });
  });
  if (!out.some((i) => i.level !== 'info')) out.unshift({ level: 'info', text: 'No problems found.' });
  return out;
}
