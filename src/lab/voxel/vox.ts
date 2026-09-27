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
  const vox: number[] = [];
  for (let z = 0; z < grid.nz; z++)
    for (let y = 0; y < grid.ny; y++)
      for (let x = 0; x < grid.nx; x++) {
        const c = grid.get(x, y, z);
        if (c) vox.push(x, grid.nz - 1 - z, y, c);
      }
  const n = vox.length / 4;
  const sizeLen = 12 + 12;
  const xyziLen = 12 + 4 + vox.length;
  const rgbaLen = 12 + 1024;
  const total = 8 + 12 + sizeLen + xyziLen + rgbaLen;
  const buf = new ArrayBuffer(total);
  const dv = new DataView(buf);
  let o = 0;
  const tag = (s: string) => {
    for (let i = 0; i < 4; i++) dv.setUint8(o++, s.charCodeAt(i));
  };
  const i32 = (v: number) => {
    dv.setInt32(o, v, true);
    o += 4;
  };
  tag('VOX ');
  i32(150);
  tag('MAIN');
  i32(0);
  i32(sizeLen + xyziLen + rgbaLen);
  tag('SIZE');
  i32(12);
  i32(0);
  i32(grid.nx);
  i32(grid.nz);
  i32(grid.ny);
  tag('XYZI');
  i32(4 + vox.length);
  i32(0);
  i32(n);
  for (const b of vox) dv.setUint8(o++, b);
  tag('RGBA');
  i32(1024);
  i32(0);
  for (let i = 1; i <= 256; i++) {
    const c = palette.colors[i];
    dv.setUint8(o++, c ? Math.round(c.r * 255) : 0);
    dv.setUint8(o++, c ? Math.round(c.g * 255) : 0);
    dv.setUint8(o++, c ? Math.round(c.b * 255) : 0);
    dv.setUint8(o++, 255);
  }
  return buf;
}
