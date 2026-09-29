import { upgradeMission, type MissionDef } from '../sim/content.ts';

export { agentKit, agentTemplate, makeContent, recruitNames, weapons } from './data.ts';

export interface MissionEntry {
  id: string;
  /** 'bundled' ships with the game; 'local' lives in the gitignored content-local/ folder (dev only). */
  source: 'bundled' | 'local';
  load(): Promise<MissionDef>;
}

const bundled = import.meta.glob<MissionDef>('./missions/*.json', { import: 'default' });
const idOf = (path: string) => path.split('/').pop()!.replace(/\.json$/, '');

export const DEFAULT_MISSION = '01_downtown';

/**
 * Every playable mission. Local missions (converted from original data, or Lab drafts) come from the
 * dev server's /__lab endpoints, so they never enter a production build or trigger dev reloads.
 */
export async function listMissions(): Promise<MissionEntry[]> {
  const out: MissionEntry[] = Object.entries(bundled).map(([p, load]) => ({ id: idOf(p), source: 'bundled' as const, load }));
  if (import.meta.env.DEV) {
    try {
      const res = await fetch('/__lab/missions');
      const list = (await res.json()) as { id: string; source: string }[];
      for (const m of list.filter((x) => x.source === 'local').sort((a, b) => a.id.localeCompare(b.id)))
        out.push({ id: m.id, source: 'local', load: async () => (await fetch(`/__lab/mission?id=${m.id}&source=local`)).json() as Promise<MissionDef> });
    } catch {
      /* no dev endpoints: bundled missions only */
    }
  }
  return out;
}

export async function loadMission(list: MissionEntry[], id: string): Promise<MissionDef> {
  const entry = list.find((m) => m.id === id) ?? list.find((m) => m.id === DEFAULT_MISSION) ?? list[0];
  return upgradeMission(structuredClone(await entry.load()));
}
