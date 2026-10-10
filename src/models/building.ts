// Building: an 8-floor tower with an entrance facade, a rooftop helipad and a small penthouse
import { Painter, region, glass, fill, text, circle } from './atlas';
import { Builder } from './builder';
import { ModelDef } from './types';

const FLOORS = 8;
const FLOOR_H = 0.3;
const HALF = 0.6;
const HEIGHT = FLOORS * FLOOR_H;

const R = {
  facade: region('facade', 0, 0, 256, 512, [1.2, HEIGHT]),
  entrance: region('entrance', 260, 0, 256, 512, [1.2, HEIGHT]),
  roof: region('roof', 520, 0, 256, 256, [1.2, 1.2]),
  penthouse: region('penthouse', 520, 260, 250, 150, [0.5, 0.3]),
  dark: region('dark', 780, 0, 64, 64, [0.5, 0.5]),
};

function build() {
  const b = new Builder();
  // Front (+x) gets the entrance; the other three walls share the facade region
  b.box(-HALF, HALF, 0, HEIGHT, -HALF, HALF, { px: R.entrance, nx: R.facade, pz: R.facade, nz: R.facade, py: R.roof, ny: R.dark });
  b.box(-0.45, 0.05, HEIGHT, HEIGHT + 0.3, -0.25, 0.25, { px: R.penthouse, nx: R.penthouse, pz: R.penthouse, nz: R.penthouse, py: R.dark });
  return b.build();
}

// Window grid: one row per floor, the ground floor is left to the caller
function windows(ctx: CanvasRenderingContext2D, w: number) {
  for (let f = 0; f < FLOORS - 1; f++) {
    const y = f * FLOOR_H + 0.07;
    for (let i = 0; i < 4; i++) fill(ctx, glass(ctx, y, y + 0.17), 0.08 + i * 0.28, y, 0.2, 0.17);
    fill(ctx, 'rgba(0,0,0,0.25)', 0, y + 0.2, w, 0.015); // floor slab line
  }
}

const painters: Record<keyof typeof R, Painter> = {
  facade(ctx, w, h, paint) {
    fill(ctx, paint, 0, 0, w, h);
    fill(ctx, 'rgba(255,255,255,0.3)', 0, 0, w, 0.04); // cornice
    windows(ctx, w);
    fill(ctx, '#3b3b44', 0, h - FLOOR_H, w, FLOOR_H); // ground floor base
    for (let i = 0; i < 2; i++) fill(ctx, glass(ctx, h - 0.25, h - 0.05), 0.15 + i * 0.55, h - 0.25, 0.35, 0.2);
  },
  entrance(ctx, w, h, paint) {
    painters.facade(ctx, w, h, paint);
    fill(ctx, '#3b3b44', 0, h - FLOOR_H, w, FLOOR_H);
    fill(ctx, '#d9d9d9', 0.3, h - 0.3, 0.6, 0.04); // canopy
    fill(ctx, glass(ctx, h - 0.26, h), 0.4, h - 0.26, 0.4, 0.26); // glass doors
    fill(ctx, '#222', 0.595, h - 0.26, 0.01, 0.26);
    text(ctx, 'UV TOWER', w / 2, h - FLOOR_H - 0.04, 0.07, '#fff');
  },
  roof(ctx, w, h, paint) {
    fill(ctx, '#77787a', 0, 0, w, h); // gravel
    for (let i = 0; i < 400; i++) fill(ctx, i % 2 ? '#8a8b8d' : '#606163', (i * 0.137) % w, (i * 0.291) % h, 0.008, 0.008);
    ctx.strokeStyle = paint; // parapet
    ctx.lineWidth = 0.05;
    ctx.strokeRect(0.025, 0.025, w - 0.05, h - 0.05);
    circle(ctx, 0.85, 0.6, 0.22, '#2d6a3e'); // helipad on the open half of the roof
    circle(ctx, 0.85, 0.6, 0.18, '#3a8a50');
    text(ctx, 'H', 0.85, 0.61, 0.22, '#fff');
  },
  penthouse(ctx, w, h, paint) {
    fill(ctx, paint, 0, 0, w, h);
    fill(ctx, 'rgba(0,0,0,0.2)', 0, 0, w, 0.03);
    fill(ctx, '#55575c', 0.18, 0.08, 0.14, 0.22); // door
  },
  dark(ctx, w, h) {
    fill(ctx, '#2b2b2b', 0, 0, w, h);
  },
};

export const building: ModelDef = { id: 'building', label: 'Building', paint: '#c9b79c', cameraDistance: 5.5, regions: R, painters, build };
