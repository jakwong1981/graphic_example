// Turns a depth map into a displaced grid mesh (a 2.5D relief)
import { DepthMap } from './depth';

export interface ReliefOptions {
  depthScale: number; // max z displacement in world units
  tearThreshold: number; // 0..1; drop triangles spanning a bigger depth jump (separates layers)
  solidBack: boolean; // add a flat back plate so the asset is closed from behind
}

export interface ReliefMesh {
  positions: Float32Array;
  normals: Float32Array;
  uvs: Float32Array;
  indices: Uint32Array;
  min: [number, number, number];
  max: [number, number, number];
}

export function buildRelief(depth: DepthMap, opts: ReliefOptions): ReliefMesh {
  const { width: W, height: H, data } = depth;
  const aspect = H / W;
  const front = W * H;
  const vertexCount = opts.solidBack ? front * 2 : front;
  const positions = new Float32Array(vertexCount * 3);
  const uvs = new Float32Array(vertexCount * 2);

  // Image spans x in [-1, 1]; row 0 (top) maps to +y. UV (0,0) = top-left, as in glTF.
  for (let j = 0; j < H; j++) {
    for (let i = 0; i < W; i++) {
      const k = j * W + i;
      const u = i / (W - 1);
      const v = j / (H - 1);
      positions.set([(u - 0.5) * 2, (0.5 - v) * 2 * aspect, data[k] * opts.depthScale], k * 3);
      uvs.set([u, v], k * 2);
      if (opts.solidBack) {
        positions.set([(u - 0.5) * 2, (0.5 - v) * 2 * aspect, -0.02], (front + k) * 3);
        uvs.set([u, v], (front + k) * 2);
      }
    }
  }

  const indices: number[] = [];
  const limit = opts.tearThreshold;
  const keep = (a: number, b: number, c: number) =>
    limit >= 1 || Math.max(data[a], data[b], data[c]) - Math.min(data[a], data[b], data[c]) <= limit;
  for (let j = 0; j < H - 1; j++) {
    for (let i = 0; i < W - 1; i++) {
      const a = j * W + i;
      const b = a + 1;
      const c = a + W;
      const d = c + 1;
      // Counter-clockwise when seen from +z
      if (keep(a, c, b)) indices.push(a, c, b);
      if (keep(b, c, d)) indices.push(b, c, d);
      if (opts.solidBack) indices.push(front + a, front + b, front + c, front + b, front + d, front + c);
    }
  }
  if (opts.solidBack) {
    // Side walls stitch the front edge to the back plate
    const wall = (p: number, q: number) => indices.push(p, q, front + p, q, front + q, front + p);
    for (let i = 0; i < W - 1; i++) {
      wall(i + 1, i); // top
      wall((H - 1) * W + i, (H - 1) * W + i + 1); // bottom
    }
    for (let j = 0; j < H - 1; j++) {
      wall(j * W, (j + 1) * W); // left
      wall((j + 1) * W + W - 1, j * W + W - 1); // right
    }
  }

  const index = new Uint32Array(indices);
  const normals = computeNormals(positions, index);
  const min: [number, number, number] = [-1, -aspect, opts.solidBack ? -0.02 : 0];
  const max: [number, number, number] = [1, aspect, opts.depthScale];
  return { positions, normals, uvs, indices: index, min, max };
}

// Area-weighted vertex normals from the triangle list
function computeNormals(p: Float32Array, idx: Uint32Array): Float32Array {
  const n = new Float32Array(p.length);
  for (let t = 0; t < idx.length; t += 3) {
    const [a, b, c] = [idx[t] * 3, idx[t + 1] * 3, idx[t + 2] * 3];
    const ux = p[b] - p[a], uy = p[b + 1] - p[a + 1], uz = p[b + 2] - p[a + 2];
    const vx = p[c] - p[a], vy = p[c + 1] - p[a + 1], vz = p[c + 2] - p[a + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    for (const k of [a, b, c]) {
      n[k] += nx;
      n[k + 1] += ny;
      n[k + 2] += nz;
    }
  }
  for (let k = 0; k < n.length; k += 3) {
    const len = Math.hypot(n[k], n[k + 1], n[k + 2]) || 1;
    n[k] /= len;
    n[k + 1] /= len;
    n[k + 2] /= len;
  }
  return n;
}
