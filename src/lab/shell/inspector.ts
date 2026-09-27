import * as THREE from 'three';
import { CATALOGUE } from '../anim/catalogue.ts';
import { design, LINEUP } from '../kits/designs.ts';
import { countTriangles } from '../kits/geo.ts';
import type { StyleKit } from '../kits/types.ts';
import type { LabState } from '../state.ts';
import type { BoardItem, BoardResult } from './registry.ts';

export interface InspectorHandlers {
  change(patch: Partial<LabState>): void;
  exportPNG(): void;
  copyLink(): void;
}

function uniqueColors(obj: THREE.Object3D): { hex: string; glow: boolean }[] {
  const seen = new Map<string, boolean>();
  obj.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    const mats = Array.isArray(m.material) ? m.material : [m.material];
    for (const mt of mats) {
      const s = mt as THREE.MeshStandardMaterial & THREE.MeshBasicMaterial;
      if (s.vertexColors && m.geometry.attributes.color) {
        const c = m.geometry.attributes.color as THREE.BufferAttribute;
        for (let i = 0; i < c.count && seen.size < 24; i += 4) {
          const hex = `#${new THREE.Color(c.getX(i), c.getY(i), c.getZ(i)).getHexString()}`;
          if (!seen.has(hex)) seen.set(hex, s.type === 'MeshBasicMaterial');
        }
      } else if (s.color) {
        const hex = (s.userData.labColor as string) ?? `#${s.color.getHexString()}`;
        const glow = !!s.userData.labEmissive || s.type === 'MeshBasicMaterial';
        if (!seen.has(hex)) seen.set(hex, glow);
      }
    }
  });
  return [...seen.entries()].slice(0, 20).map(([hex, glow]) => ({ hex, glow }));
}

function boneCount(obj: THREE.Object3D): number {
  let n = 0;
  obj.traverse((o) => {
    if ((o as THREE.Bone).isBone) n++;
  });
  return n;
}

export class Inspector {
  private root: HTMLElement;
  private h: InspectorHandlers;

  constructor(root: HTMLElement, h: InspectorHandlers) {
    this.root = root;
    this.h = h;
  }

  render(state: LabState, kit: StyleKit, board: BoardResult | null, item: BoardItem | null, boardId: string): void {
    const r = this.root;
    const sel = item?.asset;
    const obj = sel?.object;
    const tris = obj ? countTriangles(obj) : board ? board.items.reduce((s, it) => s + countTriangles(it.asset.object), 0) : 0;
    const height = obj ? new THREE.Box3().setFromObject(obj, true).getSize(new THREE.Vector3()).y : 0;
    const clipNames = new Set(sel?.clips.map((c) => c.name) ?? []);
    const missing = sel && sel.category === 'character' ? CATALOGUE.filter((c) => !clipNames.has(c.id)).length : 0;
    const colors = obj ? uniqueColors(obj) : [];
    const opt = (v: string, cur: string, label = v) => `<option value="${v}"${v === cur ? ' selected' : ''}>${label}</option>`;
    const chk = (key: keyof LabState, label: string) => `<label class="chk"><input type="checkbox" data-k="${key}"${state[key] ? ' checked' : ''}/>${label}</label>`;

    r.innerHTML = `
      <div class="ins-sec">
        <div class="ins-name">${sel ? sel.name : board ? 'Board' : '…'}</div>
        <div class="ins-sub">${sel ? sel.source : board?.subtitle ?? ''}</div>
        <div class="kv" style="margin-top:8px">
          ${sel ? `<span>Category</span><span>${sel.category}</span>` : `<span>Items</span><span>${board?.items.length ?? 0}</span>`}
          <span>Triangles</span><span>${tris.toLocaleString()}</span>
          ${sel ? `<span>Height</span><span>${height.toFixed(2)} m</span>` : ''}
          ${sel && sel.category === 'character' ? `<span>Bones</span><span>${boneCount(obj!)}</span><span>Clips</span><span>${sel.clips.length} / ${CATALOGUE.length}</span>` : ''}
        </div>
        ${sel?.notes ? `<div class="warn-note" style="margin-top:6px">${sel.notes}</div>` : ''}
        ${!sel ? '<div class="note" style="margin-top:6px">Click an asset to inspect it. Double-click (or F) to frame it.</div>' : ''}
      </div>
      <div class="ins-sec">
        <div class="ins-h">PALETTE · ${kit.palette.name.toUpperCase()}</div>
        <div class="chips">${kit.palette.swatches.map((s) => `<span class="chip" title="${s.hex}"><i style="background:${s.hex};${s.emissive ? `box-shadow:0 0 8px ${s.hex}` : ''}"></i>${s.name}</span>`).join('')}</div>
        ${colors.length ? `<div class="ins-h" style="margin-top:8px">ASSET COLOURS</div><div class="chips">${colors.map((c) => `<span class="chip" title="${c.hex}${c.glow ? ' (emissive)' : ''}"><i style="background:${c.hex};${c.glow ? `box-shadow:0 0 7px ${c.hex}` : ''}"></i></span>`).join('')}</div>` : ''}
      </div>
      ${
        sel?.category === 'character' || (!sel && board?.animated)
          ? `<div class="ins-sec">
        <div class="ins-h">CLIP COVERAGE ${sel ? (missing ? `· <span style="color:var(--bad)">${missing} missing</span>` : '· <span style="color:var(--ok)">complete</span>') : ''}</div>
        <div class="clips">${CATALOGUE.map((c) => `<span data-clip="${c.id}" title="${c.trigger}" class="${!sel || clipNames.has(c.id) ? 'have' : 'miss'}${c.id === state.clip ? ' cur' : ''}" style="cursor:default">${c.id}</span>`).join('')}</div>
        <div class="note" style="margin-top:6px">Click a clip to play it. Hover for the game state that triggers it.</div>
      </div>
      <div class="ins-sec">
        <div class="ins-h">CROSSFADE TESTER</div>
        ${chk('cf', 'Enable')}
        <div class="row">
          <select data-k="cfa">${CATALOGUE.map((c) => opt(c.id, state.cfa)).join('')}</select>
          <span class="note">→</span>
          <select data-k="cfb">${CATALOGUE.map((c) => opt(c.id, state.cfb)).join('')}</select>
        </div>
        <div class="row"><span class="note">Blend</span><input class="num" type="number" step="0.05" min="0.05" max="2" value="${state.cfblend}" data-k="cfblend" style="width:64px"/><span class="note">s</span></div>
      </div>`
          : ''
      }
      ${
        boardId === 'clipgrid'
          ? `<div class="ins-sec"><div class="ins-h">CLIP GRID SUBJECT</div><select data-k="subject" style="width:100%">${LINEUP.map((l) => opt(`${l.kind}:${l.variant}`, state.subject, design(l.kind, l.variant).name)).join('')}</select></div>`
          : ''
      }
      <div class="ins-sec">
        <div class="ins-h">REVIEW</div>
        <div class="toggles">
          ${chk('turn', 'Turntable')}
          ${chk('sil', 'Silhouette')}
          ${chk('rain', 'Rain')}
          ${chk('wet', 'Wet floor')}
          ${chk('skel', 'Skeleton')}
          ${chk('contact', 'Contacts')}
          ${chk('ghost', 'Onion skin')}
        </div>
        <div class="row"><span class="note">Pixel preview</span>
          <select data-k="px">${[1, 2, 3, 4, 6].map((k) => opt(String(k), String(state.px), k === 1 ? 'Off' : `${k}×`)).join('')}</select>
        </div>
      </div>
      <div class="ins-sec">
        <button class="btn-wide" data-act="png">Export PNG</button>
        <button class="btn-wide ghost" data-act="link">Copy deep link</button>
      </div>`;

    r.querySelectorAll<HTMLInputElement>('input[type=checkbox][data-k]').forEach((el) =>
      el.addEventListener('change', () => this.h.change({ [el.dataset.k!]: el.checked } as Partial<LabState>)),
    );
    r.querySelectorAll<HTMLSelectElement>('select[data-k]').forEach((el) =>
      el.addEventListener('change', () => {
        const k = el.dataset.k!;
        this.h.change({ [k]: k === 'px' ? Number(el.value) : el.value } as Partial<LabState>);
      }),
    );
    r.querySelectorAll<HTMLInputElement>('input.num[data-k]').forEach((el) =>
      el.addEventListener('change', () => this.h.change({ [el.dataset.k!]: Number(el.value) } as Partial<LabState>)),
    );
    r.querySelectorAll<HTMLElement>('[data-clip]').forEach((el) => el.addEventListener('click', () => this.h.change({ clip: el.dataset.clip!, cf: false })));
    r.querySelector('[data-act=png]')?.addEventListener('click', () => this.h.exportPNG());
    r.querySelector('[data-act=link]')?.addEventListener('click', () => this.h.copyLink());
  }
}
