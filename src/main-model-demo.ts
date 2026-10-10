// Model demo: load a GLB (binary glTF) file and render it with a base color texture
import vertexSource from './shaders/model.vert.glsl?raw';
import fragmentSource from './shaders/model.frag.glsl?raw';
import { createProgram } from './webgl/shader-program';
import { createMesh, Mesh } from './webgl/mesh';
import { createUniforms } from './webgl/uniforms';
import { createTexture } from './webgl/texture';
import { createOrbitCamera } from './webgl/orbit-camera';
import { perspective } from './math/matrix';
import { loadGlb } from './loaders/glb';
import { drawAtlas } from './models/atlas';
import { kmbBus } from './models/kmb-bus';
import { ModelDef } from './models/types';

const MODEL_URL = './icecream-van.glb';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const canvas = $<HTMLCanvasElement>('glcanvas');
const gl = canvas.getContext('webgl2');
if (!gl) {
  alert('WebGL2 not supported');
  throw new Error('WebGL2 not supported');
}
const glCtx: WebGL2RenderingContext = gl;
const program = createProgram(glCtx, vertexSource, fragmentSource);
const uniforms = createUniforms(glCtx, program);
const camera = createOrbitCamera(canvas, 3.5);
const projection = perspective(Math.PI / 4, canvas.width / canvas.height, 0.05, 100);

const status = $('status');
const stats = $('stats');
const viewMode = $<HTMLSelectElement>('view-mode');
const light = $<HTMLInputElement>('light');
const autoRotate = $<HTMLInputElement>('auto-rotate');

let mesh: Mesh | null = null;
let texture: WebGLTexture | null = null;
let baseColorFactor: [number, number, number, number] = [1, 1, 1, 1];
let fit = { scale: 1, center: [0, 0, 0] as [number, number, number] };

const modelSelect = $<HTMLSelectElement>('model-select');
const atlasCanvas = $<HTMLCanvasElement>('atlas-canvas');
const atlasSection = $('atlas-section');
let loadId = 0; // ignore a slow GLB load that finishes after the user switched models

// Center the bounding box at the origin and scale its largest side to 2 units
function fitTo(min: ArrayLike<number>, max: ArrayLike<number>) {
  const size = [0, 1, 2].map((i) => max[i] - min[i]);
  fit = {
    scale: 2 / Math.max(...size),
    center: [0, 1, 2].map((i) => (min[i] + max[i]) / 2) as [number, number, number],
  };
}

function replace(newMesh: Mesh, newTexture: WebGLTexture | null) {
  mesh?.dispose();
  if (texture) glCtx.deleteTexture(texture);
  mesh = newMesh;
  texture = newTexture;
}

function showGlb() {
  const id = ++loadId;
  atlasSection.hidden = true;
  status.textContent = 'Loading...';
  stats.textContent = '';
  loadGlb(MODEL_URL, (loaded, total) => {
    if (id !== loadId) return;
    const mb = (n: number) => (n / 1048576).toFixed(1);
    status.textContent = total ? `Loading ${mb(loaded)} / ${mb(total)} MB` : `Loading ${mb(loaded)} MB`;
  })
    .then((model) => {
      if (id !== loadId) return;
      glCtx.pixelStorei(glCtx.UNPACK_FLIP_Y_WEBGL, false);
      replace(createMesh(glCtx, program, model), model.baseColorImage ? createTexture(glCtx, model.baseColorImage) : null);
      baseColorFactor = model.baseColorFactor;
      fitTo(model.min, model.max);
      status.textContent = 'Loaded icecream-van.glb';
      stats.textContent =
        `${model.vertexCount.toLocaleString()} vertices, ${model.triangleCount.toLocaleString()} triangles, ` +
        `${model.indices instanceof Uint32Array ? '32' : '16'}-bit indices, ` +
        (model.baseColorImage ? `${model.baseColorImage.width}x${model.baseColorImage.height} texture` : 'no texture');
    })
    .catch((err: Error) => {
      status.textContent = `Error: ${err.message}`;
      console.error(err);
    });
}

// Procedural model with a painted UV atlas (same pipeline as the UV model demo)
function showAtlasModel(def: ModelDef) {
  ++loadId;
  const data = def.build();
  const atlas = document.createElement('canvas');
  drawAtlas(atlas, def.regions, def.painters, def.paint, 'painted');
  glCtx.pixelStorei(glCtx.UNPACK_FLIP_Y_WEBGL, false); // UV t = 0 is the top row
  const tex = createTexture(glCtx, atlas);
  glCtx.texParameteri(glCtx.TEXTURE_2D, glCtx.TEXTURE_WRAP_S, glCtx.CLAMP_TO_EDGE);
  glCtx.texParameteri(glCtx.TEXTURE_2D, glCtx.TEXTURE_WRAP_T, glCtx.CLAMP_TO_EDGE);
  replace(createMesh(glCtx, program, data), tex);
  baseColorFactor = [1, 1, 1, 1];
  fitTo(data.min, data.max);
  status.textContent = `${def.label} (built in code)`;
  stats.textContent = `${(data.indices.length / 3).toLocaleString()} triangles, ${Object.keys(def.regions).length} UV atlas regions, 1024x1024 texture`;
  atlasSection.hidden = false;
  atlasCanvas.getContext('2d')!.drawImage(atlas, 0, 0, atlasCanvas.width, atlasCanvas.height);
}

function selectModel() {
  if (modelSelect.value === 'glb') showGlb();
  else showAtlasModel(kmbBus);
}
modelSelect.addEventListener('change', selectModel);
selectModel();

glCtx.enable(glCtx.DEPTH_TEST);
glCtx.disable(glCtx.CULL_FACE); // material is double-sided

let spin = 0;
let last = performance.now();
function render(now: number) {
  const dt = (now - last) / 1000;
  last = now;
  if (autoRotate.checked) spin += dt * 0.4;

  glCtx.clearColor(0.05, 0.05, 0.15, 1);
  glCtx.clear(glCtx.COLOR_BUFFER_BIT | glCtx.DEPTH_BUFFER_BIT);
  if (mesh) {
    glCtx.useProgram(program);
    // model = rotateY(spin) * scale * translate(-center), written out column-major
    const s = fit.scale;
    const [cx, cy, cz] = fit.center;
    const c = Math.cos(spin) * s;
    const n = Math.sin(spin) * s;
    const model = new Float32Array([
      c, 0, -n, 0,
      0, s, 0, 0,
      n, 0, c, 0,
      -(c * cx + n * cz), -s * cy, -(-n * cx + c * cz), 1,
    ]);
    glCtx.activeTexture(glCtx.TEXTURE0);
    glCtx.bindTexture(glCtx.TEXTURE_2D, texture);
    uniforms.i('uBaseColor', 0);
    uniforms.i('uHasTexture', texture ? 1 : 0);
    glCtx.uniform4fv(glCtx.getUniformLocation(program, 'uBaseColorFactor'), baseColorFactor);
    const angle = (Number(light.value) * Math.PI) / 180;
    uniforms.m4('uModelMatrix', model);
    uniforms.m4('uViewMatrix', camera.view());
    uniforms.m4('uProjectionMatrix', projection);
    uniforms.v3('uLightPos', [4 * Math.cos(angle), 4, 4 * Math.sin(angle)]);
    uniforms.v3('uViewPos', camera.position());
    uniforms.i('uViewMode', Number(viewMode.value));
    mesh.draw();
  }
  requestAnimationFrame(render);
}
requestAnimationFrame(render);
