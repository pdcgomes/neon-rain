import * as THREE from 'three';
import { GROUND_ALLEY, GROUND_BUILDING, GROUND_PLAZA, GROUND_ROAD, GROUND_SIDEWALK, type CityMap } from '../sim/map.ts';
import { hash2 } from '../sim/rng.ts';

export const NEON = ['#ff2bd6', '#1ff4ff', '#ffb627', '#7dff5c', '#ff3355', '#a66bff', '#ffffff'];

export const SIGN_WORDS = [
  'EUROCORP',
  'KAIJU',
  'ラーメン',
  'NEURO+',
  'SYNDIKAT',
  'HOTEL',
  'バー',
  'CHROME',
  '24H',
  'CYBERMED',
  'ZAIBATSU',
  'NOODLES',
  'パチンコ',
  'BIOCHIP',
  'INSOMNIA',
  '薬局',
  'OPEN',
  'KARAOKE',
];

function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d')!];
}

export function signTexture(text: string, color: string, vertical: boolean): THREE.CanvasTexture {
  const W = vertical ? 96 : 384;
  const H = vertical ? 384 : 96;
  const [c, g] = canvas(W, H);
  g.fillStyle = 'rgba(8,6,14,0.92)';
  g.fillRect(0, 0, W, H);
  g.strokeStyle = color;
  g.lineWidth = 5;
  g.shadowColor = color;
  g.shadowBlur = 14;
  g.strokeRect(6, 6, W - 12, H - 12);
  g.fillStyle = color;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  if (vertical) {
    const chars = [...text];
    const size = Math.min(62, (H - 30) / chars.length);
    g.font = `700 ${size}px "Rajdhani", "Hiragino Sans", sans-serif`;
    chars.forEach((ch, i) => g.fillText(ch, W / 2, 18 + size * (i + 0.5)));
  } else {
    let size = 60;
    g.font = `700 ${size}px "Rajdhani", "Hiragino Sans", sans-serif`;
    while (g.measureText(text).width > W - 36 && size > 20) {
      size -= 4;
      g.font = `700 ${size}px "Rajdhani", "Hiragino Sans", sans-serif`;
    }
    g.fillText(text, W / 2, H / 2 + 3);
  }
  g.shadowBlur = 0;
  g.globalAlpha = 0.9;
  g.fillStyle = '#ffffff';
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

export function radialTexture(inner = 'rgba(255,255,255,1)', outer = 'rgba(255,255,255,0)'): THREE.CanvasTexture {
  const [c, g] = canvas(128, 128);
  const grd = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grd.addColorStop(0, inner);
  grd.addColorStop(0.35, 'rgba(255,255,255,0.35)');
  grd.addColorStop(1, outer);
  g.fillStyle = grd;
  g.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Paints the whole city floor into one texture plus a wetness (roughness) map. */
export function groundTextures(
  map: CityMap,
  // Large authored maps get fewer pixels per cell so the canvas stays within texture limits.
  px = Math.max(4, Math.min(14, Math.floor(4096 / Math.max(map.w, map.h)))),
): { color: THREE.CanvasTexture; rough: THREE.CanvasTexture } {
  const W = map.w * px;
  const H = map.h * px;
  const [c, g] = canvas(W, H);
  const [rc, rg] = canvas(map.w * 4, map.h * 4);

  for (let y = 0; y < map.h; y++) {
    for (let x = 0; x < map.w; x++) {
      const k = map.ground[y * map.w + x];
      const n = hash2(x, y, 3);
      let col: string;
      switch (k) {
        case GROUND_ROAD:
          col = `rgb(${14 + n * 6},${15 + n * 6},${22 + n * 8})`;
          break;
        case GROUND_SIDEWALK:
          col = `rgb(${40 + n * 10},${40 + n * 10},${52 + n * 12})`;
          break;
        case GROUND_PLAZA:
          col = (x + y) % 2 === 0 ? `rgb(${46 + n * 8},${38 + n * 6},${54 + n * 8})` : `rgb(${36 + n * 6},${30 + n * 6},${44 + n * 6})`;
          break;
        case GROUND_ALLEY:
          col = `rgb(${24 + n * 8},${22 + n * 6},${28 + n * 8})`;
          break;
        case GROUND_BUILDING:
        default:
          col = '#07070b';
      }
      g.fillStyle = col;
      g.fillRect(x * px, y * px, px, px);
      if (k === GROUND_SIDEWALK) {
        g.strokeStyle = 'rgba(0,0,0,0.35)';
        g.lineWidth = 1;
        g.strokeRect(x * px + 0.5, y * px + 0.5, px - 1, px - 1);
      }
    }
  }

  // Kerbs: bright edge where sidewalk meets road.
  g.fillStyle = 'rgba(150,150,175,0.55)';
  for (let y = 1; y < map.h - 1; y++) {
    for (let x = 1; x < map.w - 1; x++) {
      if (map.ground[y * map.w + x] !== GROUND_SIDEWALK) continue;
      if (map.ground[y * map.w + x + 1] === GROUND_ROAD) g.fillRect((x + 1) * px - 2, y * px, 2, px);
      if (map.ground[y * map.w + x - 1] === GROUND_ROAD) g.fillRect(x * px, y * px, 2, px);
      if (map.ground[(y + 1) * map.w + x] === GROUND_ROAD) g.fillRect(x * px, (y + 1) * px - 2, px, 2);
      if (map.ground[(y - 1) * map.w + x] === GROUND_ROAD) g.fillRect(x * px, y * px, px, 2);
    }
  }

  const inRoad = (bands: { start: number; end: number }[], v: number) => bands.some((b) => v >= b.start && v < b.end);

  // Lane markings and crosswalks.
  for (const r of map.roadsX) {
    const cx = ((r.start + r.end) / 2) * px;
    for (let y = 0; y < map.h; y += 3) {
      if (inRoad(map.roadsY, y) || inRoad(map.roadsY, y + 1)) continue;
      g.fillStyle = 'rgba(255,190,70,0.55)';
      g.fillRect(cx - 2, y * px, 4, px * 1.6);
    }
    for (const q of map.roadsY) {
      for (const yy of [q.start - 2, q.end]) {
        for (let x = r.start; x < r.end; x++) {
          g.fillStyle = 'rgba(220,220,240,0.35)';
          g.fillRect(x * px + 2, yy * px + 2, px * 0.55, px * 2 - 4);
        }
      }
    }
  }
  for (const r of map.roadsY) {
    const cy = ((r.start + r.end) / 2) * px;
    for (let x = 0; x < map.w; x += 3) {
      if (inRoad(map.roadsX, x) || inRoad(map.roadsX, x + 1)) continue;
      g.fillStyle = 'rgba(255,190,70,0.55)';
      g.fillRect(x * px, cy - 2, px * 1.6, 4);
    }
    for (const q of map.roadsX) {
      for (const xx of [q.start - 2, q.end]) {
        for (let y = r.start; y < r.end; y++) {
          g.fillStyle = 'rgba(220,220,240,0.35)';
          g.fillRect(xx * px + 2, y * px + 2, px * 2 - 4, px * 0.55);
        }
      }
    }
  }

  // Grime.
  for (let i = 0; i < map.w * map.h * 0.6; i++) {
    const x = hash2(i, 1, 9) * W;
    const y = hash2(i, 2, 9) * H;
    g.fillStyle = `rgba(0,0,0,${0.08 + hash2(i, 3, 9) * 0.18})`;
    g.beginPath();
    g.arc(x, y, 2 + hash2(i, 4, 9) * px * 0.9, 0, Math.PI * 2);
    g.fill();
  }

  // Wetness: dark = glossy puddle, light = rough.
  rg.fillStyle = 'rgb(150,150,150)';
  rg.fillRect(0, 0, rc.width, rc.height);
  for (let i = 0; i < map.w * map.h * 0.12; i++) {
    const x = hash2(i, 7, 5) * rc.width;
    const y = hash2(i, 8, 5) * rc.height;
    const r = 2 + hash2(i, 9, 5) * 10;
    const grd = rg.createRadialGradient(x, y, 0, x, y, r);
    grd.addColorStop(0, 'rgba(10,10,10,0.95)');
    grd.addColorStop(1, 'rgba(10,10,10,0)');
    rg.fillStyle = grd;
    rg.beginPath();
    rg.arc(x, y, r, 0, Math.PI * 2);
    rg.fill();
  }

  const color = new THREE.CanvasTexture(c);
  color.colorSpace = THREE.SRGBColorSpace;
  color.anisotropy = 8;
  color.generateMipmaps = true;
  color.minFilter = THREE.LinearMipmapLinearFilter;
  const rough = new THREE.CanvasTexture(rc);
  rough.anisotropy = 4;
  return { color, rough };
}
