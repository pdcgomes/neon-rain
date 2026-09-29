import type { Recording } from '../sim/telemetry.ts';

const KEY = 'syndicate-reborn.telemetry';

/** Telemetry is off unless switched on in the briefing (or with ?telemetry=1 in the URL). */
export function telemetryEnabled(): boolean {
  const q = new URLSearchParams(location.search).get('telemetry');
  if (q !== null) return q !== '0';
  try {
    return localStorage.getItem(KEY) === '1';
  } catch {
    return false;
  }
}

export function setTelemetry(on: boolean): void {
  try {
    localStorage.setItem(KEY, on ? '1' : '0');
  } catch {
    /* storage unavailable: the setting lasts for this page only */
  }
}

/**
 * Saves a recording: to content-local/telemetry/ through the dev server, or as a download when
 * there is no dev server (a production build).
 */
export async function saveRecording(rec: Recording): Promise<void> {
  const outcome = rec.result.abandoned ? 'abandoned' : rec.result.phase;
  const name = `${rec.recordedAt.replace(/[:.]/g, '-')}_${rec.missionId}_${outcome}.json`;
  const body = JSON.stringify(rec);
  if (import.meta.env.DEV) {
    const res = await fetch(`/__telemetry/save?name=${encodeURIComponent(name)}`, { method: 'POST', body });
    if (res.ok) return;
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([body], { type: 'application/json' }));
  a.download = name;
  a.click();
  URL.revokeObjectURL(a.href);
}
