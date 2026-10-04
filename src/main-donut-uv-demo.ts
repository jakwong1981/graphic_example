// Demo A: image textures sampled through UVs (filtering, tiling, alpha layers, normal map)

import vertexSource from './shaders/donut-uv.vert.glsl?raw';
import fragmentSource from './shaders/donut-uv.frag.glsl?raw';
import { createProgram } from './webgl/shader-program';
import { createTorus } from './geometry/torus';
import { createMesh } from './webgl/mesh';
import { createUniforms } from './webgl/uniforms';
import { FilterMode, createTexture, setFilter } from './webgl/texture';
import { createOrbitCamera } from './webgl/orbit-camera';
import { perspective } from './math/matrix';
import { generateDonutTextures, imageDataToCanvas } from './textures/generate';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const canvas = $<HTMLCanvasElement>('glcanvas');
const gl = canvas.getContext('webgl2');
if (!gl) {
  alert('WebGL2 not supported');
  throw new Error('WebGL2 not supported');
}
const glCtx: WebGL2RenderingContext = gl;

const program = createProgram(glCtx, vertexSource, fragmentSource);
const mesh = createMesh(glCtx, program, createTorus());
const uniforms = createUniforms(glCtx, program);
const camera = createOrbitCamera(canvas);
const projection = perspective(Math.PI / 4, canvas.width / canvas.height, 0.1, 100);

const images = generateDonutTextures();
const layers = [
  { sampler: 'uDough', texture: createTexture(glCtx, images.dough) },
  { sampler: 'uIcing', texture: createTexture(glCtx, images.icing) },
  { sampler: 'uChocolate', texture: createTexture(glCtx, images.chocolate) },
  { sampler: 'uNormalMap', texture: createTexture(glCtx, images.normal) },
];

const showIcing = $<HTMLInputElement>('show-icing');
const showChocolate = $<HTMLInputElement>('show-chocolate');
const useNormal = $<HTMLInputElement>('use-normal');
const filter = $<HTMLSelectElement>('filter');
const tile = $<HTMLInputElement>('tile');
const light = $<HTMLInputElement>('light');
const tileValue = $('tile-value');

// UV unwrap view: the texture layers laid out flat, with a 8x4 grid of UV cells
const uvCanvas = $<HTMLCanvasElement>('uv-canvas');
const uvCtx = uvCanvas.getContext('2d')!;
const sources = {
  dough: imageDataToCanvas(images.dough),
  icing: imageDataToCanvas(images.icing),
  chocolate: imageDataToCanvas(images.chocolate),
};

function drawUV() {
  const { width: w, height: h } = uvCanvas;
  uvCtx.clearRect(0, 0, w, h);
  uvCtx.drawImage(sources.dough, 0, 0, w, h);
  if (showIcing.checked) uvCtx.drawImage(sources.icing, 0, 0, w, h);
  if (showChocolate.checked) uvCtx.drawImage(sources.chocolate, 0, 0, w, h);
  uvCtx.strokeStyle = 'rgba(255,255,255,0.45)';
  uvCtx.lineWidth = 1;
  for (let i = 1; i < 8; i++) {
    uvCtx.beginPath();
    uvCtx.moveTo((i * w) / 8, 0);
    uvCtx.lineTo((i * w) / 8, h);
    uvCtx.stroke();
  }
  for (let j = 1; j < 4; j++) {
    uvCtx.beginPath();
    uvCtx.moveTo(0, (j * h) / 4);
    uvCtx.lineTo(w, (j * h) / 4);
    uvCtx.stroke();
  }
}

filter.addEventListener('change', () => {
  for (const layer of layers) setFilter(glCtx, layer.texture, filter.value as FilterMode);
});
tile.addEventListener('input', () => (tileValue.textContent = `${tile.value}x`));
[showIcing, showChocolate].forEach((el) => el.addEventListener('change', drawUV));
drawUV();

glCtx.enable(glCtx.DEPTH_TEST);

function render() {
  glCtx.clearColor(0.05, 0.05, 0.15, 1);
  glCtx.clear(glCtx.COLOR_BUFFER_BIT | glCtx.DEPTH_BUFFER_BIT);
  glCtx.useProgram(program);

  layers.forEach((layer, unit) => {
    glCtx.activeTexture(glCtx.TEXTURE0 + unit);
    glCtx.bindTexture(glCtx.TEXTURE_2D, layer.texture);
    uniforms.i(layer.sampler, unit);
  });

  const angle = (Number(light.value) * Math.PI) / 180;
  uniforms.m4('uViewMatrix', camera.view());
  uniforms.m4('uProjectionMatrix', projection);
  uniforms.v3('uLightPos', [3 * Math.cos(angle), 2.5, 3 * Math.sin(angle)]);
  uniforms.v3('uViewPos', camera.position());
  uniforms.f('uTile', Number(tile.value));
  uniforms.i('uShowIcing', showIcing.checked ? 1 : 0);
  uniforms.i('uShowChocolate', showChocolate.checked ? 1 : 0);
  uniforms.i('uUseNormalMap', useNormal.checked ? 1 : 0);

  mesh.draw();
  requestAnimationFrame(render);
}

render();
