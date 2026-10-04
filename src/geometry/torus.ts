// Torus (donut) geometry with UVs and tangents
// u runs around the ring (theta), v runs around the tube cross-section (phi); v = 0.25 is the top

export const TORUS_MAJOR = 0.7;
export const TORUS_MINOR = 0.3;

export interface TorusData {
  positions: Float32Array;
  normals: Float32Array;
  uvs: Float32Array;
  tangents: Float32Array;
  indices: Uint16Array;
}

export function createTorus(segU = 96, segV = 48): TorusData {
  const vertexCount = (segU + 1) * (segV + 1);
  const positions = new Float32Array(vertexCount * 3);
  const normals = new Float32Array(vertexCount * 3);
  const uvs = new Float32Array(vertexCount * 2);
  const tangents = new Float32Array(vertexCount * 3);
  const indices = new Uint16Array(segU * segV * 6);

  for (let i = 0; i <= segU; i++) {
    const u = i / segU;
    const theta = u * Math.PI * 2;
    const cosT = Math.cos(theta);
    const sinT = Math.sin(theta);
    for (let j = 0; j <= segV; j++) {
      const v = j / segV;
      const phi = v * Math.PI * 2;
      const cosP = Math.cos(phi);
      const sinP = Math.sin(phi);
      const k = i * (segV + 1) + j;

      const ring = TORUS_MAJOR + TORUS_MINOR * cosP;
      positions.set([ring * cosT, TORUS_MINOR * sinP, ring * sinT], k * 3);
      normals.set([cosP * cosT, sinP, cosP * sinT], k * 3);
      tangents.set([-sinT, 0, cosT], k * 3);
      uvs.set([u, v], k * 2);
    }
  }

  let n = 0;
  for (let i = 0; i < segU; i++) {
    for (let j = 0; j < segV; j++) {
      const a = i * (segV + 1) + j;
      const b = a + segV + 1;
      indices.set([a, b, a + 1, b, b + 1, a + 1], n);
      n += 6;
    }
  }

  return { positions, normals, uvs, tangents, indices };
}
