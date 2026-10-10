// Minimal GLB (binary glTF 2.0) loader: one primitive per mesh, merged into a single draw.
// Layout: 12-byte header | JSON chunk | BIN chunk. Data is reached via accessor -> bufferView -> buffer.
import { Mat4, identity, multiply } from '../math/matrix';
import { MeshData } from '../webgl/mesh';

interface GltfAccessor {
  bufferView?: number;
  byteOffset?: number;
  componentType: number;
  count: number;
  type: 'SCALAR' | 'VEC2' | 'VEC3' | 'VEC4' | 'MAT4';
  min?: number[];
  max?: number[];
}
interface GltfBufferView {
  byteOffset?: number;
  byteLength: number;
  byteStride?: number;
}
interface GltfNode {
  mesh?: number;
  children?: number[];
  matrix?: number[];
  translation?: number[];
  rotation?: number[];
  scale?: number[];
}
interface GltfPrimitive {
  attributes: Record<string, number>;
  indices?: number;
  material?: number;
  mode?: number;
}
interface Gltf {
  scene?: number;
  scenes?: { nodes: number[] }[];
  nodes: GltfNode[];
  meshes: { primitives: GltfPrimitive[] }[];
  accessors: GltfAccessor[];
  bufferViews: GltfBufferView[];
  materials?: { pbrMetallicRoughness?: { baseColorTexture?: { index: number }; baseColorFactor?: number[] } }[];
  textures?: { source: number }[];
  images?: { bufferView: number; mimeType: string }[];
}

export interface GlbModel extends MeshData {
  normals: Float32Array;
  uvs: Float32Array;
  baseColorImage: ImageBitmap | null;
  baseColorFactor: [number, number, number, number];
  min: [number, number, number];
  max: [number, number, number];
  vertexCount: number;
  triangleCount: number;
}

const COMPONENTS = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };
const MAGIC_GLTF = 0x46546c67;
const CHUNK_JSON = 0x4e4f534a;
const CHUNK_BIN = 0x004e4942;

export async function loadGlb(url: string, onProgress?: (loaded: number, total: number) => void): Promise<GlbModel> {
  const buffer = await fetchWithProgress(url, onProgress);
  const view = new DataView(buffer);
  if (view.getUint32(0, true) !== MAGIC_GLTF) throw new Error('Not a GLB file');
  if (view.getUint32(4, true) !== 2) throw new Error('Only glTF 2.0 is supported');

  let json: Gltf | null = null;
  let bin: ArrayBuffer | null = null;
  for (let offset = 12; offset < view.byteLength; ) {
    const length = view.getUint32(offset, true);
    const type = view.getUint32(offset + 4, true);
    const start = offset + 8;
    if (type === CHUNK_JSON) json = JSON.parse(new TextDecoder().decode(new Uint8Array(buffer, start, length)));
    else if (type === CHUNK_BIN) bin = buffer.slice(start, start + length);
    offset = start + length;
  }
  if (!json || !bin) throw new Error('GLB is missing its JSON or BIN chunk');
  const gltf = json;
  const binary = bin;

  // Read an accessor into a tightly packed typed array (handles interleaved byteStride)
  const read = (index: number): Float32Array | Uint32Array => {
    const acc = gltf.accessors[index];
    const n = COMPONENTS[acc.type];
    const out = acc.componentType === 5126 ? new Float32Array(acc.count * n) : new Uint32Array(acc.count * n);
    if (acc.bufferView === undefined) return out;
    const bv = gltf.bufferViews[acc.bufferView];
    const size = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 }[acc.componentType];
    if (!size) throw new Error(`Unsupported componentType ${acc.componentType}`);
    const stride = bv.byteStride ?? size * n;
    const base = (bv.byteOffset ?? 0) + (acc.byteOffset ?? 0);
    const dv = new DataView(binary);
    for (let i = 0; i < acc.count; i++) {
      for (let c = 0; c < n; c++) {
        const p = base + i * stride + c * size;
        switch (acc.componentType) {
          case 5126: out[i * n + c] = dv.getFloat32(p, true); break;
          case 5125: out[i * n + c] = dv.getUint32(p, true); break;
          case 5123: out[i * n + c] = dv.getUint16(p, true); break;
          case 5121: out[i * n + c] = dv.getUint8(p); break;
          default: throw new Error(`Unsupported componentType ${acc.componentType}`);
        }
      }
    }
    return out;
  };

  // Walk the scene graph, baking each node's world transform into its vertices
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  let materialIndex: number | undefined;

  const visit = (nodeIndex: number, parent: Mat4) => {
    const node = gltf.nodes[nodeIndex];
    const world = multiply(parent, nodeMatrix(node));
    if (node.mesh !== undefined) {
      for (const prim of gltf.meshes[node.mesh].primitives) {
        if ((prim.mode ?? 4) !== 4) continue; // triangles only
        materialIndex ??= prim.material;
        const base = positions.length / 3;
        const pos = read(prim.attributes.POSITION);
        const nor = prim.attributes.NORMAL !== undefined ? read(prim.attributes.NORMAL) : null;
        const uv = prim.attributes.TEXCOORD_0 !== undefined ? read(prim.attributes.TEXCOORD_0) : null;
        const count = pos.length / 3;
        for (let i = 0; i < count; i++) {
          positions.push(...transform(world, pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2], 1));
          const nv = nor ? transform(world, nor[i * 3], nor[i * 3 + 1], nor[i * 3 + 2], 0) : [0, 1, 0];
          const len = Math.hypot(nv[0], nv[1], nv[2]) || 1;
          normals.push(nv[0] / len, nv[1] / len, nv[2] / len);
          uvs.push(uv ? uv[i * 2] : 0, uv ? uv[i * 2 + 1] : 0);
        }
        if (prim.indices !== undefined) for (const idx of read(prim.indices)) indices.push(base + idx);
        else for (let i = 0; i < count; i++) indices.push(base + i);
      }
    }
    for (const child of node.children ?? []) visit(child, world);
  };
  const roots = gltf.scenes?.[gltf.scene ?? 0]?.nodes ?? gltf.nodes.map((_, i) => i);
  for (const root of roots) visit(root, identity());

  // Bounds from the baked positions
  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < positions.length; i += 3) {
    for (let c = 0; c < 3; c++) {
      min[c] = Math.min(min[c], positions[i + c]);
      max[c] = Math.max(max[c], positions[i + c]);
    }
  }

  // Base color texture: embedded PNG/JPEG decoded by the browser
  const pbr = materialIndex !== undefined ? gltf.materials?.[materialIndex]?.pbrMetallicRoughness : undefined;
  let baseColorImage: ImageBitmap | null = null;
  if (pbr?.baseColorTexture) {
    const image = gltf.images?.[gltf.textures?.[pbr.baseColorTexture.index]?.source ?? -1];
    if (image) {
      const bv = gltf.bufferViews[image.bufferView];
      const bytes = new Uint8Array(binary, bv.byteOffset ?? 0, bv.byteLength);
      // glTF UV origin is top-left, matching image row order, so no flip is needed
      baseColorImage = await createImageBitmap(new Blob([bytes], { type: image.mimeType }), {
        imageOrientation: 'none',
        premultiplyAlpha: 'none',
        colorSpaceConversion: 'none',
      });
    }
  }
  const f = pbr?.baseColorFactor ?? [1, 1, 1, 1];

  const vertexCount = positions.length / 3;
  return {
    positions: new Float32Array(positions),
    normals: new Float32Array(normals),
    uvs: new Float32Array(uvs),
    indices: vertexCount > 65535 ? new Uint32Array(indices) : new Uint16Array(indices),
    baseColorImage,
    baseColorFactor: [f[0], f[1], f[2], f[3]],
    min,
    max,
    vertexCount,
    triangleCount: indices.length / 3,
  };
}

async function fetchWithProgress(url: string, onProgress?: (loaded: number, total: number) => void): Promise<ArrayBuffer> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Failed to load ${url}: ${response.status}`);
  const total = Number(response.headers.get('Content-Length')) || 0;
  if (!response.body || !onProgress) return response.arrayBuffer();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let loaded = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    loaded += value.length;
    onProgress(loaded, total);
  }
  const out = new Uint8Array(loaded);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out.buffer;
}

// Local transform: explicit matrix, or T * R * S
function nodeMatrix(node: GltfNode): Mat4 {
  if (node.matrix) return new Float32Array(node.matrix);
  const [tx, ty, tz] = node.translation ?? [0, 0, 0];
  const [x, y, z, w] = node.rotation ?? [0, 0, 0, 1];
  const [sx, sy, sz] = node.scale ?? [1, 1, 1];
  // Column-major rotation from quaternion, scaled per column
  return new Float32Array([
    (1 - 2 * (y * y + z * z)) * sx, 2 * (x * y + z * w) * sx, 2 * (x * z - y * w) * sx, 0,
    2 * (x * y - z * w) * sy, (1 - 2 * (x * x + z * z)) * sy, 2 * (y * z + x * w) * sy, 0,
    2 * (x * z + y * w) * sz, 2 * (y * z - x * w) * sz, (1 - 2 * (x * x + y * y)) * sz, 0,
    tx, ty, tz, 1,
  ]);
}

// Note: for normals (w = 0) this is exact for rotation + uniform scale, which covers typical exports
function transform(m: Mat4, x: number, y: number, z: number, w: number): [number, number, number] {
  return [
    m[0] * x + m[4] * y + m[8] * z + m[12] * w,
    m[1] * x + m[5] * y + m[9] * z + m[13] * w,
    m[2] * x + m[6] * y + m[10] * z + m[14] * w,
  ];
}
