import * as THREE from 'three';
import { design } from '../kits/designs.ts';
import { countTriangles } from '../kits/geo.ts';
import type { ManifestEntry } from '../kits/imported.ts';
import { PROP_LABELS, type CharacterKind, type PropKind, type StyleKit } from '../kits/types.ts';
import { bakeSkinned, mergeVoxelParts, toGLB } from './bake.ts';

export interface CharacterJob {
  kind: CharacterKind;
  variant: number;
  style: 'lowpoly' | 'voxel';
}

export interface PropJob {
  prop: PropKind;
  style: 'lowpoly' | 'voxel';
}

const STYLE_TAG = { lowpoly: 'a', voxel: 'c' } as const;
const STYLE_NAME = { lowpoly: 'Style A', voxel: 'Style C' } as const;

async function save(file: string, data: ArrayBuffer | string): Promise<void> {
  const res = await fetch(`/__lab/save?file=${encodeURIComponent(file)}`, { method: 'POST', body: data });
  if (!res.ok) throw new Error(`save ${file}: ${res.status}`);
}

async function register(entry: ManifestEntry): Promise<void> {
  const res = await fetch('/__lab/manifest', { method: 'POST', body: JSON.stringify(entry) });
  if (!res.ok) throw new Error(`manifest ${entry.id}: ${res.status}`);
}

export async function exportCharacter(kit: StyleKit, job: CharacterJob): Promise<string> {
  const d = design(job.kind, job.variant);
  const slug = `${job.kind}_${job.variant}_${STYLE_TAG[job.style]}`;
  const asset = await kit.character(job.kind, job.variant);
  const tris = countTriangles(asset.object);
  const baked = bakeSkinned(asset.object);
  baked.name = `${d.name} (${STYLE_NAME[job.style]})`;
  const glb = await toGLB(baked, asset.clips);
  const file = `assets/generated/${slug}.glb`;
  await save(file, glb);
  let voxNote = '';
  if (job.style === 'voxel') {
    const fresh = await kit.character(job.kind, job.variant);
    const vox = mergeVoxelParts(fresh.object);
    if (vox) {
      await save(`assets/generated/${slug}.vox`, vox);
      voxNote = ` · MagicaVoxel source: ${slug}.vox`;
      await register({
        id: `${slug}_vox`,
        name: `${d.name} · C (.vox)`,
        file: `assets/generated/${slug}.vox`,
        category: 'character',
        format: 'vox',
        source: 'MagicaVoxel .vox (merged rest pose, editable)',
        height: d.prop.height,
      });
    }
  }
  await register({
    id: slug,
    name: `${d.name} · ${STYLE_TAG[job.style].toUpperCase()}`,
    file,
    category: 'character',
    kind: job.kind,
    source: `${STYLE_NAME[job.style]} kit → skinned GLB (${tris.toLocaleString()} tris, ${asset.clips.length} clips)`,
    height: d.prop.height,
    notes: `Mixamo-named skeleton, rigid skinning${voxNote}`,
  });
  return `${file} ${(glb.byteLength / 1024).toFixed(0)} KB`;
}

/** Static props: flat normals baked in, glows converted to emissive, as for characters. */
export async function exportProp(kit: StyleKit, job: PropJob): Promise<string> {
  const slug = `prop_${job.prop}_${STYLE_TAG[job.style]}`;
  const asset = await kit.prop(job.prop);
  const tris = countTriangles(asset.object);
  // Reuse the skinned baker's material/normal handling via a one-bone rig.
  const holder = new THREE.Group();
  const bone = new THREE.Bone();
  bone.name = 'root';
  holder.add(bone);
  bone.add(asset.object);
  const baked = bakeSkinned(holder);
  baked.name = PROP_LABELS[job.prop];
  const glb = await toGLB(baked, []);
  const file = `assets/generated/${slug}.glb`;
  await save(file, glb);
  await register({
    id: slug,
    name: `${PROP_LABELS[job.prop]} · ${STYLE_TAG[job.style].toUpperCase()}`,
    file,
    category: 'prop',
    prop: job.prop,
    source: `${STYLE_NAME[job.style]} kit → GLB (${tris.toLocaleString()} tris)`,
  });
  return `${file} ${(glb.byteLength / 1024).toFixed(0)} KB`;
}

export const DEFAULT_CHARACTERS: CharacterJob[] = (['lowpoly', 'voxel'] as const).flatMap((style) => [
  { kind: 'agent' as const, variant: 0, style },
  { kind: 'agent' as const, variant: 3, style },
  { kind: 'rival' as const, variant: 0, style },
  { kind: 'police' as const, variant: 0, style },
  { kind: 'civilian' as const, variant: 1, style },
]);

export const DEFAULT_PROPS: PropJob[] = (['lowpoly', 'voxel'] as const).flatMap((style) => [
  { prop: 'car' as const, style },
  { prop: 'vtol' as const, style },
]);
