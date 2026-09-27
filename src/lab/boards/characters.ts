import * as THREE from 'three';
import { CAST_GROUPS, design, LINEUP } from '../kits/designs.ts';
import { CHARACTER_LABELS } from '../kits/types.ts';
import type { BoardContext, BoardDef, BoardItem, BoardLabel, BoardResult } from '../shell/registry.ts';
import { boundsOf, grid, place } from './layout.ts';

const GROUP_ICONS: Record<string, string> = { agents: 'person', rivals: 'shield', law: 'shield', civilians: 'people' };

export function castBoard(groupId: string): BoardDef {
  const group = CAST_GROUPS.find((g) => g.id === groupId)!;
  return {
    id: groupId,
    section: 'Characters',
    title: group.title,
    icon: GROUP_ICONS[groupId] ?? 'person',
    styled: true,
    async build(ctx: BoardContext): Promise<BoardResult> {
      const g = new THREE.Group();
      const items: BoardItem[] = [];
      const cols = group.members.length > 4 ? 3 : group.members.length;
      const spots = grid(group.members, 2.6, cols);
      for (const [i, s] of spots.entries()) {
        const a = await ctx.kit.character(s.item.kind, s.item.variant);
        const d = design(s.item.kind, s.item.variant);
        const it = place(a, s.x, s.z, { id: `${s.item.kind}:${s.item.variant}`, label: d.name, sub: CHARACTER_LABELS[s.item.kind] === d.name ? undefined : CHARACTER_LABELS[s.item.kind], plinth: 0.8 });
        items.push(it);
        g.add(it.root);
        ctx.anim.register(a, a.object, { offset: i * 0.37 });
      }
      return { group: g, items, bounds: boundsOf(items), animated: true, turntable: true, subtitle: `${group.members.length} characters · ${ctx.kit.label}` };
    },
  };
}

export const lineupBoard: BoardDef = {
  id: 'lineup',
  section: 'Characters',
  title: 'Lineup',
  icon: 'ruler',
  styled: true,
  async build(ctx) {
    const g = new THREE.Group();
    const items: BoardItem[] = [];
    const spacing = 1.25;
    const spots = grid(LINEUP, spacing);
    for (const s of spots) {
      const a = await ctx.kit.character(s.item.kind, s.item.variant);
      const d = design(s.item.kind, s.item.variant);
      const it = place(a, s.x, 0, { id: `${s.item.kind}:${s.item.variant}`, label: d.name.replace('Director Hale ', ''), sub: `${d.prop.height.toFixed(2)} m` });
      items.push(it);
      g.add(it.root);
      ctx.anim.register(a, a.object);
    }
    // Height ruler behind the cast: a line every 0.25 m, labelled every 0.5 m, 1.8 m highlighted.
    const width = (LINEUP.length + 1) * spacing;
    const labels: BoardLabel[] = [];
    const lineMat = (strong: boolean) =>
      new THREE.MeshBasicMaterial({ color: strong ? new THREE.Color(0.3, 2.2, 2.6) : new THREE.Color(0.35, 0.36, 0.45), toneMapped: false, transparent: true, opacity: strong ? 0.9 : 0.5 });
    for (let h = 0.25; h <= 2.26; h += 0.25) {
      const strong = Math.abs(h - 1.8) < 1e-3;
      const bar = new THREE.Mesh(new THREE.PlaneGeometry(width, strong ? 0.02 : 0.008), lineMat(strong));
      bar.position.set(0, h, -0.7);
      bar.userData.decor = true;
      g.add(bar);
      if (Math.abs(h * 2 - Math.round(h * 2)) < 1e-3 || strong) labels.push({ text: `${h.toFixed(h % 1 === 0 ? 0 : 2)} m`, at: new THREE.Vector3(-width / 2 + 0.35, h + 0.02, -0.7) });
    }
    const wall = new THREE.Mesh(new THREE.PlaneGeometry(width + 1, 2.6), new THREE.MeshStandardMaterial({ color: '#15161e', roughness: 0.9 }));
    wall.position.set(0, 1.3, -0.75);
    wall.receiveShadow = true;
    wall.userData.decor = true;
    g.add(wall);
    return { group: g, items, labels, bounds: boundsOf(items, 0.6), animated: true, turntable: false, view: 'front', subtitle: `Heights against a 1.8 m reference · ${ctx.kit.label}` };
  },
};
