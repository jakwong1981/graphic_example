// Uploads torus data to a VAO; attributes the shader does not use are skipped

import { TorusData } from '../geometry/torus';

export interface Mesh {
  draw(): void;
}

export function createMesh(gl: WebGL2RenderingContext, program: WebGLProgram, data: TorusData): Mesh {
  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);

  const attribute = (name: string, array: Float32Array, size: number) => {
    const location = gl.getAttribLocation(program, name);
    if (location < 0) return;
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER, array, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(location);
    gl.vertexAttribPointer(location, size, gl.FLOAT, false, 0, 0);
  };

  attribute('aPosition', data.positions, 3);
  attribute('aNormal', data.normals, 3);
  attribute('aTangent', data.tangents, 3);
  attribute('aUV', data.uvs, 2);

  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, data.indices, gl.STATIC_DRAW);
  gl.bindVertexArray(null);

  return {
    draw() {
      gl.bindVertexArray(vao);
      gl.drawElements(gl.TRIANGLES, data.indices.length, gl.UNSIGNED_SHORT, 0);
      gl.bindVertexArray(null);
    },
  };
}
