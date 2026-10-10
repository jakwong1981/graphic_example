// Mesh builder: flat-shaded triangles whose UVs point into atlas regions, plus box and cylinder primitives
import { Region, regionUV } from './atlas';

export type V3 = [number, number, number];
export type UVFn = (p: V3) => [number, number]; // point -> (s, t) in 0..1 inside a region

export interface ModelMesh {
  positions: Float32Array;
  normals: Float32Array;
  uvs: Float32Array;
  indices: Uint32Array;
  min: [number, number, number];
  max: [number, number, number];
}

export type Axis = 'x' | 'y' | 'z';

export interface BoxFaces {
  px?: Region; nx?: Region; py?: Region; ny?: Region; pz?: Region; nz?: Region;
}

export class Builder {
  private positions: number[] = [];
  private normals: number[] = [];
  private uvs: number[] = [];

  // One triangle with its own 3 vertices (flat normal). Winding is fixed so the
  // normal points away from `center`, which works for every convex part.
  tri(a: V3, b: V3, c: V3, region: Region, uv: UVFn, center: V3) {
    let n = cross(sub(b, a), sub(c, a));
    const mid: V3 = [(a[0] + b[0] + c[0]) / 3, (a[1] + b[1] + c[1]) / 3, (a[2] + b[2] + c[2]) / 3];
    if (dot(n, sub(mid, center)) < 0) {
      [b, c] = [c, b];
      n = [-n[0], -n[1], -n[2]];
    }
    const len = Math.hypot(...n) || 1;
    for (const p of [a, b, c]) {
      this.positions.push(...p);
      this.normals.push(n[0] / len, n[1] / len, n[2] / len);
      this.uvs.push(...regionUV(region, ...uv(p)));
    }
  }

  quad(a: V3, b: V3, c: V3, d: V3, region: Region, uv: UVFn, center: V3) {
    this.tri(a, b, c, region, uv, center);
    this.tri(a, c, d, region, uv, center);
  }

  // Smooth triangle: per-vertex normals; winding follows the averaged normal
  triSmooth(p: [V3, V3, V3], n: [V3, V3, V3], region: Region, uv: UVFn) {
    let [a, b, c] = p;
    let [na, nb, nc] = n;
    const avg: V3 = [na[0] + nb[0] + nc[0], na[1] + nb[1] + nc[1], na[2] + nb[2] + nc[2]];
    if (dot(cross(sub(b, a), sub(c, a)), avg) < 0) {
      [b, c] = [c, b];
      [nb, nc] = [nc, nb];
    }
    for (const [v, vn] of [[a, na], [b, nb], [c, nc]] as const) {
      this.positions.push(...v);
      this.normals.push(...vn);
      this.uvs.push(...regionUV(region, ...uv(v)));
    }
  }

  // Parametric surface P(u, v) with smooth normals from finite differences.
  // `inside(p)` is a point inside the solid; normals are turned to face away from it.
  surface(
    P: (u: number, v: number) => V3, u: [number, number, number], v: [number, number, number],
    region: Region, uv: UVFn, inside: (p: V3) => V3
  ) {
    const [u0, u1, nu] = u;
    const [v0, v1, nv] = v;
    const eps = 1e-4;
    const pts: V3[][] = [];
    const nrm: V3[][] = [];
    for (let i = 0; i <= nu; i++) {
      pts.push([]);
      nrm.push([]);
      for (let j = 0; j <= nv; j++) {
        const uu = u0 + ((u1 - u0) * i) / nu;
        const vv = v0 + ((v1 - v0) * j) / nv;
        const p = P(uu, vv);
        const du = sub(P(Math.min(uu + eps, u1), vv), P(Math.max(uu - eps, u0), vv));
        const dv = sub(P(uu, Math.min(vv + eps, v1)), P(uu, Math.max(vv - eps, v0)));
        let n = cross(du, dv);
        if (dot(n, sub(p, inside(p))) < 0) n = [-n[0], -n[1], -n[2]];
        const len = Math.hypot(...n) || 1;
        pts[i].push(p);
        nrm[i].push([n[0] / len, n[1] / len, n[2] / len]);
      }
    }
    for (let i = 0; i < nu; i++) {
      for (let j = 0; j < nv; j++) {
        this.triSmooth([pts[i][j], pts[i + 1][j], pts[i + 1][j + 1]], [nrm[i][j], nrm[i + 1][j], nrm[i + 1][j + 1]], region, uv);
        this.triSmooth([pts[i][j], pts[i + 1][j + 1], pts[i][j + 1]], [nrm[i][j], nrm[i + 1][j + 1], nrm[i][j + 1]], region, uv);
      }
    }
  }

  // Triangle with explicit (s, t) per vertex, for UVs that do not follow from the position (seams, wraps)
  triST(p: [V3, V3, V3], st: [number, number][], region: Region, center: V3) {
    const map = new Map<V3, [number, number]>(p.map((v, i) => [v, st[i]]));
    this.tri(p[0], p[1], p[2], region, (v) => map.get(v)!, center);
  }

  // Axis-aligned box. Each face maps (s, t) so the image reads correctly from outside (t = 0 at the top).
  box(x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, faces: BoxFaces) {
    const c: V3 = [(x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2];
    const dx = x1 - x0, dy = y1 - y0, dz = z1 - z0;
    const T = (p: V3) => (y1 - p[1]) / dy;
    if (faces.pz) this.quad([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], faces.pz, (p) => [(p[0] - x0) / dx, T(p)], c);
    if (faces.nz) this.quad([x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0], faces.nz, (p) => [(x1 - p[0]) / dx, T(p)], c);
    if (faces.px) this.quad([x1, y0, z0], [x1, y0, z1], [x1, y1, z1], [x1, y1, z0], faces.px, (p) => [(z1 - p[2]) / dz, T(p)], c);
    if (faces.nx) this.quad([x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], faces.nx, (p) => [(p[2] - z0) / dz, T(p)], c);
    if (faces.py) this.quad([x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1], faces.py, (p) => [(p[0] - x0) / dx, (p[2] - z0) / dz], c);
    if (faces.ny) this.quad([x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], faces.ny, (p) => [(p[0] - x0) / dx, (z1 - p[2]) / dz], c);
  }

  // Cylinder or cone along an axis from a0 to a1 with radius r0 -> r1.
  // Side: s runs along the axis (a0 -> a1), t wraps once around. Caps map a disc into their region.
  cylinder(
    axis: Axis, center: [number, number], a0: number, a1: number, r0: number, r1: number,
    segments: number, side: Region, cap0?: Region, cap1?: Region
  ) {
    const point = (a: number, angle: number, r: number): V3 => {
      const u = Math.cos(angle) * r;
      const v = Math.sin(angle) * r;
      if (axis === 'x') return [a, center[0] + u, center[1] + v]; // angle 0 = +y, pi/2 = +z
      if (axis === 'y') return [center[0] + v, a, center[1] + u]; // angle 0 = +z, pi/2 = +x
      return [center[0] + v, center[1] + u, a]; // z: angle 0 = +y, pi/2 = +x
    };
    const mid = point((a0 + a1) / 2, 0, 0);
    for (let i = 0; i < segments; i++) {
      const t0 = i / segments;
      const t1 = (i + 1) / segments;
      const [g0, g1] = [t0 * Math.PI * 2, t1 * Math.PI * 2];
      const p00 = point(a0, g0, r0), p01 = point(a0, g1, r0);
      const p10 = point(a1, g0, r1), p11 = point(a1, g1, r1);
      if (r0 > 0) this.triST([p00, p01, p11], [[0, t0], [0, t1], [1, t1]], side, mid);
      if (r1 > 0) this.triST([p00, p11, p10], [[0, t0], [1, t1], [1, t0]], side, mid);
      else this.triST([p00, p01, p10], [[0, t0], [0, t1], [1, (t0 + t1) / 2]], side, mid);
      for (const [a, r, cap] of [[a0, r0, cap0], [a1, r1, cap1]] as const) {
        if (!cap || r <= 0) continue;
        const disc: [number, number][] = [[0.5, 0.5], [0.5 + 0.5 * Math.cos(g0), 0.5 + 0.5 * Math.sin(g0)], [0.5 + 0.5 * Math.cos(g1), 0.5 + 0.5 * Math.sin(g1)]];
        this.triST([point(a, 0, 0), point(a, g0, r), point(a, g1, r)], disc, cap, mid);
      }
    }
  }

  build(): ModelMesh {
    const positions = new Float32Array(this.positions);
    const count = positions.length / 3;
    const min: V3 = [Infinity, Infinity, Infinity];
    const max: V3 = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < positions.length; i += 3) {
      for (let k = 0; k < 3; k++) {
        min[k] = Math.min(min[k], positions[i + k]);
        max[k] = Math.max(max[k], positions[i + k]);
      }
    }
    const indices = new Uint32Array(count);
    for (let i = 0; i < count; i++) indices[i] = i;
    return { positions, normals: new Float32Array(this.normals), uvs: new Float32Array(this.uvs), indices, min, max };
  }
}

const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
