# How the original Syndicate is balanced

Syndicate (Bullfrog, 1993) is hard, and American Revolt (1994) is much harder. This note collects what we know about how the original gets there, and what Neon Rain takes from it. It is the reference for the difficulty work driven by `scripts/balance.ts`.

## Sources, and how far to trust them

| Source | What it's good for |
| --- | --- |
| The manual (`SYNDMAN.PDF`) and the Syndicate Plus reference card (`SYNDREF.PDF`), in `content-local/synticate plus/DOCS/` | Design intent. Bullfrog's own description of IPA, mods, weapons, police and American Revolt. |
| The mission files (`GAMExx.DAT`), read by `src/import/syndicate/gameFile.ts` | Ground truth for what each mission contains: who, how many, health, weapons, patrol routes. `npm run synd -- stats` summarises them. |
| [FreeSynd](https://github.com/bni/freesynd), the open-source reimplementation | Weapon data, research tree, mod costs and persuasion rules extracted from the original are reliable. AI behaviour, timings and IPA effects are mostly its authors' guesses, and they say so in the code (`TODO: calibrate weapon time for shot and reload, angle, accuracy`). Where FreeSynd and the manual disagree, the manual wins. |

## Damage

Everyone uses the same weapons. There are no "enemy versions": a guard with a minigun has your minigun. Differences between sides come from health, mods, IPA and numbers.

- **Agents have 16 health.** Every bullet weapon (pistol, Uzi, minigun, long-range rifle) does 2 per hit, so 8 hits kill an unmodified agent. A full shotgun blast (6 pellets) does 12, the laser 32, and the Gauss gun and time bomb 64 to everything in the blast radius, with no falloff. Flame and explosions are close to instant death without a V2 chest.
- **Nobody else has fixed health.** Each ped's health comes from its mission file. Across the base campaign, guards usually have 0 to 8 (FreeSynd floors 0 at 2, so one bullet), and rival agents 16. In American Revolt nearly every guard and police officer has the full 16.
- **Armour is the chest mod:** 10%, 25% or 40% damage reduction for V1, V2 and V3, never below 1 per hit. Only cyborgs (agents on both sides) have it.
- **Healing is scarce.** Agents with a V2 or V3 chest regenerate 1 health every 4 s after being hit. Otherwise the only heal is a single-use medikit.
- **No friendly fire** within a side. Bullets pass through allies, but not through civilians.
- **Getting hit staggers.** A hit ped turns to face the shooter and can't fire until the hit animation ends.

Weapon stats, from FreeSynd's `data/ref/weapons.dat` (1 tile = 256 units = 3 m in Neon Rain):

| Weapon | Damage | Range | Cooldown (neutral IPA) | Notes |
| --- | --- | --- | --- | --- |
| Pistol | 2 | 5 tiles (15 m) | 800 ms | Everyone starts with one; free |
| Shotgun | 6 × 2 | 4 tiles (12 m) | 400 ms | The only weapon with real spread (45° cone) |
| Uzi | 2 | 7 tiles (21 m) | 250 ms per shot, automatic | "The mainstay of any offensive force" |
| Minigun | 2 (5 ammo a shot) | 9 tiles (27 m) | 250 ms, automatic | Weight 25: more than one slows an unmodified agent |
| Long-range rifle | 2 | 24 tiles (72 m) | 600 ms | "Extremely accurate" |
| Laser | 32 | 16 tiles (48 m) | 400 ms | Kills an agent outright; cuts through everyone in the line |
| Flamer | 8 per tick | 2 tiles (6 m) | 150 ms, automatic | Burning victims run and die |
| Gauss gun | 64 splash, 2 tiles | 20 tiles (60 m) | 1.7 s, 3 rockets | "Eliminating large groups of people" |

The research tree gates all of this. At the start you can buy only the pistol, shotgun, Persuadertron, scanner and medikit. The Uzi leads to the minigun, the flamer to the long-range rifle and then the time bomb, and the laser to the Gauss gun.

## IPA

The manual is explicit that IPA is the core skill: *"These drugs modify the behavior of an agent when left to its own cybernetic devices. Accurate control of Levels is essential if you are to progress to the higher echelons of your Syndicate."*

### What each drug does (manual)

- **Intelligence** "controls an agent's reactions to a given situation." High intelligence "may prompt an agent to get out of a risky situation rather than risk his life", especially with high perception.
- **Perception** "improves precise firing and alerts an agent to danger earlier."
- **Adrenaline** "controls speed of reactions", and walking speed.
- **Combinations matter.** High adrenaline with low intelligence "reacts quickly but erratically: he may fire wide or too soon." High intelligence and perception with low adrenaline is slow to respond, but "firing accuracy is assured." All three at maximum: "the agent reacts quickly and with a high degree of operational independence." Low intelligence and perception together: the agent will "walk blindly into certain death."
- *"It's a good tactic to crank up Levels if leaving agents on lookout. They fire to defend themselves while awaiting the next command."*

### Doses wear off and agents get dependent (manual, timed by FreeSynd)

Each bar has a **dose** (what the player sets), an **effect** (a darker bar that fills as the drug takes hold) and a **dependency** (the centre line).

- The benefit is the gap between dose and dependency. FreeSynd models it as a multiplier from ×0.5 to ×2: `1 + gap` when the dose is above dependency, `1 / (1 + gap)` when below, with the gap as a fraction of the bar.
- Effect catches up with the dose at 1% per second. Then the dose itself falls back toward dependency at 1% per second: *"When the dark segment achieves the same extent as the normal color bar, the effect of the drug begins to diminish."* A spike from neutral to full wears off in about 50 s.
- Dependency follows the dose at 1% per 4.5 s: *"future injections need to be greater to have the same effect."* An agent kept at maximum ends up with dependency at maximum, and gets nothing from it.
- Resting below the line reverses this: *"The longer an agent's Levels are rested, the greater the improved performance when injected later."* With dependency pulled down to 20%, a full dose gives ×1.8, where from neutral it gives ×1.5.
- **Panic Mode** (both mouse buttons) sets all three to maximum, draws a weapon and fires.

FreeSynd implements this drift but never calls it during a mission, and its effect table is its own guess: adrenaline speeds movement and firing but spoils aim, perception sharpens aim and widens awareness, and intelligence does almost nothing. The manual's intelligence (self-preservation, choosing when to fire, not firing wide or too soon) exists nowhere in FreeSynd.

### Enemies

Every ped in every mission file, enemies included, is stored with neutral IPA (128 of 255) and no mods. Enemy IPA never changes during a mission. The difficulty jump in American Revolt comes from the reference card: *"enemy agents whose reactions are at least twice as fast as anything encountered before. They arm, aim and fire without hesitation"*, and the fix is *"agents whose experience allows for operational independence ... as is mastery of IPA levels. Try to bulldoze through in group mode or go in under-manned and suffer the consequences."*

## Mods

Six slots (legs, arms, chest, heart, eyes, brain), each in V1, V2 and V3. V1 is on sale from the start; V2 and V3 need research. The manual's intent:

- **Legs:** much faster movement.
- **Arms:** carry more without slowing down.
- **Eyes:** earlier awareness of hazards, and better accuracy.
- **Chest:** survive direct hits (the armour above); V2 and up adds self-destruct and blast survival.
- **Heart:** "overall physical strength and durability."
- **Brain:** "vital for quick, correct decision making under pressure"; also makes the Persuadertron stronger.

Rival agents always carry the best mod version you have researched (FreeSynd). Upgrading your agents upgrades theirs.

## Enemy behaviour

| Who | Behaviour |
| --- | --- |
| Rival agents | Attack on sight whether or not your weapons are out: *"they are firing before you can even arm a cyborg."* They carry your two best researched weapons (FreeSynd: 78% the best, 22% the second best), plus a time bomb once you have researched one. |
| Guards | Armed with whatever the mission file gives them. They attack on sight. |
| Police | Ignore agents until a weapon is drawn, then warn (*"Police! Put down your weapons!"*) and open fire if you don't holster. |
| Civilians | Panic and run once guns are out. They can be persuaded freely. |

FreeSynd adds a 2 s pause between spotting and firing for every enemy. When someone spots the squad, allies of the same faction within 8 tiles (24 m) join in immediately, one hop only. There is no hearing, no alarm and no reinforcements in FreeSynd, and it isn't known whether the original had them.

## Escalation

The original gets harder in three ways, none of them a difficulty setting:

1. **The missions themselves.** More enemies, tougher guards, heavier weapons. From the mission files:

   | Mission | Opposition |
   | --- | --- |
   | 1 Mercenary camp | 4 guards (0 health) with shotguns, pistols, an Uzi |
   | 13 The alleyway | 44 guards (8 health): Uzis, 11 miniguns, 9 long-range rifles |
   | 37 The big black | 56 rival agents, 9 guards (16 health) with 10 Gauss guns |
   | AR 16 Heal the world | 59 guards (16 health): 38 Gauss guns, 33 miniguns, 15 lasers |
   | AR 32 There goes the cavalry | 50 rival agents, 121 guards (16 health) with 92 lasers |
   | AR 34 Meat grinder | 48 rival agents, 73 police with miniguns |

2. **Your own research.** Rival agents carry your best weapons and mods.
3. **American Revolt reaction speed.** Enemies react at least twice as fast.

The American Revolt data disk ships all 50 mission files, but only 21 differ from the base game: 05, 08, 14, 16, 17, 21, 23, 24, 26, 29, 30, 32, 34, 36, 37, 39, 42, 44, 46, 47, 49. The other `revolt_*` conversions are copies of the Syndicate missions.

## What Neon Rain takes from this

| Original | Neon Rain | Where |
| --- | --- | --- |
| Symmetric weapons, 8 bullets kill an agent | One weapon table for both sides (12.5 per bullet against 100 health), plus the shotgun's pellets, the piercing laser, the flamer and the long-range rifle. The old enemy entries are aliases (`like`) of the real guns. The Rival Gauss stays a lighter Neon Rain launcher, so the first mission's heavy doesn't wipe a squad in one shot. | `src/content/weapons.json` |
| Health from the mission file | Converter carries it (×100/16, at least 2) | `convert.ts` |
| Chest armour and slow regeneration | Chest V1/V2/V3 absorb 10/25/40%. Only V2 and up self-repair. There is no base armour. | `CHEST_ARMOR`, `ipaSystem` |
| Getting hit staggers | A bullet hit stops the victim firing for `hitStagger` | `projectileSystem` |
| Research-gated arsenal | Pistol, shotgun and Persuadertron to start. Weapons unlock over the campaign: Uzi after 1 win, long-range rifle 4, minigun 8, flamer 12, laser 18, Gauss 25. Chest V1, V2, V3 come after 5, 15 and 28 wins. The loadout is the three best guns plus the Persuadertron. | `agents.json` `progression`, `kitFor` |
| Rival agents carry your best weapons and mods | Issued the squad's best gun (22%: second best) and best chest | `spawnRival` |
| IPA dose, effect, dependency, wear-off | Full model per agent, knobs `ipa*` (FreeSynd's timings by default). The HUD shows the dose, the part that has taken hold, and the dependency line. | `ipa.ts`, `hud.ts` |
| Adrenaline | Speed, fire rate and reaction time scale with its strength. Fire goes wide when it runs ahead of Intelligence. | `ipa.ts` |
| Perception | Aim, how far an agent looks for targets on its own, and persuasion | `ipa.ts` |
| Intelligence: judgement | When acting alone, a clever agent picks whoever is shooting at the squad and rival agents first. It holds fire until a target is in effective range, won't fire with a civilian in the line, and when badly hurt gets out of sight. Low Intelligence and Perception together: it doesn't react until it is hit. | `supportFire` |
| Panic Mode | Overdrive now forces real doses to maximum, so it costs dependency (it keeps its bullet time) | `ipaSystem` |
| Enemy reaction delay, twice as fast in American Revolt | Per class (`reactRival`, `reactGuard`, `reactPolice`), times `enemyReaction` on the mission | `ai.ts` |
| Rival agents see through a disguise | They spot holstered agents at full range; guards and police still ignore them beyond 6 m | `findHostile` |
| Detection range from the weapon | Weapon range × 1.5, up to 28 m (70% of that when calm). At 36 m even the intended plan for The Alleyway failed; at 22 m a rush got through. | `sightRange` |
| One-hop ally alert | Within `allyAlert` (16 m); gunfire noise also draws enemies (our addition) | `combatAi` |
| Guards hold posts | Leashed to `guardLeash` of their post; they won't chase or search beyond it | `combatAi` |
| Persuasion targets | Agents never pick a persuasion target on their own | `persuadeTargetIds` |
| Partial cover | Our addition: the original has none, but Neon Rain's 3D city needs it | `coverBlock`, off by default |

## Evaluating it

`scripts/balance.ts` has two modes. Arenas are small hand-drawn fights that compare a rush with the intended tactic. Missions plays the converted campaign itself with scripted squads: a group-mode rush, a Panic Mode rush, and a careful squad that splits up, moves holstered and manages IPA. It reports win rate and losses per mission, so the difficulty curve can be read across all 50 missions plus the 21 American Revolt ones. The targets, from the manual and reference card:

- Early missions are winnable by a careless rush with losses. The manual: "if you're having so much trouble with such an easy mission you probably aren't cut out for the Syndicate anyway."
- From the middle of the campaign, a rush should fail more often than not, and a careful squad should win.
- In American Revolt, a careful squad with neutral IPA should struggle, and one that manages IPA well should win. "Mastery of IPA levels" is the stated requirement.
