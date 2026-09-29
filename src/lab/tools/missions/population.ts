import { agentKit, makeContent } from '../../../content/data.ts';
import type { SpawnDef, SpawnKind } from '../../../sim/content.ts';
import { World } from '../../../sim/world.ts';
import type { MissionDoc } from './doc.ts';

/**
 * Toggles between procedural and explicit placement. Without spawns, the sim places the target,
 * bodyguards, rival pairs, heavies and police by Neon Rain's rules; this runs that placement once
 * and freezes the result into editable spawns. With spawns, it clears them again.
 */
export function bakePopulation(doc: MissionDoc): void {
  const m = doc.mission;
  if (m.spawns?.length) {
    delete m.spawns;
    return;
  }
  const kit = agentKit(0);
  const squad = ['A', 'B', 'C', 'D'].map((name) => ({ ...kit, loadout: [...kit.loadout], name }));
  const world = new World(makeContent({ ...doc.toMission(), spawns: undefined }), squad);
  const counts: Record<string, number> = {};
  const spawns: SpawnDef[] = [];
  for (const e of world.entities) {
    if (e.kind === 'agent' || e.kind === 'civilian') continue;
    const kind: SpawnKind = e.kind === 'rival' && e.name === 'Heavy' ? 'heavy' : (e.kind as SpawnKind);
    counts[kind] = (counts[kind] ?? 0) + 1;
    const s: SpawnDef = { id: kind === 'target' ? 'target' : `${kind}${counts[kind]}`, kind, x: Math.round(e.x * 10) / 10, y: Math.round(e.y * 10) / 10 };
    if (e.name && kind === 'target') s.name = e.name;
    if (e.facing) s.facing = Math.round(e.facing * 100) / 100;
    if (e.post && kind !== 'target') s.holds = true;
    if (e.patrol.length) s.patrol = e.patrol.map((p) => ({ x: Math.round(p.x * 10) / 10, y: Math.round(p.y * 10) / 10 }));
    spawns.push(s);
  }
  m.spawns = spawns;
  m.population = { ...m.population, police: 0, rivals: 0, guards: 0, heavies: 0 };
}
