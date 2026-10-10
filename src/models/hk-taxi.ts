// Hong Kong urban taxi: boxy red sedan (Crown Comfort style), silver roof, "TAXI 的士" roof sign. Front faces +x.
import { Painter, region, glass, fill, text, circle } from './atlas';
import { Builder, V3 } from './builder';
import { ModelDef } from './types';

const R = {
  sideLeft: region('side left', 0, 0, 1024, 164, [2.5, 0.4]),
  sideRight: region('side right', 0, 168, 1024, 164, [2.5, 0.4]),
  sideCabin: region('side cabin', 0, 336, 426, 160, [1.33, 0.5]),
  top: region('hood / trunk', 0, 500, 768, 276, [2.5, 0.9]),
  front: region('front', 0, 780, 270, 120, [0.9, 0.4]),
  back: region('back', 274, 780, 270, 120, [0.9, 0.4]),
  windshield: region('windshield', 548, 780, 250, 120, [0.88, 0.43]),
  signEnd: region('sign end', 802, 780, 210, 70, [0.3, 0.1]),
  signSide: region('sign side', 802, 854, 140, 70, [0.2, 0.1]),
  rearWindow: region('rear window', 0, 904, 240, 116, [0.88, 0.42]),
  roof: region('roof', 244, 904, 145, 116, [1.0, 0.8]),
  tread: region('tread', 393, 904, 40, 116, [0.16, 1.26]),
  hubcap: region('hubcap', 437, 904, 116, 116, [0.4, 0.4]),
  bottom: region('bottom', 557, 904, 116, 116, [2.5, 0.9]),
  dark: region('dark', 677, 904, 64, 64, [0.5, 0.5]),
};

const BODY = { x: 1.25, y0: 0.15, y1: 0.55, z: 0.45 };
// Upright, boxy cabin: little taper compared with the sports car
// y0 sits below the rounded shoulders so the cabin base is hidden inside the body
const CABIN = { y0: 0.45, y1: 0.95, bx0: -0.75, bx1: 0.55, tx0: -0.6, tx1: 0.4, bz: 0.4, tz: 0.36 };
const WHEEL = { r: 0.2, halfWidth: 0.07, x: 0.8, z: 0.42, segments: 28 };
const RED = '#c8102e';

function build() {
  const b = new Builder();
  const { x: X, y0, y1, z: Z } = BODY;
  const sideT = (p: V3) => (y1 - p[1]) / (y1 - y0);

  // Curved body: a superellipse cross-section lofted along x.
  //   plan view:  half-width w(x) rounds off near the bumpers
  //   side view:  hood and trunk drop towards the ends, the sill lifts at the overhangs
  //   section:    z = w*cos(th)^(1/3), y = bottom + height*sin(th)^(1/3)   (th: 0 = left sill, pi = right sill)
  const xEnd = X * 0.985;
  const xAt = (u: number) => xEnd * Math.sin((u * Math.PI) / 2); // u in -1..1, denser near the ends
  const w = (x: number) => Z * Math.pow(1 - Math.pow(Math.abs(x) / X, 8), 1 / 8);
  const top = (x: number) => y1 - 0.07 * Math.pow(Math.abs(x) / X, 3);
  const bottom = (x: number) => y0 + 0.05 * Math.pow(Math.abs(x) / X, 6);
  const sp = (c: number) => Math.sign(c) * Math.pow(Math.abs(c), 1 / 3);
  const P = (u: number, th: number): V3 => {
    const x = xAt(u);
    const yb = bottom(x);
    return [x, yb + (top(x) - yb) * sp(Math.sin(th)), w(x) * sp(Math.cos(th))];
  };
  const inside = (p: V3): V3 => [p[0], (y0 + y1) / 2, 0];
  const NU = 48;
  const SHOULDER = 0.32 * Math.PI; // where the side panel turns into the hood/roofline region

  // Separate left/right regions so the door lettering reads correctly on both sides
  b.surface(P, [-1, 1, NU], [0, SHOULDER, 8], R.sideLeft, (p) => [(p[0] + X) / (2 * X), sideT(p)], inside);
  b.surface(P, [-1, 1, NU], [Math.PI - SHOULDER, Math.PI, 8], R.sideRight, (p) => [(X - p[0]) / (2 * X), sideT(p)], inside);
  b.surface(P, [-1, 1, NU], [SHOULDER, Math.PI - SHOULDER, 12], R.top, (p) => [(p[0] + X) / (2 * X), (Z - p[2]) / (2 * Z)], inside);

  // Flat underside between the two sills
  const under = (u: number, k: number): V3 => {
    const x = xAt(u);
    return [x, bottom(x), w(x) * (1 - 2 * k)];
  };
  b.surface(under, [-1, 1, NU], [0, 1, 1], R.bottom, (p) => [(p[0] + X) / (2 * X), (Z - p[2]) / (2 * Z)], (p) => [p[0], p[1] + 1, p[2]]);

  // Front and back: flat end panels that fill the last cross-section
  for (const [sign, reg] of [[1, R.front], [-1, R.back]] as const) {
    const x = sign * xEnd;
    const we = w(x);
    const yb = bottom(x);
    const yt = top(x);
    const c: V3 = [x, (yb + yt) / 2, 0];
    const uvEnd = (p: V3): [number, number] => [sign > 0 ? (we - p[2]) / (2 * we) : (p[2] + we) / (2 * we), (yt - p[1]) / (yt - yb)];
    const ring: V3[] = [];
    for (let j = 0; j <= 24; j++) ring.push(P(sign, (j / 24) * Math.PI));
    ring.push(ring[0]); // close along the sill line
    for (let j = 0; j < ring.length - 1; j++) b.tri(c, ring[j], ring[j + 1], reg, uvEnd, [0, c[1], 0]);
  }

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

  // Roof sign: "TAXI" on the ends, "的士" on the sides
  b.box(-0.2, 0.0, C.y1, C.y1 + 0.1, -0.15, 0.15, { px: R.signEnd, nx: R.signEnd, pz: R.signSide, nz: R.signSide, py: R.dark });

  for (const wx of [WHEEL.x, -WHEEL.x]) {
    for (const wz of [WHEEL.z, -WHEEL.z]) {
      b.cylinder('z', [wx, WHEEL.r], wz - WHEEL.halfWidth, wz + WHEEL.halfWidth, WHEEL.r, WHEEL.r, WHEEL.segments, R.tread, R.hubcap, R.hubcap);
    }
  }
  return b.build();
}

// Side panel drawn with the rear at u = 0; `flip` mirrors the art for the right side, lettering stays readable
function side(ctx: CanvasRenderingContext2D, w: number, h: number, paint: string, flip: boolean) {
  ctx.save();
  if (flip) {
    ctx.translate(w, 0);
    ctx.scale(-1, 1);
  }
  fill(ctx, paint, 0, 0, w, h);
  fill(ctx, '#d8d8d8', 0, 0.26, w, 0.025); // chrome side moulding
  fill(ctx, '#2a2a2a', 0, 0.34, w, 0.06); // rocker
  ctx.strokeStyle = 'rgba(0,0,0,0.5)'; // 4 doors
  ctx.lineWidth = 0.008;
  for (const u of [0.5, 1.2, 1.9]) {
    ctx.beginPath();
    ctx.moveTo(u, 0);
    ctx.lineTo(u, 0.34);
    ctx.stroke();
  }
  for (const u of [1.05, 1.75]) fill(ctx, '#ddd', u, 0.08, 0.1, 0.02); // handles
  for (const u of [w / 2 - 0.8, w / 2 + 0.8]) circle(ctx, u, 0.35, 0.24, '#111'); // arches
  fill(ctx, '#ff9a1f', w - 0.05, 0.06, 0.05, 0.05); // front indicator
  fill(ctx, '#b0101e', 0, 0.06, 0.05, 0.08); // tail light wrap
  ctx.restore();
  // Door lettering, never mirrored
  text(ctx, '的士', 1.55, 0.17, 0.09, '#fff');
  text(ctx, 'TAXI', 0.85, 0.17, 0.08, '#fff');
}

const painters: Record<keyof typeof R, Painter> = {
  sideLeft: (ctx, w, h, paint) => side(ctx, w, h, paint, false),
  sideRight: (ctx, w, h, paint) => side(ctx, w, h, paint, true),
  sideCabin(ctx, w, h, paint) {
    fill(ctx, paint, 0, 0, w, h);
    // Window follows the trapezoid: left edge leans 0.15, right edge leans 0.15
    const left = (t: number) => 0.15 * (1 - t / h) + 0.05;
    const right = (t: number) => w - 0.15 * (1 - t / h) - 0.05;
    const [t0, t1] = [0.06, h - 0.13]; // the bottom 0.1 sits inside the body
    ctx.fillStyle = glass(ctx, t0, t1);
    ctx.beginPath();
    ctx.moveTo(left(t1), t1);
    ctx.lineTo(right(t1), t1);
    ctx.lineTo(right(t0), t0);
    ctx.lineTo(left(t0), t0);
    ctx.fill();
    fill(ctx, '#222', 0.68, 0, 0.05, h); // black B-pillar
    fill(ctx, '#c0c4c9', 0, 0, w, 0.03); // silver roof edge
  },
  top(ctx, w, h, paint) {
    fill(ctx, paint, 0, 0, w, h);
    ctx.strokeStyle = 'rgba(0,0,0,0.45)';
    ctx.lineWidth = 0.01;
    for (const u of [0.5, 1.8]) {
      ctx.beginPath();
      ctx.moveTo(u, 0.04);
      ctx.lineTo(u, h - 0.04);
      ctx.stroke();
    }
  },
  front(ctx, w, h, paint) {
    fill(ctx, paint, 0, 0, w, h);
    fill(ctx, '#c9ccd1', 0.28, 0.1, 0.34, 0.12); // chrome grille
    for (let y = 0.12; y < 0.22; y += 0.025) fill(ctx, '#555', 0.29, y, 0.32, 0.006);
    fill(ctx, '#fff6c8', 0.04, 0.09, 0.2, 0.1); // square headlights
    fill(ctx, '#fff6c8', 0.66, 0.09, 0.2, 0.1);
    fill(ctx, '#bfc3c8', 0, 0.28, w, 0.12); // chrome bumper
    fill(ctx, '#fff', 0.3, 0.3, 0.3, 0.08); // white front plate (HK)
    text(ctx, 'UV 2026', 0.45, 0.342, 0.055, '#111');
  },
  back(ctx, w, h, paint) {
    fill(ctx, paint, 0, 0, w, h);
    fill(ctx, '#b0101e', 0.03, 0.06, 0.18, 0.12); // tail lights
    fill(ctx, '#b0101e', 0.69, 0.06, 0.18, 0.12);
    fill(ctx, '#ffd200', 0.3, 0.16, 0.3, 0.09); // yellow rear plate (HK)
    text(ctx, 'UV 2026', 0.45, 0.207, 0.055, '#111');
    fill(ctx, '#bfc3c8', 0, 0.3, w, 0.1);
  },
  windshield(ctx, w, h) {
    fill(ctx, '#c0c4c9', 0, 0, w, h);
    fill(ctx, glass(ctx, 0, h), 0.05, 0.04, w - 0.1, h - 0.07);
  },
  rearWindow(ctx, w, h, paint) {
    painters.windshield(ctx, w, h, paint);
  },
  roof(ctx, w, h) {
    fill(ctx, '#c0c4c9', 0, 0, w, h); // HK urban taxis have a silver roof
  },
  signEnd(ctx, w, h) {
    fill(ctx, '#fafafa', 0, 0, w, h);
    fill(ctx, RED, 0, h - 0.015, w, 0.015);
    text(ctx, 'TAXI', w / 2, h / 2 - 0.005, 0.065, RED);
  },
  signSide(ctx, w, h) {
    fill(ctx, '#fafafa', 0, 0, w, h);
    text(ctx, '的士', w / 2, h / 2, 0.065, RED);
  },
  tread(ctx, w, h) {
    fill(ctx, '#1e1e1e', 0, 0, w, h);
    ctx.strokeStyle = '#0a0a0a';
    ctx.lineWidth = 0.012;
    for (let y = 0; y < h; y += 0.06) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w / 2, y + 0.03);
      ctx.lineTo(w, y);
      ctx.stroke();
    }
  },
  hubcap(ctx, w, h) {
    fill(ctx, '#1e1e1e', 0, 0, w, h);
    circle(ctx, w / 2, h / 2, 0.13, '#d5d8dd'); // plain steel wheel cover
    circle(ctx, w / 2, h / 2, 0.09, '#b4b8be');
    circle(ctx, w / 2, h / 2, 0.03, '#888');
  },
  bottom(ctx, w, h) {
    fill(ctx, '#111', 0, 0, w, h);
  },
  dark(ctx, w, h) {
    fill(ctx, '#333', 0, 0, w, h);
  },
};

export const hkTaxi: ModelDef = { id: 'hk-taxi', label: 'Hong Kong Taxi', paint: RED, cameraDistance: 3.6, regions: R, painters, build };
