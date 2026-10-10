// Writes a single textured mesh as a GLB (binary glTF 2.0) file
import { ReliefMesh } from './relief';

export async function exportGlb(mesh: ReliefMesh, texture: HTMLCanvasElement): Promise<Blob> {
  const png = new Uint8Array(await (await canvasToBlob(texture)).arrayBuffer());
  const parts: Uint8Array[] = [];
  const views: { byteOffset: number; byteLength: number; target?: number }[] = [];
  let offset = 0;
  const add = (bytes: Uint8Array, target?: number) => {
    views.push({ byteOffset: offset, byteLength: bytes.byteLength, ...(target ? { target } : {}) });
    parts.push(bytes);
    offset += bytes.byteLength;
    const pad = (4 - (offset % 4)) % 4; // every view starts 4-byte aligned
    if (pad) {
      parts.push(new Uint8Array(pad));
      offset += pad;
    }
  };
  const bytes = (a: Float32Array | Uint32Array) => new Uint8Array(a.buffer, a.byteOffset, a.byteLength);
  add(bytes(mesh.positions), 34962);
  add(bytes(mesh.normals), 34962);
  add(bytes(mesh.uvs), 34962);
  add(bytes(mesh.indices), 34963);
  add(png);

  const count = mesh.positions.length / 3;
  const json = {
    asset: { version: '2.0', generator: 'graphic_example image-to-3d demo' },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0, name: 'Relief' }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0, NORMAL: 1, TEXCOORD_0: 2 }, indices: 3, material: 0 }] }],
    materials: [
      {
        name: 'Photo',
        doubleSided: true,
        pbrMetallicRoughness: { baseColorTexture: { index: 0 }, metallicFactor: 0, roughnessFactor: 1 },
      },
    ],
    textures: [{ source: 0, sampler: 0 }],
    samplers: [{ magFilter: 9729, minFilter: 9987, wrapS: 33071, wrapT: 33071 }],
    images: [{ bufferView: 4, mimeType: 'image/png' }],
    accessors: [
      { bufferView: 0, componentType: 5126, count, type: 'VEC3', min: mesh.min, max: mesh.max },
      { bufferView: 1, componentType: 5126, count, type: 'VEC3' },
      { bufferView: 2, componentType: 5126, count, type: 'VEC2' },
      { bufferView: 3, componentType: 5125, count: mesh.indices.length, type: 'SCALAR' },
    ],
    bufferViews: views.map((v) => ({ buffer: 0, ...v })),
    buffers: [{ byteLength: offset }],
  };

  // JSON chunk is padded with spaces, BIN chunk with zeros
  let jsonBytes = new TextEncoder().encode(JSON.stringify(json));
  const jsonPad = (4 - (jsonBytes.length % 4)) % 4;
  if (jsonPad) {
    const padded = new Uint8Array(jsonBytes.length + jsonPad).fill(0x20);
    padded.set(jsonBytes);
    jsonBytes = padded;
  }
  const total = 12 + 8 + jsonBytes.length + 8 + offset;
  const header = new DataView(new ArrayBuffer(12));
  header.setUint32(0, 0x46546c67, true); // "glTF"
  header.setUint32(4, 2, true);
  header.setUint32(8, total, true);
  const chunk = (length: number, type: number) => {
    const dv = new DataView(new ArrayBuffer(8));
    dv.setUint32(0, length, true);
    dv.setUint32(4, type, true);
    return dv.buffer;
  };
  return new Blob(
    [header.buffer, chunk(jsonBytes.length, 0x4e4f534a), jsonBytes, chunk(offset, 0x004e4942), ...parts] as BlobPart[],
    { type: 'model/gltf-binary' }
  );
}

function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('PNG encoding failed'))), 'image/png')
  );
}
