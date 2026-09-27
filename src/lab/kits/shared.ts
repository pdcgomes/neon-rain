import * as THREE from 'three';
import { buildingMaterial } from '../../render/cityBuilder.ts';
import { signTexture } from '../../render/textures.ts';
import { box, canvasTexture, mat, mesh } from './geo.ts';
import { FACTION, type BuildingSpec, type LabAsset } from './types.ts';

/** Shared uniform so every lab building's windows flicker in sync with the lab clock. */
export const buildingUniforms = { uTime: { value: 0 } };

const TINTS = [
  [0.1, 0.105, 0.13],
  [0.13, 0.11, 0.12],
  [0.08, 0.1, 0.12],
  [0.15, 0.14, 0.15],
];

/** One building using the game's own facade shader, plus kit-specific rooftop and street details. */
export function gameFacade(spec: BuildingSpec): THREE.InstancedMesh {
  const geo = new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0);
  const m = new THREE.InstancedMesh(geo, buildingMaterial(buildingUniforms), 1);
  m.setMatrixAt(0, new THREE.Matrix4().compose(new THREE.Vector3(0, 0, 0), new THREE.Quaternion(), new THREE.Vector3(spec.w, spec.h, spec.d)));
  geo.setAttribute('aSeed', new THREE.InstancedBufferAttribute(new Float32Array([(spec.variant * 131 + 17) % 997]), 1));
  geo.setAttribute('aFade', new THREE.InstancedBufferAttribute(new Float32Array([1]), 1));
  geo.setAttribute('aTint', new THREE.InstancedBufferAttribute(new Float32Array(TINTS[spec.variant % TINTS.length]), 3));
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

export function buildingAsset(spec: BuildingSpec, style: 'lowpoly' | 'baseline'): LabAsset {
  const g = new THREE.Group();
  g.add(gameFacade(spec));
  if (style === 'lowpoly') {
    const metal = mat('#1c1d24', { rough: 0.7, metal: 0.4 });
    // Rooftop clutter: AC units, a water tank, an antenna with a beacon.
    const units = Math.max(2, Math.round((spec.w * spec.d) / 20));
    for (let i = 0; i < units; i++) {
      const x = ((i * 0.37 + spec.variant * 0.11) % 1) * (spec.w - 2) - spec.w / 2 + 1;
      const z = ((i * 0.61 + 0.2) % 1) * (spec.d - 2) - spec.d / 2 + 1;
      g.add(mesh(box(1.1, 0.7, 0.9), metal, x, spec.h + 0.35, z));
    }
    g.add(mesh(new THREE.CylinderGeometry(0.7, 0.7, 1.4, 8), metal, spec.w / 2 - 1.2, spec.h + 0.7, -spec.d / 2 + 1.2));
    g.add(mesh(new THREE.CylinderGeometry(0.04, 0.05, 3, 4), metal, -spec.w / 2 + 0.8, spec.h + 1.5, spec.d / 2 - 0.8));
    g.add(mesh(new THREE.IcosahedronGeometry(0.14, 0), mat('#ff3344', { emissive: 3 }), -spec.w / 2 + 0.8, spec.h + 3.05, spec.d / 2 - 0.8));
    // Street level: an awning with an LED strip over the shopfronts.
    const awn = mesh(box(spec.w * 0.7, 0.08, 1.2), mat('#23242c', { rough: 0.5, metal: 0.5 }), 0, 3.3, spec.d / 2 + 0.55);
    awn.rotation.x = 0.12;
    g.add(awn);
    g.add(mesh(box(spec.w * 0.7, 0.04, 0.04), mat(spec.variant % 2 ? FACTION.eurocorp : '#ff2bd6', { emissive: 3 }), 0, 3.22, spec.d / 2 + 1.14));
    // Fire escape / cable conduits break up the flat side wall.
    for (let y = 4; y < spec.h - 1; y += 3.1) g.add(mesh(box(0.1, 0.1, spec.d * 0.9), metal, spec.w / 2 + 0.06, y, 0));
  }
  return { object: g, clips: [], name: spec.label, category: 'building', source: `${style} (game facade shader)` };
}

export function signAsset(text: string, color: string, vertical: boolean, pixel: boolean): LabAsset {
  let tex: THREE.Texture;
  if (!pixel) tex = signTexture(text, color, vertical);
  else {
    const w = vertical ? 16 : 64;
    const h = vertical ? 64 : 16;
    tex = canvasTexture(
      w,
      h,
      (g) => {
        g.fillStyle = '#07060c';
        g.fillRect(0, 0, w, h);
        g.strokeStyle = color;
        g.strokeRect(0.5, 0.5, w - 1, h - 1);
        g.fillStyle = color;
        g.font = `bold ${vertical ? 11 : 12}px monospace`;
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        if (vertical) [...text].slice(0, 5).forEach((ch, i) => g.fillText(ch, w / 2, 7 + i * 12));
        else g.fillText(text, w / 2, h / 2 + 1);
      },
      true,
    );
  }
  const m = new THREE.MeshBasicMaterial({ map: tex, toneMapped: false, transparent: true, side: THREE.DoubleSide });
  m.color.setScalar(2.6);
  const w = vertical ? 1.3 : 4.2;
  const h = vertical ? 5.2 : 1.2;
  const g = new THREE.Group();
  g.add(new THREE.Mesh(new THREE.PlaneGeometry(w, h), m));
  const frame = mat('#15161c', { rough: 0.5, metal: 0.7 });
  g.add(mesh(box(w + 0.12, h + 0.12, 0.08), frame, 0, 0, -0.05));
  g.position.y = h / 2 + 0.3;
  const wrap = new THREE.Group();
  wrap.add(g);
  return { object: wrap, clips: [], name: `Sign: ${text}`, category: 'sign', source: pixel ? 'pixel-font canvas' : 'game sign texture' };
}
