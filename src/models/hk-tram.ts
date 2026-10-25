// Hong Kong double-decker tram #80 with the "The City of Charm 魅力之都" advert livery.
// Real-world size in metres: 12 m long, 2 m wide, body top 4.3 m. Front faces +x.
// Doors are on the kerb side (-z, the tram's left, because Hong Kong drives on the left).
import { Painter, region, glass, fill, text, circle } from './atlas';
import { Builder, V3 } from './builder';
import { ModelDef } from './types';

export const TRAM = {
  L: 6, // half length
  W: 1, // half width
  Y0: 0.45, // bottom of the body skirt
  YS: 4.3, // top of the body
  wheelR: 0.33,
  gauge: 1.067, // Hong Kong tram track gauge
  poleBase: [0.1, 4.68, 0] as V3,
  poleLength: 4.7,
  poleAngle: (15 * Math.PI) / 180,
};
// Tip of the trolley pole; the overhead wire must sit at this height
export const POLE_TIP: V3 = [
  TRAM.poleBase[0] - TRAM.poleLength * Math.cos(TRAM.poleAngle),
  TRAM.poleBase[1] + TRAM.poleLength * Math.sin(TRAM.poleAngle),
  0,
];

const SIDE_H = TRAM.YS - TRAM.Y0; // 3.85
const R = {
  sideRoad: region('side road', 0, 0, 1024, 328, [12, SIDE_H]),
  sideKerb: region('side kerb (doors)', 0, 332, 1024, 328, [12, SIDE_H]),
  front: region('front', 0, 664, 187, 360, [2, SIDE_H]),
  back: region('back', 191, 664, 187, 360, [2, SIDE_H]),
  roof: region('roof', 382, 664, 600, 100, [12, 2]),
  dest: region('route box', 382, 768, 160, 80, [0.8, 0.4]),
  louvre: region('louvre', 546, 768, 64, 64, [0.6, 0.6]),
  tread: region('wheel tread', 614, 768, 24, 116, [0.1, 2 * Math.PI * 0.33]),
  wheel: region('wheel', 642, 768, 100, 100, [0.66, 0.66]),
  dark: region('dark', 746, 768, 64, 64, [0.5, 0.5]),
  metal: region('metal', 814, 768, 64, 64, [0.5, 0.5]),
  lamp: region('lamp', 882, 768, 64, 64, [0.3, 0.3]),
};

const DARK_FACES = { px: R.dark, nx: R.dark, py: R.dark, ny: R.dark, pz: R.dark, nz: R.dark };

// Square rod between two points (trolley pole, A-frame legs)
function rod(b: Builder, p0: V3, p1: V3, s: number) {
  const d: V3 = [p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]];
  const len = Math.hypot(...d);
  const dn: V3 = [d[0] / len, d[1] / len, d[2] / len];
  // any vector not parallel to the rod
  const ref: V3 = Math.abs(dn[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0];
  const cr = (a: V3, c: V3): V3 => [a[1] * c[2] - a[2] * c[1], a[2] * c[0] - a[0] * c[2], a[0] * c[1] - a[1] * c[0]];
  const nrm = (v: V3): V3 => { const l = Math.hypot(...v); return [v[0] / l, v[1] / l, v[2] / l]; };
  const a = nrm(cr(dn, ref));
  const c = cr(dn, a);
  const off = (p: V3, i: number): V3 => {
    const sa = i === 0 || i === 3 ? s : -s;
    const sc = i < 2 ? s : -s;
    return [p[0] + a[0] * sa + c[0] * sc, p[1] + a[1] * sa + c[1] * sc, p[2] + a[2] * sa + c[2] * sc];
  };
  const mid: V3 = [(p0[0] + p1[0]) / 2, (p0[1] + p1[1]) / 2, (p0[2] + p1[2]) / 2];
  for (let i = 0; i < 4; i++) {
    const j = (i + 1) % 4;
    b.quad(off(p0, i), off(p0, j), off(p1, j), off(p1, i), R.dark, () => [0.5, 0.5], mid);
  }
}

function build() {
  const b = new Builder();
  const { L, W, Y0, YS } = TRAM;
  // Body shell: Builder.box maps each face so the artwork reads correctly from outside
  b.box(-L, L, Y0, YS, -W, W, { pz: R.sideRoad, nz: R.sideKerb, px: R.front, nx: R.back, ny: R.dark });
  // Roof rim (slightly wider) carrying the roof texture
  b.box(-L - 0.03, L + 0.03, YS, YS + 0.12, -W - 0.03, W + 0.03, { ...DARK_FACES, py: R.roof });
  const roofY = YS + 0.12;

  // Route number box at the front of the roof
  b.box(4.9, 5.7, roofY, roofY + 0.4, -0.45, 0.45, { px: R.dest, nx: R.louvre, py: R.metal, pz: R.louvre, nz: R.louvre });

  // Trolley base, turret and pole (raked back to the overhead wire), carbon head at the tip
  b.box(-0.4, 0.6, roofY, roofY + 0.1, -0.35, 0.35, DARK_FACES);
  b.cylinder('y', [0.1, 0], roofY + 0.1, roofY + 0.2, 0.22, 0.18, 16, R.dark, undefined, R.dark);
  rod(b, TRAM.poleBase, POLE_TIP, 0.035);
  b.box(POLE_TIP[0] - 0.12, POLE_TIP[0] + 0.12, POLE_TIP[1] - 0.06, POLE_TIP[1] + 0.02, -0.06, 0.06, DARK_FACES);
  // Rear A-frame hook that holds the pole when it is lowered
  for (const s of [-1, 1]) rod(b, [-4.6, roofY, s * 0.18], [-4.6, roofY + 0.45, 0], 0.02);

  // Headlight, bumpers, lifeguard trays
  b.cylinder('x', [1.0, 0], L, L + 0.07, 0.17, 0.17, 20, R.metal, undefined, R.lamp);
  for (const s of [1, -1]) {
    const x0 = s > 0 ? L : -L - 0.14;
    b.box(x0, x0 + 0.14, Y0, Y0 + 0.3, -W - 0.03, W + 0.03, DARK_FACES);
    const t0 = s > 0 ? L - 0.4 : -L;
    b.box(t0, t0 + 0.4, 0.12, Y0, -0.85, 0.85, DARK_FACES);
  }
  // Mirror on the kerb side, ahead of the front door
  b.box(L - 0.25, L - 0.1, 1.85, 2.15, -W - 0.28, -W, DARK_FACES);

  // Truck: two axles under the middle, wheels sit on the rails
  b.box(-2.0, 2.0, 0.2, Y0, -0.45, 0.45, DARK_FACES);
  for (const x of [-1.5, 1.5]) {
    for (const s of [1, -1]) {
      const z = (s * TRAM.gauge) / 2;
      b.cylinder('z', [x, TRAM.wheelR], z - 0.05, z + 0.05, TRAM.wheelR, TRAM.wheelR, 20, R.tread, R.wheel, R.wheel);
    }
  }
  return b.build();
}

// ---------------- Artwork ----------------
// Side panels: u 0..12 left to right as seen from outside, t = 4.3 - y (0 = top of the body).
// Bands: top 0..0.35, upper windows 0.35..1.3, between decks 1.3..2.0, lower windows 2.0..2.95, skirt 2.95..3.85.
const FRAME = '#b91c1c';

function windowPane(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, slider = true) {
  fill(ctx, FRAME, x - 0.04, y - 0.04, w + 0.08, h + 0.08);
  fill(ctx, '#d1d5db', x - 0.015, y - 0.015, w + 0.03, h + 0.03);
  fill(ctx, glass(ctx, y, y + h), x, y, w, h);
  if (slider) {
    fill(ctx, FRAME, x, y + h * 0.36, w, 0.05); // top-sliding window rail
    fill(ctx, '#e5e7eb', x, y + h * 0.36 + 0.015, w, 0.015);
  }
}

function cloud(ctx: CanvasRenderingContext2D, x: number, y: number, s: number) {
  for (const [dx, dy, r] of [[0, 0, 0.1], [0.1, -0.04, 0.13], [0.21, 0, 0.09]] as const) circle(ctx, x + dx * s, y + dy * s, r * s, '#fff');
  fill(ctx, '#fff', x - 0.04 * s, y, 0.28 * s, 0.08 * s);
}

function sideArt(ctx: CanvasRenderingContext2D, w: number, h: number, paint: string, kerb: boolean) {
  fill(ctx, paint, 0, 0, w, h);
  fill(ctx, '#141416', 0, 0, w, 0.05);

  // Blue glass skyscraper with perspective grid
  const g = ctx.createLinearGradient(0.6, 0, 3.4, h);
  g.addColorStop(0, '#1e3a8a');
  g.addColorStop(0.5, '#2563eb');
  g.addColorStop(1, '#1d4ed8');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.moveTo(0.6, 0.05); ctx.lineTo(2.9, 0.05); ctx.lineTo(3.45, 1.7); ctx.lineTo(3.45, h); ctx.lineTo(0.6, h);
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.45)';
  ctx.lineWidth = 0.02;
  for (let x = 0.8; x < 3.3; x += 0.3) { ctx.beginPath(); ctx.moveTo(x, 0.05); ctx.lineTo(x + 0.14, h); ctx.stroke(); }
  for (let y = 0.25; y < h; y += 0.35) { ctx.beginPath(); ctx.moveTo(0.6, y); ctx.lineTo(3.4, y - 0.2); ctx.stroke(); }
  // Trees on the left edge
  for (const t of [0.6, 1.3, 2.3, 3.1]) {
    circle(ctx, 0.3, t, 0.32, '#15803d');
    circle(ctx, 0.24, t - 0.06, 0.2, '#22c55e');
  }

  // "香港 HONG KONG" and the script slogan between the decks
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.45)';
  ctx.shadowBlur = 4; // shadow sizes are in pixels, not affected by the metre scale
  ctx.shadowOffsetX = 3;
  ctx.shadowOffsetY = 3;
  text(ctx, '香港 HONG KONG', 2.3, 1.66, 0.42, '#fff');
  ctx.restore();
  cloud(ctx, 4.6, 1.55, 1);
  cloud(ctx, 10.6, 1.48, 0.9);
  ctx.save();
  ctx.translate(7.2, 1.62);
  ctx.rotate(-0.04);
  ctx.fillStyle = '#fff';
  ctx.font = 'italic bold 0.34px "Dancing Script", Georgia, serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('The City of Charm', 0, 0);
  ctx.restore();
  text(ctx, '魅力之都', 9.3, 1.8, 0.22, '#fff');

  // Skirt: street shops, The Pawn (和昌大押), a red taxi and green tram #6
  fill(ctx, '#334155', 0.6, 2.95, 3.4, 0.9);
  fill(ctx, '#f59e0b', 1.2, 3.05, 0.7, 0.6);
  fill(ctx, '#dc2626', 2.1, 3.0, 0.5, 0.35);
  text(ctx, 'MORE >>', 2.9, 3.55, 0.12, '#fff');
  ctx.fillStyle = '#fde68a';
  ctx.strokeStyle = '#78350f';
  ctx.lineWidth = 0.025;
  ctx.beginPath();
  ctx.moveTo(4.2, 3.05); ctx.lineTo(4.7, 2.95); ctx.lineTo(7.6, 2.98); ctx.lineTo(7.6, h); ctx.lineTo(4.2, h);
  ctx.fill(); ctx.stroke();
  text(ctx, '押大昌和', 6.0, 3.12, 0.15, '#451a03');
  for (let x = 4.4; x < 7.4; x += 0.5) {
    fill(ctx, '#334155', x, 3.25, 0.32, 0.6);
    circle(ctx, x + 0.16, 3.25, 0.16, '#334155');
  }
  ctx.save();
  ctx.translate(3.55, 3.5);
  fill(ctx, '#dc2626', 0, 0.08, 0.55, 0.18);
  fill(ctx, '#f3f4f6', 0.08, 0, 0.38, 0.1);
  ctx.restore();
  fill(ctx, '#15803d', 8.2, 2.97, 1.8, 0.8);
  fill(ctx, '#111827', 8.3, 3.02, 0.7, 0.2);
  text(ctx, '6 筲箕灣', 8.65, 3.12, 0.1, '#fff');
  for (let x = 8.3; x < 9.9; x += 0.3) fill(ctx, '#dcfce7', x, 3.3, 0.2, 0.18);
  circle(ctx, 8.55, 3.65, 0.07, '#fef08a');
  // Road with yellow hatching along the bottom
  fill(ctx, '#1f2937', 0, h - 0.1, w, 0.1);
  ctx.strokeStyle = '#eab308';
  ctx.lineWidth = 0.03;
  for (let x = 0.5; x < w; x += 0.6) { ctx.beginPath(); ctx.moveTo(x, h); ctx.lineTo(x + 0.5, h - 0.1); ctx.stroke(); }

  // Fleet number at both ends
  text(ctx, '80', 0.35, 0.2, 0.16, '#fff');
  text(ctx, '80', w - 0.35, 0.2, 0.16, '#fff');

  // Upper deck: 10 windows
  const uw = (11.6 - 9 * 0.12) / 10;
  for (let i = 0; i < 10; i++) windowPane(ctx, 0.2 + i * (uw + 0.12), 0.35, uw, 0.95);
  // Lower deck: doors on the kerb side only (front exit at u 0..1.3, rear entrance at u 10.6..12)
  const [x0, x1, n] = kerb ? [1.5, 10.4, 7] : [0.6, 11.4, 8];
  const lw = (x1 - x0 - (n - 1) * 0.14) / n;
  for (let i = 0; i < n; i++) windowPane(ctx, x0 + i * (lw + 0.14), 2.0, lw, 0.95);
  if (kerb) {
    for (const dx of [0.2, 10.6]) {
      fill(ctx, '#18181b', dx, 1.85, 1.15, h - 1.85);
      fill(ctx, glass(ctx, 1.95, 3.5), dx + 0.08, 1.95, 0.46, 1.55);
      fill(ctx, glass(ctx, 1.95, 3.5), dx + 0.61, 1.95, 0.46, 1.55);
      fill(ctx, '#d1d5db', dx + 0.56, 1.95, 0.03, h - 1.95);
    }
  }
}

// Front / back: u 0..2 across the tram as seen from outside, t = 4.3 - y
function harbour(ctx: CanvasRenderingContext2D, w: number, h: number) {
  ctx.fillStyle = '#15803d';
  ctx.beginPath();
  ctx.moveTo(0, 3.05); ctx.quadraticCurveTo(0.45, 2.92, 1.0, 3.02); ctx.quadraticCurveTo(1.6, 2.93, w, 3.04);
  ctx.lineTo(w, 3.1); ctx.lineTo(0, 3.1);
  ctx.fill();
  const colors = ['#93c5fd', '#cbd5e1', '#fde68a', '#60a5fa', '#f1f5f9'];
  for (let i = 0; i < 18; i++) fill(ctx, colors[i % 5], 0.06 + i * 0.105, 3.06 - 0.04 - ((i * 17) % 9) * 0.01, 0.07, 0.05 + ((i * 17) % 9) * 0.01);
  const sea = ctx.createLinearGradient(0, 3.07, 0, 3.6);
  sea.addColorStop(0, '#0284c7');
  sea.addColorStop(1, '#1d4ed8');
  fill(ctx, sea, 0, 3.07, w, 0.53);
  // Star Ferry and a red-sail junk
  fill(ctx, '#047857', 0.2, 3.3, 0.45, 0.07);
  fill(ctx, '#fff', 0.26, 3.22, 0.33, 0.08);
  ctx.fillStyle = '#dc2626';
  for (const [x, hh] of [[1.45, 0.2], [1.58, 0.25], [1.7, 0.16]] as const) {
    ctx.beginPath(); ctx.moveTo(x, 3.32); ctx.quadraticCurveTo(x + 0.1, 3.32 - hh / 2, x, 3.32 - hh); ctx.fill();
  }
  fill(ctx, '#78350f', 1.38, 3.32, 0.42, 0.05);
  fill(ctx, '#eab308', 0, 3.6, w, 0.12);
  // Bumper with the white "smile"
  fill(ctx, '#16171a', 0, h - 0.13, w, 0.13);
  ctx.strokeStyle = '#e5e7eb';
  ctx.lineWidth = 0.025;
  ctx.beginPath(); ctx.moveTo(0.4, h - 0.1); ctx.quadraticCurveTo(1.0, h, 1.6, h - 0.1); ctx.stroke();
}

function endArt(ctx: CanvasRenderingContext2D, w: number, h: number, paint: string, front: boolean) {
  fill(ctx, paint, 0, 0, w, h);
  fill(ctx, '#141416', 0, 0, w, 0.05);
  text(ctx, '80', 0.2, 0.2, 0.15, '#fff');
  text(ctx, '80', w - 0.2, 0.2, 0.15, '#fff');
  for (const [x0, x1] of [[0.1, 0.55], [0.65, 1.35], [1.45, 1.9]]) windowPane(ctx, x0, 0.35, x1 - x0, 0.95, false);
  for (const [x0, x1] of [[0.1, 0.55], [0.65, 1.35], [1.45, 1.9]]) windowPane(ctx, x0, 2.0, x1 - x0, 0.9, false);
  text(ctx, '香', 0.25, 1.66, 0.36, '#fff');
  text(ctx, '港', w - 0.25, 1.66, 0.36, '#fff');
  if (front) {
    // Blue destination plate "Western Market 上環 (西港城)"
    fill(ctx, '#fbbf24', 0.5, 1.38, 1.0, 0.52);
    fill(ctx, '#1a2342', 0.52, 1.4, 0.96, 0.48);
    text(ctx, 'Western Market', 1.0, 1.52, 0.1, '#fde047');
    text(ctx, '上環 (西港城)', 1.0, 1.72, 0.12, '#fde047');
  } else {
    text(ctx, 'HONG', 1.0, 1.52, 0.17, '#fff');
    text(ctx, 'KONG', 1.0, 1.76, 0.17, '#fff');
  }
  harbour(ctx, w, h);
  if (front) {
    circle(ctx, 1.0, 3.3, 0.2, '#d4d8dd'); // headlight bezel (the 3D lamp sits on top)
    circle(ctx, 1.0, 3.3, 0.15, '#fef9c3');
    text(ctx, '80', 1.82, h - 0.07, 0.1, '#fff');
  } else {
    for (const x of [0.2, w - 0.2]) circle(ctx, x, 3.3, 0.09, '#dc2626'); // tail lights
  }
}

const painters: Record<keyof typeof R, Painter> = {
  sideRoad: (ctx, w, h, paint) => sideArt(ctx, w, h, paint, false),
  sideKerb: (ctx, w, h, paint) => sideArt(ctx, w, h, paint, true),
  front: (ctx, w, h, paint) => endArt(ctx, w, h, paint, true),
  back: (ctx, w, h, paint) => endArt(ctx, w, h, paint, false),
  roof(ctx, w, h, paint) {
    fill(ctx, paint, 0, 0, w, h);
    fill(ctx, 'rgba(0,0,0,0.25)', 0, 0, w, 0.08);
    fill(ctx, 'rgba(0,0,0,0.25)', 0, h - 0.08, w, 0.08);
    for (const x of [1.6, 4.0, 8.0, 10.4]) fill(ctx, '#9ca3af', x, 0.6, 0.8, 0.8); // roof vents
  },
  dest(ctx, w, h) {
    fill(ctx, '#0b1020', 0, 0, w, h);
    text(ctx, '80', 0.17, h / 2, 0.26, '#fff');
    text(ctx, '上環 (西港城)', 0.55, 0.15, 0.08, '#fde047');
    text(ctx, 'Western Market', 0.55, 0.28, 0.055, '#fff');
  },
  louvre(ctx, w, h) {
    fill(ctx, '#c9ced6', 0, 0, w, h);
    for (let y = 0.05; y < h; y += 0.08) fill(ctx, '#2a2d33', 0.05, y, w - 0.1, 0.03);
  },
  tread(ctx, w, h) {
    fill(ctx, '#aeb4bc', 0, 0, w, h);
  },
  wheel(ctx, w, h) {
    fill(ctx, '#2a2d33', 0, 0, w, h);
    circle(ctx, w / 2, h / 2, 0.32, '#b8bec6');
    circle(ctx, w / 2, h / 2, 0.22, '#7a8089');
    circle(ctx, w / 2, h / 2, 0.08, '#2a2d33');
  },
  dark(ctx, w, h) {
    fill(ctx, '#16171a', 0, 0, w, h);
  },
  metal(ctx, w, h) {
    fill(ctx, '#d4d8dd', 0, 0, w, h);
  },
  lamp(ctx, w, h) {
    fill(ctx, '#fffbe0', 0, 0, w, h);
  },
};

export const hkTram: ModelDef = { id: 'hk-tram', label: 'Hong Kong Tram #80', paint: '#c8141e', cameraDistance: 22, regions: R, painters, build };
