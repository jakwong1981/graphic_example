// Editable glTF 2.0 scene: parse a GLB into a node tree with per-primitive geometry and PBR materials,
// edit it in code, flatten it for drawing, and write it back out as a GLB.
// Supports what simple exporters (three.js GLTFExporter, Blender) emit for static models:
// node hierarchy (matrix or TRS), triangle primitives with POSITION / NORMAL / TEXCOORD_0, metallic-roughness materials,
// embedded PNG / JPEG base colour textures and emissive factors. No skins or animation.

export type Mat4 = number[]; // column-major, 16 numbers

export interface Material {
  name?: string;
  color: [number, number, number, number]; // linear base colour factor
  metallic: number;
  roughness: number;
  emissive: [number, number, number];
  image?: Blob; // PNG / JPEG base colour texture
  /** Metallic-roughness texture (G = roughness, B = metallic), multiplied by the factors */
  mrImage?: Blob;
  /** Tangent-space normal map */
  normalImage?: Blob;
  doubleSided?: boolean;
}

export interface Primitive {
  positions: Float32Array;
  normals: Float32Array;
  uvs: Float32Array;
  indices: Uint32Array;
  material: number;
  /** Optional per-vertex RGB (written as COLOR_0; not read back by parseGlb) */
  colors?: Float32Array;
}

export interface SceneNode {
  name?: string;
  /** Index of the node in the source file (not written back out) */
  id?: number;
  matrix: Mat4; // local transform
  primitives: Primitive[];
  children: SceneNode[];
}

export interface GltfScene {
  root: SceneNode;
  materials: Material[];
}

export const IDENTITY: Mat4 = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

export function mul(a: Mat4, b: Mat4): Mat4 {
  const o = new Array(16).fill(0);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) o[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k];
  return o;
}

/** T * R(quaternion) * S */
export function trs(t: number[] = [0, 0, 0], q: number[] = [0, 0, 0, 1], s: number[] = [1, 1, 1]): Mat4 {
  const [x, y, z, w] = q;
  return [
    (1 - 2 * (y * y + z * z)) * s[0], 2 * (x * y + z * w) * s[0], 2 * (x * z - y * w) * s[0], 0,
    2 * (x * y - z * w) * s[1], (1 - 2 * (x * x + z * z)) * s[1], 2 * (y * z + x * w) * s[1], 0,
    2 * (x * z + y * w) * s[2], 2 * (y * z - x * w) * s[2], (1 - 2 * (x * x + y * y)) * s[2], 0,
    t[0], t[1], t[2], 1,
  ];
}

export const transformPoint = (m: Mat4, p: ArrayLike<number>): [number, number, number] => [
  m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12],
  m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13],
  m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14],
];

// Inverse-transpose of the upper 3x3, so normals stay correct under non-uniform scale
function normalMatrix(m: Mat4): number[] {
  const [a, b, c, d, e, f, g, h, i] = [m[0], m[1], m[2], m[4], m[5], m[6], m[8], m[9], m[10]];
  const A = e * i - f * h, B = -(d * i - f * g), C = d * h - e * g;
  const det = a * A + b * B + c * C || 1;
  // columns of the inverse-transpose
  return [
    A / det, B / det, C / det,
    -(b * i - c * h) / det, (a * i - c * g) / det, -(a * h - b * g) / det,
    (b * f - c * e) / det, -(a * f - c * d) / det, (a * e - b * d) / det,
  ];
}

// ---------------- Reading ----------------
interface Json {
  scene?: number;
  scenes?: { nodes: number[] }[];
  nodes: { name?: string; mesh?: number; children?: number[]; matrix?: number[]; translation?: number[]; rotation?: number[]; scale?: number[] }[];
  meshes: { primitives: { attributes: Record<string, number>; indices?: number; material?: number; mode?: number }[] }[];
  accessors: { bufferView?: number; byteOffset?: number; componentType: number; count: number; type: string; normalized?: boolean }[];
  bufferViews: { byteOffset?: number; byteLength: number; byteStride?: number }[];
  materials?: {
    name?: string; doubleSided?: boolean; emissiveFactor?: number[];
    pbrMetallicRoughness?: { baseColorFactor?: number[]; metallicFactor?: number; roughnessFactor?: number; baseColorTexture?: { index: number }; metallicRoughnessTexture?: { index: number } };
    normalTexture?: { index: number };
  }[];
  textures?: { source: number }[];
  images?: { bufferView: number; mimeType: string }[];
}

const SIZES: Record<number, number> = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 };
const COMPONENTS: Record<string, number> = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 };

export function parseGlb(buffer: ArrayBuffer): GltfScene {
  const view = new DataView(buffer);
  if (view.getUint32(0, true) !== 0x46546c67) throw new Error('Not a GLB file');
  let json: Json | null = null;
  let bin: ArrayBuffer | null = null;
  for (let o = 12; o < view.byteLength; ) {
    const len = view.getUint32(o, true);
    const type = view.getUint32(o + 4, true);
    if (type === 0x4e4f534a) json = JSON.parse(new TextDecoder().decode(new Uint8Array(buffer, o + 8, len)));
    else if (type === 0x004e4942) bin = buffer.slice(o + 8, o + 8 + len);
    o += 8 + len;
  }
  if (!json || !bin) throw new Error('GLB is missing its JSON or BIN chunk');
  const g = json;
  const dv = new DataView(bin);

  const read = (index: number): ArrayLike<number> => {
    const acc = g.accessors[index];
    const n = COMPONENTS[acc.type];
    if (acc.bufferView === undefined) return new Float32Array(acc.count * n);
    const bv = g.bufferViews[acc.bufferView];
    const size = SIZES[acc.componentType];
    const stride = bv.byteStride ?? size * n;
    const base = (bv.byteOffset ?? 0) + (acc.byteOffset ?? 0);
    // Fast path for tightly packed floats and 32-bit indices (scanned meshes have millions of vertices)
    if (stride === size * n && !acc.normalized && (acc.componentType === 5126 || acc.componentType === 5125)) {
      const bytes = bin!.slice(base, base + acc.count * n * 4);
      return acc.componentType === 5126 ? new Float32Array(bytes) : new Uint32Array(bytes);
    }
    const out = new Float32Array(acc.count * n);
    for (let i = 0; i < acc.count; i++) {
      for (let c = 0; c < n; c++) {
        const p = base + i * stride + c * size;
        let v: number;
        switch (acc.componentType) {
          case 5126: v = dv.getFloat32(p, true); break;
          case 5125: v = dv.getUint32(p, true); break;
          case 5123: v = dv.getUint16(p, true); if (acc.normalized) v /= 65535; break;
          case 5121: v = dv.getUint8(p); if (acc.normalized) v /= 255; break;
          case 5122: v = dv.getInt16(p, true); if (acc.normalized) v = Math.max(v / 32767, -1); break;
          default: v = dv.getInt8(p); if (acc.normalized) v = Math.max(v / 127, -1);
        }
        out[i * n + c] = v;
      }
    }
    return out;
  };

  const materials: Material[] = (g.materials ?? []).map((m) => {
    const pbr = m.pbrMetallicRoughness ?? {};
    const f = pbr.baseColorFactor ?? [1, 1, 1, 1];
    const texture = (t?: { index: number }): Blob | undefined => {
      const img = t ? g.images?.[g.textures?.[t.index]?.source ?? -1] : undefined;
      if (!img) return undefined;
      const bv = g.bufferViews[img.bufferView];
      return new Blob([bin!.slice(bv.byteOffset ?? 0, (bv.byteOffset ?? 0) + bv.byteLength)], { type: img.mimeType });
    };
    const e = m.emissiveFactor ?? [0, 0, 0];
    return {
      name: m.name, color: [f[0], f[1], f[2], f[3]], metallic: pbr.metallicFactor ?? 1, roughness: pbr.roughnessFactor ?? 1,
      emissive: [e[0], e[1], e[2]], image: texture(pbr.baseColorTexture), mrImage: texture(pbr.metallicRoughnessTexture),
      normalImage: texture(m.normalTexture), doubleSided: m.doubleSided,
    };
  });
  if (!materials.length) materials.push({ color: [0.8, 0.8, 0.8, 1], metallic: 0, roughness: 0.6, emissive: [0, 0, 0] });

  const meshCache = new Map<number, Primitive[]>();
  const mesh = (index: number): Primitive[] => {
    if (meshCache.has(index)) return meshCache.get(index)!;
    const prims: Primitive[] = [];
    for (const p of g.meshes[index].primitives) {
      if ((p.mode ?? 4) !== 4) continue;
      const pos = read(p.attributes.POSITION);
      const count = pos.length / 3;
      const idx = p.indices !== undefined ? read(p.indices) : Uint32Array.from({ length: count }, (_, i) => i);
      const nor = p.attributes.NORMAL !== undefined ? read(p.attributes.NORMAL) : null;
      const uv = p.attributes.TEXCOORD_0 !== undefined ? read(p.attributes.TEXCOORD_0) : new Float32Array(count * 2);
      const f32 = (a: ArrayLike<number>) => (a instanceof Float32Array ? a : Float32Array.from(a));
      const prim: Primitive = {
        positions: f32(pos), normals: nor ? f32(nor) : new Float32Array(count * 3), uvs: f32(uv),
        indices: idx instanceof Uint32Array ? idx : Uint32Array.from(idx), material: Math.min(p.material ?? 0, materials.length - 1),
      };
      if (!nor) computeNormals(prim);
      prims.push(prim);
    }
    meshCache.set(index, prims);
    return prims;
  };

  const node = (i: number): SceneNode => {
    const n = g.nodes[i];
    return {
      name: n.name,
      id: i,
      matrix: n.matrix ? [...n.matrix] : trs(n.translation, n.rotation, n.scale),
      primitives: n.mesh !== undefined ? mesh(n.mesh) : [], // instanced meshes share primitives
      children: (n.children ?? []).map(node),
    };
  };
  const roots = g.scenes?.[g.scene ?? 0]?.nodes ?? g.nodes.map((_, i) => i);
  return { root: { name: 'root', matrix: [...IDENTITY], primitives: [], children: roots.map(node) }, materials };
}

/** Flat (per-face) normals for primitives that have none */
export function computeNormals(p: Primitive) {
  const P = p.positions;
  const N = new Float32Array(P.length);
  for (let t = 0; t < p.indices.length; t += 3) {
    const [a, b, c] = [p.indices[t] * 3, p.indices[t + 1] * 3, p.indices[t + 2] * 3];
    const u = [P[b] - P[a], P[b + 1] - P[a + 1], P[b + 2] - P[a + 2]];
    const v = [P[c] - P[a], P[c + 1] - P[a + 1], P[c + 2] - P[a + 2]];
    const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
    for (const k of [a, b, c]) for (let j = 0; j < 3; j++) N[k + j] += n[j];
  }
  for (let i = 0; i < N.length; i += 3) {
    const l = Math.hypot(N[i], N[i + 1], N[i + 2]) || 1;
    N[i] /= l; N[i + 1] /= l; N[i + 2] /= l;
  }
  p.normals = N;
}

// ---------------- Flattening ----------------
export interface FlatBatch {
  material: number;
  positions: Float32Array;
  normals: Float32Array;
  uvs: Float32Array;
  indices: Uint32Array;
}

/** Bakes world transforms and merges everything into one batch per material */
export function flatten(scene: GltfScene): { batches: FlatBatch[]; min: number[]; max: number[] } {
  // Pass 1: world matrix of every primitive instance, and the size of each material batch
  const items: { prim: Primitive; W: Mat4 }[] = [];
  const sizes = new Map<number, { v: number; i: number }>();
  const collect = (node: SceneNode, parent: Mat4) => {
    const W = mul(parent, node.matrix);
    for (const prim of node.primitives) {
      items.push({ prim, W });
      const s = sizes.get(prim.material) ?? { v: 0, i: 0 };
      s.v += prim.positions.length / 3;
      s.i += prim.indices.length;
      sizes.set(prim.material, s);
    }
    for (const c of node.children) collect(c, W);
  };
  collect(scene.root, IDENTITY);
  // Pass 2: bake transforms into preallocated arrays (scanned meshes have millions of vertices)
  const out = new Map<number, FlatBatch & { vc: number; ic: number }>();
  for (const [m, s] of sizes) {
    out.set(m, { material: m, positions: new Float32Array(s.v * 3), normals: new Float32Array(s.v * 3), uvs: new Float32Array(s.v * 2), indices: new Uint32Array(s.i), vc: 0, ic: 0 });
  }
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (const { prim, W } of items) {
    const b = out.get(prim.material)!;
    const NM = normalMatrix(W);
    // A mirroring transform (negative determinant) flips the winding
    const det = W[0] * (W[5] * W[10] - W[6] * W[9]) - W[4] * (W[1] * W[10] - W[2] * W[9]) + W[8] * (W[1] * W[6] - W[2] * W[5]);
    const base = b.vc;
    const P = prim.positions, Nn = prim.normals;
    for (let v = 0; v < P.length; v += 3) {
      const [x, y, z] = [P[v], P[v + 1], P[v + 2]];
      const o = (base + v / 3) * 3;
      const wx = W[0] * x + W[4] * y + W[8] * z + W[12];
      const wy = W[1] * x + W[5] * y + W[9] * z + W[13];
      const wz = W[2] * x + W[6] * y + W[10] * z + W[14];
      b.positions[o] = wx; b.positions[o + 1] = wy; b.positions[o + 2] = wz;
      if (wx < min[0]) min[0] = wx; if (wx > max[0]) max[0] = wx;
      if (wy < min[1]) min[1] = wy; if (wy > max[1]) max[1] = wy;
      if (wz < min[2]) min[2] = wz; if (wz > max[2]) max[2] = wz;
      const [nx, ny, nz] = [Nn[v], Nn[v + 1], Nn[v + 2]];
      const ax = NM[0] * nx + NM[3] * ny + NM[6] * nz, ay = NM[1] * nx + NM[4] * ny + NM[7] * nz, az = NM[2] * nx + NM[5] * ny + NM[8] * nz;
      const l = Math.hypot(ax, ay, az) || 1;
      b.normals[o] = ax / l; b.normals[o + 1] = ay / l; b.normals[o + 2] = az / l;
    }
    b.uvs.set(prim.uvs, base * 2);
    const I = prim.indices;
    for (let t = 0; t < I.length; t += 3) {
      const k = b.ic + t;
      b.indices[k] = base + I[t];
      b.indices[k + 1] = base + (det < 0 ? I[t + 2] : I[t + 1]);
      b.indices[k + 2] = base + (det < 0 ? I[t + 1] : I[t + 2]);
    }
    b.vc += P.length / 3;
    b.ic += I.length;
  }
  const batches = [...out.values()].sort((a, b) => a.material - b.material).map(({ material, positions, normals, uvs, indices }) => ({ material, positions, normals, uvs, indices }));
  return { batches, min, max };
}

// ---------------- Writing ----------------
/** Writes the scene as a GLB, keeping the node hierarchy so parts stay separately posable */
export async function writeGlb(scene: GltfScene): Promise<Blob> {
  const chunks: Uint8Array<ArrayBuffer>[] = [];
  let byteLength = 0;
  const bufferViews: object[] = [];
  const accessors: object[] = [];
  const addView = (bytes: Uint8Array<ArrayBuffer>, target?: number) => {
    const pad = (4 - (byteLength % 4)) % 4;
    if (pad) { chunks.push(new Uint8Array(pad)); byteLength += pad; }
    bufferViews.push({ buffer: 0, byteOffset: byteLength, byteLength: bytes.byteLength, ...(target ? { target } : {}) });
    chunks.push(bytes);
    byteLength += bytes.byteLength;
    return bufferViews.length - 1;
  };
  const addAccessor = (data: Float32Array | Uint32Array, type: 'VEC2' | 'VEC3' | 'SCALAR', target: number) => {
    const view = addView(new Uint8Array(data.slice().buffer), target);
    const n = { VEC2: 2, VEC3: 3, SCALAR: 1 }[type];
    const a: Record<string, unknown> = { bufferView: view, componentType: data instanceof Float32Array ? 5126 : 5125, count: data.length / n, type };
    if (type === 'VEC3' && data.length) {
      const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
      for (let i = 0; i < data.length; i++) { mn[i % 3] = Math.min(mn[i % 3], data[i]); mx[i % 3] = Math.max(mx[i % 3], data[i]); }
      a.min = mn; a.max = mx;
    }
    accessors.push(a);
    return accessors.length - 1;
  };

  const images: object[] = [];
  const textures: object[] = [];
  const materials = await Promise.all(scene.materials.map(async (m) => {
    const pbr: Record<string, unknown> = { baseColorFactor: m.color, metallicFactor: m.metallic, roughnessFactor: m.roughness };
    const addTexture = async (b: Blob) => {
      images.push({ bufferView: addView(new Uint8Array(await b.arrayBuffer())), mimeType: b.type || 'image/png' });
      textures.push({ source: images.length - 1, sampler: 0 });
      return { index: textures.length - 1 };
    };
    if (m.image) pbr.baseColorTexture = await addTexture(m.image);
    if (m.mrImage) pbr.metallicRoughnessTexture = await addTexture(m.mrImage);
    const normal = m.normalImage ? { normalTexture: await addTexture(m.normalImage) } : {};
    return { ...(m.name ? { name: m.name } : {}), pbrMetallicRoughness: pbr, ...normal, emissiveFactor: m.emissive, ...(m.doubleSided ? { doubleSided: true } : {}) };
  }));

  const meshes: object[] = [];
  const meshIndex = new Map<Primitive[], number>();
  const nodes: Record<string, unknown>[] = [];
  const addNode = (n: SceneNode): number => {
    const out: Record<string, unknown> = { matrix: n.matrix };
    if (n.name) out.name = n.name;
    nodes.push(out);
    const index = nodes.length - 1;
    if (n.primitives.length) {
      if (!meshIndex.has(n.primitives)) {
        meshes.push({
          primitives: n.primitives.map((p) => ({
            attributes: {
              POSITION: addAccessor(p.positions, 'VEC3', 34962), NORMAL: addAccessor(p.normals, 'VEC3', 34962), TEXCOORD_0: addAccessor(p.uvs, 'VEC2', 34962),
              ...(p.colors ? { COLOR_0: addAccessor(p.colors, 'VEC3', 34962) } : {}),
            },
            indices: addAccessor(p.indices, 'SCALAR', 34963),
            material: p.material,
          })),
        });
        meshIndex.set(n.primitives, meshes.length - 1);
      }
      out.mesh = meshIndex.get(n.primitives);
    }
    if (n.children.length) out.children = n.children.map(addNode);
    return index;
  };
  const root = addNode(scene.root);

  const json: Record<string, unknown> = {
    asset: { version: '2.0', generator: 'graphic_example zaku refine' },
    scene: 0, scenes: [{ nodes: [root] }], nodes, meshes, materials, accessors, bufferViews,
    buffers: [{ byteLength }],
  };
  if (images.length) {
    json.images = images;
    json.textures = textures;
    json.samplers = [{ magFilter: 9729, minFilter: 9987, wrapS: 33071, wrapT: 33071 }];
  }
  const enc = (s: string) => new TextEncoder().encode(s);
  let jsonBytes = enc(JSON.stringify(json));
  const jpad = (4 - (jsonBytes.length % 4)) % 4;
  if (jpad) jsonBytes = enc(JSON.stringify(json) + ' '.repeat(jpad));
  const bpad = (4 - (byteLength % 4)) % 4;
  const binLen = byteLength + bpad;
  const total = 12 + 8 + jsonBytes.length + 8 + binLen;
  const head = new DataView(new ArrayBuffer(12 + 8));
  head.setUint32(0, 0x46546c67, true);
  head.setUint32(4, 2, true);
  head.setUint32(8, total, true);
  head.setUint32(12, jsonBytes.length, true);
  head.setUint32(16, 0x4e4f534a, true);
  const binHead = new DataView(new ArrayBuffer(8));
  binHead.setUint32(0, binLen, true);
  binHead.setUint32(4, 0x004e4942, true);
  return new Blob([head.buffer, jsonBytes, binHead.buffer, ...chunks, new Uint8Array(bpad)], { type: 'model/gltf-binary' });
}
