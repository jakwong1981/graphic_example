// Ship: box hull with a wedge bow, superstructure, bridge and funnel. Bow faces +x.
import { Painter, region, fill, text, circle } from './atlas';
import { Builder, V3 } from './builder';
import { ModelDef } from './types';

const HULL = { x: 1.4, y: 0.35, z: 0.35, bowTip: 1.9, keelTip: 1.75 };

const R = {
  hullSide: region('hull side', 0, 0, 1024, 128, [2.8, 0.35]),
  bow: region('bow', 0, 132, 146, 102, [0.5, 0.35]),
  stern: region('stern', 150, 132, 205, 102, [0.7, 0.35]),
  cabin: region('cabin', 360, 132, 256, 102, [1.0, 0.4]),
  cabinEnd: region('cabin end', 620, 132, 128, 102, [0.5, 0.4]),
  bridge: region('bridge', 752, 132, 245, 102, [0.6, 0.25]),
  deck: region('deck', 0, 240, 1024, 256, [2.8, 0.7]),
  funnel: region('funnel', 0, 500, 102, 184, [0.35, 0.63]), // s = up the funnel, t = around
  dark: region('dark', 190, 500, 128, 128, [0.5, 0.5]),
};

function build() {
  const b = new Builder();
  const { x: X, y: Y, z: Z } = HULL;
  b.box(-X, X, 0, Y, -Z, Z, { pz: R.hullSide, nz: R.hullSide, nx: R.stern, py: R.deck, ny: R.dark });

  // Bow wedge: deck edge -> tip at deck level, keel slopes back from the tip
  const c: V3 = [1.6, Y / 2, 0];
  const tip: V3 = [HULL.bowTip, Y, 0];
  const keel: V3 = [HULL.keelTip, 0, 0];
  const bowUV = (p: V3): [number, number] => [(p[0] - X) / (HULL.bowTip - X), (Y - p[1]) / Y];
  for (const s of [1, -1]) {
    b.quad([X, 0, s * Z], keel, tip, [X, Y, s * Z], R.bow, bowUV, c);
  }
  const deckUV = (p: V3): [number, number] => [0.85 + (p[0] - X) / 5.6, (p[2] + Z) / (2 * Z)];
  b.tri([X, Y, Z], [X, Y, -Z], tip, R.deck, deckUV, c);
  b.tri([X, 0, Z], [X, 0, -Z], keel, R.dark, () => [0.5, 0.5], c);

  // Superstructure, bridge on top, funnel on top of the bridge
  b.box(-0.9, 0.1, Y, Y + 0.4, -0.25, 0.25, { pz: R.cabin, nz: R.cabin, px: R.cabinEnd, nx: R.cabinEnd, py: R.dark });
  b.box(-0.7, -0.1, Y + 0.4, Y + 0.65, -0.2, 0.2, { pz: R.bridge, nz: R.bridge, px: R.bridge, nx: R.bridge, py: R.dark });
  b.cylinder('y', [-0.55, 0], Y + 0.65, Y + 1.0, 0.1, 0.09, 20, R.funnel, undefined, R.dark);
  return b.build();
}

function hullColors(ctx: CanvasRenderingContext2D, w: number, paint: string) {
  fill(ctx, paint, 0, 0, w, 0.2); // topsides
  fill(ctx, '#f2f2f2', 0, 0.2, w, 0.02); // boot stripe
  fill(ctx, '#8b1e1e', 0, 0.22, w, 0.13); // antifouling below the waterline
}

const painters: Record<keyof typeof R, Painter> = {
  hullSide(ctx, w, _h, paint) {
    hullColors(ctx, w, paint);
    for (let x = 0.2; x < w - 0.1; x += 0.15) circle(ctx, x, 0.1, 0.022, '#cfe3f5'); // portholes
    text(ctx, 'UV MARU', w / 2, 0.045, 0.06, '#fff');
  },
  bow(ctx, w, _h, paint) {
    hullColors(ctx, w, paint);
  },
  stern(ctx, w, _h, paint) {
    hullColors(ctx, w, paint);
    text(ctx, 'UV MARU', w / 2, 0.1, 0.06, '#fff');
  },
  deck(ctx, w, h) {
    fill(ctx, '#b98b55', 0, 0, w, h);
    ctx.strokeStyle = 'rgba(70,40,15,0.6)'; // planks run along the ship
    ctx.lineWidth = 0.004;
    for (let y = 0.05; y < h; y += 0.05) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.stroke();
    }
    for (let x = 0.3; x < w; x += 0.6) fill(ctx, 'rgba(70,40,15,0.6)', x, 0, 0.004, h);
  },
  cabin(ctx, w, h) {
    fill(ctx, '#f4f4f4', 0, 0, w, h);
    for (let x = 0.06; x < w - 0.1; x += 0.13) fill(ctx, '#23415f', x, 0.1, 0.09, 0.1);
    fill(ctx, '#c9c9c9', 0, h - 0.03, w, 0.03);
  },
  cabinEnd(ctx, w, h) {
    fill(ctx, '#f4f4f4', 0, 0, w, h);
    fill(ctx, '#23415f', 0.1, 0.1, 0.12, 0.1);
    fill(ctx, '#23415f', 0.28, 0.1, 0.12, 0.1);
    fill(ctx, '#888', 0.2, 0.22, 0.1, 0.18); // door
  },
  bridge(ctx, w, h) {
    fill(ctx, '#f4f4f4', 0, 0, w, h);
    fill(ctx, '#1b3550', 0.03, 0.05, w - 0.06, 0.1); // wraparound windows
  },
  funnel(ctx, w, h, paint) {
    fill(ctx, paint, 0, 0, 0.22, h); // s = height up the funnel
    fill(ctx, '#f2f2f2', 0.22, 0, 0.05, h);
    fill(ctx, '#151515', 0.27, 0, w - 0.27, h);
  },
  dark(ctx, w, h) {
    fill(ctx, '#3a3d42', 0, 0, w, h);
  },
};

export const ship: ModelDef = { id: 'ship', label: 'Ship', paint: '#1f3f73', cameraDistance: 4.6, regions: R, painters, build };
