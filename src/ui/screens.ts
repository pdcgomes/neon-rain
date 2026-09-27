import type { MissionDef } from '../sim/content.ts';
import type { MissionStats } from '../sim/types.ts';
import type { FallenAgent, Save } from './roster.ts';

const root = () => document.getElementById('screens')!;

function clear(): void {
  root().innerHTML = '';
}

function screen(cls: string, html: string): HTMLDivElement {
  clear();
  const d = document.createElement('div');
  d.className = `screen ${cls}`;
  d.innerHTML = html;
  root().appendChild(d);
  return d;
}

const LOGO = `<div class="logo"><span class="logo-mark">◢◤</span> EUROCORP <span class="logo-sub">// AGENT OPERATIONS TERMINAL</span></div>`;

function memorial(fallen: FallenAgent[], highlight: Set<string>): string {
  if (!fallen.length) return '<div class="wall-empty">No agents lost. The wall is waiting.</div>';
  return `<div class="wall">${fallen
    .slice(0, 60)
    .map(
      (f) => `<div class="stone ${highlight.has(f.name) ? 'fresh' : ''}">
        <div class="stone-name">${f.name}</div>
        <div class="stone-meta">${f.mission} · ${f.date}</div>
        <div class="stone-meta">${f.missions} op${f.missions === 1 ? '' : 's'} · ${f.kills} kills</div>
      </div>`,
    )
    .join('')}</div>`;
}

export function showBriefing(mission: MissionDef, save: Save, onDeploy: () => void): void {
  const squad = save.roster
    .slice(0, 4)
    .map(
      (r, i) =>
        `<div class="brief-agent"><span class="n">${i + 1}</span><span class="nm">${r.name.toUpperCase()}</span><span class="rec">${r.missions ? `${r.missions} ops · ${r.kills} kills` : 'FRESH RECRUIT'}</span></div>`,
    )
    .join('');
  const d = screen(
    'briefing',
    `${LOGO}
    <div class="brief-grid">
      <div class="brief-main">
        <div class="brief-kicker">MISSION ${mission.id.split('_')[0]} · ${mission.city}</div>
        <h1 class="brief-title glitch" data-text="${mission.codename}">${mission.codename}</h1>
        <div class="brief-text"></div>
        <div class="brief-obj">
          <div class="h">OBJECTIVES</div>
          ${mission.objectives.map((o) => `<div class="o">▸ ${o.text}</div>`).join('')}
          <div class="o bonus">◇ BONUS: ${mission.bonus.text}</div>
        </div>
      </div>
      <div class="brief-side">
        <div class="h">ASSIGNED AGENTS</div>
        ${squad}
        <div class="h">LOADOUT</div>
        <div class="brief-load">Pistol · Uzi · Minigun · Persuadertron · 2× Frag Grenade</div>
        <div class="h">CONTROLS</div>
        <div class="brief-controls">
          <div><b>Left click</b> move (hold to steer)</div>
          <div><b>Right click</b> fire at cursor</div>
          <div><b>Both buttons</b> throw grenade</div>
          <div><b>1–4</b> select agent · <b>Shift</b> add · <b>Tab</b> all</div>
          <div><b>G</b> split squad · <b>T</b> switch team</div>
          <div><b>Z X C V</b> weapon · <b>H</b> holster</div>
          <div><b>Space</b> hold for Neural Overdrive</div>
          <div><b>Middle drag</b> or <b>Alt+drag</b> orbit camera</div>
          <div><b>Q / E</b> rotate · <b>Shift+wheel</b> pitch · <b>Y</b> top-down</div>
          <div><b>Wheel</b> zoom · <b>WASD</b> pan · <b>F</b> reset view</div>
        </div>
        <div class="brief-memorial">Memorial Wall: ${save.fallen.length} agent${save.fallen.length === 1 ? '' : 's'} decommissioned</div>
        <button class="btn deploy">DEPLOY ▸</button>
        <div class="hint">Press Enter to deploy</div>
      </div>
    </div>`,
  );

  // Terminal typewriter for the briefing text.
  const box = d.querySelector('.brief-text')!;
  const paras = mission.briefing;
  let p = 0;
  let c = 0;
  let current: HTMLParagraphElement | null = null;
  const timer = window.setInterval(() => {
    if (p >= paras.length) {
      window.clearInterval(timer);
      return;
    }
    if (!current) {
      current = document.createElement('p');
      box.appendChild(current);
    }
    c += 3;
    current.textContent = paras[p].slice(0, c);
    if (c >= paras[p].length) {
      p++;
      c = 0;
      current = null;
    }
  }, 12);

  const go = () => {
    window.clearInterval(timer);
    window.removeEventListener('keydown', onKey);
    clear();
    onDeploy();
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.code === 'Enter') go();
  };
  window.addEventListener('keydown', onKey);
  d.querySelector('.deploy')!.addEventListener('click', go);
}

export function showPause(onResume: () => void, onRestart: () => void, onAbort: () => void): void {
  const d = screen(
    'pause',
    `<div class="panel">
      <div class="h">OPERATION PAUSED</div>
      <button class="btn resume">RESUME</button>
      <button class="btn ghost restart">RESTART MISSION</button>
      <button class="btn ghost abort">ABORT TO BRIEFING</button>
    </div>`,
  );
  d.querySelector('.resume')!.addEventListener('click', onResume);
  d.querySelector('.restart')!.addEventListener('click', onRestart);
  d.querySelector('.abort')!.addEventListener('click', onAbort);
}

export function hideScreens(): void {
  clear();
}

export function showDebrief(
  mission: MissionDef,
  success: boolean,
  reason: string,
  stats: MissionStats,
  time: number,
  fallenNow: FallenAgent[],
  save: Save,
  onReplay: () => void,
  onBriefing: () => void,
): void {
  const acc = stats.shotsFired ? Math.round((stats.shotsHit / stats.shotsFired) * 100) : 0;
  const mm = String(Math.floor(time / 60)).padStart(2, '0');
  const ss = String(Math.floor(time % 60)).padStart(2, '0');
  const fee = Math.max(0, (success ? 250000 : 0) - stats.killsCivilian * 8000 - stats.killsPolice * 15000 + stats.guardsPersuaded * 40000);
  const d = screen(
    `debrief ${success ? 'win' : 'loss'}`,
    `${LOGO}
    <div class="debrief-head">
      <div class="brief-kicker">${mission.codename} · DEBRIEF</div>
      <h1 class="glitch" data-text="${success ? 'MISSION ACCOMPLISHED' : 'MISSION FAILED'}">${success ? 'MISSION ACCOMPLISHED' : 'MISSION FAILED'}</h1>
      <div class="reason">${reason}</div>
    </div>
    <div class="debrief-grid">
      <div class="stat"><div class="v">${mm}:${ss}</div><div class="k">Operation time</div></div>
      <div class="stat"><div class="v">${stats.killsEnemy}</div><div class="k">Hostiles neutralised</div></div>
      <div class="stat"><div class="v">${stats.persuaded}</div><div class="k">Persuaded (${stats.guardsPersuaded} bodyguards)</div></div>
      <div class="stat"><div class="v">${acc}%</div><div class="k">Accuracy · ${stats.shotsFired} rounds</div></div>
      <div class="stat warn"><div class="v">${stats.killsCivilian}</div><div class="k">Civilian casualties</div></div>
      <div class="stat warn"><div class="v">${stats.killsPolice}</div><div class="k">Police casualties</div></div>
      <div class="stat"><div class="v">¥${fee.toLocaleString()}</div><div class="k">Contract payout</div></div>
      <div class="stat"><div class="v">${save.wins}/${save.runs}</div><div class="k">Career record</div></div>
    </div>
    <div class="h">MEMORIAL WALL</div>
    ${memorial(save.fallen, new Set(fallenNow.map((f) => f.name)))}
    ${fallenNow.length ? `<div class="recruits">${fallenNow.length} replacement recruit${fallenNow.length > 1 ? 's' : ''} assigned from the queue.</div>` : ''}
    <div class="debrief-actions">
      <button class="btn replay">REDEPLOY ▸</button>
      <button class="btn ghost back">BRIEFING</button>
    </div>`,
  );
  d.querySelector('.replay')!.addEventListener('click', onReplay);
  d.querySelector('.back')!.addEventListener('click', onBriefing);
}
