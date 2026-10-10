// Heuristic single-image depth: brighter + more saturated pixels are assumed closer.
// This is a stand-in for an ML depth model; a real depth map can be supplied instead.
export interface DepthOptions {
  saturationWeight: number; // 0 = luminance only, 1 = saturation only
  blurRadius: number; // in grid cells
  invert: boolean;
  gamma: number;
}

export interface DepthMap {
  width: number;
  height: number;
  data: Float32Array; // 0 (far) .. 1 (near), row 0 = top of the image
}

// Sample a source image down to the grid resolution
export function samplePixels(source: CanvasImageSource, width: number, height: number): ImageData {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(source, 0, 0, width, height);
  return ctx.getImageData(0, 0, width, height);
}

export function estimateDepth(pixels: ImageData, opts: DepthOptions, isDepthMap = false): DepthMap {
  const { width, height, data } = pixels;
  const depth = new Float32Array(width * height);
  for (let i = 0; i < depth.length; i++) {
    const r = data[i * 4] / 255;
    const g = data[i * 4 + 1] / 255;
    const b = data[i * 4 + 2] / 255;
    const lum = 0.299 * r + 0.587 * g + 0.114 * b;
    if (isDepthMap) {
      depth[i] = lum;
      continue;
    }
    const max = Math.max(r, g, b);
    const sat = max > 0 ? (max - Math.min(r, g, b)) / max : 0;
    depth[i] = lum * (1 - opts.saturationWeight) + sat * opts.saturationWeight;
  }
  boxBlur(depth, width, height, Math.round(opts.blurRadius));
  normalize(depth);
  for (let i = 0; i < depth.length; i++) {
    let d = opts.invert ? 1 - depth[i] : depth[i];
    depth[i] = Math.pow(d, opts.gamma);
  }
  return { width, height, data: depth };
}

// Two passes of a separable box blur approximate a Gaussian
function boxBlur(a: Float32Array, w: number, h: number, r: number) {
  if (r <= 0) return;
  const tmp = new Float32Array(a.length);
  const pass = (src: Float32Array, dst: Float32Array, horizontal: boolean) => {
    const outer = horizontal ? h : w;
    const inner = horizontal ? w : h;
    for (let o = 0; o < outer; o++) {
      const at = (k: number) => (horizontal ? o * w + k : k * w + o);
      let sum = 0;
      for (let k = -r; k <= r; k++) sum += src[at(Math.min(inner - 1, Math.max(0, k)))];
      for (let k = 0; k < inner; k++) {
        dst[at(k)] = sum / (2 * r + 1);
        sum += src[at(Math.min(inner - 1, k + r + 1))] - src[at(Math.max(0, k - r))];
      }
    }
  };
  for (let n = 0; n < 2; n++) {
    pass(a, tmp, true);
    pass(tmp, a, false);
  }
}

function normalize(a: Float32Array) {
  let min = Infinity;
  let max = -Infinity;
  for (const v of a) {
    min = Math.min(min, v);
    max = Math.max(max, v);
  }
  const range = max - min || 1;
  for (let i = 0; i < a.length; i++) a[i] = (a[i] - min) / range;
}

export function depthToImageData(depth: DepthMap): ImageData {
  const out = new ImageData(depth.width, depth.height);
  for (let i = 0; i < depth.data.length; i++) {
    const v = depth.data[i] * 255;
    out.data.set([v, v, v, 255], i * 4);
  }
  return out;
}
