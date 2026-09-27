import './style.css';
import { AudioSystem } from './audio/audio.ts';
import { content } from './content/index.ts';
import { Game, type GameResult } from './game.ts';
import { loadSave, recordMission, squadFromSave } from './ui/roster.ts';
import { hideScreens, showBriefing, showDebrief, showPause } from './ui/screens.ts';

const app = document.getElementById('app')!;
const audio = new AudioSystem();
const params = new URLSearchParams(location.search);
let game: Game | null = null;

function deploy(): void {
  audio.init();
  audio.ui();
  game?.dispose();
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
            deploy();
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
  game.start();
  (window as unknown as { game: Game }).game = game;
}

function briefing(): void {
  showBriefing(content.mission, loadSave(), deploy);
}

function debrief(r: GameResult): void {
  const save = loadSave();
  const outcome = r.world.agents().map((a) => ({ name: a.name, alive: a.alive, kills: r.kills.get(a.id) ?? 0 }));
  const fallen = recordMission(save, content.mission.codename, r.success, outcome);
  showDebrief(content.mission, r.success, r.reason, r.world.stats, r.world.time, fallen, save, () => {
    hideScreens();
    deploy();
  }, () => {
    game?.dispose();
    game = null;
    briefing();
  });
}

if (params.has('autostart')) deploy();
else briefing();
