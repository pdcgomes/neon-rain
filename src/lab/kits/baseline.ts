import * as THREE from 'three';
import { proceduralClips } from '../anim/procedural.ts';
import { attach, buildRig } from '../rig.ts';
import { design } from './designs.ts';
import { box, mat, mesh } from './geo.ts';
import { buildingAsset, signAsset } from './shared.ts';
import { FACTION, PROP_LABELS, type CharacterKind, type LabAsset, type PropKind, type StyleKit } from './types.ts';

/** The look currently in the game (primitive parts), kept as the control group. */

function character(kind: CharacterKind, variant: number): LabAsset {
  const d = design(kind, variant);
  const rig = buildRig({ ...d.prop, height: 1.8 * (kind === 'enforcer' || kind === 'heavy' ? 1.2 / 1.08 : 1) });
  const coat = mat(d.coat, { rough: 0.45, metal: 0.3, flat: false });
  attach(rig, 'Spine', mesh(new THREE.CylinderGeometry(0.24, 0.34, 1.05 * (kind === 'civilian' ? 0.9 : 1.1), 8), coat, 0, -0.15, 0));
  attach(rig, 'Head', mesh(new THREE.IcosahedronGeometry(0.17, 1), mat(d.skin, { flat: false }), 0, 0.12, 0));
  if (d.visor !== 'none') attach(rig, 'Head', mesh(box(0.3, 0.055, 0.1), mat(d.accent, { emissive: 3 }), 0, 0.14, 0.14));
  for (const side of ['Left', 'Right'] as const) {
    attach(rig, `${side}UpLeg`, mesh(box(0.14, 0.78, 0.15).translate(0, -0.39, 0), mat('#15161b', { flat: false })));
  }
  if (d.weapon) attach(rig, 'RightHand', mesh(box(0.1, 0.55, 0.12).translate(0, -0.2, 0), mat('#0c0c10', { rough: 0.3, metal: 0.8 })));
  const clips = proceduralClips({ hipsY: rig.seg.hipsY });
  return { object: rig.root, clips, name: d.name, category: 'character', source: 'In-game primitives', walkSpeed: d.walkSpeed, runSpeed: d.runSpeed };
}

function prop(kind: PropKind): LabAsset {
  const g = new THREE.Group();
  const dark = mat('#22232a', { rough: 0.4, metal: 0.8, flat: false });
  switch (kind) {
    case 'car':
      g.add(mesh(box(1.8, 0.7, 3.8).translate(0, 0.55, 0), mat('#5a0f1f', { rough: 0.25, metal: 0.7, flat: false })));
      g.add(mesh(box(1.6, 0.55, 2).translate(0, 1.15, -0.2), mat('#0a0c12', { rough: 0.1, metal: 0.9, flat: false })));
      g.add(mesh(box(1.7, 0.12, 0.05), mat('#ffffff', { emissive: 2.2 }), 0, 0.65, 1.92));
      g.add(mesh(box(1.7, 0.12, 0.05), mat('#ff2233', { emissive: 3 }), 0, 0.65, -1.92));
      break;
    case 'lamp':
      g.add(mesh(new THREE.CylinderGeometry(0.06, 0.08, 5, 6).translate(0, 2.5, 0), dark));
      g.add(mesh(box(0.9, 0.12, 0.3), mat('#ffb070', { emissive: 3 }), 0, 5, 0));
      break;
    case 'trafficLight':
      g.add(mesh(new THREE.CylinderGeometry(0.07, 0.09, 3.6, 6).translate(0, 1.8, 0), dark));
      g.add(mesh(box(0.34, 0.5, 0.34), mat('#39ff88', { emissive: 3 }), 0, 3.7, 0));
      break;
    case 'vending':
      g.add(mesh(box(0.9, 1.9, 0.7).translate(0, 0.95, 0), mat('#181a22', { flat: false })));
      g.add(mesh(box(0.7, 1.4, 0.02), mat(FACTION.eurocorp, { emissive: 0.9 }), 0, 1.05, 0.36));
      break;
    case 'umbrella':
      g.add(mesh(new THREE.ConeGeometry(0.85, 0.32, 12, 1, true), mat('#14141c', { side: THREE.DoubleSide, flat: false }), 0, 2.2, 0));
      g.add(mesh(new THREE.TorusGeometry(0.84, 0.03, 4, 24).rotateX(Math.PI / 2), mat(FACTION.eurocorp, { emissive: 3 }), 0, 2.07, 0));
      break;
    case 'vtol':
      g.add(mesh(box(2, 1.4, 6).translate(0, 1.6, 0), dark));
      g.add(mesh(box(6, 0.2, 1.2).translate(0, 1.9, 0), dark));
      break;
  }
  return { object: g, clips: [], name: PROP_LABELS[kind], category: 'prop', source: 'In-game primitives' };
}

export const baselineKit: StyleKit = {
  id: 'baseline',
  label: 'Baseline · In-game',
  short: 'Base',
  palette: {
    name: 'Current game',
    swatches: [
      { name: 'Eurocorp', hex: FACTION.eurocorp, emissive: true },
      { name: 'Rival', hex: FACTION.rival, emissive: true },
      { name: 'Police', hex: FACTION.police, emissive: true },
      { name: 'Coat', hex: '#121318' },
    ],
  },
  async character(kind, variant) {
    return character(kind, variant);
  },
  async prop(kind) {
    return prop(kind);
  },
  async building(spec) {
    return buildingAsset(spec, 'baseline');
  },
  async sign(text, color, vertical) {
    return signAsset(text, color, vertical, false);
  },
};
