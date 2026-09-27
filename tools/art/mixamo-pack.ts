/**
 * Packs a static textured GLB as an OBJ + MTL + base colour texture zip, the format Mixamo's
 * auto-rigger accepts (it can't read GLB). Output lands next to the input.
 *
 *   node tools/art/mixamo-pack.ts public/lab/assets/tripo/agent_01.glb
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

interface Accessor { bufferView: number; byteOffset?: number; componentType: number; count: number; type: string }
interface BufferView { byteOffset?: number; byteLength: number; byteStride?: number }

const input = resolve(process.argv[2] ?? '');
const glb = readFileSync(input);
const jsonLen = glb.readUInt32LE(12);
const gltf = JSON.parse(glb.subarray(20, 20 + jsonLen).toString('utf8'));
const bin = glb.subarray(20 + jsonLen + 8);

const COMPONENTS: Record<string, number> = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 };
function read(index: number): number[][] {
  const a: Accessor = gltf.accessors[index];
  const bv: BufferView = gltf.bufferViews[a.bufferView];
  const n = COMPONENTS[a.type];
  const size = { 5121: 1, 5123: 2, 5125: 4, 5126: 4 }[a.componentType]!;
  const stride = bv.byteStride ?? size * n;
  const base = (bv.byteOffset ?? 0) + (a.byteOffset ?? 0);
  const get = (o: number) =>
    a.componentType === 5126 ? bin.readFloatLE(o) : a.componentType === 5125 ? bin.readUInt32LE(o) : a.componentType === 5123 ? bin.readUInt16LE(o) : bin.readUInt8(o);
  return Array.from({ length: a.count }, (_, i) => Array.from({ length: n }, (_, k) => get(base + i * stride + k * size)));
}

const name = basename(input).replace(/\.glb$/i, '');
const work = join(tmpdir(), `mixamo-${name}`);
rmSync(work, { recursive: true, force: true });
mkdirSync(work);

// Mixamo reads OBJ units as centimetres; scale to a ~180 cm character.
const obj: string[] = [`mtllib ${name}.mtl`];
const mtl: string[] = [];
let vBase = 0;
let texFile = '';
for (const mesh of gltf.meshes) {
  for (const prim of mesh.primitives) {
    const P = read(prim.attributes.POSITION);
    const N = prim.attributes.NORMAL !== undefined ? read(prim.attributes.NORMAL) : null;
    const T = prim.attributes.TEXCOORD_0 !== undefined ? read(prim.attributes.TEXCOORD_0) : null;
    const idx = prim.indices !== undefined ? read(prim.indices).map((x) => x[0]) : P.map((_, i) => i);
    const minY = Math.min(...P.map((p) => p[1]));
    const maxY = Math.max(...P.map((p) => p[1]));
    const k = 180 / (maxY - minY);
    for (const p of P) obj.push(`v ${(p[0] * k).toFixed(4)} ${((p[1] - minY) * k).toFixed(4)} ${(p[2] * k).toFixed(4)}`);
    if (T) for (const t of T) obj.push(`vt ${t[0].toFixed(6)} ${(1 - t[1]).toFixed(6)}`);
    if (N) for (const nn of N) obj.push(`vn ${nn[0].toFixed(5)} ${nn[1].toFixed(5)} ${nn[2].toFixed(5)}`);
    const mat = gltf.materials?.[prim.material ?? 0];
    const texIndex = mat?.pbrMetallicRoughness?.baseColorTexture?.index;
    if (texIndex !== undefined && !texFile) {
      const img = gltf.images[gltf.textures[texIndex].source];
      const bv: BufferView = gltf.bufferViews[img.bufferView];
      texFile = `${name}_basecolor.${img.mimeType === 'image/png' ? 'png' : 'jpg'}`;
      writeFileSync(join(work, texFile), bin.subarray(bv.byteOffset ?? 0, (bv.byteOffset ?? 0) + bv.byteLength));
      mtl.push('newmtl body', 'Kd 1 1 1', `map_Kd ${texFile}`);
    }
    obj.push('usemtl body');
    for (let i = 0; i < idx.length; i += 3) {
      const f = [idx[i], idx[i + 1], idx[i + 2]].map((j) => {
        const v = j + 1 + vBase;
        return T && N ? `${v}/${v}/${v}` : N ? `${v}//${v}` : T ? `${v}/${v}` : `${v}`;
      });
      obj.push(`f ${f.join(' ')}`);
    }
    vBase += P.length;
  }
}
writeFileSync(join(work, `${name}.obj`), obj.join('\n'));
writeFileSync(join(work, `${name}.mtl`), mtl.join('\n'));
const out = join(dirname(input), `${name}_mixamo.zip`);
rmSync(out, { force: true });
execFileSync('zip', ['-j', '-q', out, join(work, `${name}.obj`), join(work, `${name}.mtl`), ...(texFile ? [join(work, texFile)] : [])]);
console.log(`${out} (${vBase} vertices${texFile ? `, texture ${texFile}` : ''})`);
