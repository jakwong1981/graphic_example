// Vertex Shader Demo: Flat coloring, no lighting
console.log('=== VERTEX DEMO STARTING ===');

import vertexShaderSource from './shaders/vertex.glsl?raw';
console.log('Vertex shader loaded:', vertexShaderSource.length, 'chars');

import fragmentShaderSource from './shaders/fragment-simple.glsl?raw';
console.log('Fragment shader loaded:', fragmentShaderSource.length, 'chars');

import { createCube } from './geometry/cube';
import { createProgram } from './webgl/shader-program';
import { createRenderer } from './webgl/renderer';
import { perspective, rotateX, rotateY, multiply, lookAt } from './math/matrix';

const canvas = document.getElementById('glcanvas') as HTMLCanvasElement;
console.log('Canvas element:', canvas);

if (!canvas) {
  console.error('Canvas not found!');
  throw new Error('Canvas element with id="glcanvas" not found');
}

const gl = canvas.getContext('webgl2')!;
console.log('WebGL context:', gl);

if (!gl) {
  alert('WebGL2 not supported');
  throw new Error('WebGL2 not supported');
}

console.log('Creating shader program...');
const program = createProgram(gl, vertexShaderSource, fragmentShaderSource);
console.log('Program created:', program);

const renderer = createRenderer(gl, program);
console.log('Renderer created');

const cube = createCube();
console.log('Cube created:', cube.positions.length / 3, 'vertices');

renderer.setup(cube);
console.log('Renderer setup complete');

gl.enable(gl.DEPTH_TEST);
gl.depthFunc(gl.LEQUAL);

const cameraPosition: [number, number, number] = [0, 0, 3];
const viewMatrix = lookAt(cameraPosition, [0, 0, 0], [0, 1, 0]);
const aspect = canvas.width / canvas.height;
const projectionMatrix = perspective(Math.PI / 4, aspect, 0.1, 100);
const lightPosition: [number, number, number] = [2, 2, 2];

let startTime = Date.now();
console.log('Starting render loop...');

function render() {
  const elapsed = (Date.now() - startTime) / 1000;
  gl.clearColor(0.05, 0.05, 0.15, 1.0);
  gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
  const modelMatrix = multiply(rotateY(elapsed * 0.5), rotateX(elapsed * 0.3));
  renderer.draw(modelMatrix, viewMatrix, projectionMatrix, lightPosition, cameraPosition);
  requestAnimationFrame(render);
}

render();
console.log('First frame rendered!');
