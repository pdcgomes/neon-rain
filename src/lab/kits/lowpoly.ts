import * as THREE from 'three';
import { proceduralClips } from '../anim/procedural.ts';
import { attach, buildRig, type Rig } from '../rig.ts';
import { design, type Design } from './designs.ts';
import { box, canvasTexture, lathe, limb, mat, mesh } from './geo.ts';
import { buildingAsset, signAsset } from './shared.ts';
import { FACTION, PROP_LABELS, type BuildingSpec, type CharacterKind, type LabAsset, type PropKind, type StyleKit } from './types.ts';

/**
 * Style A: stylised low-poly. Flat-shaded faceted shapes, strong silhouettes (flared coats,
 * pads, visors), a small palette per character, emissive accents for the neon look.
 */

const cloth = (hex: string) => mat(hex, { rough: 0.85, metal: 0.05 });
const leather = (hex: string) => mat(hex, { rough: 0.42, metal: 0.25 });
const armor = (hex: string) => mat(hex, { rough: 0.35, metal: 0.65 });
const skin = (hex: string) => mat(hex, { rough: 0.7, metal: 0 });
const glow = (hex: string, k = 3) => mat(hex, { rough: 0.4, metal: 0, emissive: k });
const gunmetal = mat('#16171c', { rough: 0.3, metal: 0.85 });

function buildHead(rig: Rig, d: Design): void {
  const s = d.prop.height / 1.8;
  const headR = 0.108 * s;
  const head = new THREE.Group();
  head.position.y = 0.1 * s;
  const skull = mesh(new THREE.IcosahedronGeometry(headR, 1), skin(d.skin));
  skull.scale.set(0.92, 1.08, 1);
  head.add(skull);
  // Jaw / nose facet for a readable facing direction.
  head.add(mesh(box(0.05 * s, 0.05 * s, 0.05 * s).rotateX(0.5), skin(d.skin), 0, -0.02 * s, headR * 0.95));

  const hairMat = cloth(d.hair);
  switch (d.hairStyle) {
    case 'slick':
      head.add(mesh(new THREE.SphereGeometry(headR * 1.04, 7, 4, 0, Math.PI * 2, 0, Math.PI * 0.55), hairMat, 0, 0.012, -0.01));
      break;
    case 'buzz':
      head.add(mesh(new THREE.SphereGeometry(headR * 1.02, 7, 4, 0, Math.PI * 2, 0, Math.PI * 0.42), hairMat, 0, 0.01, 0));
      break;
    case 'bob': {
      head.add(mesh(new THREE.SphereGeometry(headR * 1.1, 8, 5, 0, Math.PI * 2, 0, Math.PI * 0.7), hairMat, 0, 0.0, -0.012));
      break;
    }
    case 'long':
      head.add(mesh(new THREE.SphereGeometry(headR * 1.08, 8, 5, 0, Math.PI * 2, 0, Math.PI * 0.6), hairMat, 0, 0.01, -0.01));
      head.add(mesh(box(0.2 * s, 0.26 * s, 0.07 * s), hairMat, 0, -0.12 * s, -0.07 * s));
      break;
    case 'mohawk':
      head.add(mesh(box(0.035 * s, 0.09 * s, 0.24 * s), mat(d.hair, { rough: 0.6, emissive: d.kind === 'civilian' ? 0.6 : 0 }), 0, headR * 1.05, -0.01));
      break;
    case 'bun':
      head.add(mesh(new THREE.SphereGeometry(headR * 1.03, 7, 4, 0, Math.PI * 2, 0, Math.PI * 0.55), hairMat, 0, 0.012, -0.01));
      head.add(mesh(new THREE.IcosahedronGeometry(0.05 * s, 0), hairMat, 0, 0.05 * s, -0.1 * s));
      break;
    default:
      break;
  }

  switch (d.head) {
    case 'cap': {
      const cap = new THREE.Group();
      cap.add(mesh(new THREE.CylinderGeometry(headR * 1.02, headR * 1.08, 0.07 * s, 8), cloth(d.kind === 'police' ? d.coat : d.trim), 0, headR * 0.72, 0));
      cap.add(mesh(box(0.2 * s, 0.015 * s, 0.1 * s), gunmetal, 0, headR * 0.5, headR * 0.95));
      if (d.kind === 'police') cap.add(mesh(box(0.04 * s, 0.035 * s, 0.01), glow('#e8eefc', 1.2), 0, headR * 0.78, headR * 1.06));
      head.add(cap);
      break;
    }
    case 'helmet':
      head.add(mesh(new THREE.IcosahedronGeometry(headR * 1.32, 1), armor(d.coat), 0, 0.02 * s, -0.01));
      break;
    case 'hood':
      head.add(mesh(lathe([[0.001, 0.2], [0.1, 0.17], [0.14, 0.06], [0.14, -0.06], [0.12, -0.14]].map(([r, y]) => [r * s, y * s] as [number, number]), 7, 1.05), cloth(d.coat === '#1c4a4a' ? d.trim : d.coat), 0, 0.005, -0.02));
      break;
    default:
      break;
  }

  // Visor: the signature Syndicate-agent glow.
  const eyeY = 0.005 * s;
  const front = headR * (d.head === 'helmet' ? 1.28 : 0.93);
  if (d.visor === 'band') head.add(mesh(box(0.2 * s, 0.035 * s, 0.05 * s), glow(d.accent, 3.2), 0, eyeY, front));
  else if (d.visor === 'shades') head.add(mesh(box(0.18 * s, 0.04 * s, 0.04 * s), glow(d.accent, 1.6), 0, eyeY, front));
  else if (d.visor === 'full') head.add(mesh(box(0.2 * s, 0.07 * s, 0.05 * s), glow(d.accent, 2.8), 0, eyeY, front));
  attach(rig, 'Head', head);
  attach(rig, 'Neck', mesh(limb(0.1 * s, 0.045 * s, 0.05 * s).translate(0, 0.09 * s, 0), skin(d.skin)));
}

function buildTorso(rig: Rig, d: Design): void {
  const s = d.prop.height / 1.8;
  const b = d.prop.bulk;
  const sh = d.prop.shoulders;
  const coatMat = d.outfit === 'longcoat' ? leather(d.coat) : d.outfit === 'armor' ? armor(d.coat) : cloth(d.coat);

  // Chest: a faceted tapered block, wide at the shoulders.
  const chest = lathe(
    [
      [0.14 * b, 0],
      [0.16 * b, 0.12],
      [(sh / 2) * 0.92, 0.3],
      [(sh / 2) * 0.7, 0.36],
      [0.06, 0.4],
    ].map(([r, y]) => [r, y * s] as [number, number]),
    6,
    0.62,
  );
  attach(rig, 'Spine', mesh(chest, coatMat, 0, -0.04 * s, 0));

  // Belly / belt.
  attach(rig, 'Hips', mesh(new THREE.CylinderGeometry(0.15 * b, 0.155 * b, 0.12 * s, 6).scale(1, 1, 0.66), cloth(d.pants), 0, 0.06 * s, 0));

  // Skirts: long coats flare to the knee, jackets stop at the hip, dresses flare wide.
  const hem =
    d.outfit === 'longcoat' ? 0.62 : d.outfit === 'dress' ? 0.5 : d.outfit === 'suit' || d.outfit === 'uniform' ? 0.2 : d.outfit === 'hoodie' ? 0.14 : d.outfit === 'jacket' ? 0.18 : 0.12;
  const flare = d.outfit === 'longcoat' ? 0.3 : d.outfit === 'dress' ? 0.3 : 0.18;
  const skirt = lathe(
    [
      [0.16 * b, 0.1],
      [0.17 * b, 0],
      [flare * b, -hem * s],
    ],
    d.outfit === 'longcoat' ? 7 : 6,
    0.72,
  );
  attach(rig, 'Hips', mesh(skirt, d.outfit === 'dress' ? cloth(d.coat) : coatMat, 0, 0.02, 0)).traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh) m.material = (m.material as THREE.MeshStandardMaterial).clone();
    if (m.isMesh) (m.material as THREE.MeshStandardMaterial).side = THREE.DoubleSide;
  });
  if (d.ledTrim) {
    const ring = new THREE.TorusGeometry(flare * b * 0.98, 0.012, 3, 14).rotateX(Math.PI / 2).scale(1, 1, 0.72);
    attach(rig, 'Hips', mesh(ring, glow(d.accent, 2.4), 0, 0.02 - hem * s, 0));
  }

  // Belt with a buckle: breaks the long dark mass of the coat at the waist.
  if (d.outfit === 'longcoat' || d.outfit === 'uniform' || d.outfit === 'armor') {
    attach(rig, 'Hips', mesh(new THREE.CylinderGeometry(0.168 * b, 0.168 * b, 0.05 * s, 7).scale(1, 1, 0.7), leather('#0b0c10'), 0, 0.1 * s, 0));
    const buckle = d.kind === 'agent' || d.kind === 'rival' ? glow(d.accent, 2.2) : armor('#8a8f99');
    attach(rig, 'Hips', mesh(box(0.05 * s, 0.035 * s, 0.02), buckle, 0, 0.1 * s, 0.12 * b));
  }

  // Collars and outfit-specific details.
  if (d.outfit === 'longcoat') {
    // Lapels: two slanted panels forming a V on the chest.
    for (const sx of [-1, 1]) {
      const lapel = mesh(box(0.07 * s, 0.26 * s, 0.018), cloth(d.trim), sx * 0.05 * s, 0.05 * s, 0.105 * b);
      lapel.rotation.z = sx * 0.28;
      lapel.rotation.x = -0.12;
      attach(rig, 'Spine1', lapel);
    }
    attach(rig, 'Spine1', mesh(new THREE.CylinderGeometry(0.1 * b, 0.13 * b, 0.12 * s, 6, 1, true).scale(1, 1, 0.8), mat(d.coat, { rough: 0.45, metal: 0.25, side: THREE.DoubleSide }), 0, 0.22 * s, -0.01));
  }
  if (d.outfit === 'suit') {
    attach(rig, 'Spine1', mesh(box(0.035 * s, 0.22 * s, 0.02), cloth(d.kind === 'voss' ? d.trim : '#0b0c10'), 0, 0.02 * s, 0.1 * b));
    attach(rig, 'Spine1', mesh(box(0.12 * s, 0.1 * s, 0.02), cloth('#e8e8ec'), 0, 0.1 * s, 0.095 * b));
  }
  if (d.outfit === 'armor') {
    attach(rig, 'Spine1', mesh(box(sh * 0.7, 0.2 * s, 0.07), armor(d.trim === '#4d8dff' ? '#3a4150' : '#4a4e58'), 0, 0.02 * s, 0.1 * b));
    attach(rig, 'Spine', mesh(box(sh * 0.55, 0.12 * s, 0.06), armor('#2f333c'), 0, 0.02 * s, 0.1 * b));
    attach(rig, 'Spine1', mesh(box(sh * 0.4, 0.02 * s, 0.075), glow(d.accent, 1.8), 0, -0.07 * s, 0.12 * b));
  }
  if (d.outfit === 'uniform') {
    attach(rig, 'Spine1', mesh(box(0.05, 0.05, 0.02), glow('#e8eefc', 1.4), 0.08 * s, 0.06 * s, 0.1 * b));
    attach(rig, 'Hips', mesh(new THREE.CylinderGeometry(0.162 * b, 0.162 * b, 0.04 * s, 6).scale(1, 1, 0.68), cloth('#0c0d12'), 0, 0.09 * s, 0));
  }
  if (d.outfit === 'hoodie' && d.ledTrim) {
    attach(rig, 'Spine1', mesh(box(0.2 * s, 0.015 * s, 0.02), glow(d.accent, 2), 0, 0.02 * s, 0.1 * b));
  }
}

function buildLimbs(rig: Rig, d: Design): void {
  const s = d.prop.height / 1.8;
  const b = d.prop.bulk;
  const sleeve = d.outfit === 'longcoat' ? leather(d.coat) : d.outfit === 'armor' ? armor(d.coat) : cloth(d.outfit === 'dress' ? d.skin : d.coat);
  const glove = d.outfit === 'armor' || d.kind === 'agent' || d.kind === 'rival' ? gunmetal : skin(d.skin);
  for (const side of ['Left', 'Right'] as const) {
    // Shoulder joint: rounds off where the sleeve meets the torso.
    attach(rig, `${side}Arm`, mesh(new THREE.IcosahedronGeometry(0.07 * b, 0), sleeve, 0, -0.01, 0));
    attach(rig, `${side}Arm`, mesh(limb(rig.seg.upperArm, 0.058 * b, 0.05 * b), sleeve));
    attach(rig, `${side}ForeArm`, mesh(limb(rig.seg.foreArm, 0.05 * b, 0.042 * b), sleeve));
    attach(rig, `${side}Hand`, mesh(box(0.06 * b, 0.09 * s, 0.07 * b).translate(0, -0.045 * s, 0), glove));
    if (d.pads) {
      const pad = box(0.15 * b, 0.07 * s, 0.16 * b).translate(0, 0.02, 0);
      attach(rig, `${side}Arm`, mesh(pad, armor(d.outfit === 'armor' ? '#4a4e58' : d.trim)));
    }
    attach(rig, `${side}UpLeg`, mesh(limb(rig.seg.thigh, 0.078 * b, 0.064 * b), cloth(d.pants)));
    attach(rig, `${side}Leg`, mesh(limb(rig.seg.shin, 0.062 * b, 0.05 * b), cloth(d.pants)));
    attach(rig, `${side}Foot`, mesh(box(0.1 * b, 0.08 * s, 0.24 * s).translate(0, -0.035 * s, 0.05 * s), leather(d.boots)));
  }
  if (d.shoulderLight) attach(rig, 'LeftArm', mesh(box(0.06, 0.04, 0.06), glow(d.accent, 3), 0.02, 0.06, 0));
}

function weaponMesh(w: NonNullable<Design['weapon']>): THREE.Group {
  const g = new THREE.Group();
  const add = (geo: THREE.BufferGeometry, m: THREE.Material, x = 0, y = 0, z = 0) => g.add(mesh(geo, m, x, y, z));
  // Barrels point along -Y of the hand (forward when the arm is raised to aim).
  switch (w) {
    case 'pistol':
      add(box(0.035, 0.18, 0.06), gunmetal, 0, -0.1, 0.02);
      add(box(0.03, 0.04, 0.09), gunmetal, 0, -0.04, -0.02);
      break;
    case 'uzi':
    case 'smg':
      add(box(0.05, 0.3, 0.08), gunmetal, 0, -0.14, 0.03);
      add(box(0.03, 0.05, 0.14), gunmetal, 0, -0.06, -0.06);
      add(box(0.052, 0.03, 0.02), glow(w === 'uzi' ? FACTION.eurocorp : FACTION.rival, 2.2), 0, -0.2, 0.075);
      break;
    case 'carbine':
      add(box(0.05, 0.56, 0.08), gunmetal, 0, -0.24, 0.03);
      add(box(0.03, 0.05, 0.14), gunmetal, 0, -0.06, -0.06);
      add(box(0.052, 0.12, 0.02), glow(FACTION.police, 1.6), 0, -0.3, 0.075);
      break;
    case 'gauss':
      add(box(0.12, 0.8, 0.14), gunmetal, 0, -0.3, 0.05);
      add(new THREE.CylinderGeometry(0.05, 0.05, 0.3, 6), glow('#7af7ff', 2.6), 0, -0.55, 0.05);
      add(box(0.13, 0.05, 0.15), glow(FACTION.rival, 1.8), 0, -0.1, 0.05);
      break;
  }
  return g;
}

function umbrellaMesh(color: string): THREE.Group {
  const g = new THREE.Group();
  g.add(mesh(new THREE.CylinderGeometry(0.012, 0.012, 1.0, 5).translate(0, 0.45, 0), gunmetal));
  const canopy = mesh(new THREE.ConeGeometry(0.62, 0.3, 10, 1, true), mat('#2c2d3c', { rough: 0.25, metal: 0.3, side: THREE.DoubleSide }), 0, 1.03, 0);
  g.add(canopy);
  g.add(mesh(new THREE.TorusGeometry(0.61, 0.018, 3, 20).rotateX(Math.PI / 2), glow(color, 3), 0, 0.88, 0));
  return g;
}

export function buildCharacter(d: Design, opts: { stepped?: boolean } = {}): LabAsset {
  const rig = buildRig(d.prop);
  buildHead(rig, d);
  buildTorso(rig, d);
  buildLimbs(rig, d);
  if (d.weapon) attach(rig, 'RightHand', weaponMesh(d.weapon));
  if (d.umbrella) {
    // Mounted on the upper torso so the canopy stays upright whatever the arms are doing.
    const u = umbrellaMesh(d.umbrella);
    u.position.set(-0.14, -0.14, 0.16);
    attach(rig, 'Spine1', u);
  }
  const clips = proceduralClips({ hipsY: rig.seg.hipsY, amplitude: d.prop.bulk > 1.2 ? 0.85 : 1, stepped: opts.stepped, fps: opts.stepped ? 8 : 30 });
  rig.root.name = d.name;
  return {
    object: rig.root,
    clips,
    name: d.name,
    category: 'character',
    source: 'Style A procedural',
    walkSpeed: d.walkSpeed,
    runSpeed: d.runSpeed,
  };
}

// ------------------------------------------------------------------ props

function car(): THREE.Group {
  const g = new THREE.Group();
  const paint = mat('#5a0f1f', { rough: 0.25, metal: 0.7 });
  const shape = new THREE.Shape();
  const pts: [number, number][] = [
    [-2.0, 0.28], [-2.05, 0.7], [-1.6, 0.82], [-0.9, 0.86], [-0.55, 1.32], [0.75, 1.32], [1.25, 0.9], [1.95, 0.8], [2.05, 0.5], [2.0, 0.28],
  ];
  shape.moveTo(pts[0][0], pts[0][1]);
  for (const p of pts.slice(1)) shape.lineTo(p[0], p[1]);
  const body = new THREE.ExtrudeGeometry(shape, { depth: 1.8, bevelEnabled: false }).translate(0, 0, -0.9);
  body.rotateY(-Math.PI / 2);
  g.add(mesh(body, paint));
  const glass = mat('#0a0d14', { rough: 0.05, metal: 0.9 });
  g.add(mesh(box(1.62, 0.36, 1.25).translate(0, 1.1, -0.1), glass));
  for (const z of [-1.35, 1.3]) for (const x of [-0.85, 0.85]) g.add(mesh(new THREE.CylinderGeometry(0.34, 0.34, 0.24, 8).rotateZ(Math.PI / 2), mat('#0c0c0f', { rough: 0.9 }), x, 0.34, z));
  g.add(mesh(box(1.5, 0.08, 0.04), glow('#e8f0ff', 3), 0, 0.68, 2.06));
  g.add(mesh(box(1.6, 0.07, 0.04), glow('#ff2244', 3), 0, 0.72, -2.04));
  g.add(mesh(box(1.82, 0.03, 3.6), glow(FACTION.eurocorp, 1.4), 0, 0.3, 0));
  return g;
}

function lamp(): THREE.Group {
  const g = new THREE.Group();
  const pole = mat('#23242b', { rough: 0.4, metal: 0.8 });
  g.add(mesh(new THREE.CylinderGeometry(0.07, 0.1, 5, 6).translate(0, 2.5, 0), pole));
  g.add(mesh(box(0.08, 0.08, 1.4).translate(0, 5, 0.6), pole));
  g.add(mesh(box(0.34, 0.1, 0.7).translate(0, 4.92, 1.2), pole));
  g.add(mesh(box(0.28, 0.03, 0.6).translate(0, 4.86, 1.2), glow('#ffb070', 4)));
  g.add(mesh(new THREE.CylinderGeometry(0.2, 0.24, 0.3, 6).translate(0, 0.15, 0), pole));
  return g;
}

function trafficLight(): THREE.Group {
  const g = new THREE.Group();
  const pole = mat('#1b1c22', { rough: 0.4, metal: 0.8 });
  g.add(mesh(new THREE.CylinderGeometry(0.07, 0.09, 3.6, 6).translate(0, 1.8, 0), pole));
  g.add(mesh(box(0.3, 0.9, 0.26).translate(0, 3.5, 0.12), pole));
  const lights: [string, number][] = [['#ff3344', 0.3], ['#ffb627', 0.3], ['#39ff88', 3.2]];
  lights.forEach(([c, k], i) => g.add(mesh(new THREE.CylinderGeometry(0.08, 0.08, 0.04, 8).rotateX(Math.PI / 2), glow(c, k), 0, 3.78 - i * 0.28, 0.26)));
  g.add(mesh(box(0.3, 0.16, 0.2).translate(0, 1.2, 0.1), pole));
  g.add(mesh(box(0.2, 0.08, 0.02), glow('#ffffff', 1.6), 0, 1.2, 0.21));
  return g;
}

function vending(): THREE.Group {
  const g = new THREE.Group();
  g.add(mesh(box(0.95, 1.9, 0.75).translate(0, 0.95, 0), mat('#1a1c26', { rough: 0.4, metal: 0.5 })));
  const tex = canvasTexture(128, 256, (c) => {
    c.fillStyle = '#081018';
    c.fillRect(0, 0, 128, 256);
    const cols = ['#1ff4ff', '#ff2bd6', '#ffb627', '#7dff5c'];
    for (let y = 0; y < 6; y++) for (let x = 0; x < 4; x++) {
      c.fillStyle = cols[(x + y) % 4];
      c.fillRect(10 + x * 28, 14 + y * 30, 18, 22);
    }
    c.fillStyle = '#1ff4ff';
    c.font = 'bold 20px sans-serif';
    c.fillText('NEURO+', 20, 240);
  });
  const panel = new THREE.MeshStandardMaterial({ map: tex, emissiveMap: tex, emissive: '#ffffff', emissiveIntensity: 1.6, roughness: 0.2 });
  g.add(mesh(new THREE.PlaneGeometry(0.7, 1.4), panel, 0, 1.1, 0.381));
  return g;
}

function vtol(): THREE.Group {
  const g = new THREE.Group();
  const hull = mat('#2a2d36', { rough: 0.35, metal: 0.7 });
  const body = lathe([[0.02, -3], [0.7, -2.2], [1.05, -0.5], [1.0, 1.2], [0.6, 2.6], [0.02, 3.1]], 8, 0.7);
  body.rotateX(Math.PI / 2);
  g.add(mesh(body, hull, 0, 1.6, 0));
  g.add(mesh(box(6.4, 0.18, 1.3), hull, 0, 1.9, -0.2));
  for (const x of [-3.2, 3.2]) {
    g.add(mesh(new THREE.TorusGeometry(0.75, 0.16, 5, 12).rotateX(Math.PI / 2), hull, x, 1.9, -0.2));
    g.add(mesh(new THREE.CylinderGeometry(0.7, 0.7, 0.05, 10), glow('#39ffb0', 1.6), x, 1.7, -0.2));
  }
  g.add(mesh(box(1.2, 0.35, 1.2).translate(0, 2.25, 1.6), mat('#0a0d14', { rough: 0.05, metal: 0.9 })));
  g.add(mesh(box(0.06, 0.06, 5), glow(FACTION.eurocorp, 2.4), 0.72, 1.35, 0));
  g.add(mesh(box(0.06, 0.06, 5), glow(FACTION.eurocorp, 2.4), -0.72, 1.35, 0));
  for (const [x, z] of [[-0.8, -1.8], [0.8, -1.8], [0, 2.0]]) g.add(mesh(new THREE.CylinderGeometry(0.06, 0.06, 1.0, 5).translate(0, 0.5, 0), hull, x, 0, z));
  return g;
}

export function buildProp(kind: PropKind): LabAsset {
  const obj =
    kind === 'car' ? car() : kind === 'lamp' ? lamp() : kind === 'trafficLight' ? trafficLight() : kind === 'vending' ? vending() : kind === 'umbrella' ? umbrellaMesh('#1ff4ff') : vtol();
  obj.name = PROP_LABELS[kind];
  return { object: obj, clips: [], name: PROP_LABELS[kind], category: 'prop', source: 'Style A procedural' };
}

export const lowpolyKit: StyleKit = {
  id: 'lowpoly',
  label: 'Style A · Low-poly',
  short: 'A',
  palette: {
    name: 'Neon Noir (faceted)',
    swatches: [
      { name: 'Eurocorp', hex: FACTION.eurocorp, emissive: true },
      { name: 'Rival', hex: FACTION.rival, emissive: true },
      { name: 'Guard', hex: FACTION.guard, emissive: true },
      { name: 'Police', hex: FACTION.police, emissive: true },
      { name: 'VIP', hex: FACTION.vip, emissive: true },
      { name: 'Coat', hex: '#15161c' },
      { name: 'Steel', hex: '#474b56' },
      { name: 'Asphalt', hex: '#14151d' },
    ],
  },
  async character(kind: CharacterKind, variant: number) {
    return buildCharacter(design(kind, variant));
  },
  async prop(kind: PropKind) {
    return buildProp(kind);
  },
  async building(spec: BuildingSpec) {
    return buildingAsset(spec, 'lowpoly');
  },
  async sign(text: string, color: string, vertical: boolean) {
    return signAsset(text, color, vertical, false);
  },
};
