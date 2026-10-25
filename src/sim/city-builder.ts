// Collects flat-shaded geometry per material. UVs are in world units / tile size, so textures repeat (REPEAT wrap).
import { V3, sub, cross, dot } from './math';
import { MaterialName } from './city-textures';
import type { MeshData } from '../webgl/mesh';

// Metres covered by one texture tile: [horizontal, vertical]
export const TILE: Record<MaterialName, [number, number]> = {
  glass: [8, 8], office: [8, 8], residential: [8, 12], residential2: [8, 12], landmark: [8, 8],
  roof: [20, 20], road: [120, 120], concrete: [10, 10], water: [40, 40], hill: [60, 60],
  container: [24, 8], crane: [10, 10],
  tonglau: [4, 3.5], shopfront: [4, 4.5], pawn: [3.4, 3.6], paving: [2, 2], asphalt: [8, 8], trackbed: [2, 2],
  steel: [1, 1], yellow: [1, 1], white: [1, 1], bark: [1, 2], blossom: [3, 3], polegreen: [1, 2], boc: [12, 12],
  signs: [1, 1], // explicit atlas UVs
  grass: [2, 2],
};

export interface Box3 { min: V3; max: V3 }

type UV = [number, number];

export class CityBuilder {
  private data = new Map<MaterialName, { p: number[]; n: number[]; uv: number[]; c: number[] }>();
  colliders: Box3[] = [];
  /** Facade tint for the walls of the next buildings; roofs and ground stay untinted */
  color: V3 = [1, 1, 1];

  private batch(m: MaterialName) {
    let b = this.data.get(m);
    if (!b) this.data.set(m, (b = { p: [], n: [], uv: [], c: [] }));
    return b;
  }

  // Flat triangle, wound so its normal faces away from `inside`
  tri(m: MaterialName, a: V3, b: V3, c: V3, ta: UV, tb: UV, tc: UV, inside: V3, tint: V3 = [1, 1, 1]) {
    let n = cross(sub(b, a), sub(c, a));
    const l = Math.hypot(...n);
    if (l < 1e-9) return;
    const mid: V3 = [(a[0] + b[0] + c[0]) / 3, (a[1] + b[1] + c[1]) / 3, (a[2] + b[2] + c[2]) / 3];
    if (dot(n, sub(mid, inside)) < 0) {
      [b, c] = [c, b];
      [tb, tc] = [tc, tb];
      n = [-n[0], -n[1], -n[2]];
    }
    const B = this.batch(m);
    for (const [p, t] of [[a, ta], [b, tb], [c, tc]] as const) {
      B.p.push(...p);
      B.n.push(n[0] / l, n[1] / l, n[2] / l);
      B.uv.push(...t);
      B.c.push(...tint);
    }
  }

  // Smooth triangle: caller gives counter-clockwise winding (seen from outside), per-vertex normals and tints
  triN(m: MaterialName, p: [V3, V3, V3], n: [V3, V3, V3], t: [UV, UV, UV], tint: [V3, V3, V3]) {
    const B = this.batch(m);
    for (let i = 0; i < 3; i++) {
      B.p.push(...p[i]);
      B.n.push(...n[i]);
      B.uv.push(...t[i]);
      B.c.push(...tint[i]);
    }
  }

  quad(m: MaterialName, a: V3, b: V3, c: V3, d: V3, ta: UV, tb: UV, tc: UV, td: UV, inside: V3) {
    this.tri(m, a, b, c, ta, tb, tc, inside);
    this.tri(m, a, c, d, ta, tc, td, inside);
  }

  // Horizontal surface: UVs from world x/z so neighbouring tiles line up
  flat(m: MaterialName, pts: V3[], inside: V3) {
    const [tu] = TILE[m];
    const uv = (p: V3): UV => [p[0] / tu, p[2] / tu];
    for (let i = 1; i < pts.length - 1; i++) this.tri(m, pts[0], pts[i], pts[i + 1], uv(pts[0]), uv(pts[i]), uv(pts[i + 1]), inside);
  }

  box(x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, side: MaterialName, top: MaterialName | null, collide = true) {
    const base: [number, number][] = [[x0, z0], [x1, z0], [x1, z1], [x0, z1]];
    this.walls(base, base, y0, y1, side, [(x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2]);
    if (top) this.flat(top, base.map(([x, z]) => [x, y1, z] as V3), [(x0 + x1) / 2, y0, (z0 + z1) / 2]);
    if (collide) this.colliders.push({ min: [x0, y0, z0], max: [x1, y1, z1] });
  }

  // N-sided prism / frustum / pyramid: segments 3 = triangle tower, 24 = cylinder, taper 0 = pointed roof
  prism(
    cx: number, cz: number, r: number, y0: number, y1: number, segments: number, side: MaterialName, top: MaterialName | null,
    opts: { rot?: number; taper?: number; jitter?: number; rnd?: () => number; collide?: boolean } = {}
  ) {
    const { rot = 0, taper = 1, jitter = 0, rnd = Math.random, collide = true } = opts;
    const base: [number, number][] = [];
    const topRing: [number, number][] = [];
    for (let i = 0; i < segments; i++) {
      const a = rot + (i / segments) * Math.PI * 2;
      const rr = r * (1 + (rnd() * 2 - 1) * jitter);
      base.push([cx + Math.cos(a) * rr, cz + Math.sin(a) * rr]);
      topRing.push([cx + Math.cos(a) * rr * taper, cz + Math.sin(a) * rr * taper]);
    }
    this.walls(base, topRing, y0, y1, side, [cx, (y0 + y1) / 2, cz]);
    if (top && taper > 0) this.flat(top, topRing.map(([x, z]) => [x, y1, z] as V3), [cx, y0, cz]);
    if (collide) {
      const e = r * (taper < 1 ? (1 + taper) / 2 : 1) * 0.9; // conservative-ish bounding box
      this.colliders.push({ min: [cx - e, y0, cz - e], max: [cx + e, y1, cz + e] });
    }
  }

  // Arbitrary footprint (any convex polygon in x/z) extruded from y0 to y1
  extrude(base: [number, number][], y0: number, y1: number, side: MaterialName, top: MaterialName | null) {
    const cx = base.reduce((s, p) => s + p[0], 0) / base.length;
    const cz = base.reduce((s, p) => s + p[1], 0) / base.length;
    this.walls(base, base, y0, y1, side, [cx, (y0 + y1) / 2, cz]);
    if (top) this.flat(top, base.map(([x, z]) => [x, y1, z] as V3), [cx, y0, cz]);
  }

  // Side walls between a base ring and a top ring. u = distance along the perimeter, v = -height.
  private walls(base: [number, number][], top: [number, number][], y0: number, y1: number, m: MaterialName, inside: V3) {
    const [tu, tv] = TILE[m];
    let u = 0;
    for (let i = 0; i < base.length; i++) {
      const j = (i + 1) % base.length;
      const L = Math.hypot(base[j][0] - base[i][0], base[j][1] - base[i][1]);
      const [u0, u1] = [u / tu, (u + L) / tu];
      const [v0, v1] = [-y0 / tv, -y1 / tv];
      const a: V3 = [base[i][0], y0, base[i][1]];
      const b: V3 = [base[j][0], y0, base[j][1]];
      const c: V3 = [top[j][0], y1, top[j][1]];
      const d: V3 = [top[i][0], y1, top[i][1]];
      this.tri(m, a, b, c, [u0, v0], [u1, v0], [u1, v1], inside, this.color);
      this.tri(m, a, c, d, [u0, v0], [u1, v1], [u0, v1], inside, this.color);
      u += L;
    }
  }

  finish(): Map<MaterialName, MeshData> {
    const out = new Map<MaterialName, MeshData>();
    for (const [m, b] of this.data) {
      const count = b.p.length / 3;
      const indices = new Uint32Array(count);
      for (let i = 0; i < count; i++) indices[i] = i;
      out.set(m, { positions: new Float32Array(b.p), normals: new Float32Array(b.n), uvs: new Float32Array(b.uv), colors: new Float32Array(b.c), indices });
    }
    return out;
  }
}
