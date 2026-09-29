/** Worker thread for mission mode: plays the runs it is sent and posts back the results. */
import { parentPort } from 'node:worker_threads';
import { configure, type Config, type Overrides } from './config.ts';
import type { BotName } from './missionBot.ts';
import { playMission } from './missionRun.ts';

export interface Task {
  id: number;
  file: string;
  bot: BotName;
  seed: number;
  overrides: Overrides;
  seconds: number;
  wins: number;
}

let cfgKey = '';
let cfg: Config | null = null;

parentPort!.on('message', (task: Task) => {
  const key = JSON.stringify([task.overrides, task.wins]);
  if (!cfg || key !== cfgKey) {
    cfg = configure(task.overrides, task.wins);
    cfgKey = key;
  }
  try {
    parentPort!.postMessage({ id: task.id, run: playMission(task.file, task.bot, task.seed, cfg, task.seconds) });
  } catch (e) {
    parentPort!.postMessage({ id: task.id, error: `${task.file} ${task.bot} ${task.seed}: ${(e as Error).stack}` });
  }
});
