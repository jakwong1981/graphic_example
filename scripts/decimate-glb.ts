// Shrinks a huge single-mesh scan (e.g. a Meshy AI export) into a light GLB for real-time use.
//   node scripts/decimate-glb.ts <in.glb> <out.glb> [targetTriangles=40000] [textureSize=2048]
// Method: vertex clustering. Vertices are snapped to a 3D grid; all vertices in one cell (and in the same small
// UV patch, so texture seams are kept) merge into one averaged vertex, and triangles that collapse are dropped.
// The grid size is found by bisection to land near the target triangle count. Only the base colour texture is
// kept, resized with macOS `sips`; the material is set non-metallic since the metallic-roughness map is dropped.
// Needs Node 23+ (runs TypeScript directly) and macOS (for `sips`).
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseGlb, flatten, writeGlb, type GltfScene, type Material } from '../src/zaku/gltf-scene.ts';

const [input, output, targetArg, texArg] = process.argv.slice(2);
if (!input || !output) {
  console.error('usage: node scripts/decimate-glb.ts <in.glb> <out.glb> [targetTriangles] [textureSize]');
  process.exit(1);
}
const TARGET = Number(targetArg ?? 40000);
const TEX = Number(texArg ?? 2048);
const UV_CELLS = 48; // UV patch size for clustering: keeps texture islands apart

const file = readFileSync(input);
const scene = parseGlb(file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength));
const { batches, min, max } = flatten(scene);
if (batches.length !== 1) throw new Error(`expected one material, found ${batches.length}`);
const b = batches[0];
const P = b.positions, N = b.normals, UV = b.uvs, I = b.indices;
const nv = P.length / 3;
console.log(`in: ${nv.toLocaleString()} vertices, ${(I.length / 3).toLocaleString()} triangles`);

const extent = Math.max(max[0] - min[0], max[1] - min[1], max[2] - min[2]);

// Cluster id of every vertex for a grid of `g` cells along the largest side
function cluster(g: number): { ids: Uint32Array; count: number } {
  const cell = extent / g;
  const ids = new Uint32Array(nv);
  const map = new Map<number, number>();
  for (let i = 0; i < nv; i++) {
    const ix = Math.min(g - 1, Math.floor((P[i * 3] - min[0]) / cell));
    const iy = Math.min(g - 1, Math.floor((P[i * 3 + 1] - min[1]) / cell));
    const iz = Math.min(g - 1, Math.floor((P[i * 3 + 2] - min[2]) / cell));
    const u = Math.min(UV_CELLS - 1, Math.max(0, Math.floor(UV[i * 2] * UV_CELLS)));
    const v = Math.min(UV_CELLS - 1, Math.max(0, Math.floor(UV[i * 2 + 1] * UV_CELLS)));
    const key = ((ix * 1024 + iy) * 1024 + iz) * 4096 + u * 64 + v; // < 2^42, exact in a double
    let id = map.get(key);
    if (id === undefined) map.set(key, (id = map.size));
    ids[i] = id;
  }
  return { ids, count: map.size };
}

// Surviving triangles: three different clusters, duplicates removed
function triangles(ids: Uint32Array): Uint32Array {
  // dedupe key: the two smaller ids packed into one number (< 2^52), then a set of third ids per pair
  const seen = new Map<number, Set<number> | number>();
  const out: number[] = [];
  for (let t = 0; t < I.length; t += 3) {
    const a = ids[I[t]], c = ids[I[t + 1]], d = ids[I[t + 2]];
    if (a === c || c === d || a === d) continue;
    const [x, y, z] = [a, c, d].sort((p, q) => p - q);
    const pair = x * 67108864 + y; // ids < 2^26
    const e = seen.get(pair);
    if (e === undefined) seen.set(pair, z);
    else if (typeof e === 'number') { if (e === z) continue; seen.set(pair, new Set([e, z])); }
    else { if (e.has(z)) continue; e.add(z); }
    out.push(a, c, d);
  }
  return new Uint32Array(out);
}

// Bisection on the grid resolution
let lo = 8, hi = 1000;
let best: { g: number; ids: Uint32Array; count: number; tris: Uint32Array } | null = null;
while (hi - lo > 2) {
  const g = Math.round((lo + hi) / 2);
  const { ids, count } = cluster(g);
  if (count >= 67108864) { hi = g; continue; } // keep cluster ids inside the dedupe key
  const tris = triangles(ids);
  console.log(`  grid ${g}: ${(tris.length / 3).toLocaleString()} triangles`);
  if (!best || Math.abs(tris.length / 3 - TARGET) < Math.abs(best.tris.length / 3 - TARGET)) best = { g, ids, count, tris };
  if (tris.length / 3 > TARGET) hi = g; else lo = g;
}
if (!best) throw new Error('no grid size worked');

// Averaged vertex per cluster, keeping only clusters that are still used
const used = new Int32Array(best.count).fill(-1);
let nOut = 0;
for (const id of best.tris) if (used[id] < 0) used[id] = nOut++;
const sum = new Float64Array(nOut * 8); // position, normal, uv
const cnt = new Uint32Array(nOut);
for (let i = 0; i < nv; i++) {
  const o = used[best.ids[i]];
  if (o < 0) continue;
  cnt[o]++;
  for (let k = 0; k < 3; k++) { sum[o * 8 + k] += P[i * 3 + k]; sum[o * 8 + 3 + k] += N[i * 3 + k]; }
  sum[o * 8 + 6] += UV[i * 2];
  sum[o * 8 + 7] += UV[i * 2 + 1];
}
const positions = new Float32Array(nOut * 3), normals = new Float32Array(nOut * 3), uvs = new Float32Array(nOut * 2);
for (let o = 0; o < nOut; o++) {
  const c = cnt[o];
  for (let k = 0; k < 3; k++) positions[o * 3 + k] = sum[o * 8 + k] / c;
  const l = Math.hypot(sum[o * 8 + 3], sum[o * 8 + 4], sum[o * 8 + 5]) || 1;
  for (let k = 0; k < 3; k++) normals[o * 3 + k] = sum[o * 8 + 3 + k] / l;
  uvs[o * 2] = sum[o * 8 + 6] / c;
  uvs[o * 2 + 1] = sum[o * 8 + 7] / c;
}
const indices = best.tris.map((id) => used[id]);

// Base colour texture, resized
const src = scene.materials[b.material];
let image: Blob | undefined;
if (src.image) {
  const dir = mkdtempSync(join(tmpdir(), 'decimate-'));
  const ext = src.image.type === 'image/png' ? 'png' : 'jpg';
  writeFileSync(join(dir, `in.${ext}`), Buffer.from(await src.image.arrayBuffer()));
  execFileSync('sips', ['-Z', String(TEX), '-s', 'format', 'jpeg', '-s', 'formatOptions', '82', join(dir, `in.${ext}`), '--out', join(dir, 'out.jpg')], { stdio: 'ignore' });
  image = new Blob([readFileSync(join(dir, 'out.jpg'))], { type: 'image/jpeg' });
  rmSync(dir, { recursive: true, force: true });
}
const material: Material = { color: src.color, metallic: 0, roughness: 0.85, emissive: [0, 0, 0], image, doubleSided: true };
const out: GltfScene = {
  materials: [material],
  root: { matrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1], children: [], primitives: [{ positions, normals, uvs, indices, material: 0 }] },
};
writeFileSync(output, Buffer.from(await (await writeGlb(out)).arrayBuffer()));
console.log(`out: grid ${best.g}, ${nOut.toLocaleString()} vertices, ${(indices.length / 3).toLocaleString()} triangles, texture ${TEX}px -> ${output}`);
