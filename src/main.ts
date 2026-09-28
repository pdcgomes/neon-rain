import './style.css';
import { AudioSystem } from './audio/audio.ts';
import { content } from './content/index.ts';
import { Game, type GameResult } from './game.ts';
import { agentArtProgress, preloadAgentArt } from './render/agentModels.ts';
import { loadSave, recordMission, squadFromSave } from './ui/roster.ts';
import { hideScreens, showBriefing, showDebrief, showLoading, showPause } from './ui/screens.ts';

const app = document.getElementById('app')!;
const audio = new AudioSystem();
const params = new URLSearchParams(location.search);
let game: Game | null = null;
let deploying = 0;

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
  game = new Game(app, content, squadFromSave(save), audio, {
    onEnd: (r) => debrief(r),
    onPauseToggle: (paused) => {
      if (paused) {
        showPause(
          () => game?.togglePause(false),
          () => {
            hideScreens();
            void deploy();
          },
          () => {
            game?.dispose();
            game = null;
            briefing();
          },
        );
      } else hideScreens();
    },
  }, seed);
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
  showBriefing(content.mission, loadSave(), () => void deploy());
}

function debrief(r: GameResult): void {
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

if (params.has('autostart')) void deploy();
else briefing();
