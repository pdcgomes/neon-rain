/** Content and knob overrides shared by the balance harness and its workers. */
import { readFileSync } from 'node:fs';
import { balance, BALANCE_DEFAULTS } from '../../src/sim/balance.ts';
import { kitFor, resolveWeapons, type AgentDef, type ProgressionDef, type RawWeapons, type WeaponDef } from '../../src/sim/content.ts';

const root = new URL('../../', import.meta.url);
export const load = (p: string) => JSON.parse(readFileSync(new URL(p, root), 'utf8'));
const baseWeapons = load('src/content/weapons.json') as RawWeapons;
const agentsJson = load('src/content/agents.json');
const baseTemplate = agentsJson.template as Omit<AgentDef, 'name'>;
const progression = agentsJson.progression as ProgressionDef;

export type Overrides = [string, string][];

export interface Config {
  weapons: Record<string, WeaponDef>;
  squad: AgentDef[];
}

/**
 * Resets the balance knobs and builds content with the overrides applied. Keys are fields of
 * `balance`, `<weapon>.<field>` for weapons.json, or `agent.<field>` for the agent template.
 * The squad gets the kit a syndicate has after `wins` missions (see `kitFor`), unless
 * `agent.loadout` or `agent.chest` say otherwise.
 */
export function configure(overrides: Overrides, wins = 0): Config {
  Object.assign(balance, BALANCE_DEFAULTS);
  const raw = structuredClone(baseWeapons);
  const kit = kitFor(baseTemplate.loadout, progression, resolveWeapons(raw), wins);
  const template = { ...structuredClone(baseTemplate), ...kit } as Record<string, unknown>;
  const weapons = raw;
  for (const [key, raw] of overrides) {
    const num = Number(raw);
    if (key in balance) {
      if (Number.isNaN(num)) throw new Error(`${key} needs a number`);
      (balance as Record<string, number>)[key] = num;
    } else if (key.startsWith('agent.')) {
      const field = key.slice(6);
      template[field] = field === 'loadout' ? raw.split('+') : num;
    } else if (key.includes('.') && weapons[key.split('.')[0]]) {
      const [id, field] = key.split('.');
      (weapons[id] as Record<string, unknown>)[field] = Number.isNaN(num) ? raw : num;
    } else throw new Error(`unknown knob "${key}" (see src/sim/balance.ts, weapons.json, agents.json)`);
  }
  const squad = ['Kade', 'Ivo', 'Rhee', 'Mara'].map((name) => ({ name, ...template }) as AgentDef);
  return { weapons: resolveWeapons(weapons), squad };
}

export const describe = (o: Overrides) => (o.length ? o.map(([k, v]) => `${k}=${v}`).join(' ') : 'defaults');
