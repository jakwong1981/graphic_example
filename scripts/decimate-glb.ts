// Shrinks a huge single-mesh scan (e.g. a Meshy AI export) into a light GLB for real-time use.
//   node scripts/decimate-glb.ts <in.glb> <out.glb> [targetTriangles=40000] [textureSize=2048] [uvCells=48 | corner | bake]
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

const [input, output, targetArg, texArg, uvArg] = process.argv.slice(2);
if (!input || !output) {
  console.error('usage: node scripts/decimate-glb.ts <in.glb> <out.glb> [targetTriangles] [textureSize] [uvCells | corner | bake]');
  process.exit(1);
}
const TARGET = Number(targetArg ?? 40000);
const TEX = Number(texArg ?? 2048);
// UV handling. A number (default 48): UV patches per side for clustering, which keeps texture islands apart.
// 'corner': cluster on position only and give every kept triangle its own copy of the original UVs at its three
// corners. That suits atlases cut into thousands of small islands (Meshy cars), where averaged seam vertices would
// sample the dark gaps between islands and show as cracks. Costs three vertices per triangle.
// 'bake': cluster on position only, sample the texture at every original vertex and store the averaged colour
// per output vertex (COLOR_0) with no texture at all. Best when the texture is a fine mosaic of islands that no
// reduced UV layout can follow; colours come out a little soft. The `textureSize` argument is then the size the
// texture is shrunk to (a box filter) before sampling.
const CORNER_UV = uvArg === 'corner';
const BAKE = uvArg === 'bake';
const UV_CELLS = CORNER_UV || BAKE ? 1 : Math.min(256, Number(uvArg ?? 48));

const file = readFileSync(input);
const scene = parseGlb(file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength));
const { batches, min, max } = flatten(scene);
if (batches.length !== 1) throw new Error(`expected one material, found ${batches.length}`);
const b = batches[0];
const P = b.positions, N = b.normals, UV = b.uvs, I = b.indices;
const nv = P.length / 3;
console.log(`in: ${nv.toLocaleString()} vertices, ${(I.length / 3).toLocaleString()} triangles`);

const extent = Math.max(max[0] - min[0], max[1] - min[1], max[2] - min[2]);

// Base colour texture as RGB bytes (via a BMP from `sips`), for 'bake'
function readTexture(image: Blob, size: number): Promise<{ w: number; h: number; rgb: Uint8Array }> {
  return image.arrayBuffer().then((bytes) => {
    const dir = mkdtempSync(join(tmpdir(), 'decimate-'));
    try {
      const ext = image.type === 'image/png' ? 'png' : 'jpg';
      writeFileSync(join(dir, `in.${ext}`), Buffer.from(bytes));
      execFileSync('sips', ['-Z', String(size), '-s', 'format', 'bmp', join(dir, `in.${ext}`), '--out', join(dir, 'out.bmp')], { stdio: 'ignore' });
      const bmp = readFileSync(join(dir, 'out.bmp'));
      const data = bmp.readUInt32LE(10), w = bmp.readInt32LE(18), hs = bmp.readInt32LE(22), bpp = bmp.readUInt16LE(28);
      if (bpp !== 24 && bpp !== 32) throw new Error(`unexpected BMP depth ${bpp}`);
      const h = Math.abs(hs), px = bpp / 8, row = Math.ceil((w * px) / 4) * 4;
      const rgb = new Uint8Array(w * h * 3);
      for (let y = 0; y < h; y++) {
        const src = data + (hs < 0 ? y : h - 1 - y) * row; // negative height = rows stored top-down
        for (let x = 0; x < w; x++) {
          const s = src + x * px, d = (y * w + x) * 3;
          rgb[d] = bmp[s + 2]; rgb[d + 1] = bmp[s + 1]; rgb[d + 2] = bmp[s]; // BGR -> RGB
        }
      }
      return { w, h, rgb };
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
}

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
    const key = ((ix * 1024 + iy) * 1024 + iz) * 65536 + u * 256 + v; // < 2^46, exact in a double
    let id = map.get(key);
    if (id === undefined) map.set(key, (id = map.size));
    ids[i] = id;
  }
  return { ids, count: map.size };
}

// Surviving triangles: three different clusters, duplicates removed
let sourceTri: number[] = []; // first index (into I) of the original triangle behind each kept one
function triangles(ids: Uint32Array): Uint32Array {
  // dedupe key: the two smaller ids packed into one number (< 2^52), then a set of third ids per pair
  const seen = new Map<number, Set<number> | number>();
  const out: number[] = [];
  sourceTri = [];
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
    sourceTri.push(t);
  }
  return new Uint32Array(out);
}

// Bisection on the grid resolution
let lo = 8, hi = 1000;
let best: { g: number; ids: Uint32Array; count: number; tris: Uint32Array; src: number[] } | null = null;
while (hi - lo > 2) {
  const g = Math.round((lo + hi) / 2);
  const { ids, count } = cluster(g);
  if (count >= 67108864) { hi = g; continue; } // keep cluster ids inside the dedupe key
  const tris = triangles(ids);
  console.log(`  grid ${g}: ${(tris.length / 3).toLocaleString()} triangles`);
  if (!best || Math.abs(tris.length / 3 - TARGET) < Math.abs(best.tris.length / 3 - TARGET)) best = { g, ids, count, tris, src: sourceTri };
  if (tris.length / 3 > TARGET) hi = g; else lo = g;
}
if (!best) throw new Error('no grid size worked');

// Averaged vertex per cluster, keeping only clusters that are still used
const used = new Int32Array(best.count).fill(-1);
let nOut = 0;
for (const id of best.tris) if (used[id] < 0) used[id] = nOut++;
const sum = new Float64Array(nOut * 8); // position, normal, uv
const cnt = new Uint32Array(nOut);
const srcMat = scene.materials[b.material];
const tex = BAKE && srcMat.image ? await readTexture(srcMat.image, TEX) : null;
if (BAKE && !tex) throw new Error('bake needs a base colour texture');
const toLinear = new Float64Array(256).map((_, i) => Math.pow(i / 255, 2.2));
const colorSum = tex ? new Float64Array(nOut * 3) : null; // linear RGB
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
let indices = best.tris.map((id) => used[id]);
let outP = positions, outN = normals, outUV = uvs;
let colors: Float32Array | undefined;
if (tex && colorSum) {
  // Sample every original triangle at its UV centroid, which lies inside its texture island (vertices sit on the
  // island edges, next to the dark gaps between islands), weighted by area, into the clusters of its corners.
  const csum = new Float64Array(nOut);
  for (let t = 0; t < I.length; t += 3) {
    const [a, c, d] = [I[t], I[t + 1], I[t + 2]];
    let u = (UV[a * 2] + UV[c * 2] + UV[d * 2]) / 3, v = (UV[a * 2 + 1] + UV[c * 2 + 1] + UV[d * 2 + 1]) / 3;
    u -= Math.floor(u); v -= Math.floor(v); // glTF UVs: origin at the top-left of the image; REPEAT wrap
    const s = (Math.min(tex.h - 1, Math.floor(v * tex.h)) * tex.w + Math.min(tex.w - 1, Math.floor(u * tex.w))) * 3;
    const e1 = [P[c * 3] - P[a * 3], P[c * 3 + 1] - P[a * 3 + 1], P[c * 3 + 2] - P[a * 3 + 2]];
    const e2 = [P[d * 3] - P[a * 3], P[d * 3 + 1] - P[a * 3 + 1], P[d * 3 + 2] - P[a * 3 + 2]];
    const area = Math.hypot(e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]);
    for (const vi of [a, c, d]) {
      const o = used[best.ids[vi]];
      if (o < 0) continue;
      csum[o] += area;
      for (let k = 0; k < 3; k++) colorSum[o * 3 + k] += toLinear[tex.rgb[s + k]] * area;
    }
  }
  colors = new Float32Array(nOut * 3);
  for (let o = 0; o < nOut; o++) for (let k = 0; k < 3; k++) colors[o * 3 + k] = csum[o] > 0 ? colorSum[o * 3 + k] / csum[o] : 0.5;
}
if (CORNER_UV) {
  // unshare: one vertex per triangle corner, at the clustered position, with the original corner's UV
  const nt = best.tris.length;
  outP = new Float32Array(nt * 3); outN = new Float32Array(nt * 3); outUV = new Float32Array(nt * 2);
  for (let k = 0; k < nt; k++) {
    const o = indices[k];
    const orig = I[best.src[Math.floor(k / 3)] + (k % 3)];
    outP.set(positions.subarray(o * 3, o * 3 + 3), k * 3);
    outN.set(normals.subarray(o * 3, o * 3 + 3), k * 3);
    outUV.set(UV.subarray(orig * 2, orig * 2 + 2), k * 2);
  }
  indices = Uint32Array.from({ length: nt }, (_, k) => k);
}

// Base colour texture, resized (none when the colours were baked into the vertices)
const src = srcMat;
let image: Blob | undefined;
if (src.image && !BAKE) {
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
  root: { matrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1], children: [], primitives: [{ positions: outP, normals: outN, uvs: outUV, indices, material: 0, colors }] },
};
writeFileSync(output, Buffer.from(await (await writeGlb(out)).arrayBuffer()));
console.log(`out: grid ${best.g}, ${(outP.length / 3).toLocaleString()} vertices, ${(indices.length / 3).toLocaleString()} triangles, ${BAKE ? 'colours baked into the vertices' : `texture ${TEX}px`} -> ${output}`);
