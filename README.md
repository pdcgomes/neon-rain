# Neon Rain

A modern reinterpretation of **Syndicate** (Bullfrog, 1993), rebuilt around the looser, more fluid controls of **Cannon Fodder** (Sensible Software, 1993). You command four Eurocorp cyborg agents through a rain-soaked, neon-lit city: assassinate, persuade, and extract.

This is a web vertical slice built with three.js and TypeScript. The simulation is deterministic and independent of the renderer, so online multiplayer and a later Godot or Unity port don't require a rewrite.

![Neural Overdrive firefight in Sakura Plaza](assets/overdrive.jpg)

## Screenshots

| | |
| --- | --- |
| ![Street level at mission start](assets/streets.jpg) | ![Persuadertron converting civilians](assets/persuadertron.jpg) |
| ![The city from above](assets/skyline.jpg) | ![Eurocorp mission briefing](assets/briefing.jpg) |

![Debrief and Memorial Wall](assets/debrief.jpg)

## The idea

**Kept from Syndicate:** four trench-coated cyborgs working for an amoral megacorp, the Persuadertron, IPA drug levels (Adrenaline, Perception, Intelligence) on every agent, the minigun and Gauss gun, police who tell you to holster your weapon, a rival syndicate, and cold corporate satire in the briefings.

**Borrowed from Cannon Fodder:** left click moves, right click fires wherever the cursor is, and both buttons together throw a grenade. You can move and shoot at the same time. The squad trails its leader along a breadcrumb path instead of needing micromanagement, you can split it into two teams, and fallen agents go on a Memorial Wall while fresh recruits take their place.

**New:**
- **Neural Overdrive:** hold Space to slow time, at the cost of agent health.
- **Procedural city:** rain, bloom, and wet-street reflections.
- **Camera:** free orbit and tilt, from a low 3/4 angle to straight top-down. Buildings between the camera and your squad, cursor, or target turn into see-through outlines.
- **Traffic:** cars drive in lanes, stop at traffic lights, and yield to pedestrians on crosswalks. They can't stop instantly, though, so an agent who sprints out in front of one gets hit.
- **Police heat:** escalates in tiers, from patrols to enforcer squads.
- **Crowd panic:** fear spreads through the crowd.
- **Synthesized audio:** generated in code, with no asset files.

## The mission: Neon Rain

Director Hale Voss of Kaiju Dynamics is holding a public appearance in Sakura Plaza, guarded by three bodyguards and a rival syndicate detail. Kill him before he reaches his limousine on the eastern boulevard, then get your squad to the extraction VTOL. As a bonus, persuade his bodyguards to switch sides.

## Running it

You need Node.js 18 or newer and a desktop browser with WebGL2 (any current Chrome, Edge, Firefox, or Safari). A mouse with a right button is strongly recommended.

```bash
npm install
npm run dev
```

Then open http://localhost:5173.

| Command | What it does |
| --- | --- |
| `npm run dev` | Dev server with hot reload |
| `npm run build` | Typecheck and build a static site into `dist/` |
| `npm run preview` | Serve the production build locally |
| `npm run typecheck` | TypeScript only |
| `npm run sim:smoke` | Play the mission headless in Node and verify determinism |
| `npm run sim:traffic` | Check that cars stay on roads and calm pedestrians are never hit |

URL options: `?autostart` skips the briefing, and `?seed=123` changes the random seed for the population and events.

## Controls

| Input | Action |
| --- | --- |
| Left click / hold | Move the selected agents (hold to steer) |
| Right click / hold | Fire at the cursor |
| Left + right click | Throw a grenade |
| `1`–`4` | Select an agent (`Shift` adds or removes) |
| `Tab` | Select all agents |
| `G` | Split the selection into a second team (with everyone selected, merges back) |
| `T` | Switch between teams |
| `Z` `X` `C` `V` | Pistol, Uzi, Minigun, Persuadertron |
| `R` | Cycle weapon |
| `H` | Holster or draw |
| `Space` (hold) | Neural Overdrive |
| Middle drag / `Alt` + left drag | Orbit the camera freely (rotate and tilt) |
| `Q` / `E` (hold) | Rotate the camera |
| `Shift` + wheel, `PageUp` / `PageDown` | Tilt, from a low 3/4 angle to straight down |
| `Y` | Toggle top-down view |
| Mouse wheel | Zoom |
| `W` `A` `S` `D` / arrows | Pan the camera |
| `F` | Reset the view |
| `Esc` / `P` | Pause |
| `O` | Performance overlay (FPS, render scale) |

Drag the ADR, PER, and INT bars on each agent's card to set their IPA levels. Higher levels make agents faster, more perceptive, or more accurate, but push the levels too far and they drain health.

## How it's built

```mermaid
flowchart LR
  Input["Input (mouse/keys)"] --> Cmds[Command queue]
  Cmds --> Sim["Sim: fixed 30Hz tick"]
  Sim --> Snapshot[World state + events]
  Snapshot --> Render["three.js renderer (interpolated)"]
  Snapshot --> HUD[DOM HUD]
  Snapshot --> Audio[Synth audio]
  Content["JSON content: weapons, missions"] --> Sim
```

- **`src/sim/`** is pure TypeScript with no three.js or DOM imports. It runs in fixed 30Hz ticks with a seeded random number generator, and changes only in response to commands. Because of that, it runs headless in Node, which also makes it the basis for an authoritative multiplayer server later.
  - `map.ts`: procedural city layout (blocks, lots, alleys, plaza, parked cars).
  - `nav.ts`: A* pathfinding with path smoothing, line of sight, and flow fields for crowds. Pedestrians keep to sidewalks and cross at crosswalks.
  - `traffic.ts`: lane-following cars, traffic signals, intersection right-of-way, yielding and braking for pedestrians, and car impacts.
  - `systems/`: movement and follow-the-leader, combat and projectiles, AI, crowd, police heat, persuasion, IPA and overdrive, objectives.
- **`src/render/`** draws the world from the sim state and interpolates between ticks. Buildings, props, and characters are instanced. A custom facade shader draws windows, shopfronts, and roof trims. The post-processing pass does bloom, tone mapping, SMAA, chromatic aberration, and film grain, and adjusts render resolution to hold frame rate. That resolution scaling is the web stand-in for DLSS or FSR.
- **`src/ui/`** has the HUD, minimap, briefing, and debrief, plus the persistent roster and Memorial Wall (saved in `localStorage`).
- **`src/audio/`** synthesizes every sound effect and the ambient music loops in code, then plays them through Howler.
- **`src/content/`** holds the data-driven weapons, agent template, and mission definition. Most balance tuning lives here.

## Style Lab

`/lab.html` (run `npm run dev`, then open http://localhost:5173/lab.html) is a side app for settling the art direction before any assets go into the game. It uses the game's own renderer: the same post-processing, environment lighting and facade shader.

![Style A lineup](assets/lab-lineup-a.jpg)
![Style C lineup](assets/lab-lineup-c.jpg)

- **Styles:** *Base* is today's in-game primitives. *A · Low-poly* is flat-shaded, faceted shapes. *C · Voxel* is chunky, about 26 voxels tall, with stepped 8 fps motion. *Imported* shows GLB and `.vox` files. Every style renders the same character designs (`src/lab/kits/designs.ts`), so a comparison never changes who is who.
- **Boards** are grouped in a macOS-style source list: character groups, a lineup against a 1.8 m ruler, buildings, signage, a street slice, props, animation boards, and style comparisons. Search, collapse, and `↑`/`↓` navigate; every view is a deep link.
- **Viewport:** drag to orbit, right-drag to pan, scroll to zoom; *Front, Side, Top, 3/4* and *Game* (the in-game camera) presets. Click selects, double-click or `F` frames.
- **Animation:** every character runs on a shared Mixamo-named skeleton with 17 placeholder clips, one per game state (idle, walk, run, aim-walk, strafe, shooting, throw, persuade, hit, two deaths, panic, cower, umbrella walk, persuaded shuffle). The timeline plays, pauses, scrubs, steps frames and changes speed, and the inspector has a crossfade tester. The *Clip Grid*, *Treadmill* (in-game speeds, foot contact markers, root trail) and *Game-scale Motion* (in-game camera at true pixel density) boards are for judging motion.
- **Review tools:** silhouette mode, pixel preview, turntable, rain and wet floor, skeleton overlay, onion skin, and PNG export.

![Style comparison](assets/lab-compare.jpg)

### Bringing in real models

Put files in `public/lab/assets/` and list them in `public/lab/manifest.json`. You can also drop `.glb`, `.gltf` or `.vox` files straight onto the viewport:

```json
{ "id": "agent-tripo-01", "name": "Agent (Tripo)", "file": "assets/tripo/agent_01.glb",
  "category": "character", "kind": "agent", "height": 1.84, "source": "Tripo image-to-3D",
  "clipAliases": { "Armature|Rifle Run": "run" } }
```

Models are scaled to `height` and placed on the floor. Clips are mapped onto the catalogue by name: Mixamo names are recognised, and `clipAliases` covers the rest. The inspector lists missing clips. The conventions: +Y up, the character faces +Z, metres, and a Mixamo skeleton (`mixamorig:*`) so every character shares one set of clips.

### Ready-made models

`public/lab/assets/generated/` holds models baked from the lab's kits. They load back in through the imported-GLB path; each one has a board under **Imported** in the lab.

- Five characters in both styles: agents Kade and Mara, a rival agent, a police officer, and a courier. Each is a single skinned mesh on a Mixamo-named skeleton with all 17 clips, and opens in Blender for touch-ups.
- `.vox` sources for the Style C characters, which open in MagicaVoxel.
- A car and the extraction VTOL in both styles.

To regenerate them after changing a kit, run `await lab.exportModels()` in the lab's dev console. `await lab.captureRefs('agent:0')` renders front, left, back and right reference images to `public/lab/assets/refs/`.

### Tripo

`tools/art/tripo.ts` runs the Tripo 3D API. It generates from a text prompt, the front reference image, or all four reference views; applies Tripo's voxel stylise for Style C; rigs to a Mixamo skeleton; and retargets the preset animations. Results go to `public/lab/assets/tripo/` and are registered in the manifest. The API key is read from `.env.local` (`TRIPO_API_KEY=...`).

```sh
npm run art:tripo -- balance
npm run art:tripo -- presets
npm run art:tripo -- make agent --from multiview --rig              # Style A
npm run art:tripo -- make agent --style voxel --from multiview --rig
npm run art:tripo -- make police --from text --dry-run              # print payloads only
```

Finished stages are logged, so a run that is interrupted, or that stops when credits run out, picks up where it left off.

## Dev tooling

- `node scripts/sim-smoke.ts` runs the whole mission headless with a scripted squad, then checks that two runs with the same inputs produce identical state.
- `node scripts/traffic-check.ts` runs 3 minutes of city life with no player input. It fails if any car leaves the road, or if more than a couple of calm (non-panicked) pedestrians are hit.
- `node scripts/diag.ts [--drawn]` is a balance probe: it walks the squad toward the plaza and logs how the fight unfolds.
- `node scripts/shot.ts --url ... --wait ... --eval ... --shot delay:path.png` drives a headless Chromium over the DevTools protocol to capture screenshots and run scripted scenes. With the dev server running, `window.game.advance(ticks, commands)` fast-forwards the sim.

## Roadmap

- Tune feel and difficulty from playtesting.
- Syndicate's world map: territories, tax rates, and unrest.
- Research and cyborg modifications between missions.
- More missions and city districts.
- Online co-op, with the sim running on an authoritative Node server.
- Port to Godot or Unity for native rendering and DLSS/FSR. A Godot project scaffold is already in the repo root.

## Disclaimer

A non-commercial fan project. Not affiliated with or endorsed by Electronic Arts, Bullfrog Productions, or Sensible Software. Syndicate and Cannon Fodder are trademarks of their respective owners.
