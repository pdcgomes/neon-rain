/**
 * The canonical animation set the game needs. Each entry documents the sim state that
 * triggers it; this is the contract between art and the game renderer.
 */
export interface ClipSpec {
  id: string;
  label: string;
  loop: boolean;
  /** Seconds, for procedural placeholders. */
  duration: number;
  /** When the game plays it (sim terms). */
  trigger: string;
  group: 'locomotion' | 'combat' | 'reaction' | 'crowd';
}

export const CATALOGUE: ClipSpec[] = [
  { id: 'idle', label: 'Idle', loop: true, duration: 2.4, trigger: 'alive, speed < 0.3 m/s, not firing', group: 'locomotion' },
  { id: 'walk', label: 'Walk', loop: true, duration: 1.0, trigger: 'speed 0.3–2.5 m/s (civilians, patrols, holstered agents)', group: 'locomotion' },
  { id: 'run', label: 'Run', loop: true, duration: 0.64, trigger: 'speed > 2.5 m/s, not firing', group: 'locomotion' },
  { id: 'aim_walk', label: 'Aim Walk', loop: true, duration: 1.0, trigger: 'moving while firing / auto-firing (move-and-shoot)', group: 'locomotion' },
  { id: 'strafe', label: 'Strafe', loop: true, duration: 0.8, trigger: 'combat AI strafing (velocity ⟂ facing)', group: 'locomotion' },
  { id: 'shoot_pistol', label: 'Shoot Pistol', loop: true, duration: 0.6, trigger: 'firing, weapon pistol / service pistol, standing', group: 'combat' },
  { id: 'shoot_smg', label: 'Shoot SMG', loop: true, duration: 0.36, trigger: 'firing, weapon uzi / smg / carbine', group: 'combat' },
  { id: 'shoot_minigun', label: 'Shoot Minigun', loop: true, duration: 0.5, trigger: 'firing, weapon minigun or gauss (hip-held heavy)', group: 'combat' },
  { id: 'throw', label: 'Throw', loop: false, duration: 1.1, trigger: "'throw' event (grenade)", group: 'combat' },
  { id: 'persuade', label: 'Persuade', loop: true, duration: 1.6, trigger: 'firing with Persuadertron', group: 'combat' },
  { id: 'hit', label: 'Hit React', loop: false, duration: 0.5, trigger: "'hit' event on this entity", group: 'reaction' },
  { id: 'death_a', label: 'Death (back)', loop: false, duration: 1.3, trigger: "'death' event, shot from the front", group: 'reaction' },
  { id: 'death_b', label: 'Death (crumple)', loop: false, duration: 1.6, trigger: "'death' event, explosion or shot from behind", group: 'reaction' },
  { id: 'panic_run', label: 'Panic Run', loop: true, duration: 0.5, trigger: "civilian ai = 'flee'", group: 'crowd' },
  { id: 'cower', label: 'Cower', loop: true, duration: 2.0, trigger: 'civilian panicking with no escape route / near explosion', group: 'crowd' },
  { id: 'umbrella_walk', label: 'Umbrella Walk', loop: true, duration: 1.1, trigger: 'civilian with umbrella, wandering', group: 'crowd' },
  { id: 'persuaded_shuffle', label: 'Persuaded Shuffle', loop: true, duration: 1.4, trigger: "faction flipped by Persuadertron, ai = 'follow'", group: 'crowd' },
];

export const CLIP_IDS = CATALOGUE.map((c) => c.id);

export function clipSpec(id: string): ClipSpec | undefined {
  return CATALOGUE.find((c) => c.id === id);
}

/** Maps an imported clip name onto the catalogue (Mixamo names, common variants, manifest aliases). */
export function canonicalClipName(name: string, aliases: Record<string, string> = {}): string | null {
  if (aliases[name]) return aliases[name];
  const n = name.toLowerCase().replace(/^.*\|/, '').replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
  if (CLIP_IDS.includes(n)) return n;
  const guesses: [RegExp, string][] = [
    [/idle|breath/, 'idle'],
    [/strafe/, 'strafe'],
    [/(aim|gun|rifle|pistol).*(walk)|walk.*(aim|gun|rifle)/, 'aim_walk'],
    [/panic|terrified|scared.*run/, 'panic_run'],
    [/run|sprint|jog/, 'run'],
    [/walk/, 'walk'],
    [/pistol.*(shoot|fire)|(shoot|fire).*pistol/, 'shoot_pistol'],
    [/(shoot|fire|firing)/, 'shoot_smg'],
    [/throw|grenade/, 'throw'],
    [/hit|react|impact/, 'hit'],
    [/death|dying|die/, 'death_a'],
    [/cower|crouch.*fear|scared/, 'cower'],
  ];
  for (const [re, id] of guesses) if (re.test(n)) return id;
  return null;
}
