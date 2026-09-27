import * as THREE from 'three';
import { design } from '../kits/designs.ts';
import type { CharacterKind, PropKind, StyleId } from '../kits/types.ts';
import type { BoardDef, BoardItem, BoardLabel } from '../shell/registry.ts';
import { boundsOf, place } from './layout.ts';

const SUBJECTS: ({ c: CharacterKind; v: number } | { p: PropKind })[] = [
  { c: 'agent', v: 0 },
  { c: 'rival', v: 0 },
  { c: 'police', v: 0 },
  { c: 'civilian', v: 1 },
  { c: 'voss', v: 0 },
  { p: 'car' },
  { p: 'trafficLight' },
];

function compareBoard(id: string, title: string, styles: StyleId[]): BoardDef {
  return {
    id,
    section: 'Compare',
    title,
    icon: 'split',
    styled: false,
    async build(ctx) {
      const g = new THREE.Group();
      const items: BoardItem[] = [];
      const labels: BoardLabel[] = [];
      const rowGap = 5.5;
      const xs = [0, 1.6, 3.2, 4.8, 6.4, 9.2, 13];
      for (const [r, sid] of styles.entries()) {
        const kit = ctx.kits[sid];
        const z = (r - (styles.length - 1) / 2) * rowGap;
        labels.push({ text: kit.label, at: new THREE.Vector3(-3.2, 0.2, z), head: true });
        for (const [i, s] of SUBJECTS.entries()) {
          const a = 'c' in s ? await kit.character(s.c, s.v) : await kit.prop(s.p);
          const it = place(a, xs[i] - 6, z, { id: `${sid}-${i}`, label: 'c' in s ? design(s.c, s.v).name.replace('Director Hale ', '') : a.name, ry: 'p' in s && s.p === 'car' ? Math.PI / 2 : 0 });
          items.push(it);
          g.add(it.root);
          if ('c' in s) ctx.anim.register(a, a.object, { offset: i * 0.3 });
        }
      }
      return { group: g, items, labels, bounds: boundsOf(items), animated: true, turntable: false, view: 'threeq', subtitle: 'Same designs, same lighting, different styles' };
    },
  };
}

export const compareAC = compareBoard('compare', 'A vs C', ['lowpoly', 'voxel']);
export const compareAll = compareBoard('compare-all', 'Base vs A vs C', ['baseline', 'lowpoly', 'voxel']);
