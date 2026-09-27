import * as THREE from 'three';
import { NEON, SIGN_WORDS } from '../../render/textures.ts';
import { canvasTexture } from '../kits/geo.ts';
import { BUILDINGS, PROP_LABELS, type PropKind } from '../kits/types.ts';
import type { BoardContext, BoardDef, BoardItem, BoardResult } from '../shell/registry.ts';
import { boundsOf, grid, place } from './layout.ts';

export const buildingsBoard: BoardDef = {
  id: 'buildings',
  section: 'Environment',
  title: 'Buildings',
  icon: 'building',
  styled: true,
  async build(ctx) {
    const g = new THREE.Group();
    const items: BoardItem[] = [];
    let x = 0;
    const gap = 5;
    const total = BUILDINGS.reduce((s, b) => s + b.w, 0) + gap * (BUILDINGS.length - 1);
    x = -total / 2;
    for (const spec of BUILDINGS) {
      const a = await ctx.kit.building(spec);
      const it = place(a, x + spec.w / 2, 0, { id: spec.id, sub: `${spec.w}×${spec.d}×${spec.h} m` });
      items.push(it);
      g.add(it.root);
      x += spec.w + gap;
    }
    return { group: g, items, bounds: boundsOf(items), animated: false, turntable: false, subtitle: `Facade shader, rooftop and street-level details · ${ctx.kit.label}` };
  },
};

export const signageBoard: BoardDef = {
  id: 'signage',
  section: 'Environment',
  title: 'Signage',
  icon: 'sign',
  styled: true,
  async build(ctx) {
    const g = new THREE.Group();
    const items: BoardItem[] = [];
    const words = SIGN_WORDS.slice(0, 10);
    // A wall of signs: rows stack vertically so the front view never overlaps them.
    const spots = grid(words, 5, 5);
    for (const [i, s] of spots.entries()) {
      const vertical = i % 3 === 1;
      const a = await ctx.kit.sign(s.item, NEON[i % (NEON.length - 1)], vertical);
      const it = place(a, s.x, 0, { id: `sign-${i}`, label: s.item, sub: vertical ? 'vertical' : 'horizontal' });
      it.root.position.y = i < 5 ? 7 : 0;
      items.push(it);
      g.add(it.root);
    }
    return { group: g, items, bounds: boundsOf(items), animated: false, turntable: false, view: 'front', subtitle: `Neon signage · ${ctx.kit.label}` };
  },
};

function roadTexture(): THREE.CanvasTexture {
  return canvasTexture(256, 1024, (c) => {
    c.fillStyle = '#12131a';
    c.fillRect(0, 0, 256, 1024);
    for (let i = 0; i < 1800; i++) {
      c.fillStyle = `rgba(0,0,0,${0.1 + Math.random() * 0.2})`;
      c.fillRect(Math.random() * 256, Math.random() * 1024, 2 + Math.random() * 6, 2 + Math.random() * 6);
    }
    c.fillStyle = 'rgba(255,190,70,0.6)';
    for (let y = 0; y < 1024; y += 64) c.fillRect(126, y, 4, 36);
    c.fillStyle = 'rgba(220,220,240,0.4)';
    for (let x = 16; x < 240; x += 24) c.fillRect(x, 440, 12, 90);
  });
}

/** A short street: road with a crosswalk, sidewalks, buildings both sides, props and a few people. */
export const streetBoard: BoardDef = {
  id: 'street',
  section: 'Environment',
  title: 'Street Slice',
  icon: 'road',
  styled: true,
  async build(ctx: BoardContext): Promise<BoardResult> {
    const g = new THREE.Group();
    const items: BoardItem[] = [];
    const L = 34;
    const road = new THREE.Mesh(new THREE.PlaneGeometry(8, L).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ map: roadTexture(), roughness: 0.25, metalness: 0.3 }));
    road.position.y = 0.01;
    road.receiveShadow = true;
    g.add(road);
    const walkMat = new THREE.MeshStandardMaterial({ color: '#2b2b36', roughness: 0.4, metalness: 0.2 });
    for (const sx of [-1, 1]) {
      const walk = new THREE.Mesh(new THREE.BoxGeometry(4, 0.15, L), walkMat);
      walk.position.set(sx * 6, 0.075, 0);
      walk.receiveShadow = true;
      g.add(walk);
    }
    const specs = [
      { id: 's1', label: 'A', w: 9, d: 6, h: 16, variant: 1 },
      { id: 's2', label: 'B', w: 11, d: 6, h: 9, variant: 2 },
      { id: 's3', label: 'C', w: 8, d: 6, h: 26, variant: 0 },
      { id: 's4', label: 'D', w: 12, d: 6, h: 12, variant: 3 },
    ];
    const placeBuilding = async (spec: (typeof specs)[number], x: number, z: number, ry: number) => {
      const a = await ctx.kit.building(spec);
      const it = place(a, x, z, { id: spec.id, label: `Building ${spec.label}`, ry });
      items.push(it);
      g.add(it.root);
    };
    await placeBuilding(specs[0], -11, -9, Math.PI / 2);
    await placeBuilding(specs[1], -11, 6, Math.PI / 2);
    await placeBuilding(specs[2], 11, -10, -Math.PI / 2);
    await placeBuilding(specs[3], 11, 5, -Math.PI / 2);

    const props: [PropKind, number, number, number][] = [
      ['lamp', -4.4, -10, Math.PI / 2],
      ['lamp', 4.4, 8, -Math.PI / 2],
      ['trafficLight', -4.5, 3.4, 0],
      ['trafficLight', 4.5, -3.4, Math.PI],
      ['vending', -7.6, -1.5, Math.PI / 2],
      ['car', 2, -6, 0],
      ['car', -2, 9, Math.PI],
    ];
    for (const [kind, x, z, ry] of props) {
      const a = await ctx.kit.prop(kind);
      const it = place(a, x, z, { id: `${kind}-${x}`, label: PROP_LABELS[kind], ry });
      it.root.position.y = kind === 'car' ? 0 : 0.15;
      items.push(it);
      g.add(it.root);
    }
    const people: [Parameters<typeof ctx.kit.character>[0], number, number, number, number, string][] = [
      ['agent', 0, -1.2, -2.5, 0.5, 'idle'],
      ['agent', 1, -0.2, -3.3, 0.5, 'idle'],
      ['agent', 2, -1.8, -3.6, 0.4, 'idle'],
      ['agent', 3, -0.8, -4.4, 0.6, 'idle'],
      ['police', 0, 6.2, 1.5, -2.6, 'walk'],
      ['civilian', 1, -6.2, 4, 3.1, 'umbrella_walk'],
      ['civilian', 0, -5.6, -6, 0, 'walk'],
      ['civilian', 5, 5.6, -7, 3.1, 'umbrella_walk'],
      ['voss', 0, 6.4, 9, -2.2, 'idle'],
    ];
    const walkers: { it: BoardItem; speed: number; dir: number }[] = [];
    for (const [i, [kind, variant, x, z, ry, clip]] of people.entries()) {
      const a = await ctx.kit.character(kind, variant);
      const it = place(a, x, z, { id: `${kind}:${variant}:${i}`, ry });
      it.root.position.y = Math.abs(x) > 4 ? 0.15 : 0;
      items.push(it);
      g.add(it.root);
      ctx.anim.register(a, a.object, { fixedClip: clip, offset: i * 0.29 });
      if (clip !== 'idle') walkers.push({ it, speed: a.walkSpeed ?? 1.5, dir: Math.cos(ry) >= 0 ? 1 : -1 });
    }
    return {
      group: g,
      items,
      bounds: new THREE.Box3(new THREE.Vector3(-16, 0, -L / 2), new THREE.Vector3(16, 8, L / 2)),
      animated: true,
      turntable: false,
      view: 'game',
      itemLabels: false,
      subtitle: `How it all reads together · ${ctx.kit.label}`,
      update(dt) {
        for (const w of walkers) {
          const p = w.it.root.position;
          p.z += w.dir * w.speed * dt;
          if (p.z > L / 2 - 1) p.z = -L / 2 + 1;
          if (p.z < -L / 2 + 1) p.z = L / 2 - 1;
        }
      },
    };
  },
};

const PROP_ICONS: Record<PropKind, string> = { car: 'car', lamp: 'lamp', trafficLight: 'traffic', vending: 'box', umbrella: 'umbrella', vtol: 'plane' };
const PROP_KINDS: PropKind[] = ['car', 'lamp', 'trafficLight', 'vending', 'umbrella', 'vtol'];
/** Big props at the back so they don't hide the small ones. */
const OVERVIEW_ORDER: PropKind[] = ['car', 'vtol', 'vending', 'lamp', 'trafficLight', 'umbrella'];

export const allPropsBoard: BoardDef = {
  id: 'props',
  section: 'Props',
  title: 'All Props',
  icon: 'grid',
  styled: true,
  async build(ctx) {
    const g = new THREE.Group();
    const items: BoardItem[] = [];
    const spots = grid(OVERVIEW_ORDER, 7.5, 3);
    for (const s of spots) {
      const a = await ctx.kit.prop(s.item);
      const it = place(a, s.x, s.z, { id: s.item, plinth: s.item === 'vtol' ? 4 : s.item === 'car' ? 2.6 : 1.2 });
      items.push(it);
      g.add(it.root);
    }
    return { group: g, items, bounds: boundsOf(items), animated: false, turntable: true, subtitle: `${PROP_KINDS.length} props · ${ctx.kit.label}` };
  },
};

export const propBoards: BoardDef[] = PROP_KINDS.map((kind) => ({
  id: `prop-${kind}`,
  section: 'Props',
  title: PROP_LABELS[kind],
  icon: PROP_ICONS[kind],
  styled: true,
  async build(ctx: BoardContext): Promise<BoardResult> {
    const g = new THREE.Group();
    const a = await ctx.kit.prop(kind);
    const it = place(a, 0, 0, { id: kind, plinth: kind === 'vtol' ? 4.5 : kind === 'car' ? 2.8 : 1.3 });
    g.add(it.root);
    // Human scale reference next to every prop.
    const ref = await ctx.kit.character('civilian', 4);
    const refIt = place(ref, kind === 'vtol' ? 5.5 : kind === 'car' ? 2.6 : 1.4, 0.6, { id: 'scale-ref', label: 'Scale reference', sub: '1.8 m' });
    g.add(refIt.root);
    ctx.anim.register(ref, ref.object);
    const items = [it, refIt];
    return { group: g, items, bounds: boundsOf([it], 0.8), animated: true, turntable: true, subtitle: `${ctx.kit.label} · with a human for scale` };
  },
}));
