import * as THREE from 'three';
import { CATALOGUE } from '../anim/catalogue.ts';
import { design, LINEUP } from '../kits/designs.ts';
import type { CharacterKind } from '../kits/types.ts';
import type { BoardContext, BoardDef, BoardItem, BoardResult } from '../shell/registry.ts';
import { boundsOf, grid, place } from './layout.ts';

function subject(ctx: BoardContext): { kind: CharacterKind; variant: number } {
  const [k, v] = ctx.state.subject.split(':');
  return { kind: (k as CharacterKind) || 'agent', variant: Number(v) || 0 };
}

export const clipGridBoard: BoardDef = {
  id: 'clipgrid',
  section: 'Animation',
  title: 'Clip Grid',
  icon: 'grid',
  styled: true,
  async build(ctx) {
    const g = new THREE.Group();
    const items: BoardItem[] = [];
    const s = subject(ctx);
    const spots = grid(CATALOGUE, 2.4, 6);
    for (const spot of spots) {
      const a = await ctx.kit.character(s.kind, s.variant);
      const it = place(a, spot.x, spot.z, { id: `clip-${spot.item.id}`, label: spot.item.label, sub: spot.item.loop ? 'loop' : 'once', plinth: 0.75 });
      items.push(it);
      g.add(it.root);
      ctx.anim.register(a, a.object, { fixedClip: spot.item.id });
    }
    return { group: g, items, bounds: boundsOf(items), animated: true, turntable: false, view: 'threeq', subtitle: `${design(s.kind, s.variant).name} playing every catalogue clip, in sync · ${ctx.kit.label}` };
  },
};

export const castMotionBoard: BoardDef = {
  id: 'cast',
  section: 'Animation',
  title: 'Cast in Motion',
  icon: 'people',
  styled: true,
  async build(ctx) {
    const g = new THREE.Group();
    const items: BoardItem[] = [];
    const spots = grid(LINEUP, 1.7, 6);
    for (const spot of spots) {
      const a = await ctx.kit.character(spot.item.kind, spot.item.variant);
      const d = design(spot.item.kind, spot.item.variant);
      const it = place(a, spot.x, spot.z, { id: `${spot.item.kind}:${spot.item.variant}`, label: d.name.replace('Director Hale ', '') });
      items.push(it);
      g.add(it.root);
      ctx.anim.register(a, a.object);
    }
    return { group: g, items, bounds: boundsOf(items), animated: true, turntable: false, clip: 'walk', subtitle: `Every character plays the timeline clip · ${ctx.kit.label}` };
  },
};

/** Characters crossing a tiled floor at their in-game speeds: exposes foot sliding and cadence. */
export const treadmillBoard: BoardDef = {
  id: 'treadmill',
  section: 'Animation',
  title: 'Treadmill',
  icon: 'run',
  styled: true,
  async build(ctx: BoardContext): Promise<BoardResult> {
    const g = new THREE.Group();
    const items: BoardItem[] = [];
    const lanes: { clip: string; kinds: [CharacterKind, number][]; speed: 'walk' | 'run' | number }[] = [
      { clip: 'walk', kinds: [['agent', 0], ['police', 0], ['civilian', 2]], speed: 'walk' },
      { clip: 'run', kinds: [['agent', 1], ['rival', 0], ['enforcer', 0]], speed: 'run' },
      { clip: 'panic_run', kinds: [['civilian', 0], ['civilian', 3]], speed: 4.5 },
      { clip: 'persuaded_shuffle', kinds: [['civilian', 5]], speed: 0.9 },
    ];
    const L = 18;
    const movers: { it: BoardItem; v: number }[] = [];
    let lane = 0;
    for (const ln of lanes) {
      for (const [j, [kind, variant]] of ln.kinds.entries()) {
        const a = await ctx.kit.character(kind, variant);
        const v = ln.speed === 'walk' ? a.walkSpeed ?? 1.5 : ln.speed === 'run' ? a.runSpeed ?? 4.5 : ln.speed;
        const z = (lane - 3.5) * 1.6;
        lane++;
        const it = place(a, -L / 2 + j * 4, z, { id: `${kind}:${variant}:${ln.clip}`, label: design(kind, variant).name.replace('Director Hale ', ''), sub: `${ln.clip} · ${v.toFixed(1)} m/s`, ry: Math.PI / 2 });
        items.push(it);
        g.add(it.root);
        ctx.anim.register(a, a.object, { fixedClip: ln.clip, offset: j * 0.2 });
        movers.push({ it, v });
      }
    }
    // Lane lines.
    const lineMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.3, 0.32, 0.42), transparent: true, opacity: 0.6 });
    for (let i = 0; i <= lane; i++) {
      const line = new THREE.Mesh(new THREE.PlaneGeometry(L + 4, 0.03).rotateX(-Math.PI / 2), lineMat);
      line.position.set(0, 0.006, (i - 4) * 1.6 + 0.0);
      g.add(line);
    }
    return {
      group: g,
      items,
      bounds: new THREE.Box3(new THREE.Vector3(-L / 2 - 1, 0, -7), new THREE.Vector3(L / 2 + 1, 2, 6)),
      animated: true,
      turntable: false,
      view: 'front',
      polar: 1.12,
      subtitle: `In-game speeds: watch for sliding feet (turn on Contacts) · ${ctx.kit.label}`,
      update(dt) {
        if (!ctx.anim.playing) return;
        for (const m of movers) {
          const p = m.it.root.position;
          p.x += m.v * dt * ctx.anim.speed;
          if (p.x > L / 2) p.x -= L;
        }
      },
    };
  },
};

/** The in-game camera with pixel preview: readability at 40 to 120 px tall is what matters. */
export const gameScaleBoard: BoardDef = {
  id: 'gamescale',
  section: 'Animation',
  title: 'Game-scale Motion',
  icon: 'eye',
  styled: true,
  async build(ctx) {
    const g = new THREE.Group();
    const items: BoardItem[] = [];
    const spots = grid(LINEUP.slice(0, 8), 2.2, 4);
    for (const [i, spot] of spots.entries()) {
      const a = await ctx.kit.character(spot.item.kind, spot.item.variant);
      const it = place(a, spot.x, spot.z, { id: `${spot.item.kind}:${spot.item.variant}`, label: design(spot.item.kind, spot.item.variant).name.replace('Director Hale ', ''), ry: -Math.PI / 4 });
      items.push(it);
      g.add(it.root);
      ctx.anim.register(a, a.object, { offset: i * 0.23 });
    }
    return {
      group: g,
      items,
      bounds: boundsOf(items),
      animated: true,
      turntable: false,
      view: 'game',
      clip: 'walk',
      pixel: 3,
      zoom: 3,
      subtitle: `In-game camera and pixel density (each block = one screen pixel at 1x) · ${ctx.kit.label}`,
    };
  },
};
