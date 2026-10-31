// Turns a box primitive (axis-aligned in its local frame, like three.js BoxGeometry) into a rounded, slightly domed
// shape: edges and corners get radius `radius`, and each face swells outwards by up to `bulge` in its middle.
// Every face keeps its own material and UV corners (bilinear across the face), so decals stay where they were.
import type { Primitive } from './gltf-scene';

export interface RoundOptions {
  radius: number; // edge radius, metres in the primitive's frame (clamped to 45% of the smallest half size)
  bulge: number; // how far the middle of a face swells, as a fraction of the face's smaller side
}

type V3 = [number, number, number];
const EDGE_STEPS = 6; // samples across each rounded edge
const MID_STEPS = 10; // samples across the flat-ish middle of a face

/** Bounds of a primitive if it is a box (every triangle axis-aligned and lying on the bounds), else null */
function boxBounds(p: Primitive): { min: V3; max: V3 } | null {
  const P = p.positions;
  const min: V3 = [Infinity, Infinity, Infinity], max: V3 = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < P.length; i += 3) for (let k = 0; k < 3; k++) { min[k] = Math.min(min[k], P[i + k]); max[k] = Math.max(max[k], P[i + k]); }
  const eps = 1e-4 * Math.max(max[0] - min[0], max[1] - min[1], max[2] - min[2]);
  for (const i of p.indices) {
    // every used vertex must be a corner of the bounds (it touches three faces)
    let on = 0;
    for (let k = 0; k < 3; k++) if (Math.abs(P[i * 3 + k] - min[k]) < eps || Math.abs(P[i * 3 + k] - max[k]) < eps) on++;
    if (on < 3) return null; // box corners touch three faces
  }
  return { min, max };
}

export function isBox(prims: Primitive[]): boolean {
  return prims.length > 0 && prims.every((p) => p.positions.length / 3 <= 24 && boxBounds(p) !== null);
}

/** Rounded replacement for each primitive of a box mesh (one output primitive per input primitive) */
export function roundBox(prims: Primitive[], o: RoundOptions): Primitive[] {
  return prims.map((p) => roundPrimitive(p, o) ?? p);
}

function roundPrimitive(p: Primitive, o: RoundOptions): Primitive | null {
  const b = boxBounds(p);
  if (!b) return null;
  const { min, max } = b;
  const half = [0, 1, 2].map((k) => (max[k] - min[k]) / 2);
  const r = Math.min(o.radius, 0.45 * Math.min(...half));
  const lo = min.map((v) => v + r), hi = max.map((v) => v - r);
  const mid = [0, 1, 2].map((k) => (min[k] + max[k]) / 2);

  // Surface point for a point on the original box surface (before rounding), and its outward face axis
  const surface = (q0: V3, axis: number, bulgeAmount: number): V3 => {
    const q: V3 = [0, 0, 0];
    const d: V3 = [0, 0, 0];
    for (let k = 0; k < 3; k++) {
      q[k] = Math.min(hi[k], Math.max(lo[k], q0[k]));
      d[k] = q0[k] - q[k];
    }
    const l = Math.hypot(d[0], d[1], d[2]) || 1;
    const out: V3 = [q[0] + (d[0] / l) * r, q[1] + (d[1] / l) * r, q[2] + (d[2] / l) * r];
    // Dome: zero with zero slope where the rounded edge starts, so normals stay continuous across edges
    let w = 1;
    for (let k = 0; k < 3; k++) {
      if (k === axis) continue;
      const span = (hi[k] - lo[k]) / 2;
      const a = span > 1e-6 ? (q[k] - mid[k]) / span : 0;
      w *= (1 - a * a) * (1 - a * a);
    }
    out[axis] += Math.sign(d[axis]) * bulgeAmount * w;
    return out;
  };

  const P = p.positions, UV = p.uvs;
  const outP: number[] = [], outN: number[] = [], outUV: number[] = [], outI: number[] = [];

  // Group this primitive's triangles into box faces (axis + side)
  const faces = new Map<string, Set<number>>();
  for (let t = 0; t < p.indices.length; t += 3) {
    const ids = [p.indices[t], p.indices[t + 1], p.indices[t + 2]];
    const v = ids.map((i) => [P[i * 3], P[i * 3 + 1], P[i * 3 + 2]]);
    const e1 = [v[1][0] - v[0][0], v[1][1] - v[0][1], v[1][2] - v[0][2]];
    const e2 = [v[2][0] - v[0][0], v[2][1] - v[0][1], v[2][2] - v[0][2]];
    const n = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
    const axis = [0, 1, 2].reduce((best, k) => (Math.abs(n[k]) > Math.abs(n[best]) ? k : best), 0);
    // side from the vertex position (robust to either winding)
    const side = v[0][axis] > mid[axis] ? 1 : -1;
    const key = `${axis}${side}`;
    if (!faces.has(key)) faces.set(key, new Set());
    ids.forEach((i) => faces.get(key)!.add(i));
  }

  for (const [key, verts] of faces) {
    const axis = Number(key[0]);
    const side = key[1] === '1' ? 1 : -1;
    const [ia, ib] = [0, 1, 2].filter((k) => k !== axis);
    // UV at each corner of the face, found from the vertices this primitive uses
    const cornerUV = (sa: number, sb: number): [number, number] => {
      let best = -1, bestD = Infinity;
      for (const i of verts) {
        const da = Math.abs(P[i * 3 + ia] - (sa ? max[ia] : min[ia]));
        const db = Math.abs(P[i * 3 + ib] - (sb ? max[ib] : min[ib]));
        if (da + db < bestD) { bestD = da + db; best = i; }
      }
      return [UV[best * 2], UV[best * 2 + 1]];
    };
    const c00 = cornerUV(0, 0), c10 = cornerUV(1, 0), c01 = cornerUV(0, 1), c11 = cornerUV(1, 1);
    // Sample positions along each face axis: dense across the rounded edges, coarser in the middle
    const samples = (k: number) => {
      const s: number[] = [];
      for (let i = 0; i < EDGE_STEPS; i++) s.push(min[k] + (r * i) / EDGE_STEPS);
      for (let i = 0; i < MID_STEPS; i++) s.push(lo[k] + ((hi[k] - lo[k]) * i) / MID_STEPS);
      for (let i = 0; i <= EDGE_STEPS; i++) s.push(hi[k] + (r * i) / EDGE_STEPS);
      return s;
    };
    const sa = samples(ia), sb = samples(ib);
    const faceSize = Math.min(max[ia] - min[ia], max[ib] - min[ib]);
    const bulge = o.bulge * faceSize;
    const at = (a: number, bb: number): V3 => {
      const q: V3 = [0, 0, 0];
      q[axis] = side > 0 ? max[axis] : min[axis];
      q[ia] = a;
      q[ib] = bb;
      return surface(q, axis, bulge);
    };
    const base = outP.length / 3;
    const ea = (max[ia] - min[ia]) * 1e-3, eb = (max[ib] - min[ib]) * 1e-3;
    for (const bv of sb) {
      for (const av of sa) {
        const pos = at(av, bv);
        // Normal from the surface's partial derivatives (central differences, clamped to the face)
        const a0 = Math.max(min[ia], av - ea), a1 = Math.min(max[ia], av + ea);
        const b0 = Math.max(min[ib], bv - eb), b1 = Math.min(max[ib], bv + eb);
        const pa1 = at(a1, bv), pa0 = at(a0, bv), pb1 = at(av, b1), pb0 = at(av, b0);
        const du = [pa1[0] - pa0[0], pa1[1] - pa0[1], pa1[2] - pa0[2]];
        const dv = [pb1[0] - pb0[0], pb1[1] - pb0[1], pb1[2] - pb0[2]];
        let n = [du[1] * dv[2] - du[2] * dv[1], du[2] * dv[0] - du[0] * dv[2], du[0] * dv[1] - du[1] * dv[0]];
        const outward = [pos[0] - mid[0], pos[1] - mid[1], pos[2] - mid[2]];
        if (n[0] * outward[0] + n[1] * outward[1] + n[2] * outward[2] < 0) n = n.map((x) => -x);
        const l = Math.hypot(n[0], n[1], n[2]) || 1;
        outP.push(...pos);
        outN.push(n[0] / l, n[1] / l, n[2] / l);
        const s = (av - min[ia]) / (max[ia] - min[ia]);
        const t = (bv - min[ib]) / (max[ib] - min[ib]);
        outUV.push(
          (1 - s) * (1 - t) * c00[0] + s * (1 - t) * c10[0] + (1 - s) * t * c01[0] + s * t * c11[0],
          (1 - s) * (1 - t) * c00[1] + s * (1 - t) * c10[1] + (1 - s) * t * c01[1] + s * t * c11[1],
        );
      }
    }
    // Triangles, wound counter-clockwise seen from outside
    const W = sa.length;
    for (let j = 0; j < sb.length - 1; j++) {
      for (let i = 0; i < W - 1; i++) {
        const v00 = base + j * W + i, v10 = v00 + 1, v01 = v00 + W, v11 = v01 + 1;
        // (ia, ib, axis) is a right-handed frame when ib follows ia cyclically; flip for the other cases
        const flip = (side > 0) !== ((ia + 1) % 3 === ib);
        if (flip) outI.push(v00, v01, v10, v10, v01, v11);
        else outI.push(v00, v10, v01, v10, v11, v01);
      }
    }
  }
  return { positions: new Float32Array(outP), normals: new Float32Array(outN), uvs: new Float32Array(outUV), indices: new Uint32Array(outI), material: p.material };
}
