// Demo B: the same donut with every texture computed in the shader (noise, masks, bump)

import commonNoise from './shaders/common-noise.glsl?raw';
import vertexBody from './shaders/donut-proc.vert.glsl?raw';
import fragmentBody from './shaders/donut-proc.frag.glsl?raw';
import { createProgram } from './webgl/shader-program';
import { createTorus } from './geometry/torus';
import { createMesh } from './webgl/mesh';
import { createUniforms } from './webgl/uniforms';
import { createOrbitCamera } from './webgl/orbit-camera';
import { perspective } from './math/matrix';

const header = '#version 300 es\nprecision highp float;\n';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const canvas = $<HTMLCanvasElement>('glcanvas');
const gl = canvas.getContext('webgl2');
if (!gl) {
  alert('WebGL2 not supported');
  throw new Error('WebGL2 not supported');
}
const glCtx: WebGL2RenderingContext = gl;

const program = createProgram(glCtx, header + commonNoise + vertexBody, header + commonNoise + fragmentBody);
const mesh = createMesh(glCtx, program, createTorus());
const uniforms = createUniforms(glCtx, program);
const camera = createOrbitCamera(canvas);
const projection = perspective(Math.PI / 4, canvas.width / canvas.height, 0.1, 100);

const mode = $<HTMLSelectElement>('mode');
const thickness = $<HTMLInputElement>('thickness');
const light = $<HTMLInputElement>('light');
const thicknessValue = $('thickness-value');

thickness.addEventListener('input', () => (thicknessValue.textContent = Number(thickness.value).toFixed(3)));

glCtx.enable(glCtx.DEPTH_TEST);

function render() {
  glCtx.clearColor(0.05, 0.05, 0.15, 1);
  glCtx.clear(glCtx.COLOR_BUFFER_BIT | glCtx.DEPTH_BUFFER_BIT);
  glCtx.useProgram(program);

  const angle = (Number(light.value) * Math.PI) / 180;
  uniforms.m4('uViewMatrix', camera.view());
  uniforms.m4('uProjectionMatrix', projection);
  uniforms.v3('uLightPos', [3 * Math.cos(angle), 2.5, 3 * Math.sin(angle)]);
  uniforms.v3('uViewPos', camera.position());
  uniforms.f('uThickness', Number(thickness.value));
  uniforms.i('uMode', Number(mode.value));

  mesh.draw();
  requestAnimationFrame(render);
}

render();
