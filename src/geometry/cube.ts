// Cube geometry: positions, normals, colors, and indices
// Each face has 4 vertices with unique normals for proper lighting

export interface CubeData {
  positions: Float32Array;
  normals: Float32Array;
  colors: Float32Array;
  indices: Uint16Array;
}

export function createCube(): CubeData {
  // 24 vertices: 4 per face (each face has unique normals and colors)
  // prettier-ignore
  const positions = new Float32Array([
    // Front face (z = +0.5)
    -0.5, -0.5,  0.5,   // 0: bottom-left
     0.5, -0.5,  0.5,   // 1: bottom-right
     0.5,  0.5,  0.5,   // 2: top-right
    -0.5,  0.5,  0.5,   // 3: top-left
    // Back face (z = -0.5)
    -0.5, -0.5, -0.5,   // 4: bottom-left
     0.5, -0.5, -0.5,   // 5: bottom-right
     0.5,  0.5, -0.5,   // 6: top-right
    -0.5,  0.5, -0.5,   // 7: top-left
    // Top face (y = +0.5)
    -0.5,  0.5, -0.5,   // 8: bottom-left
     0.5,  0.5, -0.5,   // 9: bottom-right
     0.5,  0.5,  0.5,   // 10: top-right
    -0.5,  0.5,  0.5,   // 11: top-left
    // Bottom face (y = -0.5)
    -0.5, -0.5, -0.5,   // 12: bottom-left
     0.5, -0.5, -0.5,   // 13: bottom-right
     0.5, -0.5,  0.5,   // 14: top-right
    -0.5, -0.5,  0.5,   // 15: top-left
    // Right face (x = +0.5)
     0.5, -0.5, -0.5,   // 16: bottom-left
     0.5, -0.5,  0.5,   // 17: bottom-right
     0.5,  0.5,  0.5,   // 18: top-right
     0.5,  0.5, -0.5,   // 19: top-left
    // Left face (x = -0.5)
    -0.5, -0.5, -0.5,   // 20: bottom-left
    -0.5, -0.5,  0.5,   // 21: bottom-right
    -0.5,  0.5,  0.5,   // 22: top-right
    -0.5,  0.5, -0.5,   // 23: top-left
  ]);

  // Normals: one per face (6 faces × 4 vertices = 24 normals)
  // Each face has a constant normal pointing outward
  // prettier-ignore
  const normals = new Float32Array([
    // Front face (normal: +Z)
    0, 0, 1,  0, 0, 1,  0, 0, 1,  0, 0, 1,
    // Back face (normal: -Z)
    0, 0, -1, 0, 0, -1, 0, 0, -1, 0, 0, -1,
    // Top face (normal: +Y)
    0, 1, 0,  0, 1, 0,  0, 1, 0,  0, 1, 0,
    // Bottom face (normal: -Y)
    0, -1, 0, 0, -1, 0, 0, -1, 0, 0, -1, 0,
    // Right face (normal: +X)
    1, 0, 0,  1, 0, 0,  1, 0, 0,  1, 0, 0,
    // Left face (normal: -X)
    -1, 0, 0, -1, 0, 0, -1, 0, 0, -1, 0, 0,
  ]);

  // Per-vertex colors (RGB)
  // prettier-ignore
  const colors = new Float32Array([
    // Front: red
    1, 0, 0,  1, 0, 0,  1, 0, 0,  1, 0, 0,
    // Back: green
    0, 1, 0,  0, 1, 0,  0, 1, 0,  0, 1, 0,
    // Top: blue
    0, 0, 1,  0, 0, 1,  0, 0, 1,  0, 0, 1,
    // Bottom: yellow
    1, 1, 0,  1, 1, 0,  1, 1, 0,  1, 1, 0,
    // Right: magenta
    1, 0, 1,  1, 0, 1,  1, 0, 1,  1, 0, 1,
    // Left: cyan
    0, 1, 1,  0, 1, 1,  0, 1, 1,  0, 1, 1,
  ]);

  // Indices: 6 faces × 2 triangles × 3 vertices = 36 indices
  // prettier-ignore
  const indices = new Uint16Array([
    0,  1,  2,   0,  2,  3,   // Front
    4,  5,  6,   4,  6,  7,   // Back
    8,  9,  10,  8,  10, 11,  // Top
    12, 13, 14,  12, 14, 15,  // Bottom
    16, 17, 18,  16, 18, 19,  // Right
    20, 21, 22,  20, 22, 23,  // Left
  ]);

  return { positions, normals, colors, indices };
}
