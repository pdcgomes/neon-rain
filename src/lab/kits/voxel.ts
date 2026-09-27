import * as THREE from 'three';
import { proceduralClips } from '../anim/procedural.ts';
import { attach, buildRig, type BoneName, type Rig } from '../rig.ts';
import { meshVoxels, VoxelGrid, VoxelPalette } from '../voxel/mesher.ts';
import { design, type Design } from './designs.ts';
import { signAsset } from './shared.ts';
import { FACTION, PROP_LABELS, type BuildingSpec, type CharacterKind, type LabAsset, type PropKind, type StyleKit } from './types.ts';

/**
 * Style C: retro-modern voxel. Chunky figures ~26 voxels tall (a nod to the original's
 * sprites), hard-edged colour blocks, glowing voxel visors, stepped 8 fps animation.
 */

const VOX_TALL = 26;

interface Part {
  bone: BoneName;
  grid: VoxelGrid;
  anchor: [number, number, number];
}

function part(bone: BoneName, nx: number, ny: number, nz: number, anchor: [number, number, number]): Part {
  return { bone, grid: new VoxelGrid(nx, ny, nz), anchor };
}

function voxelCharacter(d: Design): { rig: Rig; parts: Part[]; palette: VoxelPalette; size: number } {
  const rig = buildRig(d.prop);
  const size = d.prop.height / VOX_TALL;
  const pal = new VoxelPalette();
  const C = (hex: string, glow = false) => pal.index(hex, glow);
  const bulk = d.prop.bulk;
  const vu = (m: number) => Math.max(1, Math.round(m / size));

  const coat = C(d.coat);
  const trim = C(d.trim);
  const pants = C(d.pants);
  const skin = C(d.skin);
  const hair = C(d.hair);
  const boots = C(d.boots);
  const accent = C(d.accent, true);
  const dark = C('#101116');
  const parts: Part[] = [];

  // Head: 4x4x4 with hair / gear / visor painted on.
  const hw = 4;
  const head = part('Head', hw + 2, hw + 3, hw + 2, [(hw + 2) / 2, -0.6, (hw + 2) / 2]);
  const hg = head.grid;
  hg.fill(1, 0, 1, 1 + hw, hw, 1 + hw, skin);
  if (d.hairStyle !== 'bald') {
    hg.fill(1, hw - 1, 1, 1 + hw, hw, 1 + hw, hair);
    hg.fill(1, 1, 1, 1 + hw, hw, 2, hair);
    if (d.hairStyle === 'bob' || d.hairStyle === 'long') {
      hg.fill(1, 0, 1, 2, hw, 1 + hw - 1, hair);
      hg.fill(hw, 0, 1, hw + 1, hw, 1 + hw - 1, hair);
      if (d.hairStyle === 'long') hg.fill(1, -1, 0, 1 + hw, 2, 1, hair);
    }
    if (d.hairStyle === 'mohawk') hg.fill(2, hw, 1, 4, hw + 2, 1 + hw, C(d.hair, d.kind === 'civilian'));
    if (d.hairStyle === 'bun') hg.fill(2, hw - 1, 0, 4, hw + 1, 1, hair);
  }
  if (d.head === 'cap') {
    hg.fill(1, hw, 1, 1 + hw, hw + 1, 1 + hw, d.kind === 'police' ? coat : trim);
    hg.fill(1, hw - 1, hw + 1, 1 + hw, hw, hw + 2, dark);
  } else if (d.head === 'helmet') {
    hg.fill(0, 0, 0, hw + 2, hw + 1, hw + 2, coat);
    hg.fill(1, 1, hw + 1, 1 + hw, 3, hw + 2, accent);
  } else if (d.head === 'hood') {
    hg.fill(0, 0, 0, hw + 2, hw + 1, hw + 1, d.coat === '#1c4a4a' ? trim : coat);
    hg.fill(1, 0, 1, 1 + hw, hw - 1, hw + 2, 0);
    hg.fill(1, 0, 1, 1 + hw, hw - 1, 1 + hw, skin);
  }
  if (d.visor === 'band' || d.visor === 'shades') hg.fill(1, 2, hw, 1 + hw, 3, hw + 1, accent);
  if (d.visor === 'band') {
    // Wraps round the temples, plus an earpiece light.
    hg.set(0, 2, hw, accent);
    hg.set(hw + 1, 2, hw, accent);
    hg.set(hw + 1, 1, hw - 1, accent);
  }
  if (d.visor === 'none' && d.head !== 'helmet') {
    hg.set(2, 2, hw, dark);
    hg.set(3, 2, hw, dark);
  }
  parts.push(head);

  // Torso on Spine: shoulders wide, tapering to the waist.
  const sw = Math.max(5, vu(d.prop.shoulders * 1.05 * bulk));
  const depth = Math.max(3, Math.round(3 * bulk));
  const th = vu(0.5 * (d.prop.height / 1.8));
  const torso = part('Spine', sw + 2, th + 2, depth + 2, [(sw + 2) / 2, 1.2, (depth + 2) / 2]);
  const tg = torso.grid;
  for (let y = 0; y < th; y++) {
    const inset = y < th * 0.35 ? 1 : 0;
    tg.fill(1 + inset, y, 1, 1 + sw - inset, y + 1, 1 + depth, coat);
  }
  if (d.outfit === 'longcoat') {
    tg.fill(1, th - 1, 0, 1 + sw, th + 1, 1, coat);
    // Coat opening and lapels in the trim colour, so the torso isn't a single dark block.
    const mid = Math.floor((sw + 2) / 2);
    tg.fill(mid, 0, depth + 1, mid + 1, th - 1, depth + 2, trim);
    tg.fill(mid - 1, th - 3, depth + 1, mid + 2, th - 1, depth + 2, trim);
    tg.fill(1, th - 1, 1, 1 + sw, th, 1 + depth, trim);
  }
  if (d.outfit === 'suit') {
    tg.fill(Math.floor((sw + 2) / 2), 2, depth + 1, Math.floor((sw + 2) / 2) + 1, th, depth + 2, d.kind === 'voss' ? trim : dark);
    tg.fill(Math.floor((sw + 2) / 2) - 1, th - 2, depth + 1, Math.floor((sw + 2) / 2) + 2, th, depth + 2, C('#e8e8ec'));
  }
  if (d.outfit === 'armor') {
    tg.fill(2, 2, depth + 1, sw, th - 1, depth + 2, C('#4a4e58'));
    tg.fill(2, 3, depth + 2, sw, 4, depth + 3, accent);
  }
  if (d.outfit === 'uniform') tg.set(sw - 1, th - 3, depth + 1, C('#e8eefc', true));
  if (d.ledTrim && d.outfit === 'hoodie') tg.fill(2, th - 3, depth + 1, sw, th - 2, depth + 2, accent);
  parts.push(torso);

  // Hips + skirt.
  const hem = d.outfit === 'longcoat' ? 9 : d.outfit === 'dress' ? 7 : d.outfit === 'jacket' || d.outfit === 'suit' || d.outfit === 'uniform' ? 3 : 2;
  const hipW = Math.max(5, vu(0.34 * bulk));
  const skirtW = d.outfit === 'longcoat' || d.outfit === 'dress' ? hipW + 2 : hipW;
  const hips = part('Hips', skirtW + 2, hem + 3, depth + 4, [(skirtW + 2) / 2, hem + 1, (depth + 4) / 2]);
  const hgp = hips.grid;
  hgp.fill(1 + (skirtW - hipW) / 2, hem, 2, 1 + (skirtW + hipW) / 2, hem + 2, 2 + depth, pants);
  const skirtCol = d.outfit === 'dress' ? coat : d.outfit === 'armor' ? C('#2f333c') : coat;
  for (let y = 0; y < hem; y++) {
    // y counts down from the waist: the coat flares out below the hips.
    const w = y >= hem * 0.35 ? skirtW : hipW;
    const x0 = 1 + Math.floor((skirtW - w) / 2);
    // Shell only: legs swing inside the coat.
    for (let x = x0; x < x0 + w; x++)
      for (let z = 1; z < 3 + depth; z++) {
        const edge = x === x0 || x === x0 + w - 1 || z === 1 || z === 2 + depth;
        if (edge) hgp.set(x, hem - 1 - y + 1, z, skirtCol);
      }
  }
  if (d.outfit === 'longcoat' || d.outfit === 'uniform' || d.outfit === 'armor') {
    const x0 = 1 + (skirtW - hipW) / 2;
    hgp.fill(x0, hem + 1, 1, x0 + hipW, hem + 2, 3 + depth, dark);
    hgp.set(Math.floor((skirtW + 2) / 2), hem + 1, 2 + depth, d.kind === 'agent' || d.kind === 'rival' ? accent : C('#8a8f99'));
  }
  if (d.ledTrim && (d.outfit === 'longcoat' || d.outfit === 'dress')) {
    for (let x = 1; x < 1 + skirtW; x++) {
      hgp.set(x, 1, 1, accent);
      hgp.set(x, 1, 2 + depth, accent);
    }
  }
  parts.push(hips);

  // Limbs.
  const armW = bulk > 1.2 ? 3 : 2;
  const legW = bulk > 1.2 ? 3 : 2;
  const sleeve = d.outfit === 'dress' ? skin : coat;
  const glove = d.outfit === 'armor' || d.kind === 'agent' || d.kind === 'rival' ? dark : skin;
  for (const side of ['Left', 'Right'] as const) {
    const ua = vu(rig.seg.upperArm);
    const fa = vu(rig.seg.foreArm);
    const upper = part(`${side}Arm`, armW, ua, armW, [armW / 2, ua, armW / 2]);
    upper.grid.fill(0, 0, 0, armW, ua, armW, sleeve);
    if (d.pads) {
      const pad = part(`${side}Arm`, armW + 2, 2, armW + 2, [(armW + 2) / 2, 0.5, (armW + 2) / 2]);
      pad.grid.fill(0, 0, 0, armW + 2, 2, armW + 2, d.outfit === 'armor' ? C('#4a4e58') : trim);
      parts.push(pad);
    }
    const fore = part(`${side}ForeArm`, armW, fa, armW, [armW / 2, fa, armW / 2]);
    fore.grid.fill(0, 0, 0, armW, fa, armW, sleeve);
    fore.grid.fill(0, 0, 0, armW, 1, armW, glove);
    const th2 = vu(rig.seg.thigh);
    const sh2 = vu(rig.seg.shin);
    const thigh = part(`${side}UpLeg`, legW, th2, legW, [legW / 2, th2, legW / 2]);
    thigh.grid.fill(0, 0, 0, legW, th2, legW, pants);
    const shin = part(`${side}Leg`, legW, sh2, legW + 2, [legW / 2, sh2, legW / 2]);
    shin.grid.fill(0, 1, 0, legW, sh2, legW, pants);
    shin.grid.fill(0, 0, 0, legW, 2, legW + 2, boots);
    parts.push(upper, fore, thigh, shin);
  }
  if (d.kind === 'agent' || d.kind === 'rival') {
    const holster = part('RightUpLeg', 1, 3, 2, [legW / 2 + 1, vu(rig.seg.thigh) * 0.6, 1]);
    holster.grid.fill(0, 0, 0, 1, 3, 2, dark);
    holster.grid.set(0, 2, 1, accent);
    parts.push(holster);
  }
  if (d.shoulderLight) {
    const l = part('LeftArm', 1, 1, 1, [0.5, -1, 0.5]);
    l.grid.set(0, 0, 0, accent);
    parts.push(l);
  }

  // Weapon in the right hand (barrel along -Y of the hand).
  if (d.weapon) {
    const len = d.weapon === 'gauss' ? 10 : d.weapon === 'carbine' ? 8 : d.weapon === 'pistol' ? 3 : 5;
    const wide = d.weapon === 'gauss' ? 2 : 1;
    const w = part('RightForeArm', wide + 1, len, 3, [(wide + 1) / 2, len + vu(rig.seg.foreArm) - 1, 1]);
    w.grid.fill(0, 0, 1, wide + 1, len, 2 + (wide > 1 ? 1 : 0), dark);
    w.grid.fill(0, len - 2, 0, wide + 1, len, 1, dark);
    w.grid.set(0, Math.floor(len / 3), 2, C(d.weapon === 'gauss' ? '#7af7ff' : d.accent, true));
    parts.push(w);
  }

  if (d.umbrella) {
    const u = part('Spine1', 13, 16, 13, [8.5, -1, 4.5]);
    u.grid.fill(6, 0, 6, 7, 13, 7, dark);
    for (let z = 0; z < 13; z++)
      for (let x = 0; x < 13; x++) {
        const r = Math.hypot(x - 6, z - 6);
        if (r <= 6.4) u.grid.set(x, r > 5.5 ? 12 : r > 3 ? 13 : 14, z, r > 5.5 ? C(d.umbrella, true) : C('#14141c'));
      }
    parts.push(u);
  }

  return { rig, parts, palette: pal, size };
}

function buildVoxelCharacter(d: Design): LabAsset {
  const { rig, parts, palette, size } = voxelCharacter(d);
  let voxels = 0;
  for (const p of parts) {
    voxels += p.grid.count();
    attach(rig, p.bone, meshVoxels(p.grid, palette, size, p.anchor));
  }
  const clips = proceduralClips({ hipsY: rig.seg.hipsY, stepped: true, fps: 8, amplitude: d.prop.bulk > 1.2 ? 0.85 : 1 });
  rig.root.name = d.name;
  return {
    object: rig.root,
    clips,
    name: d.name,
    category: 'character',
    source: `Style C voxel (${voxels} voxels, ${VOX_TALL} tall)`,
    walkSpeed: d.walkSpeed,
    runSpeed: d.runSpeed,
  };
}

// ------------------------------------------------------------------ props

function voxelProp(kind: PropKind): LabAsset {
  const pal = new VoxelPalette();
  const C = (hex: string, glow = false) => pal.index(hex, glow);
  let grid: VoxelGrid;
  let size = 0.125;
  switch (kind) {
    case 'car': {
      grid = new VoxelGrid(15, 11, 32);
      const paint = C('#5a0f1f');
      const glass = C('#0a0d14');
      const tyre = C('#0c0c0f');
      grid.fill(0, 2, 0, 15, 6, 32, paint);
      grid.fill(1, 6, 8, 14, 10, 24, glass);
      grid.fill(1, 10, 9, 14, 11, 23, paint);
      for (const z of [4, 24]) for (const x of [0, 13]) grid.fill(x, 0, z, x + 2, 4, z + 5, tyre);
      grid.fill(1, 4, 31, 14, 5, 32, C('#e8f0ff', true));
      grid.fill(1, 4, 0, 14, 5, 1, C('#ff2244', true));
      grid.fill(0, 2, 2, 15, 3, 30, C(FACTION.eurocorp, true));
      break;
    }
    case 'lamp': {
      grid = new VoxelGrid(3, 42, 12);
      const pole = C('#23242b');
      grid.fill(1, 0, 1, 2, 40, 2, pole);
      grid.fill(0, 0, 0, 3, 2, 3, pole);
      grid.fill(1, 39, 1, 2, 40, 11, pole);
      grid.fill(0, 38, 7, 3, 39, 11, C('#ffb070', true));
      break;
    }
    case 'trafficLight': {
      grid = new VoxelGrid(4, 34, 4);
      const pole = C('#1b1c22');
      grid.fill(1, 0, 1, 3, 26, 3, pole);
      grid.fill(0, 25, 0, 4, 34, 3, pole);
      grid.fill(1, 31, 3, 3, 33, 4, C('#5a1018'));
      grid.fill(1, 28, 3, 3, 30, 4, C('#5a4010'));
      grid.fill(1, 26, 3, 3, 28, 4, C('#39ff88', true));
      break;
    }
    case 'vending': {
      grid = new VoxelGrid(8, 15, 6);
      grid.fill(0, 0, 0, 8, 15, 6, C('#1a1c26'));
      const cols = ['#1ff4ff', '#ff2bd6', '#ffb627', '#7dff5c'];
      for (let y = 0; y < 5; y++) for (let x = 0; x < 3; x++) grid.fill(1 + x * 2, 5 + y * 2, 5, 2 + x * 2, 6 + y * 2, 6, C(cols[(x + y) % 4], true));
      grid.fill(1, 2, 5, 7, 3, 6, C('#0a0a10'));
      break;
    }
    case 'umbrella': {
      grid = new VoxelGrid(13, 18, 13);
      grid.fill(6, 0, 6, 7, 16, 7, C('#101116'));
      for (let z = 0; z < 13; z++)
        for (let x = 0; x < 13; x++) {
          const r = Math.hypot(x - 6, z - 6);
          if (r <= 6.4) grid.set(x, r > 5.5 ? 15 : r > 3 ? 16 : 17, z, r > 5.5 ? C(FACTION.eurocorp, true) : C('#14141c'));
        }
      break;
    }
    default: {
      size = 0.2;
      grid = new VoxelGrid(34, 12, 32);
      const hull = C('#2a2d36');
      grid.fill(12, 4, 2, 22, 11, 30, hull);
      grid.fill(13, 9, 22, 21, 11, 28, C('#0a0d14'));
      grid.fill(0, 8, 12, 34, 9, 20, hull);
      for (const x0 of [0, 26])
        for (let z = 11; z < 21; z++)
          for (let x = x0; x < x0 + 8; x++) {
            const r = Math.hypot(x - (x0 + 3.5), z - 15.5);
            if (r > 2.5 && r < 4.3) grid.fill(x, 7, z, x + 1, 10, z + 1, hull);
            else if (r <= 2.5) grid.set(x, 7, z, C('#39ffb0', true));
          }
      grid.fill(12, 5, 2, 13, 6, 30, C(FACTION.eurocorp, true));
      grid.fill(21, 5, 2, 22, 6, 30, C(FACTION.eurocorp, true));
      for (const [x, z] of [[13, 6], [20, 6], [16, 26]]) grid.fill(x, 0, z, x + 1, 4, z + 1, hull);
    }
  }
  const obj = meshVoxels(grid, pal, size, [grid.nx / 2, 0, grid.nz / 2]);
  obj.name = PROP_LABELS[kind];
  return { object: obj, clips: [], name: PROP_LABELS[kind], category: 'prop', source: `Style C voxel (${grid.count()} voxels @ ${size * 100} cm)` };
}

// ------------------------------------------------------------------ buildings

function pixelFacade(w: number, h: number, seed: number, faceSeed: number): THREE.CanvasTexture {
  const ppm = 4;
  const c = document.createElement('canvas');
  c.width = Math.max(4, Math.round(w * ppm));
  c.height = Math.max(4, Math.round(h * ppm));
  const g = c.getContext('2d')!;
  const base = ['#1a1b24', '#221c24', '#172028', '#26242a'][seed % 4];
  g.fillStyle = base;
  g.fillRect(0, 0, c.width, c.height);
  const rnd = (i: number) => Math.abs(Math.sin(i * 12.9898 + seed * 78.233 + faceSeed * 3.1) * 43758.5453) % 1;
  const winColors = ['#c98a4a', '#e0a860', '#b07a42', '#6fa8c8'];
  for (let y = 2; y < c.height - 14; y += 5) {
    for (let x = 1; x < c.width - 2; x += 4) {
      const r = rnd(x * 31 + y * 7);
      g.fillStyle = r > 0.66 ? winColors[Math.floor(r * 97) % winColors.length] : r > 0.3 ? '#10121a' : '#161822';
      g.fillRect(x, c.height - y - 3, 2, 3);
    }
    g.fillStyle = 'rgba(0,0,0,0.35)';
    g.fillRect(0, c.height - y, c.width, 1);
  }
  // Shopfront band at street level.
  for (let x = 0; x < c.width; x += 8) {
    const r = rnd(x + 999);
    g.fillStyle = r > 0.55 ? ['#1ff4ff', '#ff2bd6', '#ffb627'][Math.floor(r * 31) % 3] : '#0b0c12';
    g.fillRect(x + 1, c.height - 11, 6, 8);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.magFilter = THREE.NearestFilter;
  t.minFilter = THREE.NearestFilter;
  t.generateMipmaps = false;
  return t;
}

function voxelBuilding(spec: BuildingSpec): LabAsset {
  const g = new THREE.Group();
  const faces = [
    pixelFacade(spec.d, spec.h, spec.variant, 0),
    pixelFacade(spec.d, spec.h, spec.variant, 1),
    null,
    null,
    pixelFacade(spec.w, spec.h, spec.variant, 2),
    pixelFacade(spec.w, spec.h, spec.variant, 3),
  ];
  const roof = new THREE.MeshStandardMaterial({ color: '#15161d', roughness: 0.9, flatShading: true });
  const mats = faces.map((t) =>
    t ? new THREE.MeshStandardMaterial({ map: t, emissiveMap: t, emissive: '#ffffff', emissiveIntensity: 0.4, roughness: 0.8, metalness: 0.05 }) : roof,
  );
  const body = new THREE.Mesh(new THREE.BoxGeometry(spec.w, spec.h, spec.d).translate(0, spec.h / 2, 0), mats);
  body.castShadow = true;
  body.receiveShadow = true;
  g.add(body);

  // Chunky voxel roof details at 25 cm.
  const pal = new VoxelPalette();
  const C = (hex: string, glow = false) => pal.index(hex, glow);
  const nx = Math.round(spec.w * 4);
  const nz = Math.round(spec.d * 4);
  const roofGrid = new VoxelGrid(nx, 14, nz);
  roofGrid.fill(0, 0, 0, nx, 1, 1, C('#2a2b33'));
  roofGrid.fill(0, 0, nz - 1, nx, 1, nz, C('#2a2b33'));
  roofGrid.fill(0, 0, 0, 1, 1, nz, C('#2a2b33'));
  roofGrid.fill(nx - 1, 0, 0, nx, 1, nz, C('#2a2b33'));
  const units = Math.max(2, Math.round((spec.w * spec.d) / 20));
  for (let i = 0; i < units; i++) {
    const x = 2 + Math.floor(((i * 0.37 + spec.variant * 0.11) % 1) * (nx - 8));
    const z = 2 + Math.floor(((i * 0.61 + 0.2) % 1) * (nz - 8));
    roofGrid.fill(x, 0, z, x + 4, 3, z + 3, C('#1c1d24'));
    roofGrid.fill(x + 1, 3, z + 1, x + 3, 4, z + 2, C('#303139'));
  }
  roofGrid.fill(2, 0, 2, 3, 12, 3, C('#1c1d24'));
  roofGrid.set(2, 12, 2, C('#ff3344', true));
  roofGrid.fill(0, 0, 0, nx, 1, 1, C(spec.variant % 2 ? FACTION.eurocorp : '#ff2bd6', true));
  const roofMesh = meshVoxels(roofGrid, pal, 0.25, [nx / 2, 0, nz / 2]);
  roofMesh.position.y = spec.h;
  g.add(roofMesh);

  const awnPal = new VoxelPalette();
  const aw = new VoxelGrid(Math.round(spec.w * 0.7 * 4), 2, 5);
  aw.fill(0, 1, 0, aw.nx, 2, 5, awnPal.index('#23242c'));
  aw.fill(0, 0, 4, aw.nx, 1, 5, awnPal.index(spec.variant % 2 ? FACTION.eurocorp : '#ff2bd6', true));
  const awning = meshVoxels(aw, awnPal, 0.25, [aw.nx / 2, 0, 0]);
  awning.position.set(0, 3.1, spec.d / 2);
  g.add(awning);
  return { object: g, clips: [], name: spec.label, category: 'building', source: 'Style C pixel facade + 25 cm voxel details' };
}

export const voxelKit: StyleKit = {
  id: 'voxel',
  label: 'Style C · Voxel',
  short: 'C',
  palette: {
    name: 'Retro sprite (voxel)',
    swatches: [
      { name: 'Eurocorp', hex: FACTION.eurocorp, emissive: true },
      { name: 'Rival', hex: FACTION.rival, emissive: true },
      { name: 'Guard', hex: FACTION.guard, emissive: true },
      { name: 'Police', hex: FACTION.police, emissive: true },
      { name: 'Window', hex: '#ffb35c', emissive: true },
      { name: 'Coat', hex: '#15161c' },
      { name: 'Wall', hex: '#1a1b24' },
    ],
  },
  async character(kind: CharacterKind, variant: number) {
    return buildVoxelCharacter(design(kind, variant));
  },
  async prop(kind: PropKind) {
    return voxelProp(kind);
  },
  async building(spec: BuildingSpec) {
    return voxelBuilding(spec);
  },
  async sign(text: string, color: string, vertical: boolean) {
    return signAsset(text, color, vertical, true);
  },
};
