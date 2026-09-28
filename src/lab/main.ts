import './shell/lab.css';
import { ToolHost, type ToolEntry } from './shell/tools.ts';
import { Stage } from './stage.ts';

const canvas = document.createElement('canvas');
canvas.id = 'stage';
const stage = new Stage(canvas);

const tools: ToolEntry[] = [
  { id: 'art', title: 'Art', icon: 'person', load: async () => (await import('./tools/art/art.ts')).artTool },
  { id: 'missions', title: 'Missions', icon: 'map', load: async () => (await import('./tools/missions/missions.ts')).missionsTool },
  { id: 'import', title: 'Import', icon: 'download', load: async () => (await import('./tools/import/import.ts')).importTool },
];

const host = new ToolHost(document.getElementById('appbar')!, document.getElementById('tool-root')!, stage, tools);
(window as unknown as { labHost: ToolHost }).labHost = host;
void host.start();
