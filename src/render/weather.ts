import * as THREE from 'three';

const DROPS = 9000;
const SPLASHES = 1100;
const BOX = new THREE.Vector3(96, 16, 96);

/**
 * Rain anchored in world space: streaks fall through a low band above the street (so they never
 * sweep past the lens when the camera pans), fade near the camera and at the edges of the volume,
 * and leave splash rings on the ground. `density` thins drops and splashes from a downpour to a
 * drizzle to nothing; drizzle also gets shorter, fainter streaks.
 */
export class Rain {
  readonly group = new THREE.Group();
  private uniforms = {
    uTime: { value: 0 },
    uCenter: { value: new THREE.Vector3() },
    uCam: { value: new THREE.Vector3() },
    uBox: { value: BOX },
    uDensity: { value: 0.75 },
    uColor: { value: new THREE.Color(0x8cadff) },
  };

  constructor() {
    this.group.add(this.buildDrops(), this.buildSplashes());
  }

  private buildDrops(): THREE.LineSegments {
    const pos = new Float32Array(DROPS * 2 * 3);
    const end = new Float32Array(DROPS * 2);
    const rank = new Float32Array(DROPS * 2);
    for (let i = 0; i < DROPS; i++) {
      const x = Math.random() * BOX.x;
      const y = Math.random() * BOX.y;
      const z = Math.random() * BOX.z;
      const r = Math.random();
      for (let k = 0; k < 2; k++) {
        pos.set([x, y, z], (i * 2 + k) * 3);
        end[i * 2 + k] = k;
        rank[i * 2 + k] = r;
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('aEnd', new THREE.BufferAttribute(end, 1));
    geo.setAttribute('aRank', new THREE.BufferAttribute(rank, 1));
    const mat = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      vertexShader: /* glsl */ `
        uniform float uTime;
        uniform vec3 uCenter;
        uniform vec3 uCam;
        uniform vec3 uBox;
        uniform float uDensity;
        attribute float aEnd;
        attribute float aRank;
        varying float vA;
        void main() {
          vec3 p = position;
          float speed = 22.0 + fract(p.x * 13.1) * 8.0;
          p.y = mod(p.y - uTime * speed, uBox.y);
          // World-anchored tiling: a drop only moves when it wraps to the far side of the volume.
          p.x = mod(p.x + uTime * 1.5 - uCenter.x, uBox.x) + uCenter.x - uBox.x * 0.5;
          p.z = mod(p.z - uCenter.z, uBox.z) + uCenter.z - uBox.z * 0.5;
          vec2 rel = abs(p.xz - uCenter.xz) / (uBox.xz * 0.5);
          float edge = 1.0 - smoothstep(0.75, 1.0, max(rel.x, rel.y));
          float nearCam = smoothstep(6.0, 16.0, distance(p, uCam));
          float light = smoothstep(0.0, 0.6, uDensity);
          p += vec3(0.04, mix(0.35, 0.75, light), 0.0) * aEnd;
          vA = aEnd * edge * nearCam * smoothstep(0.0, 1.5, p.y) * step(aRank, uDensity) * mix(0.6, 1.0, light);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
        }`,
      fragmentShader: /* glsl */ `
        uniform vec3 uColor;
        varying float vA;
        void main() { gl_FragColor = vec4(uColor * 0.8, 0.32 * vA); }`,
    });
    const lines = new THREE.LineSegments(geo, mat);
    lines.frustumCulled = false;
    return lines;
  }

  private buildSplashes(): THREE.InstancedMesh {
    const geo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
    const seeds = new Float32Array(SPLASHES * 3);
    for (let i = 0; i < SPLASHES; i++) seeds.set([Math.random(), Math.random(), Math.random()], i * 3);
    geo.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seeds, 3));
    const mat = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      vertexShader: /* glsl */ `
        uniform float uTime;
        uniform vec3 uCenter;
        uniform vec3 uBox;
        uniform float uDensity;
        attribute vec3 aSeed;
        varying vec2 vUv;
        varying float vT;
        varying float vEdge;
        float h(float n) { return fract(sin(n) * 43758.5453); }
        void main() {
          float period = 0.55 + aSeed.z * 0.5;
          float cycle = floor(uTime / period + aSeed.z * 7.0);
          vT = fract(uTime / period + aSeed.z * 7.0);
          // Each cycle the splash lands somewhere new, snapped to a world grid around the view.
          vec2 cell = floor(uCenter.xz / 8.0) * 8.0;
          vec2 off = (vec2(h(cycle * 1.7 + aSeed.x * 91.0), h(cycle * 2.3 + aSeed.y * 57.0)) - 0.5) * uBox.xz * 0.8;
          vec2 world = cell + off;
          vec2 rel = abs(world - uCenter.xz) / (uBox.xz * 0.4);
          vEdge = (1.0 - smoothstep(0.7, 1.0, max(rel.x, rel.y))) * step(aSeed.x, uDensity);
          float s = 0.12 + vT * 0.38;
          vUv = uv;
          vec3 p = vec3(position.x * s + world.x, 0.05, position.z * s + world.y);
          gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
        }`,
      fragmentShader: /* glsl */ `
        uniform vec3 uColor;
        varying vec2 vUv;
        varying float vT;
        varying float vEdge;
        void main() {
          float d = length(vUv - 0.5) * 2.0;
          float ring = smoothstep(0.7, 0.85, d) * (1.0 - smoothstep(0.85, 1.0, d));
          gl_FragColor = vec4(uColor * 0.85, ring * (1.0 - vT) * 0.55 * vEdge);
        }`,
    });
    const mesh = new THREE.InstancedMesh(geo, mat, SPLASHES);
    mesh.frustumCulled = false;
    return mesh;
  }

  setLook(density: number, color: THREE.Color): void {
    this.uniforms.uDensity.value = density;
    this.uniforms.uColor.value.copy(color);
    this.group.visible = density > 0.005;
  }

  update(time: number, center: THREE.Vector3, camera: THREE.Vector3): void {
    this.uniforms.uTime.value = time;
    this.uniforms.uCenter.value.copy(center);
    this.uniforms.uCam.value.copy(camera);
  }
}
