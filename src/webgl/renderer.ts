// WebGL renderer: manages buffers and draw calls

import { CubeData } from '../geometry/cube';
import { Mat4 } from '../math/matrix';

export interface Renderer {
  setup(cube: CubeData): void;
  draw(
    modelMatrix: Mat4,
    viewMatrix: Mat4,
    projectionMatrix: Mat4,
    lightPosition: [number, number, number],
    viewPosition: [number, number, number]
  ): void;
}

export function createRenderer(gl: WebGL2RenderingContext, program: WebGLProgram): Renderer {
  let vertexArray: WebGLVertexArrayObject | null = null;
  let indexCount = 0;

  // Get attribute and uniform locations
  const aPosition = gl.getAttribLocation(program, 'aPosition');
  const aNormal = gl.getAttribLocation(program, 'aNormal');
  const aColor = gl.getAttribLocation(program, 'aColor');

  const uModelMatrix = gl.getUniformLocation(program, 'uModelMatrix');
  const uViewMatrix = gl.getUniformLocation(program, 'uViewMatrix');
  const uProjectionMatrix = gl.getUniformLocation(program, 'uProjectionMatrix');
  const uLightPosition = gl.getUniformLocation(program, 'uLightPosition');
  const uViewPosition = gl.getUniformLocation(program, 'uViewPosition');

  function setup(cube: CubeData) {
    vertexArray = gl.createVertexArray();
    gl.bindVertexArray(vertexArray);

    // Position buffer
    const positionBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, cube.positions, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(aPosition);
    gl.vertexAttribPointer(aPosition, 3, gl.FLOAT, false, 0, 0);

    // Normal buffer
    const normalBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, normalBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, cube.normals, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(aNormal);
    gl.vertexAttribPointer(aNormal, 3, gl.FLOAT, false, 0, 0);

    // Color buffer
    const colorBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, colorBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, cube.colors, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(aColor);
    gl.vertexAttribPointer(aColor, 3, gl.FLOAT, false, 0, 0);

    // Index buffer
    const indexBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, cube.indices, gl.STATIC_DRAW);

    indexCount = cube.indices.length;

    gl.bindVertexArray(null);
  }

  function draw(
    modelMatrix: Mat4,
    viewMatrix: Mat4,
    projectionMatrix: Mat4,
    lightPosition: [number, number, number],
    viewPosition: [number, number, number]
  ) {
    gl.useProgram(program);
    gl.bindVertexArray(vertexArray);

    // Set uniforms
    gl.uniformMatrix4fv(uModelMatrix, false, modelMatrix);
    gl.uniformMatrix4fv(uViewMatrix, false, viewMatrix);
    gl.uniformMatrix4fv(uProjectionMatrix, false, projectionMatrix);
    gl.uniform3fv(uLightPosition, lightPosition);
    gl.uniform3fv(uViewPosition, viewPosition);

    // Draw indexed triangles
    gl.drawElements(gl.TRIANGLES, indexCount, gl.UNSIGNED_SHORT, 0);

    gl.bindVertexArray(null);
  }

  return { setup, draw };
}
