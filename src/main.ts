// Main application: bootstrap WebGL, load shaders, run render loop

import vertexShaderSource from './shaders/vertex.glsl?raw';
import fragmentShaderSource from './shaders/fragment.glsl?raw';
import { createCube } from './geometry/cube';
import { createProgram } from './webgl/shader-program';
import { createRenderer } from './webgl/renderer';
import { identity, perspective, rotateX, rotateY, multiply, formatMatrix, lookAt } from './math/matrix';

console.log('Starting WebGL application...');

const canvas = document.getElementById('glcanvas') as HTMLCanvasElement;
if (!canvas) {
  console.error('Canvas element not found!');
  throw new Error('Canvas element not found');
}
console.log('Canvas found:', canvas.width, 'x', canvas.height);

const gl = canvas.getContext('webgl2');
if (!gl) {
  alert('WebGL2 not supported');
  throw new Error('WebGL2 not supported');
}
const glCtx: WebGL2RenderingContext = gl;
console.log('WebGL2 context created successfully');

// Display shader source in info panel
document.getElementById('vertex-shader-display')!.textContent = vertexShaderSource;
document.getElementById('fragment-shader-display')!.textContent = fragmentShaderSource;
console.log('Shader sources displayed');

// Create shader program
console.log('Creating shader program...');
const program = createProgram(glCtx, vertexShaderSource, fragmentShaderSource);
console.log('Shader program created successfully');

// Create renderer and setup geometry
console.log('Creating renderer...');
const renderer = createRenderer(glCtx, program);
const cube = createCube();
console.log('Cube data created:', cube.positions.length / 3, 'vertices');
renderer.setup(cube);
console.log('Renderer setup complete');

// Enable depth testing (hidden surface removal)
glCtx.enable(glCtx.DEPTH_TEST);
glCtx.depthFunc(glCtx.LEQUAL);

// Camera setup
const cameraPosition: [number, number, number] = [0, 0, 3];
const viewMatrix = lookAt(cameraPosition, [0, 0, 0], [0, 1, 0]); // Camera at z=3, looking at origin

// Projection setup
const aspect = canvas.width / canvas.height;
const projectionMatrix = perspective(Math.PI / 4, aspect, 0.1, 100);

// Light setup
const lightPosition: [number, number, number] = [2, 2, 2];

// Display static matrices
document.getElementById('view-matrix')!.textContent = formatMatrix(viewMatrix);
document.getElementById('proj-matrix')!.textContent = formatMatrix(projectionMatrix);

// Animation loop
let startTime = Date.now();
let frameCount = 0;

function render() {
  const elapsed = (Date.now() - startTime) / 1000;
  frameCount++;
  
  if (frameCount === 1) {
    console.log('Render loop started');
  }
  if (frameCount % 60 === 0) {
    console.log('Frame', frameCount, 'time:', elapsed.toFixed(2));
  }

  // Clear screen
  glCtx.clearColor(0.1, 0.1, 0.1, 1.0);
  glCtx.clear(glCtx.COLOR_BUFFER_BIT | glCtx.DEPTH_BUFFER_BIT);

  // Model transformation: rotate around X and Y axes
  const modelMatrix = multiply(rotateY(elapsed * 0.5), rotateX(elapsed * 0.3));

  // Display model matrix
  document.getElementById('model-matrix')!.textContent = formatMatrix(modelMatrix);

  // Draw the cube
  renderer.draw(modelMatrix, viewMatrix, projectionMatrix, lightPosition, cameraPosition);

  requestAnimationFrame(render);
}

console.log('Starting render loop...');
render();
