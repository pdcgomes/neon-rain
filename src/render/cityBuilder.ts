import * as THREE from 'three';
import type { Building, CityMap, Prop } from '../sim/map.ts';
import { hash2 } from '../sim/rng.ts';
import { NEON, SIGN_WORDS, groundTextures, radialTexture, signTexture } from './textures.ts';

export interface BuildingBox {
  min: THREE.Vector3;
  max: THREE.Vector3;
  fade: number;
  target: number;
}

const BUILDING_VERT_HEAD = /* glsl */ `
attribute float aSeed;
attribute float aFade;
attribute vec3 aTint;
varying vec3 vBPos;
varying vec3 vBNormal;
flat varying float vSeed;
varying float vFade;
flat varying vec3 vTint;
varying float vTop;
varying vec3 vLocal;
varying vec3 vSize;
`;

const BUILDING_FRAG_HEAD = /* glsl */ `
uniform float uTime;
varying vec3 vBPos;
varying vec3 vBNormal;
flat varying float vSeed;
varying float vFade;
flat varying vec3 vTint;
varying float vTop;
varying vec3 vLocal;
varying vec3 vSize;
float bHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float bayer4(vec2 p) {
  ivec2 i = ivec2(mod(p, 4.0));
  int idx = i.x + i.y * 4;
  float m[16] = float[16](0., 8., 2., 10., 12., 4., 14., 6., 3., 11., 1., 9., 15., 7., 13., 5.);
  return (m[idx] + 0.5) / 16.0;
}
`;

function buildingMaterial(uniforms: { uTime: { value: number } }): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.62, metalness: 0.15, envMapIntensity: 0.35 });
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = uniforms.uTime;
    shader.vertexShader = BUILDING_VERT_HEAD + shader.vertexShader.replace(
      '#include <begin_vertex>',
      /* glsl */ `#include <begin_vertex>
      vec4 bw = modelMatrix * instanceMatrix * vec4(transformed, 1.0);
      vBPos = bw.xyz;
      vBNormal = normalize(mat3(instanceMatrix) * objectNormal);
      vTop = (modelMatrix * instanceMatrix * vec4(0.0, 1.0, 0.0, 1.0)).y;
      vLocal = position;
      vSize = vec3(length(instanceMatrix[0].xyz), length(instanceMatrix[1].xyz), length(instanceMatrix[2].xyz));
      vSeed = aSeed; vFade = aFade; vTint = aTint;`,
    );
    shader.fragmentShader = BUILDING_FRAG_HEAD + shader.fragmentShader
      .replace(
        '#include <clipping_planes_fragment>',
        /* glsl */ `#include <clipping_planes_fragment>
        float bEdge = 0.0;
        if (vFade < 0.995) {
          vec3 bD = min(vLocal - vec3(-0.5, 0.0, -0.5), vec3(0.5, 1.0, 0.5) - vLocal) * vSize;
          float bMn = min(bD.x, min(bD.y, bD.z));
          float bMx = max(bD.x, max(bD.y, bD.z));
          float bMid = bD.x + bD.y + bD.z - bMn - bMx;
          bEdge = 1.0 - step(0.09, bMid);
          if (bEdge < 0.5 && bayer4(gl_FragCoord.xy) > vFade * 0.9) discard;
        }`,
      )
      .replace(
        '#include <color_fragment>',
        /* glsl */ `#include <color_fragment>
        vec3 bn = normalize(vBNormal);
        float bWall = 1.0 - step(0.5, abs(bn.y));
        vec2 bUv = abs(bn.x) > 0.5 ? vBPos.zy : vBPos.xy;
        float bStyle = floor(bHash(vec2(vSeed, 7.0)) * 3.0);
        vec2 bCell = bStyle < 1.0 ? vec2(1.1, 2.6) : (bStyle < 2.0 ? vec2(3.0, 2.6) : vec2(2.2, 3.4));
        vec2 bQ = bUv / bCell;
        vec2 bId = floor(bQ);
        vec2 bF = fract(bQ);
        vec2 bFw = max(fwidth(bQ), vec2(1e-4));
        float bLod = clamp(max(bFw.x, bFw.y) * 3.0 - 0.6, 0.0, 1.0);
        vec2 bLo = bStyle < 1.0 ? vec2(0.22, 0.34) : (bStyle < 2.0 ? vec2(-1.0, 0.4) : vec2(0.35, 0.4));
        vec2 bHi = bStyle < 1.0 ? vec2(0.78, 0.74) : (bStyle < 2.0 ? vec2(2.0, 0.72) : vec2(0.65, 0.7));
        vec2 bIn = smoothstep(bLo - bFw, bLo + bFw, bF) * (1.0 - smoothstep(bHi - bFw, bHi + bFw, bF));
        float bCover = (min(bHi.x, 1.0) - max(bLo.x, 0.0)) * (bHi.y - bLo.y);
        float bWin = mix(bIn.x * bIn.y, bCover, bLod);
        float bGround = step(vBPos.y, 3.2);
        bWin *= bWall * (1.0 - bGround) * step(vBPos.y, vTop - 1.0);
        float bFloor = step(0.94, fract(vBPos.y / 2.6)) * bWall;
        float bPier = step(0.93, fract(bUv.x / 6.0)) * bWall;
        diffuseColor.rgb = vTint * (0.85 + 0.3 * bHash(vec2(bId.y, vSeed)));
        diffuseColor.rgb *= 1.0 - 0.6 * bWin;
        diffuseColor.rgb *= 1.0 - 0.35 * max(bFloor, bPier);
        diffuseColor.rgb *= mix(1.0, 0.55, bGround * bWall);
        if (bn.y > 0.5) diffuseColor.rgb = vTint * 0.5;`,
      )
      .replace(
        '#include <emissivemap_fragment>',
        /* glsl */ `#include <emissivemap_fragment>
        float bH = bHash(bId + vec2(vSeed * 0.0137, bn.x * 3.0 + bn.z * 7.0));
        float bLit = mix(step(0.7, bH), 0.3, bLod);
        vec3 bWarm = vec3(1.0, 0.62, 0.34);
        vec3 bCool = vec3(0.45, 0.75, 1.0);
        vec3 bPink = vec3(1.0, 0.32, 0.72);
        vec3 bWc = bH > 0.96 ? bPink : (bH > 0.85 ? bCool : bWarm);
        float bFlick = 0.85 + 0.15 * sin(uTime * (1.0 + bH * 3.0) + bH * 60.0);
        float bGlow = bStyle < 2.0 ? 0.7 : 0.9;
        totalEmissiveRadiance += bWc * bWin * bLit * bGlow * bFlick;
        float bShopSeg = floor(bUv.x / 4.0);
        float bShopOn = step(0.4, bHash(vec2(bShopSeg, vSeed)));
        float bShop = bWall * step(0.4, vBPos.y) * step(vBPos.y, 2.5) * bShopOn * step(0.12, fract(bUv.x / 4.0)) * step(fract(bUv.x / 4.0), 0.88);
        vec3 bShopC = mix(bCool, bPink, bHash(vec2(bShopSeg + 3.0, vSeed)));
        bShopC = mix(bShopC, bWarm, step(0.7, bHash(vec2(bShopSeg + 9.0, vSeed))));
        totalEmissiveRadiance += bShopC * bShopC * bShop * 0.45;
        float bTrimOn = step(0.55, bHash(vec2(vSeed, 3.0)));
        vec3 bTrimC = bHash(vec2(vSeed, 5.0)) > 0.5 ? vec3(0.1, 0.95, 1.0) : vec3(1.0, 0.17, 0.84);
        float bTrim = bWall * bTrimOn * step(vTop - 0.35, vBPos.y);
        totalEmissiveRadiance += bTrimC * bTrim * 2.2;
        if (bEdge > 0.5) {
          diffuseColor.rgb *= 0.2;
          totalEmissiveRadiance = mix(totalEmissiveRadiance, vec3(0.15, 0.9, 1.1), 1.0 - vFade);
        }`,
      );
  };
  return mat;
}

export class City {
  readonly group = new THREE.Group();
  readonly boxes: BuildingBox[] = [];
  private uniforms = { uTime: { value: 0 } };
  private fadeAttr!: THREE.InstancedBufferAttribute;
  private flickers: { mat: THREE.MeshBasicMaterial; base: number; seed: number }[] = [];
  private beacons!: THREE.InstancedMesh;
  private holo!: THREE.Mesh;
  vtolBeam!: THREE.Mesh;
  vtolPad!: THREE.Mesh;
  escapeBeam!: THREE.Mesh;
  private map: CityMap;

  constructor(map: CityMap) {
    this.map = map;
    this.buildGround();
    this.buildBuildings(map.buildings);
    this.buildSigns(map.buildings);
    this.buildProps(map.props);
    this.buildMarkers();
  }

  private buildGround(): void {
    const { color, rough } = groundTextures(this.map);
    const geo = new THREE.PlaneGeometry(this.map.w, this.map.h);
    geo.rotateX(-Math.PI / 2);
    geo.translate(this.map.w / 2, 0, this.map.h / 2);
    const mat = new THREE.MeshStandardMaterial({
      map: color,
      roughnessMap: rough,
      roughness: 1,
      metalness: 0.15,
      envMapIntensity: 1.6,
    });
    const ground = new THREE.Mesh(geo, mat);
    ground.receiveShadow = true;
    this.group.add(ground);

    // Endless dark apron beyond the map edge so fog swallows the border.
    const apron = new THREE.Mesh(
      new THREE.PlaneGeometry(this.map.w * 6, this.map.h * 6).rotateX(-Math.PI / 2),
      new THREE.MeshStandardMaterial({ color: 0x07070c, roughness: 0.4, metalness: 0.2 }),
    );
    apron.position.set(this.map.w / 2, -0.02, this.map.h / 2);
    this.group.add(apron);

    // Silhouette skyline ring outside the playable area.
    const ring = new THREE.InstancedMesh(
      new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0),
      buildingMaterial(this.uniforms),
      160,
    );
    const seeds = new Float32Array(160);
    const fades = new Float32Array(160).fill(1);
    const tints = new Float32Array(160 * 3);
    const m = new THREE.Matrix4();
    const cx = this.map.w / 2;
    const cz = this.map.h / 2;
    for (let i = 0; i < 160; i++) {
      const a = (i / 160) * Math.PI * 2;
      const r = this.map.w * (0.62 + hash2(i, 1) * 0.35);
      const h = 30 + hash2(i, 2) * 90;
      const s = 8 + hash2(i, 3) * 14;
      m.compose(
        new THREE.Vector3(cx + Math.cos(a) * r, 0, cz + Math.sin(a) * r),
        new THREE.Quaternion(),
        new THREE.Vector3(s, h, s),
      );
      ring.setMatrixAt(i, m);
      seeds[i] = (i * 17) % 997;
      tints.set([0.07, 0.075, 0.1], i * 3);
    }
    ring.geometry.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seeds, 1));
    ring.geometry.setAttribute('aFade', new THREE.InstancedBufferAttribute(fades, 1));
    ring.geometry.setAttribute('aTint', new THREE.InstancedBufferAttribute(tints, 3));
    this.group.add(ring);
  }

  private buildBuildings(buildings: Building[]): void {
    const n = buildings.length;
    const geo = new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0);
    const mesh = new THREE.InstancedMesh(geo, buildingMaterial(this.uniforms), n);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    const seeds = new Float32Array(n);
    const fades = new Float32Array(n).fill(1);
    const tints = new Float32Array(n * 3);
    const palette = [
      [0.1, 0.105, 0.13],
      [0.13, 0.11, 0.12],
      [0.08, 0.1, 0.12],
      [0.15, 0.14, 0.15],
    ];
    const m = new THREE.Matrix4();
    const roofBits: THREE.Matrix4[] = [];
    const beaconPos: THREE.Vector3[] = [];
    buildings.forEach((b, i) => {
      m.compose(
        new THREE.Vector3(b.x + b.w / 2, 0, b.y + b.h / 2),
        new THREE.Quaternion(),
        new THREE.Vector3(b.w, b.height, b.h),
      );
      mesh.setMatrixAt(i, m);
      seeds[i] = b.seed % 997;
      tints.set(palette[b.style % palette.length], i * 3);
      this.boxes.push({
        min: new THREE.Vector3(b.x, 0, b.y),
        max: new THREE.Vector3(b.x + b.w, b.height, b.y + b.h),
        fade: 1,
        target: 1,
      });
      // Rooftop clutter: AC units and water tanks.
      const bits = 1 + Math.floor(hash2(b.id, 5) * 4);
      for (let k = 0; k < bits; k++) {
        const s = 0.8 + hash2(b.id, k + 10) * 1.6;
        const px = b.x + 1 + hash2(b.id, k + 20) * Math.max(0, b.w - 2);
        const pz = b.y + 1 + hash2(b.id, k + 30) * Math.max(0, b.h - 2);
        roofBits.push(
          new THREE.Matrix4().compose(
            new THREE.Vector3(px, b.height, pz),
            new THREE.Quaternion(),
            new THREE.Vector3(s, s * 0.7, s),
          ),
        );
      }
      if (b.height > 24) beaconPos.push(new THREE.Vector3(b.x + b.w / 2, b.height + 1.2, b.y + b.h / 2));
    });
    geo.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seeds, 1));
    this.fadeAttr = new THREE.InstancedBufferAttribute(fades, 1);
    this.fadeAttr.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('aFade', this.fadeAttr);
    geo.setAttribute('aTint', new THREE.InstancedBufferAttribute(tints, 3));
    this.group.add(mesh);

    const roof = new THREE.InstancedMesh(
      new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0),
      new THREE.MeshStandardMaterial({ color: 0x1c1d24, roughness: 0.8, metalness: 0.4 }),
      roofBits.length,
    );
    roofBits.forEach((mm, i) => roof.setMatrixAt(i, mm));
    roof.castShadow = true;
    this.group.add(roof);

    this.beacons = new THREE.InstancedMesh(
      new THREE.SphereGeometry(0.35, 8, 6),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(4, 0.3, 0.3), toneMapped: false }),
      Math.max(1, beaconPos.length),
    );
    this.beacons.count = beaconPos.length;
    beaconPos.forEach((p, i) => this.beacons.setMatrixAt(i, new THREE.Matrix4().makeTranslation(p.x, p.y, p.z)));
    this.group.add(this.beacons);
  }

  private buildSigns(buildings: Building[]): void {
    const textures = new Map<string, THREE.CanvasTexture>();
    const getTex = (word: string, color: string, vertical: boolean) => {
      const key = `${word}|${color}|${vertical}`;
      let t = textures.get(key);
      if (!t) {
        t = signTexture(word, color, vertical);
        textures.set(key, t);
      }
      return t;
    };
    const glowTex = radialTexture();
    const glowGeo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
    const glows: { x: number; z: number; s: number; c: THREE.Color }[] = [];

    const faces = [
      { nx: 1, nz: 0 },
      { nx: -1, nz: 0 },
      { nx: 0, nz: 1 },
      { nx: 0, nz: -1 },
    ];

    for (const b of buildings) {
      const count = Math.floor(hash2(b.id, 40) * 3.2);
      for (let k = 0; k < count; k++) {
        const face = faces[Math.floor(hash2(b.id, 41 + k) * 4)];
        const along = hash2(b.id, 50 + k);
        const len = face.nx !== 0 ? b.h : b.w;
        const off = 1 + along * Math.max(0, len - 2);
        const fx = face.nx > 0 ? b.x + b.w : face.nx < 0 ? b.x : b.x + off;
        const fz = face.nz > 0 ? b.y + b.h : face.nz < 0 ? b.y : b.y + off;
        const ox = Math.floor(fx + face.nx * 0.5);
        const oz = Math.floor(fz + face.nz * 0.5);
        if (this.map.blocked[oz * this.map.w + ox] && this.map.ground[oz * this.map.w + ox] === 4) continue;

        const vertical = hash2(b.id, 60 + k) > 0.45;
        const word = SIGN_WORDS[Math.floor(hash2(b.id, 70 + k) * SIGN_WORDS.length)];
        const colorHex = NEON[Math.floor(hash2(b.id, 80 + k) * (NEON.length - 1))];
        const sw = vertical ? 1.3 : Math.min(len - 0.5, 4.5);
        const sh = vertical ? 5.2 : 1.2;
        const y = vertical
          ? Math.min(b.height - sh / 2 - 0.5, 6 + hash2(b.id, 90 + k) * Math.max(0, b.height - 12))
          : 3.9;
        if (y < sh / 2 + 3) continue;

        const intensity = 2.2 + hash2(b.id, 95 + k) * 1.5;
        const mat = new THREE.MeshBasicMaterial({
          map: getTex(word, colorHex, vertical),
          transparent: true,
          toneMapped: false,
          side: THREE.DoubleSide,
        });
        mat.color.setScalar(intensity);
        if (hash2(b.id, 99 + k) > 0.82) this.flickers.push({ mat, base: intensity, seed: b.id * 7 + k });
        const sign = new THREE.Mesh(new THREE.PlaneGeometry(sw, sh), mat);
        const stand = vertical ? 0.75 : 0.06;
        sign.position.set(fx + face.nx * stand, y, fz + face.nz * stand);
        if (vertical) sign.rotation.y = face.nx !== 0 ? 0 : Math.PI / 2;
        else sign.rotation.y = Math.atan2(face.nx, face.nz);
        this.group.add(sign);
        glows.push({
          x: fx + face.nx * 2.5,
          z: fz + face.nz * 2.5,
          s: vertical ? 7 : 6,
          c: new THREE.Color(colorHex).multiplyScalar(vertical ? 0.28 : 0.4),
        });
      }
    }

    // Lamp light pools.
    for (const p of this.map.props) {
      if (p.kind !== 'lamp') continue;
      const warm = hash2(p.x, p.y, 2) > 0.4;
      glows.push({
        x: p.x + 0.5,
        z: p.y + 0.5,
        s: 9,
        c: new THREE.Color(warm ? '#ffae5a' : '#69d6ff').multiplyScalar(0.34),
      });
    }

    const glowMesh = new THREE.InstancedMesh(
      glowGeo,
      new THREE.MeshBasicMaterial({
        map: glowTex,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        toneMapped: false,
      }),
      glows.length,
    );
    const m = new THREE.Matrix4();
    glows.forEach((g, i) => {
      m.compose(new THREE.Vector3(g.x, 0.03, g.z), new THREE.Quaternion(), new THREE.Vector3(g.s, 1, g.s));
      glowMesh.setMatrixAt(i, m);
      glowMesh.setColorAt(i, g.c);
    });
    glowMesh.renderOrder = 1;
    this.group.add(glowMesh);
  }

  private buildProps(props: Prop[]): void {
    const by = (k: Prop['kind']) => props.filter((p) => p.kind === k);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);

    // Street lamps.
    const lamps = by('lamp');
    const pole = new THREE.InstancedMesh(
      new THREE.CylinderGeometry(0.06, 0.08, 5, 6).translate(0, 2.5, 0),
      new THREE.MeshStandardMaterial({ color: 0x22232a, metalness: 0.8, roughness: 0.4 }),
      lamps.length,
    );
    const head = new THREE.InstancedMesh(
      new THREE.BoxGeometry(0.9, 0.12, 0.3),
      new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false }),
      lamps.length,
    );
    lamps.forEach((p, i) => {
      pole.setMatrixAt(i, m.makeTranslation(p.x + 0.5, 0, p.y + 0.5));
      head.setMatrixAt(i, m.makeTranslation(p.x + 0.5, 5, p.y + 0.5));
      const warm = hash2(p.x, p.y, 2) > 0.4;
      head.setColorAt(i, new THREE.Color(warm ? '#ffb070' : '#7fe0ff').multiplyScalar(3));
    });
    pole.castShadow = true;
    this.group.add(pole, head);

    // Parked cars.
    const cars = by('car');
    const body = new THREE.InstancedMesh(
      new THREE.BoxGeometry(1.8, 0.7, 3.8).translate(0, 0.55, 0),
      new THREE.MeshStandardMaterial({ color: 0xffffff, metalness: 0.7, roughness: 0.25 }),
      cars.length,
    );
    const cabin = new THREE.InstancedMesh(
      new THREE.BoxGeometry(1.6, 0.55, 2).translate(0, 1.15, -0.2),
      new THREE.MeshStandardMaterial({ color: 0x0a0c12, metalness: 0.9, roughness: 0.1 }),
      cars.length,
    );
    const lights = new THREE.InstancedMesh(
      new THREE.BoxGeometry(1.7, 0.12, 0.05),
      new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false }),
      cars.length * 2,
    );
    const paints = ['#1b1e2a', '#5a0f1f', '#20252f', '#0d3040', '#3a3a44', '#46205a', '#c9c6bd'];
    cars.forEach((p, i) => {
      const cx = p.x + p.w / 2;
      const cz = p.y + p.h / 2;
      const rot = p.w > p.h ? Math.PI / 2 : 0;
      q.setFromAxisAngle(up, rot + (hash2(p.seed, 1) > 0.5 ? Math.PI : 0));
      m.compose(new THREE.Vector3(cx, 0, cz), q, new THREE.Vector3(1, 1, 1));
      body.setMatrixAt(i, m);
      cabin.setMatrixAt(i, m);
      body.setColorAt(i, new THREE.Color(paints[Math.floor(hash2(p.seed, 2) * paints.length)]));
      const fwd = new THREE.Vector3(0, 0, 1).applyQuaternion(q);
      const front = new THREE.Vector3(cx, 0.65, cz).addScaledVector(fwd, 1.92);
      const back = new THREE.Vector3(cx, 0.65, cz).addScaledVector(fwd, -1.92);
      lights.setMatrixAt(i * 2, new THREE.Matrix4().compose(front, q, new THREE.Vector3(1, 1, 1)));
      lights.setMatrixAt(i * 2 + 1, new THREE.Matrix4().compose(back, q, new THREE.Vector3(1, 1, 1)));
      lights.setColorAt(i * 2, new THREE.Color(2.2, 2.2, 2.6));
      lights.setColorAt(i * 2 + 1, new THREE.Color(3, 0.15, 0.2));
    });
    body.castShadow = true;
    this.group.add(body, cabin, lights);

    // Trees: glowing sakura canopies.
    const trees = by('tree');
    const trunk = new THREE.InstancedMesh(
      new THREE.CylinderGeometry(0.12, 0.18, 2.4, 6).translate(0, 1.2, 0),
      new THREE.MeshStandardMaterial({ color: 0x2a1c1c, roughness: 0.9 }),
      trees.length,
    );
    const canopy = new THREE.InstancedMesh(
      new THREE.IcosahedronGeometry(1.5, 1),
      new THREE.MeshStandardMaterial({
        color: 0x24121f,
        emissive: 0xff4fa3,
        emissiveIntensity: 0.035,
        envMapIntensity: 0.2,
        roughness: 0.8,
        flatShading: true,
      }),
      trees.length,
    );
    trees.forEach((p, i) => {
      trunk.setMatrixAt(i, m.makeTranslation(p.x + 0.5, 0, p.y + 0.5));
      q.setFromAxisAngle(up, p.rot);
      const s = 0.65 + hash2(p.seed, 3) * 0.35;
      canopy.setMatrixAt(i, m.compose(new THREE.Vector3(p.x + 0.5, 3.1, p.y + 0.5), q, new THREE.Vector3(s, s * 0.8, s)));
    });
    trunk.castShadow = true;
    canopy.castShadow = true;
    this.group.add(trunk, canopy);

    // Vending machines.
    const vend = by('vending');
    const vbox = new THREE.InstancedMesh(
      new THREE.BoxGeometry(0.9, 1.9, 0.7).translate(0, 0.95, 0),
      new THREE.MeshStandardMaterial({ color: 0x181a22, emissive: 0x1ff4ff, emissiveIntensity: 0.9 }),
      Math.max(1, vend.length),
    );
    vbox.count = vend.length;
    vend.forEach((p, i) => vbox.setMatrixAt(i, m.makeTranslation(p.x + 0.5, 0, p.y + 0.5)));
    this.group.add(vbox);

    // Benches.
    const benches = by('bench');
    const bench = new THREE.InstancedMesh(
      new THREE.BoxGeometry(1.6, 0.45, 0.5).translate(0, 0.22, 0),
      new THREE.MeshStandardMaterial({ color: 0x2b2d36, metalness: 0.6, roughness: 0.4 }),
      Math.max(1, benches.length),
    );
    bench.count = benches.length;
    benches.forEach((p, i) => {
      q.setFromAxisAngle(up, p.rot);
      bench.setMatrixAt(i, m.compose(new THREE.Vector3(p.x + 0.5, 0, p.y + 0.5), q, new THREE.Vector3(1, 1, 1)));
    });
    this.group.add(bench);

    // Plaza fountain with a corporate hologram.
    for (const f of by('fountain')) {
      const cx = f.x + f.w / 2;
      const cz = f.y + f.h / 2;
      const basin = new THREE.Mesh(
        new THREE.CylinderGeometry(1.6, 1.8, 0.6, 20),
        new THREE.MeshStandardMaterial({ color: 0x2a2c35, metalness: 0.5, roughness: 0.3 }),
      );
      basin.position.set(cx, 0.3, cz);
      const water = new THREE.Mesh(
        new THREE.CircleGeometry(1.45, 24).rotateX(-Math.PI / 2),
        new THREE.MeshBasicMaterial({ color: new THREE.Color(0.05, 0.45, 0.6), toneMapped: false }),
      );
      water.position.set(cx, 0.62, cz);
      this.holo = new THREE.Mesh(
        new THREE.OctahedronGeometry(1.1, 0),
        new THREE.MeshBasicMaterial({
          color: new THREE.Color(0.6, 2.2, 3.0),
          wireframe: true,
          toneMapped: false,
          transparent: true,
          opacity: 0.8,
        }),
      );
      this.holo.position.set(cx, 3.2, cz);
      this.group.add(basin, water, this.holo);
    }
  }

  private buildMarkers(): void {
    const beamGeo = new THREE.CylinderGeometry(1, 1, 60, 24, 1, true).translate(0, 30, 0);
    const beamMat = (c: THREE.Color) =>
      new THREE.MeshBasicMaterial({
        color: c,
        transparent: true,
        opacity: 0.12,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
        toneMapped: false,
      });
    const ex = this.map.extraction;
    this.vtolBeam = new THREE.Mesh(beamGeo, beamMat(new THREE.Color(0.3, 2.2, 1.4)));
    this.vtolBeam.position.set(ex.x, 0, ex.y);
    this.vtolBeam.scale.set(4.5, 1, 4.5);
    this.vtolPad = new THREE.Mesh(
      new THREE.RingGeometry(4.2, 4.6, 48).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(0.4, 3, 1.8), toneMapped: false, transparent: true }),
    );
    this.vtolPad.position.set(ex.x, 0.05, ex.y);
    const es = this.map.escape;
    this.escapeBeam = new THREE.Mesh(beamGeo, beamMat(new THREE.Color(3, 0.3, 0.4)));
    this.escapeBeam.position.set(es.x, 0, es.y);
    this.escapeBeam.scale.set(2.2, 1, 2.2);
    this.escapeBeam.visible = false;

    // The limousine waiting at the escape point.
    const limo = new THREE.Group();
    const lb = new THREE.Mesh(
      new THREE.BoxGeometry(2, 0.8, 6).translate(0, 0.6, 0),
      new THREE.MeshStandardMaterial({ color: 0x0b0b0f, metalness: 0.9, roughness: 0.15 }),
    );
    const trim = new THREE.Mesh(
      new THREE.BoxGeometry(2.05, 0.06, 6.05).translate(0, 0.62, 0),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(3, 2.2, 0.5), toneMapped: false }),
    );
    limo.add(lb, trim);
    limo.position.set(es.x - 3, 0, es.y);
    this.group.add(this.vtolBeam, this.vtolPad, this.escapeBeam, limo);
  }

  setFade(i: number, v: number): void {
    this.fadeAttr.setX(i, v);
  }

  update(time: number): void {
    this.uniforms.uTime.value = time;
    for (const f of this.flickers) {
      const s = Math.sin(time * 23 + f.seed) + Math.sin(time * 7.3 + f.seed * 3);
      f.mat.color.setScalar(s > 1.4 ? f.base * 0.15 : f.base);
    }
    const blink = Math.sin(time * 3) > 0.6 ? 1 : 0.05;
    (this.beacons.material as THREE.MeshBasicMaterial).color.setRGB(4 * blink, 0.3 * blink, 0.3 * blink);
    if (this.holo) {
      this.holo.rotation.y = time * 0.8;
      this.holo.position.y = 3.2 + Math.sin(time * 1.5) * 0.15;
    }
    let dirty = false;
    this.boxes.forEach((b, i) => {
      const nf = b.fade + (b.target - b.fade) * 0.18;
      if (Math.abs(nf - b.fade) > 0.002) {
        b.fade = nf;
        this.setFade(i, nf);
        dirty = true;
      }
    });
    if (dirty) this.fadeAttr.needsUpdate = true;
  }
}
