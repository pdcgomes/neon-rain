/** Headless traffic check: cars must stay on road cells, keep moving, and occasionally hit people. */
import { readFileSync } from 'node:fs';
import { resolveWeapons, type AgentDef, type Content, type MissionDef, type WeaponDef } from '../src/sim/content.ts';
import { GROUND_ROAD } from '../src/sim/map.ts';
import { World } from '../src/sim/world.ts';

const load = (p: string) => JSON.parse(readFileSync(new URL(p, import.meta.url), 'utf8'));
const content: Content = {
  weapons: resolveWeapons(load('../src/content/weapons.json') as Record<string, Partial<WeaponDef>>),
  agents: [],
  mission: load('../src/content/missions/01_downtown.json') as MissionDef,
};
const tpl = load('../src/content/agents.json').template;
const squad: AgentDef[] = ['Kade', 'Ivo', 'Rhee', 'Mara'].map((name) => ({ name, ...tpl }));
const world = new World(content, squad);
const { map } = world;

let offRoad = 0;
let samples = 0;
let hits = 0;
let horns = 0;
let deaths = 0;
let calmHits = 0;
let speedSum = 0;
let minCars = Infinity;
let maxCars = 0;
const TICKS = 30 * 180;
for (let t = 0; t < TICKS; t++) {
  world.step([]);
  for (const ev of world.events) {
    if (ev.t === 'carHit') {
      hits++;
      if (ev.calm) calmHits++;
    }
    if (ev.t === 'horn') horns++;
    if (ev.t === 'death' && ev.by === -1) deaths++;
  }
  const cars = world.traffic.vehicles.filter((v) => !v.wrecked);
  minCars = Math.min(minCars, cars.length);
  maxCars = Math.max(maxCars, cars.length);
  for (const v of cars) {
    speedSum += v.speed;
    const c = Math.cos(v.heading);
    const s = Math.sin(v.heading);
    for (const [f, l] of [[1.9, 0.9], [1.9, -0.9], [-1.9, 0.9], [-1.9, -0.9]]) {
      const x = v.x + c * f - s * l;
      const y = v.y + s * f + c * l;
      if (x < 0 || y < 0 || x >= map.w || y >= map.h) continue;
      samples++;
      if (map.ground[Math.floor(y) * map.w + Math.floor(x)] !== GROUND_ROAD) {
        offRoad++;
        if (offRoad <= 5) console.log(`off-road car ${v.id} at ${x.toFixed(1)},${y.toFixed(1)} heading ${v.heading.toFixed(2)}`);
      }
    }
  }
}
const avg = speedSum / Math.max(1, world.traffic.vehicles.length * TICKS);
console.log(`cars ${minCars}-${maxCars}, avg speed ${avg.toFixed(1)} m/s, off-road samples ${offRoad}/${samples}, hits ${hits} (${calmHits} on calm pedestrians, ${deaths} fatal), horns ${horns}`);
if (offRoad > 0 || maxCars === 0 || calmHits > 2) process.exit(1);
