// Uploads mesh data to a VAO; attributes the shader does not use (or the mesh lacks) are skipped
export interface MeshData {
  positions: Float32Array;
  normals?: Float32Array;
  uvs?: Float32Array;
  tangents?: Float32Array;
  colors?: Float32Array; // per-vertex RGB tint
  indices: Uint16Array | Uint32Array;
}
export interface Mesh {
  draw(): void;
  dispose(): void;
}
export function createMesh(gl: WebGL2RenderingContext, program: WebGLProgram, data: MeshData): Mesh {
  const vao = gl.createVertexArray();
  const buffers: WebGLBuffer[] = [];
  const buffer = () => {
    const b = gl.createBuffer();
    if (!b) throw new Error('Failed to create buffer');
    buffers.push(b);
    return b;
  };
  gl.bindVertexArray(vao);
  const attribute = (name: string, array: Float32Array | undefined, size: number) => {
    const location = gl.getAttribLocation(program, name);
    if (location < 0 || !array) return;
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer());
    gl.bufferData(gl.ARRAY_BUFFER, array, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(location);
    gl.vertexAttribPointer(location, size, gl.FLOAT, false, 0, 0);
  };
  attribute('aPosition', data.positions, 3);
  attribute('aNormal', data.normals, 3);
  attribute('aTangent', data.tangents, 3);
  attribute('aUV', data.uvs, 2);
  attribute('aColor', data.colors, 3);
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, buffer());
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, data.indices, gl.STATIC_DRAW);
  gl.bindVertexArray(null);
  // WebGL2 supports 32-bit indices natively (needed for meshes over 65535 vertices)
  const indexType = data.indices instanceof Uint32Array ? gl.UNSIGNED_INT : gl.UNSIGNED_SHORT;
  const count = data.indices.length;
  return {
    draw() {
      gl.bindVertexArray(vao);
      gl.drawElements(gl.TRIANGLES, count, indexType, 0);
      gl.bindVertexArray(null);
    },
    dispose() {
      gl.deleteVertexArray(vao);
      buffers.forEach((b) => gl.deleteBuffer(b));
    },
  };
}
