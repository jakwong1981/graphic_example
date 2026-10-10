// Car: body box, tapered cabin and four wheels. Front faces +x.
import { Painter, region, glass, fill, text, circle } from './atlas';
import { Builder, V3 } from './builder';
import { ModelDef } from './types';

const R = {
  sideBody: region('side body', 0, 0, 1024, 171, [2.4, 0.4]),
  sideCabin: region('side cabin', 0, 176, 640, 172, [1.3, 0.35]),
  top: region('hood / trunk', 0, 352, 1024, 427, [2.4, 1.0]),
  front: region('front', 0, 784, 300, 120, [1.0, 0.4]),
  back: region('back', 304, 784, 300, 120, [1.0, 0.4]),
  windshield: region('windshield', 608, 784, 250, 120, [0.96, 0.46]),
  rearWindow: region('rear window', 0, 908, 250, 116, [0.96, 0.43]),
  roof: region('roof', 254, 908, 107, 116, [0.75, 0.84]),
  tread: region('tread', 365, 908, 40, 116, [0.16, 1.26]), // s = across the tyre, t = around it
  hubcap: region('hubcap', 529, 908, 116, 116, [0.4, 0.4]),
  bottom: region('bottom', 649, 908, 116, 116, [2.4, 1.0]),
};

const BODY = { x: 1.2, y0: 0.15, y1: 0.55, z: 0.5 };
const CABIN = { y0: 0.55, y1: 0.9, bx0: -0.7, bx1: 0.6, tx0: -0.45, tx1: 0.3, bz: 0.48, tz: 0.42 };
const WHEEL = { r: 0.2, halfWidth: 0.08, x: 0.75, z: 0.46, segments: 28 };

function build() {
  const b = new Builder();
  const { x: X, y0, y1, z: Z } = BODY;
  const bodyCenter: V3 = [0, (y0 + y1) / 2, 0];
  const sideT = (p: V3) => (y1 - p[1]) / (y1 - y0);

  // Both sides share one region with s from x, so front stays front (the image is mirrored on one side)
  for (const z of [Z, -Z]) {
    b.quad([-X, y0, z], [X, y0, z], [X, y1, z], [-X, y1, z], R.sideBody, (p) => [(p[0] + X) / (2 * X), sideT(p)], bodyCenter);
  }
  b.quad([X, y0, Z], [X, y0, -Z], [X, y1, -Z], [X, y1, Z], R.front, (p) => [(Z - p[2]) / (2 * Z), sideT(p)], bodyCenter);
  b.quad([-X, y0, -Z], [-X, y0, Z], [-X, y1, Z], [-X, y1, -Z], R.back, (p) => [(p[2] + Z) / (2 * Z), sideT(p)], bodyCenter);
  b.quad([-X, y1, Z], [X, y1, Z], [X, y1, -Z], [-X, y1, -Z], R.top, (p) => [(p[0] + X) / (2 * X), (Z - p[2]) / (2 * Z)], bodyCenter);
  b.quad([-X, y0, Z], [X, y0, Z], [X, y0, -Z], [-X, y0, -Z], R.bottom, (p) => [(p[0] + X) / (2 * X), (Z - p[2]) / (2 * Z)], bodyCenter);

  // Cabin: a tapered box (frustum)
  const C = CABIN;
  const cc: V3 = [(C.bx0 + C.bx1) / 2, (C.y0 + C.y1) / 2, 0];
  const cabinT = (p: V3) => (C.y1 - p[1]) / (C.y1 - C.y0);
  for (const s of [1, -1]) {
    b.quad([C.bx0, C.y0, s * C.bz], [C.bx1, C.y0, s * C.bz], [C.tx1, C.y1, s * C.tz], [C.tx0, C.y1, s * C.tz],
      R.sideCabin, (p) => [(p[0] - C.bx0) / (C.bx1 - C.bx0), cabinT(p)], cc);
  }
  b.quad([C.bx1, C.y0, C.bz], [C.bx1, C.y0, -C.bz], [C.tx1, C.y1, -C.tz], [C.tx1, C.y1, C.tz],
    R.windshield, (p) => [(C.bz - p[2]) / (2 * C.bz), cabinT(p)], cc);
  b.quad([C.bx0, C.y0, -C.bz], [C.bx0, C.y0, C.bz], [C.tx0, C.y1, C.tz], [C.tx0, C.y1, -C.tz],
    R.rearWindow, (p) => [(p[2] + C.bz) / (2 * C.bz), cabinT(p)], cc);
  b.quad([C.tx0, C.y1, C.tz], [C.tx1, C.y1, C.tz], [C.tx1, C.y1, -C.tz], [C.tx0, C.y1, -C.tz],
    R.roof, (p) => [(p[0] - C.tx0) / (C.tx1 - C.tx0), (C.tz - p[2]) / (2 * C.tz)], cc);

  // Wheels: cylinders along z; tread wraps around, both caps use the hubcap disc
  const W = WHEEL;
  for (const wx of [W.x, -W.x]) {
    for (const wz of [W.z, -W.z]) {
      b.cylinder('z', [wx, W.r], wz - W.halfWidth, wz + W.halfWidth, W.r, W.r, W.segments, R.tread, R.hubcap, R.hubcap);
    }
  }
  return b.build();
}

const painters: Record<keyof typeof R, Painter> = {
  sideBody(ctx, w, _h, paint) {
    fill(ctx, paint, 0, 0, w, 0.4);
    fill(ctx, 'rgba(255,255,255,0.85)', 0, 0.08, w, 0.03); // racing stripe
    fill(ctx, '#2a2a2a', 0, 0.33, w, 0.07); // rocker panel
    ctx.strokeStyle = 'rgba(0,0,0,0.5)'; // door seams
    ctx.lineWidth = 0.008;
    for (const x of [0.5, 1.15, 1.8]) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, 0.33);
      ctx.stroke();
    }
    for (const x of [1.0, 1.65]) fill(ctx, '#ccc', x, 0.13, 0.1, 0.02); // door handles
    for (const x of [0.45, 1.95]) circle(ctx, x, 0.35, 0.24, '#111'); // wheel arches
    fill(ctx, '#ffcf5a', w - 0.06, 0.12, 0.06, 0.08); // headlight wrap (front = right)
    fill(ctx, '#c0182a', 0, 0.12, 0.06, 0.08); // taillight wrap
  },
  sideCabin(ctx, w, h, paint) {
    fill(ctx, paint, 0, 0, w, h);
    // Window follows the trapezoid: at height t the cabin spans left(t)..right(t)
    const left = (t: number) => 0.25 * (1 - t / h) + 0.05;
    const right = (t: number) => w - 0.3 * (1 - t / h) - 0.05;
    const [t0, t1] = [0.05, h - 0.05];
    ctx.fillStyle = glass(ctx, t0, t1);
    ctx.beginPath();
    ctx.moveTo(left(t1), t1);
    ctx.lineTo(right(t1), t1);
    ctx.lineTo(right(t0), t0);
    ctx.lineTo(left(t0), t0);
    ctx.fill();
    fill(ctx, paint, 0.62, 0, 0.05, h); // B-pillar
  },
  top(ctx, w, h, paint) {
    fill(ctx, paint, 0, 0, w, h);
    fill(ctx, 'rgba(255,255,255,0.85)', 0, 0.4, w, 0.06);
    fill(ctx, 'rgba(255,255,255,0.85)', 0, 0.54, w, 0.06);
    ctx.strokeStyle = 'rgba(0,0,0,0.45)';
    ctx.lineWidth = 0.01;
    for (const x of [0.45, 1.85]) {
      ctx.beginPath();
      ctx.moveTo(x, 0.04);
      ctx.lineTo(x, h - 0.04);
      ctx.stroke();
    }
  },
  front(ctx, w, h, paint) {
    fill(ctx, paint, 0, 0, w, h);
    fill(ctx, '#151515', 0.3, 0.14, 0.4, 0.14); // grille
    for (let y = 0.165; y < 0.28; y += 0.035) fill(ctx, '#777', 0.31, y, 0.38, 0.008);
    fill(ctx, '#fff6c8', 0.05, 0.08, 0.2, 0.09); // headlights
    fill(ctx, '#fff6c8', 0.75, 0.08, 0.2, 0.09);
    fill(ctx, '#3a3a3a', 0, 0.31, w, 0.09); // bumper
  },
  back(ctx, w, h, paint) {
    fill(ctx, paint, 0, 0, w, h);
    fill(ctx, '#c0182a', 0.04, 0.08, 0.2, 0.08); // taillights
    fill(ctx, '#c0182a', 0.76, 0.08, 0.2, 0.08);
    fill(ctx, '#f2f2f2', 0.34, 0.17, 0.32, 0.1); // number plate
    text(ctx, 'UV-2026', 0.5, 0.222, 0.07, '#111');
    fill(ctx, '#3a3a3a', 0, 0.31, w, 0.09);
  },
  windshield(ctx, w, h, paint) {
    fill(ctx, paint, 0, 0, w, h);
    fill(ctx, glass(ctx, 0, h), 0.06, 0.04, w - 0.12, h - 0.08);
  },
  rearWindow(ctx, w, h, paint) {
    painters.windshield(ctx, w, h, paint);
  },
  roof(ctx, w, h, paint) {
    fill(ctx, paint, 0, 0, w, h);
    fill(ctx, 'rgba(255,255,255,0.85)', 0, 0.26, w, 0.06);
    fill(ctx, 'rgba(255,255,255,0.85)', 0, 0.52, w, 0.06);
  },
  // Tread: s = across the tyre (axis), t = around it
  tread(ctx, w, h) {
    fill(ctx, '#1e1e1e', 0, 0, w, h);
    ctx.strokeStyle = '#0a0a0a';
    ctx.lineWidth = 0.012;
    for (let y = 0; y < h; y += 0.06) {
      ctx.beginPath(); // chevron grooves repeated around the tyre
      ctx.moveTo(0, y);
      ctx.lineTo(w / 2, y + 0.03);
      ctx.lineTo(w, y);
      ctx.stroke();
    }
  },
  hubcap(ctx, w, h) {
    const c = w / 2;
    fill(ctx, '#1e1e1e', 0, 0, w, h);
    circle(ctx, c, h / 2, 0.13, '#c9ced6'); // rim
    ctx.strokeStyle = '#6b717a'; // 5 spokes
    ctx.lineWidth = 0.025;
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2;
      ctx.beginPath();
      ctx.moveTo(c, h / 2);
      ctx.lineTo(c + Math.cos(a) * 0.12, h / 2 + Math.sin(a) * 0.12);
      ctx.stroke();
    }
    circle(ctx, c, h / 2, 0.025, '#e44');
  },
  bottom(ctx, w, h) {
    fill(ctx, '#111', 0, 0, w, h);
  },
};

export const car: ModelDef = { id: 'car', label: 'Car', paint: '#d62828', cameraDistance: 3.6, regions: R, painters, build };
