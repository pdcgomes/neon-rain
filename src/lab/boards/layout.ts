import * as THREE from 'three';
import type { LabAsset } from '../kits/types.ts';
import type { BoardItem } from '../shell/registry.ts';

const plinthMat = new THREE.MeshStandardMaterial({ color: '#1b1c24', roughness: 0.35, metalness: 0.6 });
const ringMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.12, 0.6, 0.8), toneMapped: false });

export function heightOf(obj: THREE.Object3D): number {
  obj.updateMatrixWorld(true);
  const b = new THREE.Box3().setFromObject(obj, true);
  return b.isEmpty() ? 1 : b.max.y;
}

/** Places an asset on the board: a wrapper at (x, z), an inner turntable node, optional plinth. */
export function place(asset: LabAsset, x: number, z: number, opts: { id?: string; label?: string; sub?: string; plinth?: number; ry?: number } = {}): BoardItem {
  const root = new THREE.Group();
  root.position.set(x, 0, z);
  const spin = new THREE.Group();
  spin.rotation.y = opts.ry ?? 0;
  spin.add(asset.object);
  root.add(spin);
  if (opts.plinth) {
    const r = opts.plinth;
    const disc = new THREE.Mesh(new THREE.CylinderGeometry(r, r * 1.04, 0.06, 40), plinthMat);
    disc.position.y = -0.03;
    disc.receiveShadow = true;
    const ring = new THREE.Mesh(new THREE.RingGeometry(r * 0.97, r, 48).rotateX(-Math.PI / 2), ringMat);
    ring.position.y = 0.004;
    disc.userData.decor = true;
    ring.userData.decor = true;
    root.add(disc, ring);
  }
  return {
    id: opts.id ?? asset.name,
    asset,
    root,
    spin,
    label: opts.label ?? asset.name,
    sublabel: opts.sub,
    labelY: heightOf(asset.object) + 0.35,
  };
}

export function boundsOf(items: BoardItem[], pad = 1): THREE.Box3 {
  const b = new THREE.Box3();
  for (const it of items) {
    it.root.updateMatrixWorld(true);
    b.union(new THREE.Box3().setFromObject(it.root, true));
  }
  if (b.isEmpty()) b.set(new THREE.Vector3(-2, 0, -2), new THREE.Vector3(2, 2, 2));
  b.min.addScalar(-pad);
  b.max.addScalar(pad);
  b.min.y = 0;
  return b;
}

/** Lays items out in a centred row (or grid if `cols` given) with the given spacing. */
export function grid<T>(list: T[], spacing: number, cols = list.length): { item: T; x: number; z: number }[] {
  const rows = Math.ceil(list.length / cols);
  return list.map((item, i) => {
    const c = i % cols;
    const r = Math.floor(i / cols);
    const inRow = Math.min(cols, list.length - r * cols);
    return { item, x: (c - (inRow - 1) / 2) * spacing, z: (r - (rows - 1) / 2) * spacing * 1.15 };
  });
}

export const ICONS: Record<string, string> = {
  person: '<path d="M8 2.2a2.2 2.2 0 1 1 0 4.4 2.2 2.2 0 0 1 0-4.4ZM4 13.5c0-2.6 1.8-4.6 4-4.6s4 2 4 4.6" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>',
  people: '<path d="M5.5 3a1.9 1.9 0 1 1 0 3.8 1.9 1.9 0 0 1 0-3.8Zm5.5 0.6a1.6 1.6 0 1 1 0 3.2 1.6 1.6 0 0 1 0-3.2ZM2 13c0-2.2 1.6-4 3.5-4S9 10.8 9 13m1-1c.2-1.7 1.1-3 2.4-3 1.3 0 2.1 1.3 2.1 3" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>',
  shield: '<path d="M8 1.8 13 3.6v4.2c0 3-2.2 5.2-5 6.4-2.8-1.2-5-3.4-5-6.4V3.6L8 1.8Z" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/>',
  ruler: '<path d="M2.5 11.5 11.5 2.5l2 2-9 9-2-2Zm2-2 1.2 1.2M6.5 7.5l1.2 1.2M8.5 5.5l1.2 1.2" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>',
  building: '<path d="M3 14V3.5L8.5 2v12M8.5 6H13v8M5 5.5h1.5M5 8h1.5M5 10.5h1.5M10.5 8.5h1M10.5 11h1M2 14h12" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>',
  sign: '<path d="M3 3h10v6H3zM8 9v5M5.5 6h5" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round" stroke-linecap="round"/>',
  road: '<path d="M5 2 3 14M11 2l2 12M8 3v1.6M8 7v1.6M8 11v1.6" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>',
  car: '<path d="M2.5 10V8l1.4-3.2h8.2L13.5 8v2M2.5 10h11v2h-11zM4.5 12.5v.8M11.5 12.5v.8M5 8h6" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round" stroke-linecap="round"/>',
  lamp: '<path d="M6 14V3.5c0-.8.7-1.5 1.5-1.5H11M9.5 2v2.4h3V2M4 14h4" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/>',
  traffic: '<path d="M5.5 1.8h5v9h-5zM8 10.8V14M8 4a.8.8 0 1 0 0 .1M8 6.3a.8.8 0 1 0 0 .1M8 8.6a.8.8 0 1 0 0 .1" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>',
  box: '<path d="M3 4.5 8 2l5 2.5v7L8 14l-5-2.5v-7ZM3 4.5 8 7l5-2.5M8 7v7" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/>',
  umbrella: '<path d="M2 8a6 6 0 0 1 12 0H2ZM8 8v4.5a1.3 1.3 0 0 1-2.6 0" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round" stroke-linecap="round"/>',
  plane: '<path d="M8 1.8v11.4M2 8.2l6-1.6 6 1.6M5.8 13.6 8 12.4l2.2 1.2" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/>',
  grid: '<path d="M2.5 2.5h4v4h-4zM9.5 2.5h4v4h-4zM2.5 9.5h4v4h-4zM9.5 9.5h4v4h-4z" fill="none" stroke="currentColor" stroke-width="1.3"/>',
  film: '<path d="M2.5 3h11v10h-11zM2.5 6h11M2.5 10h11M5 3v3M8 3v3M11 3v3M5 10v3M8 10v3M11 10v3" fill="none" stroke="currentColor" stroke-width="1.2"/>',
  run: '<path d="M9.8 2.3a1.4 1.4 0 1 1 0 2.8 1.4 1.4 0 0 1 0-2.8ZM5 7.5l2.6-1.8 2 1.6 2 .4M7.6 5.7 6.4 10l2.4 1.4-.6 2.8M6.4 10 3.6 11" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/>',
  eye: '<path d="M1.8 8S4.2 3.8 8 3.8 14.2 8 14.2 8 11.8 12.2 8 12.2 1.8 8 1.8 8Zm6.2-2a2 2 0 1 1 0 4 2 2 0 0 1 0-4Z" fill="none" stroke="currentColor" stroke-width="1.3"/>',
  split: '<path d="M2.5 3h11v10h-11zM8 3v10" fill="none" stroke="currentColor" stroke-width="1.3"/>',
  cube: '<path d="M8 1.8 13.5 5v6L8 14.2 2.5 11V5L8 1.8Zm0 0v12.4M2.5 5 8 8l5.5-3" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/>',
  chip: '<path d="M4 4h8v8H4zM6 1.5V4M10 1.5V4M6 12v2.5M10 12v2.5M1.5 6H4M1.5 10H4M12 6h2.5M12 10h2.5" fill="none" stroke="currentColor" stroke-width="1.2"/>',
  map: '<path d="M2 3.5 6 2l4 1.5L14 2v10.5L10 14l-4-1.5L2 14V3.5ZM6 2v10.5M10 3.5V14" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/>',
  download: '<path d="M8 2v8M4.8 7 8 10.2 11.2 7M2.5 11.5V14h11v-2.5" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/>',
  pin: '<path d="M8 14s4.5-4.2 4.5-7.5a4.5 4.5 0 0 0-9 0C3.5 9.8 8 14 8 14Zm0-6a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3Z" fill="none" stroke="currentColor" stroke-width="1.3"/>',
  brush: '<path d="M13.5 2.5 7 9M7 9c-1.6-.4-3 .6-3 2.3 0 1.2-.8 1.9-1.8 2.2 2.8.8 5.6-.3 5.6-2.8L7 9Z" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/>',
  cursor: '<path d="M3.5 2.5 12.5 7l-4 1.2-1.6 4.3-3.4-10Z" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/>',
  route: '<path d="M3.5 12.5a1.5 1.5 0 1 0 0 .1M12.5 3.5a1.5 1.5 0 1 0 0 .1M5 12.5h4.5a2 2 0 0 0 0-4h-3a2 2 0 0 1 0-4H11" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>',
  rect: '<path d="M2.5 4h11v8h-11z" fill="none" stroke="currentColor" stroke-width="1.3" stroke-dasharray="2 1.5"/>',
  tree: '<path d="M8 1.8 12.5 8h-2.3L13 12H3l2.8-4H3.5L8 1.8ZM8 12v2.5" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/>',
  check: '<path d="M3 8.5 6.5 12 13 4" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>',
};

export function icon(name: string): string {
  return `<svg class="icon" viewBox="0 0 16 16">${ICONS[name] ?? ICONS.box}</svg>`;
}
