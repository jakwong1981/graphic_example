// Hong Kong tram street (think Johnston Road, Wan Chai): two tram tracks with overhead wires,
// road lanes, pavements lined with sakura trees, tong lau shophouses with neon signs,
// The Pawn (和昌大押), towers behind, the Bank of China Tower and the Peak in the distance.
// Street runs along x; tram tracks at z = -2.1 (eastbound, +x) and z = +2.1 (westbound).
import { V3, mulberry32 } from '../sim/math';
import { CityBuilder } from '../sim/city-builder';
import { MaterialName } from '../sim/city-textures';
import type { MeshData } from '../webgl/mesh';
import { SIGNS, SIGN_ATLAS, signSlot } from './signs';
import { TRAM, POLE_TIP } from '../models/hk-tram';
import { buildSakura } from './sakura';
import { storefrontUV, pickShop, isShutter, SEAFOOD_SHOP } from './storefronts';

export const STREET_HALF = 240; // street spans x -240..240
export const TRACKS = [-2.1, 2.1];
export const LANES = [-5.2, 5.2]; // car lanes: eastbound on the -z side (keep left), westbound on +z
export const RAIL_TOP = 0.04;
export const WIRE_Y = RAIL_TOP + POLE_TIP[1];
const ROAD = 7; // road half width
const KERB = 11; // building frontage

export interface Street {
  batches: Map<MaterialName, MeshData>;
  blossoms: [number, number, number, number][]; // canopy x, y, z, radius: petals fall from here
  lamps: V3[]; // light position under each street lamp head
}

export function buildStreet(seed = 1904): Street {
  const rnd = mulberry32(seed);
  const b = new CityBuilder();
  const range = (lo: number, hi: number) => lo + rnd() * (hi - lo);
  const pick = <T>(a: T[]) => a[Math.floor(rnd() * a.length)];
  const S = STREET_HALF;
  const flatRect = (m: MaterialName, x0: number, x1: number, z0: number, z1: number, y: number) =>
    b.flat(m, [[x0, y, z0], [x1, y, z0], [x1, y, z1], [x0, y, z1]], [(x0 + x1) / 2, y - 1, (z0 + z1) / 2]);

  // ---- Ground, road, tracks, markings, pavements ----
  // The whole scene is periodic in x with period 2S and is drawn three times side by side,
  // so nothing may extend past x = +-S except where it overlaps the neighbouring copy harmlessly.
  flatRect('concrete', -S, S, -1500, 1500, -0.03);
  flatRect('asphalt', -S, S, -ROAD, ROAD, 0);
  for (const c of TRACKS) {
    flatRect('trackbed', -S, S, c - 1.0, c + 1.0, 0.006);
    for (const s of [-1, 1]) {
      const z = c + (s * TRAM.gauge) / 2;
      b.box(-S, S, 0, RAIL_TOP, z - 0.035, z + 0.035, 'steel', 'steel', false);
    }
  }
  for (const s of [-1, 1]) {
    // dashed white lane edge next to the tram tracks, double yellow line along the kerb
    for (let x = -S; x < S; x += 9) flatRect('white', x, x + 4.5, s * 3.45 - 0.08, s * 3.45 + 0.08, 0.01);
    for (const z of [6.55, 6.8]) flatRect('yellow', -S, S, s * z - 0.06, s * z + 0.06, 0.01);
    const [z0, z1] = s > 0 ? [ROAD, KERB] : [-KERB, -ROAD];
    b.box(-S, S, -0.03, 0.15, z0, z1, 'concrete', 'paving', false);
  }

  // ---- Signs: double-sided panels with explicit atlas UVs ----
  const slotUV = (i: number, s: number, t: number): [number, number] => {
    const r = signSlot(i);
    return [(r.x + s * r.w) / SIGN_ATLAS, (r.y + t * r.h) / SIGN_ATLAS];
  };
  const EDGE: [number, number] = [1020 / SIGN_ATLAS, 1020 / SIGN_ATLAS];
  // Hanging sign in the plane x = const, sticking out from the facade over the pavement
  const hangingSign = (i: number, x: number, z0: number, z1: number, y0: number, y1: number) => {
    const c: V3 = [x, (y0 + y1) / 2, (z0 + z1) / 2];
    const d = 0.06;
    for (const sx of [1, -1]) {
      const xf = x + sx * d;
      // viewer looking along -sx*x: right is -sx*z, so s grows towards that side
      const s = (z: number) => (sx > 0 ? (z1 - z) / (z1 - z0) : (z - z0) / (z1 - z0));
      const t = (y: number) => (y1 - y) / (y1 - y0);
      const P = (z: number, y: number): V3 => [xf, y, z];
      b.quad('signs', P(z0, y0), P(z1, y0), P(z1, y1), P(z0, y1),
        slotUV(i, s(z0), t(y0)), slotUV(i, s(z1), t(y0)), slotUV(i, s(z1), t(y1)), slotUV(i, s(z0), t(y1)), c);
    }
    // edges
    const e = (a: V3, b2: V3, c2: V3, d2: V3) => b.quad('signs', a, b2, c2, d2, EDGE, EDGE, EDGE, EDGE, c);
    e([x - d, y1, z0], [x + d, y1, z0], [x + d, y1, z1], [x - d, y1, z1]);
    e([x - d, y0, z0], [x + d, y0, z0], [x + d, y0, z1], [x - d, y0, z1]);
    for (const z of [z0, z1]) e([x - d, y0, z], [x + d, y0, z], [x + d, y1, z], [x - d, y1, z]);
  };
  // Sign flat on a facade facing the street (facing = -1: faces -z, +1: faces +z)
  const wallSign = (i: number, x0: number, x1: number, y0: number, y1: number, z: number, facing: number) => {
    // facing -z: the viewer looks along +z and their right is -x
    const s = (x: number) => (facing < 0 ? (x1 - x) / (x1 - x0) : (x - x0) / (x1 - x0));
    const t = (y: number) => (y1 - y) / (y1 - y0);
    const P = (x: number, y: number): V3 => [x, y, z];
    b.quad('signs', P(x0, y0), P(x1, y0), P(x1, y1), P(x0, y1),
      slotUV(i, s(x0), t(y0)), slotUV(i, s(x1), t(y0)), slotUV(i, s(x1), t(y1)), slotUV(i, s(x0), t(y1)), [(x0 + x1) / 2, (y0 + y1) / 2, z - facing]);
  };
  const horizontal = SIGNS.map((s, i) => (s.vertical ? -1 : i)).filter((i) => i >= 0 && i !== 2);
  const vertical = SIGNS.map((s, i) => (s.vertical ? i : -1)).filter((i) => i > 8);

  // ---- Tree positions: every 16-22 m, clear of the tram poles and the landmark verandas ----
  const poleGap = (x: number) => { const m = (((x + S - 15) % 30) + 30) % 30; return Math.min(m, 30 - m); };
  const treeXs = new Map<number, number[]>();
  for (const side of [-1, 1]) {
    const xs: number[] = [];
    for (let x = -S + 10; x < S - 10; x += range(16, 22)) {
      if (poleGap(x) < 4) continue;
      if (side > 0 && ((x > -38 && x < -16) || (x > 14 && x < 38))) continue; // The Pawn / neon shophouse signs
      xs.push(x);
    }
    treeXs.set(side, xs);
  }
  const nearTree = (side: number, x: number, r = 5) => treeXs.get(side)!.some((t) => Math.abs(t - x) < r);

  // ---- Storefronts: one atlas slot per shop unit, laid just in front of the ground-floor box ----
  // Own random stream, so the building layout stays the same as before shops were added
  const srnd = mulberry32(seed + 101);
  const AWNINGS: V3[] = [[0.85, 0.16, 0.16], [0.2, 0.45, 0.8], [0.12, 0.55, 0.3], [0.95, 0.62, 0.12], [0.55, 0.22, 0.6], [0.92, 0.92, 0.9]];
  // Shop facade quad in the plane z = const (facing = -1: faces -z, +1: faces +z)
  const storefront = (i: number, x0: number, x1: number, y0: number, y1: number, z: number, facing: number) => {
    const s = (x: number) => (facing < 0 ? (x1 - x) / (x1 - x0) : (x - x0) / (x1 - x0));
    const t = (y: number) => (y1 - y) / (y1 - y0);
    const P = (x: number, y: number): V3 => [x, y, z];
    const uv = (x: number, y: number) => storefrontUV(i, s(x), t(y));
    b.quad('storefront', P(x0, y0), P(x1, y0), P(x1, y1), P(x0, y1),
      uv(x0, y0), uv(x1, y0), uv(x1, y1), uv(x0, y1), [(x0 + x1) / 2, (y0 + y1) / 2, z - facing]);
  };
  // Sloped canvas awning over a shop, with a valance along the outer edge (both faces, tinted)
  const awning = (x0: number, x1: number, side: number, tint: V3) => {
    const zw = side * (KERB - 0.05);
    const zo = side * (KERB - 1.5);
    const [yw, yo, drop] = [3.8, 3.35, 0.32];
    const w = x1 - x0;
    const A: V3 = [x0, yw, zw], B: V3 = [x1, yw, zw], C: V3 = [x1, yo, zo], D: V3 = [x0, yo, zo];
    const E: V3 = [x1, yo - drop, zo], F: V3 = [x0, yo - drop, zo];
    for (const s of [1, -1]) {
      const over: V3 = [(x0 + x1) / 2, (yw + yo) / 2 - s, (zw + zo) / 2];
      b.tri('awning', A, B, C, [0, 0], [w, 0], [w, 1.5], over, tint);
      b.tri('awning', A, C, D, [0, 0], [w, 1.5], [0, 1.5], over, tint);
      const front: V3 = [(x0 + x1) / 2, yo - drop / 2, zo + s];
      b.tri('awning', D, C, E, [0, 0], [w, 0], [w, drop], front, tint);
      b.tri('awning', D, E, F, [0, 0], [w, drop], [0, drop], front, tint);
    }
  };
  // A row of shop units along a lot frontage
  const shopRow = (x0: number, x1: number, side: number) => {
    const n = Math.max(1, Math.round((x1 - x0) / 4.5));
    const w = (x1 - x0) / n;
    const z = side * (KERB - 0.03);
    for (let k = 0; k < n; k++) {
      const a = x0 + k * w + 0.18;
      const e = x0 + (k + 1) * w - 0.18;
      const i = pickShop(srnd);
      storefront(i, a, e, 0.15, 4.4, z, -side);
      const wantAwning = srnd() < 0.45;
      const tint = AWNINGS[Math.floor(srnd() * AWNINGS.length)];
      // awnings would poke into the sakura canopies
      if (wantAwning && !isShutter(i) && !nearTree(side, (a + e) / 2, 4.2 + (e - a) / 2)) awning(a, e, side, tint);
    }
  };

  // ---- Buildings ----
  const PASTEL: V3[] = [[1, 1, 1], [1.05, 0.9, 0.82], [0.88, 1.0, 0.92], [0.85, 0.92, 1.05], [1.05, 0.98, 0.78], [1.0, 0.86, 0.9], [0.8, 0.8, 0.82]];
  const tint = (c: V3) => { const k = range(0.92, 1.05); b.color = [c[0] * k, c[1] * k, c[2] * k]; };
  // A lot spans x0..x1; `side` = +1 south (z > 0), -1 north; front at |z| = KERB
  const zSpan = (side: number, depth: number, front = KERB): [number, number] => (side > 0 ? [front, front + depth] : [-front - depth, -front]);

  const tongLau = (x0: number, x1: number, side: number, floors: number) => {
    const [z0, z1] = zSpan(side, range(12, 16));
    b.color = [1, 1, 1];
    b.box(x0, x1, 0, 4.5, z0, z1, 'shopfront', null, false);
    shopRow(x0, x1, side);
    tint(pick(PASTEL));
    b.box(x0, x1, 4.5, 4.5 + floors * 3.5, z0, z1, 'tonglau', 'roof', false);
    b.color = [1, 1, 1];
    b.box(x0 + 1, x0 + 3, 4.5 + floors * 3.5, 4.5 + floors * 3.5 + 2.5, z0 + 2, z0 + 5, 'concrete', 'roof', false); // stair hood
    // Hanging sign over the pavement
    const x = range(x0 + 1.5, x1 - 1.5);
    if (rnd() < 0.65 && !nearTree(side, x)) { // signs would poke through the canopy
      const front = side * KERB;
      const y = range(5, 4.5 + floors * 3.5 - 2.5);
      if (rnd() < 0.5) hangingSign(pick(horizontal), x, side > 0 ? front - 2.4 : front, side > 0 ? front : front + 2.4, y, y + 1.2);
      else hangingSign(pick(vertical), x, side > 0 ? front - 1.0 : front, side > 0 ? front : front + 1.0, y, y + 2.0);
    }
  };

  const tower = (x0: number, x1: number, side: number) => {
    const [z0, z1] = zSpan(side, range(16, 24));
    b.color = [1, 1, 1];
    b.box(x0, x1, 0, 6, z0, z1, 'shopfront', 'roof', false);
    shopRow(x0, x1, side);
    tint(pick(PASTEL));
    const inset = 1.5;
    const [tz0, tz1] = side > 0 ? [z0 + inset + 2, z1 - inset] : [z0 + inset, z1 - inset - 2];
    b.box(x0 + inset, x1 - inset, 6, range(45, 110), tz0, tz1, pick(['residential', 'residential2', 'office', 'glass'] as MaterialName[]), 'roof', false);
  };

  // The Pawn (和昌大押): four-storey veranda building with a ground-floor arcade over the pavement
  const thePawn = (x0: number, x1: number) => {
    b.color = [1, 1, 1];
    const H = 16;
    b.box(x0, x1, 0, H, 13.5, 26, 'pawn', 'roof', false);
    b.box(x0, x1, 0, 4.5, 13.2, 13.5, 'shopfront', null, false);
    const mid = (x0 + x1) / 2; // restaurant behind the arcade
    storefront(SEAFOOD_SHOP, x0 + 0.4, mid - 0.1, 0.15, 4.4, 13.17, -1);
    storefront(SEAFOOD_SHOP, mid + 0.1, x1 - 0.4, 0.15, 4.4, 13.17, -1);
    b.box(x0, x1, 4.5, H, 9, 13.5, 'pawn', 'roof', false); // verandas above the arcade
    for (let x = x0 + 0.3; x < x1; x += (x1 - x0 - 0.6) / 5) b.box(x, x + 0.6, 0.15, 4.5, 9, 9.6, 'pawn', null, false); // arcade pillars
    for (const y of [4.5, 8.1, 11.7]) b.box(x0 - 0.2, x1 + 0.2, y - 0.25, y, 8.8, 13.5, 'concrete', 'concrete', false); // cornices
    b.box(x0, x1, H, H + 0.9, 9, 13.5, 'pawn', 'roof', false); // parapet
    wallSign(2, x0 + 3, x1 - 3, H - 0.1, H + 0.85, 8.98, -1); // 和昌大押 plaque
    hangingSign(8, x0 + 1.2, 7.6, 8.9, 5.5, 8.0); // red bat-shaped 押 sign
  };

  // Neon shophouse with the cafe and cha chaan teng signs
  const neonShophouse = (x0: number, x1: number) => {
    tongLau(x0, x1, 1, 7);
    hangingSign(0, x0 + 3, KERB - 2.8, KERB, 6.0, 7.4);
    hangingSign(1, x1 - 3, KERB - 3.0, KERB, 9.0, 10.5);
    hangingSign(9, (x0 + x1) / 2, KERB - 1.0, KERB, 12.5, 14.5);
  };

  for (const side of [-1, 1]) {
    // Landmarks reserved on the south side, near the middle of the street
    const reserved: [number, number, (a: number, b: number) => void][] =
      side > 0 ? [[-34, -20, neonShophouse], [18, 34, thePawn]] : [];
    for (let x = -S; x < S; ) {
      const here = reserved.find(([a, e]) => x >= a && x < e);
      if (here) { here[2](here[0], here[1]); x = here[1]; continue; }
      const next = reserved.find(([a]) => a > x);
      const limit = next ? next[0] : S;
      if (rnd() < 0.08) { x = Math.min(limit, x + 10); continue; } // side street
      const x1 = Math.min(limit, x + range(7, 13));
      if (x1 - x >= 4) {
        if (rnd() < 0.18) tower(x, x1, side);
        else tongLau(x, x1, side, 3 + Math.floor(rnd() * 6));
      }
      x = x1;
    }
  }

  // Towers further back give the HK skyline
  b.color = [1, 1, 1];
  for (let i = 0; i < 220; i++) {
    const side = rnd() < 0.5 ? -1 : 1;
    const cx = range(-S, S); // the neighbouring copies continue the skyline
    const cz = side * range(40, 260);
    const h = range(40, 170) * (1 - Math.abs(cz) / 600);
    tint(pick(PASTEL));
    if (rnd() < 0.25) b.prism(cx, cz, range(10, 16), 0, h, pick([6, 8, 24]), pick(['glass', 'office'] as MaterialName[]), 'roof', { collide: false, rot: rnd() });
    else {
      const hw = range(8, 16), hd = range(8, 16);
      b.box(cx - hw, cx + hw, 0, h, cz - hd, cz + hd, pick(['residential', 'residential2', 'office', 'glass'] as MaterialName[]), 'roof', false);
    }
  }

  // Bank of China Tower: a square split into four triangular shafts of rising height, each with a sloped crown
  b.color = [1, 1, 1];
  {
    const [cx, cz, h] = [70, -150, 26];
    const corners: [number, number][] = [[cx - h, cz - h], [cx + h, cz - h], [cx + h, cz + h], [cx - h, cz + h]];
    const heights = [120, 160, 200, 245];
    const uv = (p: V3): [number, number] => [p[0] / 12, -p[1] / 12];
    heights.forEach((H, i) => {
      const a = corners[i];
      const c2 = corners[(i + 1) % 4];
      b.extrude([[cx, cz], a, c2], 0, H, 'boc', null);
      const top: V3 = [cx, H + 30, cz];
      const A: V3 = [a[0], H, a[1]];
      const C: V3 = [c2[0], H, c2[1]];
      const inside: V3 = [(cx + a[0] + c2[0]) / 3, H - 5, (cz + a[1] + c2[1]) / 3];
      b.tri('boc', A, C, top, uv(A), uv(C), uv(top), inside);
      for (const P of [A, C]) b.tri('boc', [cx, H, cz], P, top, uv([cx, H, cz]), uv(P), uv(top), inside);
    });
    for (const dx of [-3, 3]) b.prism(cx + dx, cz + 8, 0.8, 245, 300, 6, 'white', null, { collide: false });
  }
  // Victoria Peak behind the south side
  b.prism(-100, 900, 650, 0, 480, 24, 'hill', 'hill', { taper: 0.1, jitter: 0.12, rnd, collide: false });
  b.prism(500, 1000, 500, 0, 360, 20, 'hill', 'hill', { taper: 0.12, jitter: 0.12, rnd, collide: false });

  // ---- Overhead wires and green tram poles ----
  b.color = [0.25, 0.25, 0.27];
  for (const c of TRACKS) b.box(-S, S, WIRE_Y - 0.012, WIRE_Y + 0.012, c - 0.012, c + 0.012, 'steel', 'steel', false);
  b.color = [1, 1, 1];
  for (let x = -S + 15; x < S; x += 30) {
    for (const s of [-1, 1]) {
      const z = s * 7.4;
      b.prism(x, z, 0.13, 0.15, WIRE_Y + 1.2, 8, 'polegreen', 'polegreen', { collide: false });
      // bracket arm out over the nearer track, with a hanger down to the wire
      const zEnd = s * (Math.abs(TRACKS[0]) - 0.5);
      b.box(x - 0.05, x + 0.05, WIRE_Y + 0.5, WIRE_Y + 0.6, Math.min(z, zEnd), Math.max(z, zEnd), 'polegreen', 'polegreen', false);
      const zc = s * Math.abs(TRACKS[0]);
      b.box(x - 0.03, x + 0.03, WIRE_Y, WIRE_Y + 0.55, zc - 0.03, zc + 0.03, 'polegreen', null, false);
      b.box(x - 0.05, x + 0.05, WIRE_Y + 0.5, WIRE_Y + 0.6, Math.min(zEnd, zc), Math.max(zEnd, zc), 'polegreen', 'polegreen', false);
    }
  }

  // ---- Sakura trees on both pavements (positions chosen before the buildings, see treeXs) ----
  const blossoms: Street['blossoms'] = [];
  for (const [side, xs] of treeXs) {
    for (const x of xs) {
      blossoms.push(buildSakura(b, x, side * 9.2, 0.15, { scale: range(0.9, 1.08), roadDir: side, rnd }));
    }
  }
  // ---- Street lamps: random spacing along both kerbs, clear of the trees and the tram poles ----
  const lrnd = mulberry32(seed + 202);
  const lamps: V3[] = [];
  const streetLamp = (x: number, side: number): V3 => {
    const zp = side * 7.75; // pole at the kerb edge
    const zh = side * 5.3; // head over the kerb-side traffic lane
    const top = 7.9;
    b.color = [0.42, 0.45, 0.48];
    b.prism(x, zp, 0.11, 0.15, top, 8, 'steel', 'steel', { collide: false });
    b.prism(x, zp, 0.17, 0.15, 1.2, 8, 'steel', null, { collide: false }); // thicker base
    b.box(x - 0.05, x + 0.05, top - 0.26, top - 0.14, Math.min(zp, zh), Math.max(zp, zh), 'steel', 'steel', false); // arm
    const [h0, h1] = [zh - 0.55, zh + 0.55];
    b.box(x - 0.2, x + 0.2, top - 0.42, top - 0.16, h0, h1, 'steel', 'steel', false); // lamp housing
    b.color = [1, 1, 1];
    const y = top - 0.43;
    b.flat('lamp', [[x - 0.16, y, h0 + 0.06], [x + 0.16, y, h0 + 0.06], [x + 0.16, y, h1 - 0.06], [x - 0.16, y, h1 - 0.06]], [x, top, zh]);
    return [x, y - 0.15, zh];
  };
  for (const side of [-1, 1]) {
    for (let x = -S + 4 + lrnd() * 12; x < S - 4; x += 20 + lrnd() * 16) {
      // slide forward until clear of the canopies and the tram poles
      let tries = 0;
      while (tries < 10 && (poleGap(x) < 3 || nearTree(side, x, 5.5))) { x += 1.5; tries++; }
      if (tries === 10 || x >= S - 3) continue;
      lamps.push(streetLamp(x, side));
    }
  }

  b.color = [1, 1, 1];
  return { batches: b.finish(), blossoms, lamps };
}
