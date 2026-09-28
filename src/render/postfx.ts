import * as THREE from 'three';
import {
  BloomEffect,
  BlendFunction,
  ChromaticAberrationEffect,
  EffectComposer,
  EffectPass,
  NoiseEffect,
  RenderPass,
  SMAAEffect,
  ToneMappingEffect,
  ToneMappingMode,
  VignetteEffect,
} from 'postprocessing';

/**
 * Bloom-heavy neon grade plus dynamic resolution. Stands in for DLSS/FSR on the web:
 * the internal render scale drops when frames run long and recovers when there is headroom.
 */
export class PostFX {
  readonly composer: EffectComposer;
  private renderer: THREE.WebGLRenderer;
  private bloom: BloomEffect;
  private chroma: ChromaticAberrationEffect;
  private vignette: VignetteEffect;
  private baseDpr: number;
  scale = 1;
  private minScale = 0.5;
  private frameTimes: number[] = [];
  private lastAdjust = 0;
  private lastDown = -10;
  private width = 1;
  private height = 1;
  private overdrive = 0;
  private bloomBase = 1.45;

  private dynamic: boolean;

  constructor(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera, opts: { dynamicResolution?: boolean } = {}) {
    this.renderer = renderer;
    this.dynamic = opts.dynamicResolution ?? true;
    this.baseDpr = Math.min(window.devicePixelRatio || 1, 2);
    this.composer = new EffectComposer(renderer, { frameBufferType: THREE.HalfFloatType });
    this.composer.addPass(new RenderPass(scene, camera));

    this.bloom = new BloomEffect({
      mipmapBlur: true,
      luminanceThreshold: 0.62,
      luminanceSmoothing: 0.3,
      intensity: 1.45,
      radius: 0.72,
    });
    const tone = new ToneMappingEffect({ mode: ToneMappingMode.ACES_FILMIC });
    this.vignette = new VignetteEffect({ darkness: 0.62, offset: 0.28 });
    const noise = new NoiseEffect({ blendFunction: BlendFunction.OVERLAY, premultiply: false });
    noise.blendMode.opacity.value = 0.07;
    this.chroma = new ChromaticAberrationEffect({
      offset: new THREE.Vector2(0.0008, 0.0005),
      radialModulation: true,
      modulationOffset: 0.25,
    });

    this.composer.addPass(new EffectPass(camera, this.bloom, tone, this.vignette, noise));
    this.composer.addPass(new EffectPass(camera, this.chroma));
    this.composer.addPass(new EffectPass(camera, new SMAAEffect()));
  }

  setSize(w: number, h: number): void {
    this.width = w;
    this.height = h;
    this.apply();
  }

  /** Overrides the base device pixel ratio (the lab's pixel-preview mode renders at a fraction of it). */
  setBasePixelRatio(dpr: number): void {
    this.baseDpr = dpr;
    this.apply();
  }

  private apply(): void {
    this.renderer.setPixelRatio(this.baseDpr * this.scale);
    this.renderer.setSize(this.width, this.height, false);
    this.composer.setSize(this.width, this.height, false);
  }

  /** Time-of-day grade: brighter scenes need less bloom and a higher threshold to keep neon reading. */
  setGrade(bloom: number, threshold: number): void {
    this.bloomBase = bloom;
    this.bloom.luminanceMaterial.threshold = threshold;
  }

  setOverdrive(v: number): void {
    this.overdrive += (v - this.overdrive) * 0.15;
    const k = 1 + this.overdrive * 5;
    this.chroma.offset.set(0.0008 * k, 0.0005 * k);
    this.vignette.darkness = 0.62 + this.overdrive * 0.3;
    this.bloom.intensity = this.bloomBase + this.overdrive * 0.6;
  }

  render(dt: number, now: number): void {
    this.composer.render(dt);
    if (!this.dynamic) return;
    this.frameTimes.push(dt * 1000);
    if (this.frameTimes.length > 90) this.frameTimes.shift();
    if (now - this.lastAdjust < 1.5 || this.frameTimes.length < 60) return;
    this.lastAdjust = now;
    const avg = this.frameTimes.reduce((a, b) => a + b, 0) / this.frameTimes.length;
    if (avg > 21 && this.scale > this.minScale) {
      this.scale = Math.max(this.minScale, this.scale - 0.1);
      this.lastDown = now;
      this.frameTimes.length = 0;
      this.apply();
    } else if (avg < 17.4 && this.scale < 1 && now - this.lastDown > 6) {
      this.scale = Math.min(1, this.scale + 0.05);
      this.frameTimes.length = 0;
      this.apply();
    }
  }
}
