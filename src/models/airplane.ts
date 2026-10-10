// Airplane: cylinder fuselage with nose and tail cones, box wings and tail, two engines. Nose faces +x.
import { Painter, region, fill, text, circle } from './atlas';
import { Builder } from './builder';
import { ModelDef } from './types';

const FUSE = { x0: -1.2, x1: 1.0, r: 0.18, y: 0.6 };
const CIRC = 2 * Math.PI * FUSE.r; // 1.13

const R = {
  fuselage: region('fuselage', 0, 0, 512, 263, [2.2, CIRC]), // s = along the plane, t = around (0 = top)
  nose: region('nose', 520, 0, 93, 263, [0.4, CIRC]),
  tail: region('tail cone', 620, 0, 93, 263, [0.4, CIRC]),
  wing: region('wing', 0, 270, 92, 512, [0.5, 2.8]), // s = chord (rear -> front), t = span
  fin: region('fin', 100, 270, 154, 256, [0.3, 0.5]),
  engine: region('engine', 260, 270, 233, 256, [0.4, 0.44]),
  intake: region('intake', 500, 270, 128, 128, [0.14, 0.14]),
  dark: region('dark', 640, 270, 64, 64, [0.5, 0.5]),
};

function build() {
  const b = new Builder();
  const { x0, x1, r, y } = FUSE;
  b.cylinder('x', [y, 0], x0, x1, r, r, 32, R.fuselage);
  b.cylinder('x', [y, 0], x1, x1 + 0.4, r, 0, 32, R.nose);
  b.cylinder('x', [y, 0], x0, x0 - 0.4, r, 0.04, 32, R.tail, undefined, R.dark);
  // Main wings (one box through the fuselage), horizontal stabilizer, vertical fin
  b.box(-0.2, 0.3, y - 0.07, y - 0.03, -1.4, 1.4, { py: R.wing, ny: R.wing, px: R.dark, nx: R.dark, pz: R.dark, nz: R.dark });
  b.box(-1.55, -1.3, y + 0.02, y + 0.05, -0.5, 0.5, { py: R.wing, ny: R.wing, px: R.dark, nx: R.dark, pz: R.dark, nz: R.dark });
  b.box(-1.6, -1.3, y + 0.1, y + 0.6, -0.02, 0.02, { pz: R.fin, nz: R.fin, px: R.dark, nx: R.dark, py: R.dark });
  // Engines under the wings; the front cap is the fan intake
  for (const z of [0.6, -0.6]) b.cylinder('x', [y - 0.15, z], -0.05, 0.35, 0.07, 0.07, 20, R.engine, R.dark, R.intake);
  return b.build();
}

const painters: Record<keyof typeof R, Painter> = {
  fuselage(ctx, w, h, paint) {
    fill(ctx, '#f5f6f8', 0, 0, w, h);
    fill(ctx, '#c7ccd3', 0, 0.42, w, 0.29); // belly, around t = 0.5
    // Sides sit at t = 1/4 (+z) and 3/4 (-z) of the circumference
    for (const side of [h / 4, (3 * h) / 4]) {
      fill(ctx, paint, 0, side + 0.03, w, 0.025); // cheat line
      for (let x = 0.15; x < w - 0.05; x += 0.07) fill(ctx, '#20324a', x, side - 0.035, 0.035, 0.03); // windows
      fill(ctx, '#9aa1ab', w - 0.25, side - 0.06, 0.07, 0.12); // front door
    }
    text(ctx, 'UV AIR', w / 2, 0.06, 0.08, paint); // on the crown, readable from above
  },
  nose(ctx, w, h) {
    fill(ctx, '#f5f6f8', 0, 0, w, h);
    // Cockpit windows: just ahead of the fuselage, upper sides
    for (const t of [0.12, h - 0.2]) fill(ctx, '#20324a', 0.03, t, 0.1, 0.08);
    fill(ctx, '#9aa1ab', w - 0.06, 0, 0.06, h); // radome tip
  },
  tail(ctx, w, h) {
    fill(ctx, '#f5f6f8', 0, 0, w, h);
    fill(ctx, '#c7ccd3', 0, 0.42, w, 0.29);
  },
  wing(ctx, w, h, paint) {
    fill(ctx, '#cdd2d9', 0, 0, w, h);
    fill(ctx, '#b4bac3', 0, 0, 0.12, h); // flaps along the trailing edge
    ctx.strokeStyle = '#8e959f';
    ctx.lineWidth = 0.006;
    for (let t = 0.2; t < h; t += 0.4) {
      ctx.beginPath();
      ctx.moveTo(0, t);
      ctx.lineTo(0.12, t);
      ctx.stroke();
    }
    fill(ctx, paint, 0, 0, w, 0.08); // painted wingtips
    fill(ctx, paint, 0, h - 0.08, w, 0.08);
  },
  fin(ctx, w, h, paint) {
    fill(ctx, paint, 0, 0, w, h);
    circle(ctx, w / 2, h * 0.4, 0.09, '#fff');
    text(ctx, 'UV', w / 2, h * 0.4 + 0.005, 0.08, paint);
  },
  engine(ctx, w, h, paint) {
    fill(ctx, '#d9dde3', 0, 0, w, h);
    fill(ctx, paint, w - 0.08, 0, 0.04, h); // band near the intake (s = 1 is the front)
  },
  intake(ctx, w, h) {
    fill(ctx, '#2c2f34', 0, 0, w, h);
    circle(ctx, w / 2, h / 2, 0.06, '#5d636b');
    ctx.strokeStyle = '#2c2f34'; // fan blades
    ctx.lineWidth = 0.006;
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      ctx.beginPath();
      ctx.moveTo(w / 2, h / 2);
      ctx.lineTo(w / 2 + Math.cos(a) * 0.06, h / 2 + Math.sin(a) * 0.06);
      ctx.stroke();
    }
    circle(ctx, w / 2, h / 2, 0.015, '#ddd');
  },
  dark(ctx, w, h) {
    fill(ctx, '#7a8089', 0, 0, w, h);
  },
};

export const airplane: ModelDef = { id: 'airplane', label: 'Airplane', paint: '#1d6fd1', cameraDistance: 5, regions: R, painters, build };
