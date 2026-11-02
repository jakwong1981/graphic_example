// Level of detail: lower-triangle copies of a mesh, built once at load time, and the choice of copy per draw.
//
// Simplifying: vertex clustering, as in scripts/decimate-glb.ts. Vertices are snapped to a 3D grid and every
// cell merges into one point (the average position and normal); triangles that collapse are dropped. The grid
// size is estimated from the triangle count (a surface's count grows with the square of the grid) and refined a
// couple of times. Each kept triangle then gets its own three corners carrying the attributes of the original
// triangle's corners (UV, colour, rig), so textures made of many small islands still sample the right island.
//
// Choosing: by how big the object is on screen, its bounding radius in pixels.
import type { V3 } from './math';

export interface LodMesh {
  positions: Float32Array;
  normals: Float32Array;
  uvs: Float32Array;
  /** per-vertex RGB (optional) */
  colors?: Float32Array;
  /** per-vertex leg weights of a walking mecha, 2 floats (optional) */
  rig?: Float32Array;
  indices: ArrayLike<number>;
}
export interface LodLevel extends LodMesh { indices: Uint32Array; triangles: number }

/** Default screen radius (px) above which the full mesh is drawn, and above which level 1 is drawn */
export const LOD_PIXELS = [120, 40];

/**
 * Level to draw for an object of bounding radius `radius` (m) at `dist` (m). `pxPerRad` is the viewport height
 * over 2 tan(fov / 2), so radius * pxPerRad / dist is the object's radius on screen in pixels.
 */
export function lodLevel(radius: number, dist: number, pxPerRad: number, levels: number, pixels = LOD_PIXELS): number {
  const px = (radius * pxPerRad) / Math.max(dist, 1e-3);
  let l = 0;
  while (l < pixels.length && px <= pixels[l]) l++;
  return Math.min(l, levels - 1);
}

export const distance = (a: ArrayLike<number>, b: ArrayLike<number>) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

/** Bounding sphere of a mesh (centre of the box, half its diagonal), in mesh units */
export function bounds(positions: Float32Array): { center: V3; radius: number } {
  const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < positions.length; i += 3) {
    for (let k = 0; k < 3; k++) {
      const v = positions[i + k];
      if (v < mn[k]) mn[k] = v;
      if (v > mx[k]) mx[k] = v;
    }
  }
  return {
    center: [(mn[0] + mx[0]) / 2, (mn[1] + mx[1]) / 2, (mn[2] + mx[2]) / 2],
    radius: Math.hypot(mx[0] - mn[0], mx[1] - mn[1], mx[2] - mn[2]) / 2,
  };
}

const yieldFrame = () => new Promise<void>((r) => setTimeout(r, 0));

/**
 * The mesh at each target triangle count (largest first). A target at or above the mesh's own count gives the
 * mesh itself (as level 0). Yields to the page between passes, so loading a multi-million triangle scan does not
 * freeze the street for seconds.
 */
export async function buildLods(m: LodMesh, targets: number[]): Promise<LodMesh[]> {
  const tris = m.indices.length / 3;
  const out: LodMesh[] = [m];
  for (const t of targets) {
    if (t >= tris * 0.8) continue; // not worth a level
    await yieldFrame();
    const prev = out[out.length - 1];
    const level = simplify(m, t);
    if (level.triangles >= prev.indices.length / 3 * 0.8) continue;
    out.push(level);
  }
  return out;
}

/** One simplified copy of `m` with about `target` triangles */
export function simplify(m: LodMesh, target: number): LodLevel {
  const P = m.positions, I = m.indices;
  const nv = P.length / 3;
  const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < P.length; i += 3) for (let k = 0; k < 3; k++) { mn[k] = Math.min(mn[k], P[i + k]); mx[k] = Math.max(mx[k], P[i + k]); }
  const extent = Math.max(mx[0] - mn[0], mx[1] - mn[1], mx[2] - mn[2]) || 1;

  const ids = new Uint32Array(nv);
  const cluster = (g: number): number => {
    const cell = extent / g;
    const map = new Map<number, number>();
    for (let i = 0; i < nv; i++) {
      const ix = Math.min(g - 1, Math.floor((P[i * 3] - mn[0]) / cell));
      const iy = Math.min(g - 1, Math.floor((P[i * 3 + 1] - mn[1]) / cell));
      const iz = Math.min(g - 1, Math.floor((P[i * 3 + 2] - mn[2]) / cell));
      const key = (ix * 1024 + iy) * 1024 + iz;
      let id = map.get(key);
      if (id === undefined) map.set(key, (id = map.size));
      ids[i] = id;
    }
    return map.size;
  };
  // Surviving triangles (index of the original triangle), with duplicates removed
  const survivors = (): Uint32Array => {
    const seen = new Map<number, number | Set<number>>();
    const keep: number[] = [];
    for (let t = 0; t < I.length; t += 3) {
      const a = ids[I[t]], b = ids[I[t + 1]], c = ids[I[t + 2]];
      if (a === b || b === c || a === c) continue;
      const lo = Math.min(a, b, c), hi = Math.max(a, b, c), mid = a + b + c - lo - hi;
      const pair = lo * 67108864 + mid; // ids stay below 2^26 (grid <= 400 cells a side)
      const e = seen.get(pair);
      if (e === undefined) seen.set(pair, hi);
      else if (typeof e === 'number') { if (e === hi) continue; seen.set(pair, new Set([e, hi])); }
      else { if (e.has(hi)) continue; e.add(hi); }
      keep.push(t / 3);
    }
    return Uint32Array.from(keep);
  };

  // grid size: triangles grow about as g^2 on a surface; start from a guess and correct it twice
  let g = Math.max(4, Math.min(400, Math.round(Math.sqrt(target / 2))));
  let best: { g: number; kept: Uint32Array } | null = null;
  for (let pass = 0; pass < 4; pass++) {
    cluster(g);
    const kept = survivors();
    if (!best || Math.abs(kept.length - target) < Math.abs(best.kept.length - target)) best = { g, kept };
    if (Math.abs(kept.length - target) < target * 0.15) break;
    const next = Math.max(4, Math.min(400, Math.round(g * Math.sqrt(target / Math.max(1, kept.length)))));
    if (next === g) break;
    g = next;
  }
  if (best!.g !== g) cluster(best!.g);
  const kept = best!.kept;

  // average position and normal of every cluster
  const count = ids.reduce((a, b) => Math.max(a, b), 0) + 1;
  const sum = new Float64Array(count * 6);
  const n = new Uint32Array(count);
  const N = m.normals;
  for (let i = 0; i < nv; i++) {
    const o = ids[i] * 6;
    n[ids[i]]++;
    for (let k = 0; k < 3; k++) { sum[o + k] += P[i * 3 + k]; sum[o + 3 + k] += N[i * 3 + k]; }
  }

  // one vertex per corner of every kept triangle
  const nc = kept.length * 3;
  const positions = new Float32Array(nc * 3), normals = new Float32Array(nc * 3), uvs = new Float32Array(nc * 2);
  const colors = m.colors ? new Float32Array(nc * 3) : undefined;
  const rig = m.rig ? new Float32Array(nc * 2) : undefined;
  for (let k = 0; k < kept.length; k++) {
    for (let c = 0; c < 3; c++) {
      const src = I[kept[k] * 3 + c], id = ids[src], o = id * 6, d = k * 3 + c;
      for (let j = 0; j < 3; j++) positions[d * 3 + j] = sum[o + j] / n[id];
      const l = Math.hypot(sum[o + 3], sum[o + 4], sum[o + 5]);
      // facing both ways (thin double-sided shells) averages to nothing: keep the corner's own normal
      if (l > 0.2 * n[id]) for (let j = 0; j < 3; j++) normals[d * 3 + j] = sum[o + 3 + j] / l;
      else for (let j = 0; j < 3; j++) normals[d * 3 + j] = N[src * 3 + j];
      uvs[d * 2] = m.uvs[src * 2];
      uvs[d * 2 + 1] = m.uvs[src * 2 + 1];
      if (colors) for (let j = 0; j < 3; j++) colors[d * 3 + j] = m.colors![src * 3 + j];
      if (rig) { rig[d * 2] = m.rig![src * 2]; rig[d * 2 + 1] = m.rig![src * 2 + 1]; }
    }
  }
  const indices = new Uint32Array(nc);
  for (let i = 0; i < nc; i++) indices[i] = i;
  return { positions, normals, uvs, colors, rig, indices, triangles: kept.length };
}
