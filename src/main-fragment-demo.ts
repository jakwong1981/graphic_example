// Fragment Shader Demo: Full Phong lighting
import vertexShaderSource from './shaders/vertex.glsl?raw';
import fragmentShaderSource from './shaders/fragment-lighting.glsl?raw';
import { createCube } from './geometry/cube';
import { createProgram } from './webgl/shader-program';
import { createRenderer } from './webgl/renderer';
import { perspective, rotateX, rotateY, multiply, lookAt } from './math/matrix';

const canvas = document.getElementById('glcanvas') as HTMLCanvasElement;
const gl = canvas.getContext('webgl2')!;
if (!gl) {
  alert('WebGL2 not supported');
  throw new Error('WebGL2 not supported');
}

const program = createProgram(gl, vertexShaderSource, fragmentShaderSource);
const renderer = createRenderer(gl, program);
const cube = createCube();
renderer.setup(cube);

gl.enable(gl.DEPTH_TEST);
gl.depthFunc(gl.LEQUAL);

const cameraPosition: [number, number, number] = [0, 0, 3];
const viewMatrix = lookAt(cameraPosition, [0, 0, 0], [0, 1, 0]);
const aspect = canvas.width / canvas.height;
const projectionMatrix = perspective(Math.PI / 4, aspect, 0.1, 100);
const lightPosition: [number, number, number] = [2, 2, 2];

let startTime = Date.now();

function render() {
  const elapsed = (Date.now() - startTime) / 1000;
  gl.clearColor(0.05, 0.05, 0.15, 1.0);
  gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
  const modelMatrix = multiply(rotateY(elapsed * 0.5), rotateX(elapsed * 0.3));
  renderer.draw(modelMatrix, viewMatrix, projectionMatrix, lightPosition, cameraPosition);
  requestAnimationFrame(render);
}

render();
