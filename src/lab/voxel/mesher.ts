import * as THREE from 'three';

/** A dense voxel grid; values are palette indices (0 = empty). x = right, y = up, z = forward. */
export class VoxelGrid {
  readonly nx: number;
  readonly ny: number;
  readonly nz: number;
  readonly data: Uint8Array;

  constructor(nx: number, ny: number, nz: number) {
    this.nx = nx;
    this.ny = ny;
    this.nz = nz;
    this.data = new Uint8Array(nx * ny * nz);
  }

  get(x: number, y: number, z: number): number {
    if (x < 0 || y < 0 || z < 0 || x >= this.nx || y >= this.ny || z >= this.nz) return 0;
    return this.data[(z * this.ny + y) * this.nx + x];
  }

  set(x: number, y: number, z: number, c: number): void {
    if (x < 0 || y < 0 || z < 0 || x >= this.nx || y >= this.ny || z >= this.nz) return;
    this.data[(z * this.ny + y) * this.nx + x] = c;
  }

  /** Fills the half-open box [x0,x1) x [y0,y1) x [z0,z1). */
  fill(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, c: number): this {
    for (let z = Math.max(0, z0); z < Math.min(this.nz, z1); z++)
      for (let y = Math.max(0, y0); y < Math.min(this.ny, y1); y++)
        for (let x = Math.max(0, x0); x < Math.min(this.nx, x1); x++) this.set(x, y, z, c);
    return this;
  }

  count(): number {
    let n = 0;
    for (const v of this.data) if (v) n++;
    return n;
  }
}

/** Palette: index -> colour, plus which indices glow. Index 0 is unused (empty). */
export class VoxelPalette {
  colors: THREE.Color[] = [new THREE.Color(0, 0, 0)];
  emissive = new Set<number>();
  private byHex = new Map<string, number>();

  index(hex: string, glow = false): number {
    const key = `${hex}|${glow}`;
    let i = this.byHex.get(key);
    if (i === undefined) {
      i = this.colors.length;
      if (i > 255) throw new Error('Voxel palette overflow');
      this.colors.push(new THREE.Color(hex));
      if (glow) this.emissive.add(i);
      this.byHex.set(key, i);
    }
    return i;
  }
}

interface Out {
  pos: number[];
  nrm: number[];
  col: number[];
  idx: number[];
}

/**
 * Greedy mesher: merges coplanar faces of the same colour into large quads, so voxel models
 * stay cheap. Solid and emissive voxels go to separate meshes (the latter glows under bloom).
 */
export function meshVoxels(
  grid: VoxelGrid,
  palette: VoxelPalette,
  size: number,
  anchor: [number, number, number] = [grid.nx / 2, 0, grid.nz / 2],
  opts: { glowStrength?: number; rough?: number; metal?: number } = {},
): THREE.Group {
  const solid: Out = { pos: [], nrm: [], col: [], idx: [] };
  const glow: Out = { pos: [], nrm: [], col: [], idx: [] };
  const dims = [grid.nx, grid.ny, grid.nz];
  const g = (p: number[]) => grid.get(p[0], p[1], p[2]);

  for (let d = 0; d < 3; d++) {
    const u = (d + 1) % 3;
    const v = (d + 2) % 3;
    const x = [0, 0, 0];
    const q = [0, 0, 0];
    q[d] = 1;
    const mask = new Int32Array(dims[u] * dims[v]);
    for (x[d] = -1; x[d] < dims[d]; ) {
      let n = 0;
      for (x[v] = 0; x[v] < dims[v]; x[v]++) {
        for (x[u] = 0; x[u] < dims[u]; x[u]++) {
          const a = x[d] >= 0 ? g(x) : 0;
          const b = x[d] < dims[d] - 1 ? g([x[0] + q[0], x[1] + q[1], x[2] + q[2]]) : 0;
          mask[n++] = (a !== 0) === (b !== 0) ? 0 : a !== 0 ? a : -b;
        }
      }
      x[d]++;
      n = 0;
      for (let j = 0; j < dims[v]; j++) {
        for (let i = 0; i < dims[u]; ) {
          const c = mask[n];
          if (c === 0) {
            i++;
            n++;
            continue;
          }
          let w = 1;
          while (i + w < dims[u] && mask[n + w] === c) w++;
          let h = 1;
          outer: for (; j + h < dims[v]; h++) {
            for (let k = 0; k < w; k++) if (mask[n + k + h * dims[u]] !== c) break outer;
          }
          x[u] = i;
          x[v] = j;
          const du = [0, 0, 0];
          const dv = [0, 0, 0];
          du[u] = w;
          dv[v] = h;
          const colorIdx = Math.abs(c);
          const out = palette.emissive.has(colorIdx) ? glow : solid;
          const col = palette.colors[colorIdx] ?? new THREE.Color(1, 0, 1);
          const nrm = [0, 0, 0];
          nrm[d] = c > 0 ? 1 : -1;
          const base = out.pos.length / 3;
          const corners = [
            [x[0], x[1], x[2]],
            [x[0] + du[0], x[1] + du[1], x[2] + du[2]],
            [x[0] + du[0] + dv[0], x[1] + du[1] + dv[1], x[2] + du[2] + dv[2]],
            [x[0] + dv[0], x[1] + dv[1], x[2] + dv[2]],
          ];
          // Tiny per-face shade variation gives a hand-painted feel.
          const shade = 0.94 + (((i * 7 + j * 13 + x[d] * 3) % 5) / 5) * 0.08;
          for (const p of corners) {
            out.pos.push((p[0] - anchor[0]) * size, (p[1] - anchor[1]) * size, (p[2] - anchor[2]) * size);
            out.nrm.push(nrm[0], nrm[1], nrm[2]);
            out.col.push(col.r * shade, col.g * shade, col.b * shade);
          }
          if (c > 0) out.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
          else out.idx.push(base, base + 2, base + 1, base, base + 3, base + 2);
          for (let l = 0; l < h; l++) for (let k = 0; k < w; k++) mask[n + k + l * dims[u]] = 0;
          i += w;
          n += w;
        }
      }
    }
  }

  const group = new THREE.Group();
  const build = (o: Out) => {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(o.pos, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(o.nrm, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(o.col, 3));
    geo.setIndex(o.idx);
    return geo;
  };
  if (solid.idx.length) {
    const m = new THREE.Mesh(
      build(solid),
      new THREE.MeshStandardMaterial({ vertexColors: true, roughness: opts.rough ?? 0.78, metalness: opts.metal ?? 0.08, flatShading: true }),
    );
    m.castShadow = true;
    m.receiveShadow = true;
    group.add(m);
  }
  if (glow.idx.length) {
    const gm = new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false });
    gm.color.setScalar(opts.glowStrength ?? 1.7);
    group.add(new THREE.Mesh(build(glow), gm));
  }
  return group;
}
