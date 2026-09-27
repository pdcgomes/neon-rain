import * as THREE from 'three';
import { importedEntries, loadEntry, type ManifestEntry } from '../kits/imported.ts';
import type { BoardDef, BoardItem } from '../shell/registry.ts';
import { boundsOf, place } from './layout.ts';

export function importedBoard(e: ManifestEntry): BoardDef {
  return {
    id: `imp-${e.id}`,
    section: 'Imported',
    title: e.name,
    icon: e.format === 'vox' ? 'cube' : 'box',
    styled: false,
    async build(ctx) {
      const g = new THREE.Group();
      const a = await loadEntry(e);
      const it = place(a, 0, 0, { id: e.id, sub: e.source, plinth: e.category === 'character' ? 0.8 : 1.6 });
      g.add(it.root);
      const items: BoardItem[] = [it];
      ctx.anim.register(a, a.object);
      // Style A agent alongside for scale and style reference.
      if (e.category === 'character') {
        const ref = await ctx.kits.lowpoly.character(e.kind ?? 'agent', 0);
        const refIt = place(ref, 1.8, 0, { id: 'ref', label: 'Style A reference', plinth: 0.8 });
        g.add(refIt.root);
        items.push(refIt);
        ctx.anim.register(ref, ref.object);
      }
      return { group: g, items, bounds: boundsOf(items), animated: true, turntable: true, subtitle: `${e.source ?? e.file}${a.notes ? ` · ${a.notes}` : ''}` };
    },
  };
}

export const importedOverview: BoardDef = {
  id: 'imported',
  section: 'Imported',
  title: 'All Imported',
  icon: 'grid',
  styled: false,
  async build(ctx) {
    const g = new THREE.Group();
    const items: BoardItem[] = [];
    const entries = importedEntries();
    // Characters in the front row, everything else behind, spaced by actual footprint.
    const rows = [entries.filter((e) => e.category === 'character'), entries.filter((e) => e.category !== 'character')];
    for (const [r, row] of rows.entries()) {
      const loaded = await Promise.all(row.map((e) => loadEntry(e)));
      const widths = loaded.map((a) => {
        const s = new THREE.Box3().setFromObject(a.object, true).getSize(new THREE.Vector3());
        return Math.max(s.x, s.z) + 0.9;
      });
      let x = -widths.reduce((s, w) => s + w, 0) / 2;
      for (const [i, a] of loaded.entries()) {
        const it = place(a, x + widths[i] / 2, r === 0 ? 2 : -5, { id: row[i].id, sub: row[i].format === 'vox' ? '.vox' : undefined });
        x += widths[i];
        items.push(it);
        g.add(it.root);
        ctx.anim.register(a, a.object);
      }
    }
    return {
      group: g,
      items,
      bounds: boundsOf(items),
      animated: true,
      turntable: true,
      subtitle: entries.length ? `${entries.length} imported assets` : 'Nothing imported yet: add entries to public/lab/manifest.json or drop .glb / .vox files here',
    };
  },
};
