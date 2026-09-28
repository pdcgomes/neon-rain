import type { MissionDef } from '../../../sim/content.ts';

export type MissionSource = 'bundled' | 'local';

export interface MissionListing {
  id: string;
  source: MissionSource;
  codename: string;
  city: string;
  kind: 'authored' | 'procedural';
  size: number;
  mtime: number;
  objectives: string[];
}

async function ok(res: Response): Promise<Response> {
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
  return res;
}

/** True when the dev server's mission endpoints are available (not in a static build). */
export async function hasBackend(): Promise<boolean> {
  try {
    const r = await fetch('/__lab/missions');
    return r.ok && (r.headers.get('content-type') ?? '').includes('json');
  } catch {
    return false;
  }
}

export async function listMissions(): Promise<MissionListing[]> {
  const r = await ok(await fetch('/__lab/missions'));
  return (await r.json()) as MissionListing[];
}

export async function loadMissionFile(id: string, source: MissionSource): Promise<MissionDef> {
  const r = await ok(await fetch(`/__lab/mission?id=${encodeURIComponent(id)}&source=${source}`));
  return (await r.json()) as MissionDef;
}

export async function saveMissionFile(mission: MissionDef, source: MissionSource): Promise<string> {
  const r = await ok(
    await fetch(`/__lab/mission?id=${encodeURIComponent(mission.id)}&source=${source}`, { method: 'POST', body: JSON.stringify(mission) }),
  );
  return ((await r.json()) as { path: string }).path;
}

export async function deleteMissionFile(id: string, source: MissionSource): Promise<void> {
  await ok(await fetch(`/__lab/mission-delete?id=${encodeURIComponent(id)}&source=${source}`, { method: 'POST' }));
}

export async function promoteMission(id: string): Promise<string> {
  const r = await ok(await fetch(`/__lab/mission-promote?id=${encodeURIComponent(id)}`, { method: 'POST' }));
  return ((await r.json()) as { path: string }).path;
}

/** Static-build fallback: hand the mission to the user as a file. */
export function downloadMission(mission: MissionDef): void {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([JSON.stringify(mission, null, 2)], { type: 'application/json' }));
  a.download = `${mission.id}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
