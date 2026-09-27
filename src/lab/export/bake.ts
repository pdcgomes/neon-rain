import * as THREE from 'three';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { VoxelGrid, type VoxelPalette } from '../voxel/mesher.ts';
import { writeVox } from '../voxel/vox.ts';

/**
 * Turns a kit character (rigid parts parented to bones) into a single skinned mesh on a
 * Mixamo-named skeleton, the shape Blender, Mixamo and the game's GLB path all expect.
 * Each part is weighted 100% to its bone. Must be given a freshly built asset in rest pose.
 */
export function bakeSkinned(root: THREE.Object3D): THREE.Group {
  root.position.set(0, 0, 0);
  root.rotation.set(0, 0, 0);
  root.updateMatrixWorld(true);
  const bones: THREE.Bone[] = [];
  root.traverse((o) => {
    if ((o as THREE.Bone).isBone) bones.push(o as THREE.Bone);
  });
  const boneIndex = new Map(bones.map((b, i) => [b, i]));
  const rootInv = root.matrixWorld.clone().invert();

  const byMaterial = new Map<string, { material: THREE.Material; geos: THREE.BufferGeometry[] }>();
  const meshes: THREE.Mesh[] = [];
  root.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) meshes.push(o as THREE.Mesh);
  });
  for (const m of meshes) {
    let b: THREE.Object3D | null = m.parent;
    while (b && !(b as THREE.Bone).isBone) b = b.parent;
    const bi = b ? boneIndex.get(b as THREE.Bone) ?? 0 : 0;
    let g = m.geometry.clone();
    g = g.index ? g.toNonIndexed() : g;
    g.applyMatrix4(new THREE.Matrix4().multiplyMatrices(rootInv, m.matrixWorld));
    for (const name of Object.keys(g.attributes)) if (name !== 'position' && name !== 'normal' && name !== 'color') g.deleteAttribute(name);
    // Faceted shading survives export: non-indexed triangles get per-face normals.
    g.computeVertexNormals();
    const n = g.attributes.position.count;
    if (!g.attributes.color) g.setAttribute('color', new THREE.Float32BufferAttribute(new Float32Array(n * 3).fill(1), 3));
    const si = new Uint16Array(n * 4);
    const sw = new Float32Array(n * 4);
    for (let i = 0; i < n; i++) {
      si[i * 4] = bi;
      sw[i * 4] = 1;
    }
    g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(si, 4));
    g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(sw, 4));
    const mat = Array.isArray(m.material) ? m.material[0] : m.material;
    const key = mat.uuid;
    const slot = byMaterial.get(key) ?? { material: mat, geos: [] };
    slot.geos.push(g);
    byMaterial.set(key, slot);
    m.parent?.remove(m);
  }

  const out = new THREE.Group();
  out.name = root.name || 'Character';
  const armature = new THREE.Group();
  armature.name = 'Armature';
  const hips = bones[0];
  armature.add(hips);
  out.add(armature);
  out.updateMatrixWorld(true);
  const skeleton = new THREE.Skeleton(bones);
  let i = 0;
  for (const { material, geos } of byMaterial.values()) {
    const geo = mergeGeometries(geos, false);
    if (!geo) continue;
    const sm = new THREE.SkinnedMesh(geo, exportMaterial(material));
    sm.name = `${out.name}_${i++}`;
    sm.castShadow = true;
    sm.receiveShadow = true;
    sm.bind(skeleton, new THREE.Matrix4());
    out.add(sm);
  }
  return out;
}

/** glTF-friendly material: glows become emissive, colours come from vertex colours or base colour. */
function exportMaterial(m: THREE.Material): THREE.MeshStandardMaterial {
  const basic = m as THREE.MeshBasicMaterial;
  if (basic.isMeshBasicMaterial) {
    const hex = (basic.userData.labColor as string) ?? `#${basic.color.getHexString()}`;
    const strength = (basic.userData.glowStrength as number) ?? 2.5;
    const out = new THREE.MeshStandardMaterial({ color: '#000000', emissive: hex, emissiveIntensity: strength, roughness: 0.5 });
    out.name = `glow_${hex.slice(1)}`;
    return out;
  }
  const s = m as THREE.MeshStandardMaterial;
  const out = new THREE.MeshStandardMaterial({
    color: s.vertexColors ? '#ffffff' : s.color,
    vertexColors: true,
    roughness: s.roughness,
    metalness: s.metalness,
    emissive: s.emissive,
    emissiveIntensity: s.emissiveIntensity,
    side: s.side,
  });
  out.name = s.userData.labColor ? `mat_${String(s.userData.labColor).slice(1)}` : s.name || 'mat';
  return out;
}

export async function toGLB(obj: THREE.Object3D, clips: THREE.AnimationClip[]): Promise<ArrayBuffer> {
  const exporter = new GLTFExporter();
  const res = await exporter.parseAsync(obj, { binary: true, animations: clips, onlyVisible: true });
  return res as ArrayBuffer;
}

/**
 * Merges a voxel character's per-bone part grids into one grid in rest pose, for editing in
 * MagicaVoxel. Parts are snapped to the voxel lattice.
 */
export function mergeVoxelParts(root: THREE.Object3D): ArrayBuffer | null {
  root.updateMatrixWorld(true);
  const parts: { grid: VoxelGrid; palette: VoxelPalette; size: number; anchor: [number, number, number]; origin: THREE.Vector3 }[] = [];
  root.traverse((o) => {
    const v = o.userData.voxel as { grid: VoxelGrid; palette: VoxelPalette; size: number; anchor: [number, number, number] } | undefined;
    if (v) parts.push({ ...v, origin: new THREE.Vector3().setFromMatrixPosition(o.matrixWorld) });
  });
  if (!parts.length) return null;
  const size = parts[0].size;
  const palette = parts[0].palette;
  const cells: [number, number, number, number][] = [];
  for (const p of parts) {
    if (p.palette !== palette) continue;
    for (let z = 0; z < p.grid.nz; z++)
      for (let y = 0; y < p.grid.ny; y++)
        for (let x = 0; x < p.grid.nx; x++) {
          const c = p.grid.get(x, y, z);
          if (!c) continue;
          const wx = p.origin.x / size + (x + 0.5 - p.anchor[0]);
          const wy = p.origin.y / size + (y + 0.5 - p.anchor[1]);
          const wz = p.origin.z / size + (z + 0.5 - p.anchor[2]);
          cells.push([Math.floor(wx), Math.floor(wy), Math.floor(wz), c]);
        }
  }
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (const c of cells)
    for (let k = 0; k < 3; k++) {
      min[k] = Math.min(min[k], c[k]);
      max[k] = Math.max(max[k], c[k]);
    }
  const grid = new VoxelGrid(max[0] - min[0] + 1, max[1] - min[1] + 1, max[2] - min[2] + 1);
  for (const [x, y, z, c] of cells) grid.set(x - min[0], y - min[1], z - min[2], c);
  return writeVox(grid, palette);
}
