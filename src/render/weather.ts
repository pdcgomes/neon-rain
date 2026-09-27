import * as THREE from 'three';

const DROPS = 7000;
const BOX = new THREE.Vector3(80, 45, 80);

/** GPU-animated rain streaks that wrap around the camera target. */
export class Rain {
  readonly mesh: THREE.LineSegments;
  private uniforms = {
    uTime: { value: 0 },
    uCenter: { value: new THREE.Vector3() },
    uBox: { value: BOX },
  };

  constructor() {
    const pos = new Float32Array(DROPS * 2 * 3);
    const end = new Float32Array(DROPS * 2);
    for (let i = 0; i < DROPS; i++) {
      const x = Math.random() * BOX.x;
      const y = Math.random() * BOX.y;
      const z = Math.random() * BOX.z;
      for (let k = 0; k < 2; k++) {
        pos.set([x, y, z], (i * 2 + k) * 3);
        end[i * 2 + k] = k;
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('aEnd', new THREE.BufferAttribute(end, 1));
    const mat = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      vertexShader: /* glsl */ `
        uniform float uTime;
        uniform vec3 uCenter;
        uniform vec3 uBox;
        attribute float aEnd;
        varying float vA;
        void main() {
          vec3 p = position;
          float speed = 32.0 + fract(p.x * 13.1) * 10.0;
          p.y = mod(p.y - uTime * speed, uBox.y);
          p.x = mod(p.x + uTime * 3.0 - uCenter.x, uBox.x) + uCenter.x - uBox.x * 0.5;
          p.z = mod(p.z - uCenter.z, uBox.z) + uCenter.z - uBox.z * 0.5;
          p += vec3(0.08, 0.9, 0.0) * aEnd;
          vA = mix(0.0, 1.0, aEnd) * smoothstep(0.0, 4.0, p.y);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
        }`,
      fragmentShader: /* glsl */ `
        varying float vA;
        void main() { gl_FragColor = vec4(0.55, 0.7, 1.0, 0.28 * vA); }`,
    });
    this.mesh = new THREE.LineSegments(geo, mat);
    this.mesh.frustumCulled = false;
  }

  update(time: number, center: THREE.Vector3): void {
    this.uniforms.uTime.value = time;
    this.uniforms.uCenter.value.copy(center);
  }
}
