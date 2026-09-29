import './style.css';
import { AudioSystem } from './audio/audio.ts';
import { DEFAULT_MISSION, listMissions, loadMission, makeContent } from './content/index.ts';
import { Game, type GameResult } from './game.ts';
import { agentArtProgress, preloadAgentArt } from './render/agentModels.ts';
import type { Content } from './sim/content.ts';
import { loadSave, recordMission, squadFromSave } from './ui/roster.ts';
import { hideScreens, showBriefing, showDebrief, showLoading, showPause } from './ui/screens.ts';
import { saveRecording, telemetryEnabled } from './ui/telemetry.ts';
import { ReplayViewer } from './replay/viewer.ts';
import type { Recording } from './sim/telemetry.ts';

const app = document.getElementById('app')!;
const audio = new AudioSystem();
const params = new URLSearchParams(location.search);
let game: Game | null = null;
let deploying = 0;
const missions = await listMissions();
let missionId = params.get('mission') ?? DEFAULT_MISSION;
let content: Content = makeContent(await loadMission(missions, missionId));

async function selectMission(id: string): Promise<void> {
  missionId = id;
  content = makeContent(await loadMission(missions, id));
  const q = new URLSearchParams(location.search);
  if (id === DEFAULT_MISSION) q.delete('mission');
  else q.set('mission', id);
  history.replaceState(null, '', `${location.pathname}${q.toString() ? `?${q}` : ''}`);
}

async function deploy(): Promise<void> {
  const my = ++deploying;
  audio.init();
  audio.ui();
  game?.dispose();
  game = null;
  const loading = showLoading(content.mission);
  let raf = 0;
  const poll = () => {
    loading.set(agentArtProgress() * 0.85, 'Loading field assets…');
    raf = requestAnimationFrame(poll);
  };
  poll();
  await preloadAgentArt();
  cancelAnimationFrame(raf);
  if (my !== deploying) return;
  loading.set(0.9, 'Calibrating optics…');
  await new Promise(requestAnimationFrame);

  const save = loadSave();
  const seed = params.has('seed') ? Number(params.get('seed')) : undefined;
  const record = telemetryEnabled() ? missionId : undefined;
  game = new Game(app, content, squadFromSave(save), audio, {
    onEnd: (r) => debrief(r),
    onPauseToggle: (paused) => {
      if (paused) {
        showPause(
          () => game?.togglePause(false),
          () => {
            hideScreens();
            keepRecording(game, true);
            void deploy();
          },
          () => {
            keepRecording(game, true);
            game?.dispose();
            game = null;
            briefing();
          },
        );
      } else hideScreens();
    },
  }, seed, record);
  const g = game;
  (window as unknown as { game: Game }).game = g;
  await g.view.warmup();
  if (my !== deploying) return;
  loading.set(1, 'Uplink established');
  hideScreens();
  g.start();
}

function briefing(): void {
  void preloadAgentArt();
  audio.init();
  showBriefing(content.mission, loadSave(), () => void deploy(), (ch) => audio.typeChar(ch), {
    list: missions.map((m) => ({ id: m.id, local: m.source === 'local' })),
    current: missionId,
    pick: (id) => void selectMission(id).then(briefing),
  }, import.meta.env.DEV ? { list: () => fetch('/__telemetry/list').then((r) => (r.ok ? r.json() : [])), watch: (name) => void watch(name) } : undefined);
}

const recorded = new WeakSet<Game>();

/** Saves the game's telemetry recording, once, if it has one. */
function keepRecording(g: Game | null, abandoned: boolean): void {
  if (!g?.recorder || recorded.has(g)) return;
  recorded.add(g);
  saveRecording(g.recorder.finish(abandoned)).catch((e) => console.warn('telemetry not saved', e));
}

function debrief(r: GameResult): void {
  keepRecording(game, false);
  const save = loadSave();
  const outcome = r.world.agents().map((a) => ({ name: a.name, alive: a.alive, kills: r.kills.get(a.id) ?? 0 }));
  const fallen = recordMission(save, content.mission.codename, r.success, outcome);
  showDebrief(content.mission, r.success, r.reason, r.world.stats, r.world.time, fallen, save, () => {
    hideScreens();
    void deploy();
  }, () => {
    game?.dispose();
    game = null;
    briefing();
  });
}

/** Plays back a telemetry recording (dev server): ?replay=<file in content-local/telemetry>. */
async function watch(name: string): Promise<void> {
  const q = new URLSearchParams(location.search);
  q.set('replay', name);
  history.replaceState(null, '', `${location.pathname}?${q}`);
  const res = await fetch(`/__telemetry/file?name=${encodeURIComponent(name)}`);
  if (!res.ok) {
    console.warn(`replay ${name}: ${res.status}`);
    return briefing();
  }
  const rec = (await res.json()) as Recording;
  await preloadAgentArt();
  hideScreens();
  const viewer = new ReplayViewer(app, rec, () => {
    const q = new URLSearchParams(location.search);
    q.delete('replay');
    history.replaceState(null, '', `${location.pathname}${q.toString() ? `?${q}` : ''}`);
    briefing();
  });
  (window as unknown as { replay: ReplayViewer }).replay = viewer;
  await viewer.start();
}

if (params.has('replay')) void watch(params.get('replay')!);
else if (params.has('autostart')) void deploy();
else briefing();
