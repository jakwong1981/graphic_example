// Procedural cherry blossom tree modelled on a reference photo:
// short thick trunk that forks low into 5-6 limbs spreading in a vase shape, sub-branches reaching
// into a wide, lumpy dome of blossom (lighter on top, deeper pink underneath, open underside so the
// branches show), small drooping clusters on the ragged lower rim, and a grass patch at the base.
import { V3 } from '../sim/math';
import { CityBuilder } from '../sim/city-builder';
import { MaterialName } from '../sim/city-textures';

type UV = [number, number];

const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const mul = (a: V3, s: number): V3 => [a[0] * s, a[1] * s, a[2] * s];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a: V3): V3 => mul(a, 1 / (Math.hypot(...a) || 1));
const lerp3 = (a: V3, b: V3, t: number): V3 => add(a, mul(sub(b, a), t));

// ---- Icosphere (shared vertices so jitter does not crack the surface) ----
const PHI = (1 + Math.sqrt(5)) / 2;
const ICO_V: V3[] = [
  [-1, PHI, 0], [1, PHI, 0], [-1, -PHI, 0], [1, -PHI, 0], [0, -1, PHI], [0, 1, PHI],
  [0, -1, -PHI], [0, 1, -PHI], [PHI, 0, -1], [PHI, 0, 1], [-PHI, 0, -1], [-PHI, 0, 1],
].map((v) => norm(v as V3));
const ICO_F = [
  [0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11], [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8],
  [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9], [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1],
];
function icosphere(subdiv: number): { v: V3[]; f: number[][] } {
  let v = [...ICO_V];
  let f = ICO_F.map((x) => [...x]);
  for (let s = 0; s < subdiv; s++) {
    const cache = new Map<string, number>();
    const mid = (a: number, b: number) => {
      const key = a < b ? `${a},${b}` : `${b},${a}`;
      let i = cache.get(key);
      if (i === undefined) {
        i = v.length;
        v.push(norm(lerp3(v[a], v[b], 0.5)));
        cache.set(key, i);
      }
      return i;
    };
    const next: number[][] = [];
    for (const [a, b, c] of f) {
      const ab = mid(a, b), bc = mid(b, c), ca = mid(c, a);
      next.push([a, ab, ca], [b, bc, ab], [c, ca, bc], [ab, bc, ca]);
    }
    f = next;
  }
  return { v, f };
}
const SPHERES = [icosphere(0), icosphere(1), icosphere(2)];

export interface SakuraOptions {
  scale: number;
  /** +1: the road is towards -z (south pavement), -1: road towards +z; the canopy leans slightly away from it */
  roadDir: number;
  rnd: () => number;
}

export function buildSakura(b: CityBuilder, x: number, z: number, y0: number, o: SakuraOptions): [number, number, number, number] {
  const { rnd, scale: s } = o;
  const range = (lo: number, hi: number) => lo + rnd() * (hi - lo);
  const base: V3 = [x, y0, z];

  // Canopy: a wide, slightly flattened dome. It is long along the pavement (x) and narrower across it (z),
  // so double-deck buses in the kerb lane (z up to 6.5) and the facades (z 11) are mostly cleared.
  const cc: V3 = [x, y0 + 4.9 * s, z + o.roadDir * 0.1 * s];
  const R: V3 = [3.7 * s, 2.25 * s, 1.95 * s];
  const TOP: V3 = [1.08, 1.05, 1.08]; // tint at the top of the canopy (sunlit, pale)
  const BOTTOM: V3 = [0.78, 0.55, 0.68]; // underside (shaded, deeper pink)

  // ---- Grass patch ----
  b.color = [1, 1, 1];
  b.prism(x, z, 1.25 * s, y0, y0 + 0.08, 14, 'grass', 'grass', { taper: 0.85, collide: false });

  // ---- Trunk and branches as smooth tapered tubes ----
  const tube = (p0: V3, p1: V3, r0: number, r1: number, seg = 7) => {
    const d = norm(sub(p1, p0));
    const ref: V3 = Math.abs(d[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
    const u = norm(cross(d, ref));
    const w = cross(u, d);
    const len = Math.hypot(...sub(p1, p0));
    const ring = (p: V3, r: number, k: number): V3 => {
      const a = (k / seg) * Math.PI * 2;
      return add(p, add(mul(u, Math.cos(a) * r), mul(w, Math.sin(a) * r)));
    };
    const nrm = (k: number): V3 => {
      const a = (k / seg) * Math.PI * 2;
      return norm(add(mul(u, Math.cos(a)), mul(w, Math.sin(a))));
    };
    const dark: V3 = [0.85, 0.85, 0.85];
    for (let k = 0; k < seg; k++) {
      const a0 = ring(p0, r0, k), a1 = ring(p0, r0, k + 1), b0 = ring(p1, r1, k), b1 = ring(p1, r1, k + 1);
      const n0 = nrm(k), n1 = nrm(k + 1);
      const uv = (kk: number, t: number): UV => [kk / seg, -t * len / 2];
      // (u, w, d) is left-handed here, so (a0, b1, a1) winds counter-clockwise seen from outside
      b.triN('bark', [a0, b1, a1], [n0, n1, n1], [uv(k, 0), uv(k + 1, 1), uv(k + 1, 0)], [dark, dark, dark]);
      b.triN('bark', [a0, b0, b1], [n0, n0, n1], [uv(k, 0), uv(k, 1), uv(k + 1, 1)], [dark, dark, dark]);
    }
  };
  // Short, thick trunk with a slight lean, forking at ~1.7 m
  const fork: V3 = add(base, [range(-0.15, 0.15) * s, 1.7 * s, range(-0.1, 0.1) * s]);
  tube(base, add(base, [0, 0.35 * s, 0]), 0.36 * s, 0.31 * s); // root flare
  tube(add(base, [0, 0.35 * s, 0]), fork, 0.31 * s, 0.27 * s);
  const limbs = 5 + Math.floor(rnd() * 2);
  const tips: V3[] = [];
  for (let i = 0; i < limbs; i++) {
    const az = (i / limbs) * Math.PI * 2 + range(-0.3, 0.3);
    const elev = range(0.6, 1.05); // 35..60 degrees: vase shape
    const L = range(2.2, 3.0) * s;
    const sq = R[2] / R[0]; // branches spread like the canopy: wide along x, narrow across z
    const dir: V3 = [Math.cos(az) * Math.cos(elev), Math.sin(elev), Math.sin(az) * Math.cos(elev) * sq];
    const mid = add(fork, mul(norm(dir), L));
    tube(fork, mid, 0.17 * s, 0.1 * s);
    // two or three sub-branches fanning out to the canopy shell
    const subs = 2 + Math.floor(rnd() * 2);
    for (let k = 0; k < subs; k++) {
      const a2 = az + range(-0.6, 0.6);
      const e2 = elev + range(-0.35, 0.3);
      const d2: V3 = [Math.cos(a2) * Math.cos(e2), Math.sin(e2), Math.sin(a2) * Math.cos(e2) * sq];
      const end = add(mid, mul(norm(d2), range(1.2, 1.9) * s));
      tube(mid, end, 0.09 * s, 0.035 * s, 5);
      tips.push(end);
    }
  }

  // ---- Blossom clusters: lumpy smooth spheres, tinted by height in the canopy ----
  const cluster = (c: V3, r: number, subdiv: number, flatten = 0.8) => {
    const { v, f } = SPHERES[subdiv];
    const jit = v.map(() => range(0.82, 1.15)); // lumpy, fluffy surface
    const pos = v.map((d, i) => add(c, [d[0] * r * jit[i], d[1] * r * jit[i] * flatten, d[2] * r * jit[i]]));
    const nor = v.map((d) => norm([d[0], d[1] / flatten, d[2]]));
    const shade = (p: V3): V3 => {
      const t = Math.min(1, Math.max(0, (p[1] - (cc[1] - R[1])) / (2 * R[1])));
      const k = range(0.95, 1.05);
      return [0, 1, 2].map((i) => (BOTTOM[i] + (TOP[i] - BOTTOM[i]) * t) * k) as V3;
    };
    const uv = (p: V3): UV => [(p[0] + p[2]) / 2.2, -p[1] / 2.2];
    const tint = pos.map(shade);
    for (const [a, bb, cI] of f) {
      b.triN('blossom', [pos[a], pos[bb], pos[cI]], [nor[a], nor[bb], nor[cI]], [uv(pos[a]), uv(pos[bb]), uv(pos[cI])], [tint[a], tint[bb], tint[cI]]);
    }
  };
  // Large clusters on the dome shell (elevation -20..90 degrees; the underside stays open)
  const shell = (el: number, az: number, k: number): V3 =>
    add(cc, [Math.cos(el) * Math.cos(az) * R[0] * k, Math.sin(el) * R[1] * k, Math.cos(el) * Math.sin(az) * R[2] * k]);
  const rings: [number, number][] = [[-0.3, 10], [0.1, 12], [0.5, 10], [0.9, 7], [1.3, 3]];
  for (const [el, n] of rings) {
    for (let i = 0; i < n; i++) {
      const az = (i / n) * Math.PI * 2 + range(-0.25, 0.25);
      cluster(shell(el + range(-0.12, 0.12), az, range(0.7, 0.85)), range(0.9, 1.35) * s, 1);
    }
  }
  cluster(add(cc, [0, R[1] * 0.75, 0]), 1.3 * s, 2); // crown
  // Clusters at the branch tips fill the inside of the dome
  for (const t of tips) cluster(t, range(0.7, 1.0) * s, 1);
  // Small fluffy puffs on the outside and drooping clusters on the ragged lower rim
  for (let i = 0; i < 26; i++) cluster(shell(range(-0.1, 1.2), range(0, Math.PI * 2), range(0.95, 1.05)), range(0.35, 0.6) * s, 0);
  for (let i = 0; i < 16; i++) cluster(shell(range(-0.6, -0.3), range(0, Math.PI * 2), range(0.9, 1.0)), range(0.3, 0.5) * s, 0, 1.2);

  return [cc[0], cc[1], cc[2], Math.max(R[0], R[2])];
}

export const SAKURA_MATERIALS: MaterialName[] = ['bark', 'blossom', 'grass'];
