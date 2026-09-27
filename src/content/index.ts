import { resolveWeapons, type AgentDef, type Content, type MissionDef, type WeaponDef } from '../sim/content.ts';
import agentsRaw from './agents.json';
import mission01 from './missions/01_downtown.json';
import weaponsRaw from './weapons.json';

export const content: Content = {
  weapons: resolveWeapons(weaponsRaw as Record<string, Partial<WeaponDef>>),
  agents: [],
  mission: mission01 as MissionDef,
};

export const agentTemplate: Omit<AgentDef, 'name'> = agentsRaw.template;
export const recruitNames: string[] = agentsRaw.recruitNames;
