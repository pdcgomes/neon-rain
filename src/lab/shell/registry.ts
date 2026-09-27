import type * as THREE from 'three';
import type { AnimPlayer } from '../anim/player.ts';
import type { LabAsset, StyleId, StyleKit } from '../kits/types.ts';
import type { Stage } from '../stage.ts';
import type { LabState } from '../state.ts';
import type { ViewPreset } from '../viewport.ts';

export interface BoardItem {
  id: string;
  asset: LabAsset;
  /** Placed wrapper (position on the board). */
  root: THREE.Object3D;
  /** Inner node that spins on the turntable. */
  spin: THREE.Object3D;
  label: string;
  sublabel?: string;
  /** Height above the root where the label sits. */
  labelY: number;
}

export interface BoardLabel {
  text: string;
  sub?: string;
  at: THREE.Vector3;
  head?: boolean;
}

export interface BoardResult {
  group: THREE.Object3D;
  items: BoardItem[];
  labels?: BoardLabel[];
  bounds: THREE.Box3;
  /** Characters on this board animate from the timeline. */
  animated: boolean;
  turntable: boolean;
  /** Show a floating label per item (off for dense, game-distance boards). */
  itemLabels?: boolean;
  view?: ViewPreset;
  /** Camera pitch (polar angle) for the board's default view. */
  polar?: number;
  clip?: string;
  /** Pixel-preview factor forced by the board (game-scale boards). */
  pixel?: number;
  zoom?: number;
  subtitle?: string;
  update?(dt: number, t: number): void;
}

export interface BoardContext {
  kit: StyleKit;
  kits: Record<StyleId, StyleKit>;
  stage: Stage;
  anim: AnimPlayer;
  state: LabState;
}

export interface BoardDef {
  id: string;
  section: string;
  title: string;
  icon: string;
  /** Uses the currently selected style kit (vs. fixed kits, like the comparison boards). */
  styled: boolean;
  build(ctx: BoardContext): Promise<BoardResult>;
}

export const SECTIONS = ['Characters', 'Environment', 'Props', 'Animation', 'Compare', 'Imported'] as const;

export class Registry {
  boards: BoardDef[] = [];

  add(b: BoardDef): void {
    const i = this.boards.findIndex((x) => x.id === b.id);
    if (i >= 0) this.boards[i] = b;
    else this.boards.push(b);
  }

  get(id: string): BoardDef | undefined {
    return this.boards.find((b) => b.id === id);
  }

  inSection(section: string): BoardDef[] {
    return this.boards.filter((b) => b.section === section);
  }
}
