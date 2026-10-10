// KMB double-decker bus (Enviro500-style), 12 m x 2.55 m x 4.3 m, in metres. Front faces +x.
// Red livery, cream swooshes, two-deck glazing, LED destination "STAR FERRY 1A", tandem rear axle.
import { Painter, region, glass, fill, text, circle } from './atlas';
import { Builder, V3 } from './builder';
import { ModelDef } from './types';

const L = 6; // half length
const W = 1.275; // half width
const WR = 1.05; // roof half width (chamfered roof edge)
const Y0 = 0.35; // floor / skirt bottom
const YS = 4.05; // top of the side panels
const YT = 4.3; // roof
const RAKE = 0.15; // the front leans back by this much at the top
const WHEEL_R = 0.5;
const AXLES = [3.9, -2.6, -3.9];
const RED = '#d71920';
const CREAM = '#efe2bf';
const LED = '#ff8a1c';

const R = {
  sideLeft: region('side left', 0, 0, 1024, 316, [12, YS - Y0]),
  sideRight: region('side right', 0, 320, 1024, 316, [12, YS - Y0]),
  front: region('front', 0, 640, 200, 310, [2 * W, YT - Y0]),
  back: region('back', 204, 640, 200, 310, [2 * W, YT - Y0]),
  roof: region('roof', 408, 640, 400, 70, [12, 2 * WR]),
  roofEdge: region('roof edge', 408, 714, 400, 12, [12, 0.34]),
  tread: region('tread', 408, 730, 30, 116, [0.3, 2 * Math.PI * WHEEL_R]),
  hubcap: region('hubcap', 442, 730, 116, 116, [1, 1]),
  dark: region('dark', 562, 730, 64, 64, [0.5, 0.5]),
};

const xf = (y: number) => L - RAKE * ((y - Y0) / (YT - Y0)); // front face x at height y

function build() {
  const b = new Builder();
  const c: V3 = [0, (Y0 + YT) / 2, 0];
  const sideT = (p: V3) => (YS - p[1]) / (YS - Y0);

  // Sides: separate regions so the lettering reads correctly on both
  b.quad([-L, Y0, W], [xf(Y0), Y0, W], [xf(YS), YS, W], [-L, YS, W], R.sideLeft, (p) => [(p[0] + L) / (2 * L), sideT(p)], c);
  b.quad([-L, Y0, -W], [xf(Y0), Y0, -W], [xf(YS), YS, -W], [-L, YS, -W], R.sideRight, (p) => [(L - p[0]) / (2 * L), sideT(p)], c);
  // Chamfered roof edges + roof
  for (const s of [1, -1]) {
    b.quad([-L, YS, s * W], [xf(YS), YS, s * W], [xf(YT), YT, s * WR], [-L, YT, s * WR], R.roofEdge,
      (p) => [(p[0] + L) / (2 * L), (p[1] - YS) / (YT - YS)], c);
  }
  b.quad([-L, YT, WR], [xf(YT), YT, WR], [xf(YT), YT, -WR], [-L, YT, -WR], R.roof, (p) => [(p[0] + L) / (2 * L), (WR - p[2]) / (2 * WR)], c);
  b.quad([-L, Y0, W], [xf(Y0), Y0, W], [xf(Y0), Y0, -W], [-L, Y0, -W], R.dark, () => [0.5, 0.5], c);

  // Front and back: rectangle up to the side tops + trapezoid up to the roof
  const endT = (p: V3) => (YT - p[1]) / (YT - Y0);
  const front = (z: number, y: number): V3 => [xf(y), y, z];
  const frontUV = (p: V3): [number, number] => [(W - p[2]) / (2 * W), endT(p)];
  b.quad(front(W, Y0), front(-W, Y0), front(-W, YS), front(W, YS), R.front, frontUV, c);
  b.quad(front(W, YS), front(-W, YS), front(-WR, YT), front(WR, YT), R.front, frontUV, c);
  const backUV = (p: V3): [number, number] => [(p[2] + W) / (2 * W), endT(p)];
  b.quad([-L, Y0, -W], [-L, Y0, W], [-L, YS, W], [-L, YS, -W], R.back, backUV, c);
  b.quad([-L, YS, -W], [-L, YS, W], [-L, YT, WR], [-L, YT, -WR], R.back, backUV, c);

  // Wheels: single front axle, tandem rear axles; they stand just proud of the body sides
  for (const x of AXLES) {
    for (const s of [1, -1]) {
      const zc = s * 1.15;
      b.cylinder('z', [x, WHEEL_R], zc - 0.15, zc + 0.15, WHEEL_R, WHEEL_R, 24, R.tread, R.hubcap, R.hubcap);
    }
  }
  // Mirrors on stalks, ahead of the front corners
  for (const s of [1, -1]) {
    b.box(5.95, 6.25, 2.55, 2.6, s * 1.15, s * 1.45, { py: R.dark, ny: R.dark, pz: R.dark, nz: R.dark, px: R.dark, nx: R.dark });
    b.box(6.1, 6.22, 2.1, 2.75, s * 1.38, s * 1.5, { py: R.dark, ny: R.dark, pz: R.dark, nz: R.dark, px: R.dark, nx: R.dark });
  }
  return b.build();
}

// Side panel art. Drawn with the rear at u = 0, front at u = 12; `flip` mirrors it for the right side.
// t = 0 is the top of the side panel (y 4.05), t = 3.7 the bottom (y 0.35): t = 4.05 - y.
function side(ctx: CanvasRenderingContext2D, w: number, h: number, flip: boolean) {
  const X = (u: number) => (flip ? w - u : u); // mirror x positions for text drawn without the flip
  ctx.save();
  if (flip) {
    ctx.translate(w, 0);
    ctx.scale(-1, 1);
  }
  fill(ctx, RED, 0, 0, w, h);
  // Upper deck glazing (y 2.7..3.75)
  fill(ctx, '#1a1f26', 0.35, 0.3, 11.5, 1.05);
  for (let u = 0.35; u < 11.8; u += 1.28) fill(ctx, glass(ctx, 0.32, 1.33), u + 0.06, 0.32, 1.16, 1.01);
  // Lower deck glazing (y 1.3..2.35), broken by the centre door
  for (const [u0, u1] of [[0.4, 6.1], [7.3, 10.5]] as const) {
    fill(ctx, '#1a1f26', u0, 1.7, u1 - u0, 1.05);
    for (let u = u0; u < u1 - 0.3; u += 1.3) fill(ctx, glass(ctx, 1.72, 2.73), u + 0.06, 1.72, Math.min(1.18, u1 - u - 0.12), 1.01);
  }
  // Doors: centre (x 0.2..1.2) and front (x 4.6..5.6), glazed almost to the floor
  for (const u0 of [6.2, 10.6]) {
    fill(ctx, '#2a2a2a', u0, 1.55, 1.0, 2.05);
    fill(ctx, glass(ctx, 1.6, 3.5), u0 + 0.06, 1.6, 0.42, 1.9);
    fill(ctx, glass(ctx, 1.6, 3.5), u0 + 0.52, 1.6, 0.42, 1.9);
  }
  // Cream swooshes: upper pair rising towards the front, lower pair along the skirt
  ctx.fillStyle = CREAM;
  for (const dy of [0, 0.1]) {
    ctx.beginPath();
    ctx.moveTo(6.5, 1.5 + dy);
    ctx.lineTo(w, 1.42 + dy);
    ctx.lineTo(w, 1.46 + dy);
    ctx.lineTo(6.5, 1.53 + dy);
    ctx.fill();
    fill(ctx, CREAM, 7.3, 2.9 + dy, 3.3, 0.035);
  }
  // Wheel arches
  for (const x of AXLES) circle(ctx, x + 6, 3.55, 0.6, '#151515');
  // Rear corner lights and front indicator
  fill(ctx, '#b0101e', 0, 2.6, 0.08, 0.5);
  fill(ctx, '#ff9a1f', w - 0.1, 3.05, 0.1, 0.12);
  ctx.restore();

  // Lettering (never mirrored)
  text(ctx, 'KMB', X(11.0), 1.55, 0.32, '#fff');
  text(ctx, 'KMB', X(8.2), 3.2, 0.55, 'rgba(255,255,255,0.85)');
  // Side route display next to the front door
  fill(ctx, '#111', flip ? w - 10.45 : 9.45, 1.85, 1.0, 0.28);
  text(ctx, '1A 尖沙咀天星碼頭', X(9.95), 1.995, 0.12, LED);
}

const painters: Record<keyof typeof R, Painter> = {
  sideLeft: (ctx, w, h) => side(ctx, w, h, false),
  sideRight: (ctx, w, h) => side(ctx, w, h, true),
  // Front: t = 0 roof (y 4.3), t = 3.95 bottom (y 0.35): t = 4.3 - y
  front(ctx, w, h) {
    fill(ctx, RED, 0, 0, w, h);
    fill(ctx, '#15181d', 0.08, 0.12, w - 0.16, 3.1); // black glazing frame
    fill(ctx, glass(ctx, 0.15, 1.5), 0.14, 0.18, w - 0.28, 1.35); // upper deck windscreen
    fill(ctx, '#e8e8e8', 0.95, 0.15, 0.65, 0.22); // CCTV / dome housing at the top
    // LED destination display
    fill(ctx, '#0b0b0b', 0.2, 1.6, w - 0.4, 0.5);
    text(ctx, 'STAR FERRY', 1.0, 1.77, 0.2, LED);
    text(ctx, '1A', 2.05, 1.84, 0.34, LED);
    text(ctx, '尖沙咀天星碼頭', 1.0, 1.98, 0.13, LED);
    fill(ctx, glass(ctx, 2.15, 3.1), 0.14, 2.15, w - 0.28, 1.0); // lower windscreen
    ctx.strokeStyle = '#111'; // wipers
    ctx.lineWidth = 0.025;
    for (const x0 of [0.3, 1.3]) {
      ctx.beginPath();
      ctx.moveTo(x0, 2.3);
      ctx.lineTo(x0 + 0.9, 2.18);
      ctx.stroke();
    }
    // Cream band with the KMB logo, headlights in the black corners
    fill(ctx, '#15181d', 0, 3.2, w, 0.12);
    ctx.fillStyle = CREAM;
    ctx.beginPath();
    ctx.moveTo(0.35, 3.3);
    ctx.lineTo(w - 0.35, 3.3);
    ctx.quadraticCurveTo(w / 2, 3.75, 0.35, 3.3);
    ctx.fill();
    text(ctx, 'KMB', w / 2, 3.43, 0.2, RED);
    for (const x of [0.18, w - 0.18]) {
      fill(ctx, '#15181d', x - 0.16, 3.2, 0.32, 0.36);
      circle(ctx, x, 3.3, 0.06, '#fff6d8');
      circle(ctx, x, 3.46, 0.05, '#fff6d8');
    }
    fill(ctx, '#f6f6f6', w / 2 - 0.27, 3.66, 0.54, 0.13); // number plate
    text(ctx, 'LV 3652', w / 2, 3.727, 0.09, '#111');
    fill(ctx, '#1a1a1a', 0, 3.85, w, 0.1); // bumper
  },
  back(ctx, w, h) {
    fill(ctx, RED, 0, 0, w, h);
    fill(ctx, '#15181d', 0.3, 0.35, w - 0.6, 0.85);
    fill(ctx, glass(ctx, 0.4, 1.15), 0.36, 0.41, w - 0.72, 0.73); // upper rear window
    fill(ctx, '#0b0b0b', 0.5, 1.4, w - 1.0, 0.3); // rear route number
    text(ctx, '1A', w / 2, 1.555, 0.22, LED);
    text(ctx, 'KMB', w / 2, 2.2, 0.35, '#fff');
    fill(ctx, '#151515', 0.25, 2.85, w - 0.5, 0.7); // engine grille
    ctx.fillStyle = '#333';
    for (let y = 2.9; y < 3.5; y += 0.08) ctx.fillRect(0.3, y, w - 0.6, 0.03);
    for (const x of [0.04, w - 0.16]) {
      fill(ctx, '#c0101e', x, 2.4, 0.12, 0.5); // tail lights
      fill(ctx, '#ff9a1f', x, 2.92, 0.12, 0.14);
    }
    fill(ctx, '#ffd200', w / 2 - 0.27, 3.62, 0.54, 0.13); // yellow rear plate
    text(ctx, 'LV 3652', w / 2, 3.687, 0.09, '#111');
    fill(ctx, '#1a1a1a', 0, 3.85, w, 0.1);
  },
  roof(ctx, w, h) {
    fill(ctx, '#c4161d', 0, 0, w, h);
    fill(ctx, '#bfc3c8', 2.0, 0.45, 2.8, 1.2); // air-conditioning pod
    fill(ctx, '#9ea3a9', 2.2, 0.6, 2.4, 0.9);
    fill(ctx, '#2a2a2a', 9.5, 0.8, 0.4, 0.5); // roof hatch
  },
  roofEdge(ctx, w, h) {
    fill(ctx, '#cc171e', 0, 0, w, h);
  },
  tread(ctx, w, h) {
    fill(ctx, '#1d1d1d', 0, 0, w, h);
    ctx.strokeStyle = '#0a0a0a';
    ctx.lineWidth = 0.02;
    for (let y = 0; y < h; y += 0.09) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y + 0.03);
      ctx.stroke();
    }
  },
  hubcap(ctx, w, h) {
    const c = w / 2;
    fill(ctx, '#1d1d1d', 0, 0, w, h);
    circle(ctx, c, h / 2, 0.34, '#c9ccd1'); // steel rim
    circle(ctx, c, h / 2, 0.22, '#9fa4aa');
    for (let i = 0; i < 10; i++) { // wheel nuts
      const a = (i / 10) * Math.PI * 2;
      circle(ctx, c + Math.cos(a) * 0.16, h / 2 + Math.sin(a) * 0.16, 0.022, '#e6e6e6');
    }
    circle(ctx, c, h / 2, 0.07, '#6b7077');
  },
  dark(ctx, w, h) {
    fill(ctx, '#202225', 0, 0, w, h);
  },
};

export const kmbBus: ModelDef = { id: 'kmb-bus', label: 'KMB Double-decker Bus', paint: RED, cameraDistance: 22, regions: R, painters, build };
