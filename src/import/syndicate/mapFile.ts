/**
 * MAPxx.DAT (after RNC): u32 width, u32 height, u32 levels, then width*height u32 offsets (relative to
 * byte 12) to columns of `levels` tile ids, bottom level first. Identical columns share storage.
 */
export interface SyndMap {
  w: number;
  h: number;
  levels: number;
  /** Tile id at (x, y, z): tiles[(y * w + x) * levels + z]. */
  tiles: Uint8Array;
}

export function parseMap(data: Uint8Array): SyndMap {
  const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const w = dv.getUint32(0, true);
  const h = dv.getUint32(4, true);
  const levels = dv.getUint32(8, true);
  if (!w || !h || !levels || w > 512 || h > 512 || levels > 32) throw new Error('Not a Syndicate map file');
  const tiles = new Uint8Array(w * h * levels);
  for (let i = 0; i < w * h; i++) {
    const off = 12 + dv.getUint32(12 + i * 4, true);
    tiles.set(data.subarray(off, off + levels), i * levels);
  }
  return { w, h, levels, tiles };
}

export function tileAt(m: SyndMap, x: number, y: number, z: number): number {
  if (x < 0 || y < 0 || z < 0 || x >= m.w || y >= m.h || z >= m.levels) return 0;
  return m.tiles[(y * m.w + x) * m.levels + z];
}
