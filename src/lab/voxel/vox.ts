import { VoxelGrid, VoxelPalette } from './mesher.ts';

/**
 * Minimal MagicaVoxel .vox reader (first model). Handles SIZE, XYZI, RGBA and MATL (emit).
 * MagicaVoxel is z-up; we convert to y-up with z pointing forward.
 */
export function parseVox(buf: ArrayBuffer): { grid: VoxelGrid; palette: VoxelPalette } {
  const dv = new DataView(buf);
  const str = (o: number, n: number) => String.fromCharCode(...new Uint8Array(buf, o, n));
  if (str(0, 4) !== 'VOX ') throw new Error('Not a .vox file');
  const found: { size?: [number, number, number]; voxels?: Uint8Array } = {};
  const rgba: number[][] = [];
  const emit = new Set<number>();

  const walk = (start: number, end: number) => {
    let o = start;
    while (o < end) {
      const id = str(o, 4);
      const content = dv.getInt32(o + 4, true);
      const children = dv.getInt32(o + 8, true);
      const body = o + 12;
      if (id === 'SIZE' && !found.size) found.size = [dv.getInt32(body, true), dv.getInt32(body + 4, true), dv.getInt32(body + 8, true)];
      else if (id === 'XYZI' && !found.voxels) {
        const n = dv.getInt32(body, true);
        found.voxels = new Uint8Array(buf, body + 4, n * 4);
      } else if (id === 'RGBA') {
        for (let i = 0; i < 256; i++) rgba.push([dv.getUint8(body + i * 4), dv.getUint8(body + i * 4 + 1), dv.getUint8(body + i * 4 + 2)]);
      } else if (id === 'MATL') {
        const matId = dv.getInt32(body, true);
        let p = body + 4;
        const pairs = dv.getInt32(p, true);
        p += 4;
        const dict: Record<string, string> = {};
        for (let k = 0; k < pairs; k++) {
          const kl = dv.getInt32(p, true);
          const key = str(p + 4, kl);
          p += 4 + kl;
          const vl = dv.getInt32(p, true);
          dict[key] = str(p + 4, vl);
          p += 4 + vl;
        }
        if (dict._type === '_emit') emit.add(matId);
      }
      if (id === 'MAIN') walk(body + content, body + content + children);
      o = body + content + children;
    }
  };
  walk(8, buf.byteLength);
  if (!found.size || !found.voxels) throw new Error('.vox file has no model');
  const [sx, sy, sz] = found.size;
  const grid = new VoxelGrid(sx, sz, sy);
  const palette = new VoxelPalette();
  const remap = new Map<number, number>();
  const vox = found.voxels;
  for (let i = 0; i < vox.length; i += 4) {
    const x = vox[i];
    const y = vox[i + 1];
    const z = vox[i + 2];
    const c = vox[i + 3];
    let idx = remap.get(c);
    if (idx === undefined) {
      const col = rgba.length ? rgba[c - 1] : [200, 200, 200];
      const hex = `#${col.map((n) => n.toString(16).padStart(2, '0')).join('')}`;
      idx = palette.index(hex, emit.has(c));
      remap.set(c, idx);
    }
    grid.set(x, z, sy - 1 - y, idx);
  }
  return { grid, palette };
}

/** Writes a VoxelGrid back out as a .vox (for MagicaVoxel touch-ups of generated models). */
export function writeVox(grid: VoxelGrid, palette: VoxelPalette): ArrayBuffer {
  const bytes: number[] = [];
  const i32 = (v: number) => bytes.push(v & 255, (v >> 8) & 255, (v >> 16) & 255, (v >>> 24) & 255);
  const tag = (s: string) => {
    for (let i = 0; i < 4; i++) bytes.push(s.charCodeAt(i));
  };
  const chunk = (id: string, body: number[]) => {
    tag(id);
    i32(body.length);
    i32(0);
    bytes.push(...body);
  };
  const le = (v: number) => [v & 255, (v >> 8) & 255, (v >> 16) & 255, (v >>> 24) & 255];
  const str = (s: string) => [...le(s.length), ...[...s].map((c) => c.charCodeAt(0))];

  const size = [...le(grid.nx), ...le(grid.nz), ...le(grid.ny)];
  const xyzi: number[] = [];
  let n = 0;
  for (let z = 0; z < grid.nz; z++)
    for (let y = 0; y < grid.ny; y++)
      for (let x = 0; x < grid.nx; x++) {
        const c = grid.get(x, y, z);
        if (!c) continue;
        xyzi.push(x, grid.nz - 1 - z, y, c);
        n++;
      }
  const rgba: number[] = [];
  for (let i = 1; i <= 256; i++) {
    const c = palette.colors[i]?.clone().convertLinearToSRGB();
    rgba.push(c ? Math.round(c.r * 255) : 0, c ? Math.round(c.g * 255) : 0, c ? Math.round(c.b * 255) : 0, 255);
  }
  const matls: number[][] = [];
  for (const idx of palette.emissive) {
    const dict: [string, string][] = [
      ['_type', '_emit'],
      ['_emit', '1'],
      ['_flux', '2'],
    ];
    matls.push([...le(idx), ...le(dict.length), ...dict.flatMap(([k, v]) => [...str(k), ...str(v)])]);
  }

  tag('VOX ');
  i32(150);
  const children: number[] = [];
  const saved = bytes.splice(0, bytes.length);
  chunk('SIZE', size);
  chunk('XYZI', [...le(n), ...xyzi]);
  chunk('RGBA', rgba);
  for (const m of matls) chunk('MATL', m);
  children.push(...bytes.splice(0, bytes.length));
  bytes.push(...saved);
  tag('MAIN');
  i32(0);
  i32(children.length);
  bytes.push(...children);
  return new Uint8Array(bytes).buffer;
}
