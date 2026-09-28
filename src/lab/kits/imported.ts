import * as THREE from 'three';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils.js';
import { canonicalClipName, CLIP_IDS } from '../anim/catalogue.ts';
import { repairRestPose, retargetProcedural } from '../anim/retarget.ts';
import { meshVoxels } from '../voxel/mesher.ts';
import { parseVox } from '../voxel/vox.ts';
import { attachToHand, type AttachSpec } from './attach.ts';
import { baselineKit } from './baseline.ts';
import { CHARACTER_LABELS, PROP_LABELS, type AssetCategory, type CharacterKind, type LabAsset, type PropKind, type StyleKit } from './types.ts';

/** One entry in public/lab/manifest.json (or a file dropped onto the lab). */
export interface ManifestEntry {
  id: string;
  name: string;
  /** Path relative to /lab/ (e.g. "assets/tripo/agent_01.glb") or an object URL for drops. */
  file: string;
  category: AssetCategory;
  kind?: CharacterKind;
  prop?: PropKind;
  source?: string;
  /** Target height in metres after normalisation (characters default to 1.8). */
  height?: number;
  clipAliases?: Record<string, string>;
  /** Recolour emissive materials to a faction accent. */
  accent?: string;
  /** Make texture regions close to this colour glow (for generated models exported without emissive maps). */
  glowColor?: string;
  notes?: string;
  format?: 'glb' | 'fbx' | 'vox';
  /** Extra GLB/FBX files whose first animation plays on this model (e.g. Mixamo downloads, "without skin"). */
  extraAnimations?: { file: string; clip: string }[];
  /** Other manifest assets held by this character (weapons). */
  attach?: AttachSpec[];
  /** Marks a holdable item (weapon) and how it sits in the hand. */
  hold?: Omit<AttachSpec, 'asset'>;
}

export interface Manifest {
  assets: ManifestEntry[];
}

interface Loaded {
  scene: THREE.Object3D;
  animations: THREE.AnimationClip[];
}

const gltfLoader = new GLTFLoader();
const fbxLoader = new FBXLoader();
const cache = new Map<string, Promise<Loaded>>();

function loadModel(url: string, format?: ManifestEntry['format']): Promise<Loaded> {
  let p = cache.get(url);
  if (!p) {
    p =
      format === 'fbx' || url.toLowerCase().endsWith('.fbx')
        ? fbxLoader.loadAsync(url).then((g) => ({ scene: g, animations: g.animations }))
        : gltfLoader.loadAsync(url).then((g) => ({ scene: g.scene, animations: g.animations }));
    cache.set(url, p);
  }
  return p;
}
let manifest: Manifest = { assets: [] };
const dropped: ManifestEntry[] = [];

export async function loadManifest(): Promise<Manifest> {
  try {
    const res = await fetch(`${import.meta.env.BASE_URL}lab/manifest.json`, { cache: 'no-store' });
    if (res.ok) manifest = (await res.json()) as Manifest;
  } catch {
    manifest = { assets: [] };
  }
  return manifest;
}

export function importedEntries(): ManifestEntry[] {
  return [...manifest.assets, ...dropped];
}

export function weaponEntries(): ManifestEntry[] {
  return importedEntries().filter((e) => e.hold);
}

export function addDropped(file: File): ManifestEntry {
  const url = URL.createObjectURL(file);
  const ext = file.name.toLowerCase().split('.').pop();
  const base = file.name.replace(/\.[^.]+$/, '');
  const entry: ManifestEntry = {
    id: `drop-${dropped.length}-${base}`,
    name: base,
    file: url,
    category: 'character',
    source: `Dropped file (${file.name})`,
    format: ext === 'vox' ? 'vox' : ext === 'fbx' ? 'fbx' : 'glb',
  };
  dropped.push(entry);
  return entry;
}

function resolveUrl(file: string): string {
  if (file.startsWith('blob:') || file.startsWith('http') || file.startsWith('/')) return file;
  return `${import.meta.env.BASE_URL}lab/${file}`;
}

function normalise(obj: THREE.Object3D, height: number | undefined, category: AssetCategory): THREE.Group {
  const wrap = new THREE.Group();
  wrap.add(obj);
  obj.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(obj, true);
  const size = box.getSize(new THREE.Vector3());
  const target = height ?? (category === 'character' ? 1.8 : 0);
  const k = target > 0 && size.y > 1e-4 ? target / size.y : 1;
  obj.scale.multiplyScalar(k);
  obj.updateMatrixWorld(true);
  const b2 = new THREE.Box3().setFromObject(obj, true);
  const c = b2.getCenter(new THREE.Vector3());
  obj.position.x -= c.x;
  obj.position.z -= c.z;
  obj.position.y -= b2.min.y;
  obj.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh) {
      m.castShadow = true;
      m.receiveShadow = true;
      m.frustumCulled = false;
    }
  });
  return wrap;
}

function applyAccent(obj: THREE.Object3D, accent: string): void {
  obj.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    const mats = Array.isArray(m.material) ? m.material : [m.material];
    for (const mt of mats) {
      const s = mt as THREE.MeshStandardMaterial;
      if (s.emissive && (s.emissiveIntensity > 0 || s.emissiveMap) && s.emissive.getHex() !== 0) {
        s.emissive.set(accent);
        s.emissiveIntensity = Math.max(2, s.emissiveIntensity);
      }
    }
  });
}

const GLOW_MAP_MAX = 1024;

/** Builds an emissive map from the pixels of the base colour texture that match `hex` in hue. */
function applyGlowKey(obj: THREE.Object3D, hex: string): void {
  const key = new THREE.Color(hex);
  const keyHsl = { h: 0, s: 0, l: 0 };
  key.getHSL(keyHsl);
  const done = new Map<THREE.Texture, THREE.Texture>();
  obj.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    for (const mt of Array.isArray(m.material) ? m.material : [m.material]) {
      const s = mt as THREE.MeshStandardMaterial;
      const img = s.map?.image as CanvasImageSource & { width: number; height: number } | undefined;
      if (!s.map || !img?.width) continue;
      let em = done.get(s.map);
      if (!em) {
        const c = document.createElement('canvas');
        const k = Math.min(1, GLOW_MAP_MAX / Math.max(img.width, img.height));
        c.width = Math.round(img.width * k);
        c.height = Math.round(img.height * k);
        const g = c.getContext('2d', { willReadFrequently: true })!;
        g.drawImage(img, 0, 0, c.width, c.height);
        const data = g.getImageData(0, 0, c.width, c.height);
        const px = data.data;
        const col = new THREE.Color();
        const hsl = { h: 0, s: 0, l: 0 };
        for (let i = 0; i < px.length; i += 4) {
          col.setRGB(px[i] / 255, px[i + 1] / 255, px[i + 2] / 255);
          col.getHSL(hsl);
          const dh = Math.min(Math.abs(hsl.h - keyHsl.h), 1 - Math.abs(hsl.h - keyHsl.h));
          const on = dh < 0.06 && hsl.s > 0.45 && hsl.l > 0.28;
          if (!on) px[i] = px[i + 1] = px[i + 2] = 0;
        }
        g.putImageData(data, 0, 0);
        em = new THREE.CanvasTexture(c);
        em.colorSpace = THREE.SRGBColorSpace;
        em.flipY = s.map.flipY;
        em.channel = s.map.channel;
        done.set(s.map, em);
      }
      s.emissiveMap = em;
      s.emissive.set('#ffffff');
      s.emissiveIntensity = 2.6;
      s.needsUpdate = true;
    }
  });
}

export async function loadEntry(e: ManifestEntry, opts: { weapon?: string } = {}): Promise<LabAsset> {
  const url = resolveUrl(e.file);
  if (e.format === 'vox' || url.toLowerCase().endsWith('.vox')) {
    const buf = await (await fetch(url)).arrayBuffer();
    const { grid, palette } = parseVox(buf);
    const obj = normalise(meshVoxels(grid, palette, 0.1, [grid.nx / 2, 0, grid.nz / 2]), e.height, e.category);
    return { object: obj, clips: [], name: e.name, category: e.category, source: e.source ?? 'MagicaVoxel .vox', notes: e.notes };
  }
  const gltf = await loadModel(url, e.format);
  const scene = SkeletonUtils.clone(gltf.scene);
  scene.traverse((o) => (o as THREE.SkinnedMesh).isSkinnedMesh && (o as THREE.SkinnedMesh).normalizeSkinWeights());
  const repaired = repairRestPose(scene);
  const placeholders = e.category === 'character' ? retargetProcedural(scene) : [];
  const obj = normalise(scene, e.height, e.category);
  if (e.accent) applyAccent(obj, e.accent);
  if (e.glowColor) applyGlowKey(obj, e.glowColor);
  const clips: THREE.AnimationClip[] = [];
  const unmapped: string[] = [];
  for (const clip of gltf.animations) {
    const id = canonicalClipName(clip.name, e.clipAliases);
    if (id && !clips.some((c) => c.name === id)) {
      const c = clip.clone();
      c.name = id;
      clips.push(c);
    } else unmapped.push(clip.name);
  }
  for (const x of e.extraAnimations ?? []) {
    try {
      const g = await loadModel(resolveUrl(x.file));
      const c = g.animations[0]?.clone();
      if (c && !clips.some((k) => k.name === x.clip)) {
        c.name = x.clip;
        clips.push(c);
      }
    } catch {
      unmapped.push(`${x.file} (failed to load)`);
    }
  }
  // Fill catalogue gaps with the lab's placeholder clips, retargeted onto this skeleton.
  const filled: string[] = [];
  for (const c of placeholders) {
    if (CLIP_IDS.includes(c.name) && !clips.some((k) => k.name === c.name)) {
      clips.push(c);
      filled.push(c.name);
    }
  }
  const held: string[] = [];
  const attach = opts.weapon === 'none' ? [] : opts.weapon ? [{ asset: opts.weapon }] : (e.attach ?? []);
  if (e.category === 'character') {
    for (const a of attach) {
      const src = importedEntries().find((x) => x.id === a.asset);
      if (src && attachToHand(obj, (await loadEntry(src)).object, clips, { ...src.hold, ...a })) held.push(src.name);
    }
  }
  const notes = [
    e.notes,
    held.length ? `Holding ${held.join(', ')}` : '',
    repaired ? 'Rest pose rebuilt from bind matrices' : '',
    filled.length ? `${filled.length} placeholder clips retargeted (${filled.length === CLIP_IDS.length ? 'all' : filled.join(', ')})` : '',
    unmapped.length ? `Unmapped clips: ${unmapped.join(', ')}` : ''].filter(Boolean).join(' · ');
  return { object: obj, clips, name: e.name, category: e.category, source: e.source ?? url, notes };
}

async function placeholder(label: string, make: () => Promise<LabAsset>): Promise<LabAsset> {
  const a = await make();
  a.source = 'Placeholder (baseline)';
  a.notes = `No imported model for ${label} yet: add one to public/lab/manifest.json`;
  return a;
}

export const importedKit: StyleKit = {
  id: 'imported',
  label: 'Imported · GLB / VOX',
  short: 'Imp',
  palette: { name: 'Per-asset (from files)', swatches: [] },
  async character(kind, variant) {
    const matches = importedEntries().filter((e) => e.category === 'character' && e.kind === kind);
    if (matches.length) return loadEntry(matches[variant % matches.length]);
    return placeholder(CHARACTER_LABELS[kind], () => baselineKit.character(kind, variant));
  },
  async prop(kind) {
    const match = importedEntries().find((e) => e.category === 'prop' && e.prop === kind);
    if (match) return loadEntry(match);
    return placeholder(PROP_LABELS[kind], () => baselineKit.prop(kind));
  },
  async building(spec) {
    return placeholder(spec.label, () => baselineKit.building(spec));
  },
  async sign(text, color, vertical) {
    return baselineKit.sign(text, color, vertical);
  },
};
