import * as THREE from 'three';
import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils.js';
import { attachToHand } from '../lab/kits/attach.ts';
import { importedEntries, loadEntry, loadManifest, type ManifestEntry } from '../lab/kits/imported.ts';
import type { LabAsset } from '../lab/kits/types.ts';
import { hash2 } from '../sim/rng.ts';
import type { Entity } from '../sim/types.ts';
import type { World } from '../sim/world.ts';

const CHARACTER = 'mixamo-agent-01';
/** Sim weapon id -> manifest weapon. Unlisted weapons (persuadertron, grenade) show empty hands. */
const WEAPON_ART: Record<string, string> = {
  pistol: 'tripo-pistol-01',
  uzi: 'tripo-smg-01',
  minigun: 'tripo-minigun-01',
  gauss: 'tripo-minigun-01',
};
const SHOOT_CLIP: Record<string, string> = { pistol: 'shoot_pistol', persuadertron: 'shoot_pistol' };
/** Imported models are normalised to 1.8 m; the game's agents stand about 2 m tall. */
const SCALE = 1.1;
/** Ground speed each locomotion clip was authored at (m/s), for foot-sync playback rates. */
const CLIP_SPEED: Record<string, number> = { walk: 1.5, strafe: 1.6, run: 4.2 };
const FADE = 0.18;

interface Rig {
  root: THREE.Group;
  mixer: THREE.AnimationMixer;
  actions: Map<string, THREE.AnimationAction>;
  current: THREE.AnimationAction | null;
  weapons: Map<string, THREE.Object3D>;
}

export interface AgentArt {
  base: LabAsset;
  weapons: Map<string, { entry: ManifestEntry; object: THREE.Object3D }>;
}

let artPromise: Promise<AgentArt | null> | null = null;
let art: AgentArt | null = null;
const progress = { done: 0, total: 1 };

/**
 * Loads the imported agent and weapon art once per page; later calls reuse it. Resolves to null
 * with ?art=classic or if the assets can't be loaded, in which case agents stay procedural.
 */
export function preloadAgentArt(): Promise<AgentArt | null> {
  if (artPromise) return artPromise;
  if (new URLSearchParams(location.search).get('art') === 'classic') {
    progress.done = progress.total;
    return (artPromise = Promise.resolve(null));
  }
  artPromise = (async () => {
    await loadManifest();
    const entry = importedEntries().find((e) => e.id === CHARACTER);
    if (!entry) throw new Error(`${CHARACTER} missing from lab manifest`);
    const ids = [...new Set(Object.values(WEAPON_ART))];
    progress.total = 1 + ids.length;
    const tick = <T>(p: Promise<T>) => p.then((v) => (progress.done++, v));
    const [base, ...weapons] = await Promise.all([
      tick(loadEntry(entry, { weapon: 'none' })),
      ...ids.map((id) => {
        const w = importedEntries().find((e) => e.id === id);
        return tick(w ? loadEntry(w).then((a) => ({ entry: w, object: a.object })) : Promise.resolve(null));
      }),
    ]);
    const loaded: AgentArt = { base, weapons: new Map() };
    for (const w of weapons) if (w) loaded.weapons.set(w.entry.id, w);
    return (art = loaded);
  })().catch((err) => {
    console.warn('Imported agent art unavailable, using procedural agents.', err);
    progress.done = progress.total;
    return null;
  });
  return artPromise;
}

/** Fraction of the agent art loaded so far, 0..1. */
export function agentArtProgress(): number {
  return progress.done / progress.total;
}

/**
 * Renders player agents with the imported Mixamo character and Tripo weapons from the lab
 * manifest, if `preloadAgentArt` has finished; otherwise `ids` stays empty and the procedural
 * actors draw agents as before.
 */
export class AgentModels {
  readonly group = new THREE.Group();
  /** Entities currently drawn by this renderer; the procedural actors skip them. */
  readonly ids = new Set<number>();
  private art = art;
  private rigs = new Map<number, Rig>();
  private tmp = new THREE.Vector2();

  private spawn(e: Entity): Rig {
    const base = this.art!.base;
    const root = new THREE.Group();
    const body = SkeletonUtils.clone(base.object);
    body.scale.multiplyScalar(SCALE);
    root.add(body);
    const weapons = new Map<string, THREE.Object3D>();
    for (const wid of e.weapons) {
      const art = this.art!.weapons.get(WEAPON_ART[wid] ?? '');
      if (!art || weapons.has(wid)) continue;
      const item = art.object.clone(true);
      if (attachToHand(body, item, base.clips, { ...art.entry.hold, asset: art.entry.id })) {
        let holder: THREE.Object3D | undefined;
        body.traverse((o) => {
          if (o.name === `held:${art.entry.id}` && !holder && ![...weapons.values()].includes(o)) holder = o;
        });
        if (holder) weapons.set(wid, holder);
      }
    }
    const mixer = new THREE.AnimationMixer(body);
    const actions = new Map<string, THREE.AnimationAction>();
    for (const c of base.clips) {
      const a = mixer.clipAction(c);
      if (c.name.startsWith('death')) {
        a.setLoop(THREE.LoopOnce, 1);
        a.clampWhenFinished = true;
      }
      actions.set(c.name, a);
    }
    this.group.add(root);
    return { root, mixer, actions, current: null, weapons };
  }

  private clipFor(e: Entity, speed: number): { clip: string; rate: number } {
    if (!e.alive) return { clip: hash2(e.id, 31) < 0.5 ? 'death_a' : 'death_b', rate: 1 };
    const wid = e.weapons[e.weaponIdx] ?? '';
    const shooting = !e.holstered && (e.firing || e.autoFire);
    if (speed < 0.35) return { clip: shooting ? (SHOOT_CLIP[wid] ?? 'shoot_smg') : 'idle', rate: 1 };
    // Moving: pick by travel direction relative to where the agent faces (move-and-shoot strafes).
    const fx = Math.cos(e.facing);
    const fy = Math.sin(e.facing);
    const along = (e.vx * fx + e.vy * fy) / speed;
    if (Math.abs(along) < 0.5) {
      const side = (fx * e.vy - fy * e.vx) / speed;
      return { clip: 'strafe', rate: Math.sign(side || 1) * (speed / CLIP_SPEED.strafe) };
    }
    const clip = speed > 2.8 ? 'run' : 'walk';
    return { clip, rate: Math.sign(along) * THREE.MathUtils.clamp(speed / CLIP_SPEED[clip], 0.5, 1.8) };
  }

  update(world: World, alpha: number, dt: number): void {
    if (!this.art) return;
    const seen = new Set<number>();
    for (const e of world.entities) {
      if (e.kind !== 'agent' || e.faction !== 'player') continue;
      seen.add(e.id);
      let rig = this.rigs.get(e.id);
      if (!rig) {
        rig = this.spawn(e);
        this.rigs.set(e.id, rig);
      }
      this.ids.add(e.id);
      const speed = this.tmp.set(e.vx, e.vy).length();
      rig.root.position.set(e.px + (e.x - e.px) * alpha, 0, e.py + (e.y - e.py) * alpha);
      rig.root.rotation.y = Math.PI / 2 - e.facing;

      const { clip, rate } = this.clipFor(e, speed);
      const next = rig.actions.get(clip) ?? rig.actions.get('idle')!;
      if (next !== rig.current) {
        next.reset().play();
        if (rig.current) next.crossFadeFrom(rig.current, FADE, false);
        rig.current = next;
      }
      next.timeScale = rate;

      const wid = e.weapons[e.weaponIdx];
      for (const [id, w] of rig.weapons) w.visible = e.alive && !e.holstered && id === wid;
      rig.mixer.update(dt);
    }
    for (const [id, rig] of this.rigs) {
      if (seen.has(id)) continue;
      this.group.remove(rig.root);
      rig.mixer.stopAllAction();
      this.rigs.delete(id);
      this.ids.delete(id);
    }
  }
}
