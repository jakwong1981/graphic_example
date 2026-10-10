// Texture atlas core: one 1024x1024 canvas split into named regions, one per group of faces.
// Each region's aspect ratio matches its face (in metres) so the paint is not stretched.
export interface Region {
  name: string;
  x: number; // pixels
  y: number;
  w: number;
  h: number;
  units: [number, number]; // face size in world units (width, height)
}

export type Painter = (ctx: CanvasRenderingContext2D, w: number, h: number, paint: string) => void;
export type AtlasMode = 'painted' | 'checker';

export const ATLAS_SIZE = 1024;

export const region = (name: string, x: number, y: number, w: number, h: number, units: [number, number]): Region => ({
  name, x, y, w, h, units,
});

// (s, t) in 0..1 inside a region -> atlas UV. t = 0 is the top row of the image, as in glTF.
export function regionUV(r: Region, s: number, t: number): [number, number] {
  return [(r.x + s * r.w) / ATLAS_SIZE, (r.y + t * r.h) / ATLAS_SIZE];
}

export function drawAtlas(
  canvas: HTMLCanvasElement,
  regions: Record<string, Region>,
  painters: Record<string, Painter>,
  paint: string,
  mode: AtlasMode
) {
  canvas.width = canvas.height = ATLAS_SIZE;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#333';
  ctx.fillRect(0, 0, ATLAS_SIZE, ATLAS_SIZE);
  for (const [key, r] of Object.entries(regions)) {
    ctx.save();
    ctx.beginPath();
    ctx.rect(r.x, r.y, r.w, r.h);
    ctx.clip();
    ctx.translate(r.x, r.y);
    // Draw in face units: 1 unit = 1 world metre on that face
    ctx.scale(r.w / r.units[0], r.h / r.units[1]);
    if (mode === 'checker') drawChecker(ctx, r);
    else painters[key]?.(ctx, r.units[0], r.units[1], paint);
    ctx.restore();
  }
}

// Checker + label: shows texel density and orientation of every region on the model
function drawChecker(ctx: CanvasRenderingContext2D, r: Region) {
  const [w, h] = r.units;
  const cell = 0.1;
  for (let y = 0; y < h; y += cell) {
    for (let x = 0; x < w; x += cell) {
      ctx.fillStyle = (Math.round(x / cell) + Math.round(y / cell)) % 2 ? '#e8e8e8' : '#4a7bd0';
      ctx.fillRect(x, y, cell, cell);
    }
  }
  // Undo the non-uniform scale so text is not squashed
  ctx.setTransform(1, 0, 0, 1, r.x, r.y);
  ctx.fillStyle = '#e33';
  ctx.fillRect(0, 0, 14, 14); // red corner = (s, t) = (0, 0)
  ctx.fillStyle = '#000';
  ctx.font = 'bold 16px sans-serif';
  ctx.fillText(r.name, 18, 14);
}

// Shared painting helpers
export function glass(ctx: CanvasRenderingContext2D, y0: number, y1: number) {
  const g = ctx.createLinearGradient(0, y0, 0, y1);
  g.addColorStop(0, '#9fc4e8');
  g.addColorStop(1, '#1d2f4a');
  return g;
}

export function fill(ctx: CanvasRenderingContext2D, color: string | CanvasGradient, x: number, y: number, w: number, h: number) {
  ctx.fillStyle = color;
  ctx.fillRect(x, y, w, h);
}

export function text(ctx: CanvasRenderingContext2D, value: string, x: number, y: number, size: number, color: string) {
  ctx.fillStyle = color;
  ctx.font = `bold ${size}px sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(value, x, y);
}

export function circle(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, color: string) {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
}
