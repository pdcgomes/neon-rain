import * as THREE from 'three';

/** Small helpers shared by the procedural kits. */

const matCache = new Map<string, THREE.Material>();

export interface MatOpts {
  rough?: number;
  metal?: number;
  emissive?: number;
  flat?: boolean;
  side?: THREE.Side;
  transparent?: boolean;
  opacity?: number;
  vertexColors?: boolean;
}

/** Cached flat-shaded standard material. `emissive` > 0 makes it glow (bloom picks it up). */
export function mat(hex: string, o: MatOpts = {}): THREE.MeshStandardMaterial {
  const key = `${hex}|${JSON.stringify(o)}`;
  let m = matCache.get(key) as THREE.MeshStandardMaterial | undefined;
  if (!m) {
    m = new THREE.MeshStandardMaterial({
      color: o.vertexColors ? 0xffffff : hex,
      roughness: o.rough ?? 0.7,
      metalness: o.metal ?? 0.1,
      flatShading: o.flat ?? true,
      side: o.side ?? THREE.FrontSide,
      transparent: o.transparent ?? false,
      opacity: o.opacity ?? 1,
      vertexColors: o.vertexColors ?? false,
    });
    if (o.emissive) {
      m.emissive.set(hex);
      m.emissiveIntensity = o.emissive;
    }
    m.userData.labColor = hex;
    m.userData.labEmissive = !!o.emissive;
    matCache.set(key, m);
  }
  return m;
}

export function mesh(geo: THREE.BufferGeometry, material: THREE.Material, x = 0, y = 0, z = 0): THREE.Mesh {
  const m = new THREE.Mesh(geo, material);
  m.position.set(x, y, z);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

/** A limb segment hanging down from its joint (joint at the origin, extends to -len). */
export function limb(len: number, rTop: number, rBot: number, sides = 6): THREE.BufferGeometry {
  return new THREE.CylinderGeometry(rTop, rBot, len, sides, 1).translate(0, -len / 2, 0);
}

/** Lathe from a list of [radius, y] points, flattened front-to-back by `depth`. */
export function lathe(points: [number, number][], sides = 8, depth = 0.75, open = true): THREE.BufferGeometry {
  const g = new THREE.LatheGeometry(
    points.map(([r, y]) => new THREE.Vector2(r, y)),
    sides,
    open ? 0 : 0,
    Math.PI * 2,
  );
  g.scale(1, 1, depth);
  return g;
}

export function box(w: number, h: number, d: number): THREE.BoxGeometry {
  return new THREE.BoxGeometry(w, h, d);
}

export function countTriangles(obj: THREE.Object3D): number {
  let n = 0;
  obj.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh || !m.geometry) return;
    const g = m.geometry;
    const tris = g.index ? g.index.count / 3 : g.attributes.position.count / 3;
    n += (m as THREE.InstancedMesh).isInstancedMesh ? tris * (m as THREE.InstancedMesh).count : tris;
  });
  return Math.round(n);
}

export function canvasTexture(w: number, h: number, draw: (g: CanvasRenderingContext2D) => void, pixel = false): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d')!;
  draw(g);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  if (pixel) {
    t.magFilter = THREE.NearestFilter;
    t.minFilter = THREE.NearestMipmapNearestFilter;
  } else t.anisotropy = 4;
  return t;
}

/** Deterministic small hash for variant choices. */
export function pick<T>(arr: readonly T[], seed: number): T {
  const h = Math.abs(Math.sin(seed * 12.9898 + 78.233) * 43758.5453) % 1;
  return arr[Math.floor(h * arr.length)];
}
