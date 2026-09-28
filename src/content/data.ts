import { resolveWeapons, type AgentDef, type Content, type MissionDef, type WeaponDef } from '../sim/content.ts';
import agentsRaw from './agents.json';
import weaponsRaw from './weapons.json';

/** Static game content. Kept apart from the mission registry so the Lab can use it without watching mission folders. */
export const weapons: Record<string, WeaponDef> = resolveWeapons(weaponsRaw as Record<string, Partial<WeaponDef>>);

export function makeContent(mission: MissionDef): Content {
  return { weapons, agents: [], mission };
}

export const agentTemplate: Omit<AgentDef, 'name'> = agentsRaw.template;
export const recruitNames: string[] = agentsRaw.recruitNames;
