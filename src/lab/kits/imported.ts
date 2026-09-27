import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils.js';
import { canonicalClipName } from '../anim/catalogue.ts';
import { meshVoxels } from '../voxel/mesher.ts';
import { parseVox } from '../voxel/vox.ts';
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
  notes?: string;
  format?: 'glb' | 'vox';
}

export interface Manifest {
  assets: ManifestEntry[];
}

const loader = new GLTFLoader();
const cache = new Map<string, Promise<GLTF>>();
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

export function addDropped(file: File): ManifestEntry {
  const url = URL.createObjectURL(file);
  const isVox = file.name.toLowerCase().endsWith('.vox');
  const base = file.name.replace(/\.[^.]+$/, '');
  const entry: ManifestEntry = {
    id: `drop-${dropped.length}-${base}`,
    name: base,
    file: url,
    category: 'character',
    source: `Dropped file (${file.name})`,
    format: isVox ? 'vox' : 'glb',
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

export async function loadEntry(e: ManifestEntry): Promise<LabAsset> {
  const url = resolveUrl(e.file);
  if (e.format === 'vox' || url.toLowerCase().endsWith('.vox')) {
    const buf = await (await fetch(url)).arrayBuffer();
    const { grid, palette } = parseVox(buf);
    const obj = normalise(meshVoxels(grid, palette, 0.1, [grid.nx / 2, 0, grid.nz / 2]), e.height, e.category);
    return { object: obj, clips: [], name: e.name, category: e.category, source: e.source ?? 'MagicaVoxel .vox', notes: e.notes };
  }
  let p = cache.get(url);
  if (!p) {
    p = loader.loadAsync(url);
    cache.set(url, p);
  }
  const gltf = await p;
  const scene = SkeletonUtils.clone(gltf.scene);
  const obj = normalise(scene, e.height, e.category);
  if (e.accent) applyAccent(obj, e.accent);
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
  const notes = [e.notes, unmapped.length ? `Unmapped clips: ${unmapped.join(', ')}` : ''].filter(Boolean).join(' · ');
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
