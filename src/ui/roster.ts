import { agentKit, recruitNames } from '../content/index.ts';
import type { AgentDef } from '../sim/content.ts';

const KEY = 'syndicate-reborn.save.v1';

export interface RosterAgent {
  name: string;
  missions: number;
  kills: number;
}

export interface FallenAgent {
  name: string;
  mission: string;
  date: string;
  missions: number;
  kills: number;
}

export interface Save {
  roster: RosterAgent[];
  fallen: FallenAgent[];
  nextRecruit: number;
  runs: number;
  wins: number;
}

function fresh(): Save {
  return { roster: [], fallen: [], nextRecruit: 0, runs: 0, wins: 0 };
}

export function loadSave(): Save {
  let s: Save;
  try {
    s = { ...fresh(), ...JSON.parse(localStorage.getItem(KEY) ?? '{}') };
  } catch {
    s = fresh();
  }
  while (s.roster.length < 4) {
    const i = s.nextRecruit++;
    const base = recruitNames[i % recruitNames.length];
    const gen = Math.floor(i / recruitNames.length);
    s.roster.push({ name: gen ? `${base} ${['II', 'III', 'IV', 'V', 'VI'][Math.min(4, gen - 1)]}` : base, missions: 0, kills: 0 });
  }
  return s;
}

export function storeSave(s: Save): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* storage unavailable: progress is session-only */
  }
}

/** The squad for the next mission, kitted out with everything the syndicate's wins have unlocked. */
export function squadFromSave(s: Save): AgentDef[] {
  const kit = agentKit(s.wins);
  return s.roster.slice(0, 4).map((r) => ({ ...kit, loadout: [...kit.loadout], name: r.name }));
}

/** Applies a finished mission to the persistent roster. Returns the agents who fell this mission. */
export function recordMission(
  s: Save,
  mission: string,
  success: boolean,
  outcome: { name: string; alive: boolean; kills: number }[],
): FallenAgent[] {
  s.runs++;
  if (success) s.wins++;
  const fallen: FallenAgent[] = [];
  const date = new Date().toISOString().slice(0, 10);
  for (const o of outcome) {
    const r = s.roster.find((x) => x.name === o.name);
    if (!r) continue;
    r.kills += o.kills;
    r.missions++;
    if (!o.alive) {
      const f = { name: r.name, mission, date, missions: r.missions, kills: r.kills };
      fallen.push(f);
      s.fallen.unshift(f);
      s.roster = s.roster.filter((x) => x !== r);
    }
  }
  storeSave(s);
  return fallen;
}
