// CPU-generated donut textures. Noise is sampled in 3D at the torus surface point, so u/v wrap seamlessly.
// The icing mask math is mirrored in shaders/common-noise.glsl.

import { TORUS_MAJOR, TORUS_MINOR } from '../geometry/torus';

export const TEX_SIZE = 512;
const TAU = Math.PI * 2;

export interface DonutTextures {
  dough: ImageData;
  icing: ImageData;
  chocolate: ImageData;
  normal: ImageData;
}

function hash3(x: number, y: number, z: number): number {
  let h = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ Math.imul(z, 1274126177);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}

function vnoise3(x: number, y: number, z: number): number {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  const s = (t: number) => t * t * (3 - 2 * t);
  const fx = s(x - xi), fy = s(y - yi), fz = s(z - zi);
  const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
  const c = (dx: number, dy: number, dz: number) => hash3(xi + dx, yi + dy, zi + dz);
  return lerp(
    lerp(lerp(c(0, 0, 0), c(1, 0, 0), fx), lerp(c(0, 1, 0), c(1, 1, 0), fx), fy),
    lerp(lerp(c(0, 0, 1), c(1, 0, 1), fx), lerp(c(0, 1, 1), c(1, 1, 1), fx), fy),
    fz
  );
}

function fbm3(x: number, y: number, z: number): number {
  let sum = 0;
  let amp = 0.5;
  for (let o = 0; o < 4; o++) {
    sum += amp * vnoise3(x, y, z);
    x *= 2; y *= 2; z *= 2;
    amp *= 0.5;
  }
  return sum / 0.9375;
}

const smoothstep = (a: number, b: number, x: number) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

function icingEdge(u: number): number {
  const g = 0.5 + 0.25 * Math.sin(TAU * 3 * u) + 0.15 * Math.sin(TAU * 7 * u + 1.3) + 0.1 * Math.sin(TAU * 13 * u + 4);
  return 0.35 - 0.7 * g;
}

function icingMask(u: number, v: number): number {
  const e = icingEdge(u);
  return smoothstep(e - 0.03, e + 0.03, Math.sin(TAU * v));
}

type Rgba = [number, number, number, number];

function paint(shade: (u: number, v: number, p: [number, number, number], x: number, y: number) => Rgba): ImageData {
  const image = new ImageData(TEX_SIZE, TEX_SIZE);
  for (let y = 0; y < TEX_SIZE; y++) {
    for (let x = 0; x < TEX_SIZE; x++) {
      const u = (x + 0.5) / TEX_SIZE;
      const v = (y + 0.5) / TEX_SIZE;
      const theta = u * TAU;
      const phi = v * TAU;
      const ring = TORUS_MAJOR + TORUS_MINOR * Math.cos(phi);
      const p: [number, number, number] = [ring * Math.cos(theta), TORUS_MINOR * Math.sin(phi), ring * Math.sin(theta)];
      const [r, g, b, a] = shade(u, v, p, x, y);
      image.data.set([r * 255, g * 255, b * 255, a * 255], (y * TEX_SIZE + x) * 4);
    }
  }
  return image;
}

// Returns > 0 inside a sprinkle, with the cell hash in `id` for coloring
function sprinkle(u: number, v: number): { hit: boolean; id: number } {
  const gu = u * 60;
  const gv = v * 24;
  const cu = Math.floor(gu);
  const cv = Math.floor(gv);
  const id = hash3(cu, cv, 7);
  if (id > 0.1) return { hit: false, id };
  const fx = gu - cu - 0.5;
  const fy = gv - cv - 0.5;
  const angle = id * 62.8;
  const along = fx * Math.cos(angle) + fy * Math.sin(angle);
  const across = -fx * Math.sin(angle) + fy * Math.cos(angle);
  return { hit: Math.abs(along) < 0.32 && Math.abs(across) < 0.09, id };
}

const SPRINKLE_COLORS: [number, number, number][] = [
  [0.95, 0.9, 0.3],
  [0.3, 0.75, 0.95],
  [0.4, 0.9, 0.45],
  [1, 1, 1],
];

export function generateDonutTextures(): DonutTextures {
  const dough = paint((_u, v, p) => {
    const top = Math.sin(TAU * v);
    const t = smoothstep(-1, 0.6, top);
    const n = fbm3(p[0] * 6, p[1] * 6, p[2] * 6);
    const grain = 0.95 + 0.1 * hash3(Math.floor(p[0] * 180), Math.floor(p[1] * 180), Math.floor(p[2] * 180));
    const k = (0.75 + 0.5 * n) * grain;
    return [(0.62 + 0.23 * t) * k, (0.38 + 0.2 * t) * k, (0.16 + 0.11 * t) * k, 1];
  });

  const heights = new Float32Array(TEX_SIZE * TEX_SIZE);
  const icing = paint((u, v, p, x, y) => {
    const mask = icingMask(u, v);
    const tint = fbm3(p[0] * 4, p[1] * 4, p[2] * 4);
    let color: [number, number, number] = [0.93 + 0.05 * tint, 0.45 + 0.2 * tint, 0.62 + 0.16 * tint];
    const s = sprinkle(u, v);
    heights[y * TEX_SIZE + x] = 0.5 * fbm3(p[0] * 8, p[1] * 8, p[2] * 8) + (s.hit ? 0.4 : 0);
    if (s.hit) color = SPRINKLE_COLORS[Math.floor(s.id * 40) % SPRINKLE_COLORS.length];
    return [...color, mask] as Rgba;
  });

  const chocolate = paint((u, v, p) => {
    const w = u * 14 + 1.5 * Math.sin(TAU * 2 * v) + 1.2 * fbm3(p[0] * 3, p[1] * 3, p[2] * 3);
    const stripe = smoothstep(0.8, 0.88, 0.5 + 0.5 * Math.sin(TAU * w));
    const top = smoothstep(0.3, 0.4, Math.sin(TAU * v));
    return [0.25, 0.12, 0.06, stripe * top * icingMask(u, v)];
  });

  // Tangent-space normal map from the icing height field; +x = +u, +y = +v (rows increase with v)
  const strength = 12;
  const normal = new ImageData(TEX_SIZE, TEX_SIZE);
  const at = (x: number, y: number) =>
    heights[((y + TEX_SIZE) % TEX_SIZE) * TEX_SIZE + ((x + TEX_SIZE) % TEX_SIZE)];
  for (let y = 0; y < TEX_SIZE; y++) {
    for (let x = 0; x < TEX_SIZE; x++) {
      const nx = -(at(x + 1, y) - at(x - 1, y)) * strength;
      const ny = -(at(x, y + 1) - at(x, y - 1)) * strength;
      const len = Math.hypot(nx, ny, 1);
      normal.data.set(
        [(nx / len * 0.5 + 0.5) * 255, (ny / len * 0.5 + 0.5) * 255, (1 / len * 0.5 + 0.5) * 255, 255],
        (y * TEX_SIZE + x) * 4
      );
    }
  }

  return { dough, icing, chocolate, normal };
}

export function imageDataToCanvas(image: ImageData): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = image.width;
  canvas.height = image.height;
  canvas.getContext('2d')!.putImageData(image, 0, 0);
  return canvas;
}
