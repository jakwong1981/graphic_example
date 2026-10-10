// UV model demo: build a model (car, building, ship, airplane) in code and texture it with a painted 2D UV atlas
import vertexSource from './shaders/model.vert.glsl?raw';
import fragmentSource from './shaders/model.frag.glsl?raw';
import { createProgram } from './webgl/shader-program';
import { createMesh, Mesh } from './webgl/mesh';
import { createUniforms } from './webgl/uniforms';
import { createTexture } from './webgl/texture';
import { createOrbitCamera } from './webgl/orbit-camera';
import { perspective } from './math/matrix';
import { AtlasMode, drawAtlas } from './models/atlas';
import { ModelMesh } from './models/builder';
import { MODELS, ModelDef } from './models';
import { exportGlb } from './image3d/glb-export';

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
const camera = createOrbitCamera(canvas, 3.6);
const projection = perspective(Math.PI / 4, canvas.width / canvas.height, 0.05, 100);

const ui = {
  model: $<HTMLSelectElement>('model'),
  paint: $<HTMLInputElement>('paint'),
  atlasMode: $<HTMLSelectElement>('atlas-mode'),
  viewMode: $<HTMLSelectElement>('view-mode'),
  showWire: $<HTMLInputElement>('show-wire'),
  light: $<HTMLInputElement>('light'),
  autoRotate: $<HTMLInputElement>('auto-rotate'),
  exportBtn: $<HTMLButtonElement>('export'),
  stats: $('stats'),
  atlasView: $<HTMLCanvasElement>('atlas-canvas'),
};

for (const m of MODELS) ui.model.add(new Option(m.label, m.id));

const atlas = document.createElement('canvas');
let def: ModelDef = MODELS[0];
let data: ModelMesh;
let mesh: Mesh | null = null;
let texture: WebGLTexture | null = null;
let center: [number, number, number] = [0, 0, 0];

function selectModel(id: string) {
  def = MODELS.find((m) => m.id === id) ?? MODELS[0];
  data = def.build();
  mesh?.dispose();
  mesh = createMesh(glCtx, program, data);
  // Rotate around the middle of the bounding box
  center = [0, 1, 2].map((k) => (data.min[k] + data.max[k]) / 2) as [number, number, number];
  camera.setDistance(def.cameraDistance);
  ui.paint.value = def.paint;
  ui.stats.textContent = `${(data.indices.length / 3).toLocaleString()} triangles, ${Object.keys(def.regions).length} atlas regions`;
  updateAtlas();
}

function updateAtlas() {
  drawAtlas(atlas, def.regions, def.painters, ui.paint.value, ui.atlasMode.value as AtlasMode);
  if (texture) glCtx.deleteTexture(texture);
  glCtx.pixelStorei(glCtx.UNPACK_FLIP_Y_WEBGL, false); // UV t = 0 is the top row
  texture = createTexture(glCtx, atlas);
  // Clamp so mip levels do not bleed in from the opposite edge of the atlas
  glCtx.texParameteri(glCtx.TEXTURE_2D, glCtx.TEXTURE_WRAP_S, glCtx.CLAMP_TO_EDGE);
  glCtx.texParameteri(glCtx.TEXTURE_2D, glCtx.TEXTURE_WRAP_T, glCtx.CLAMP_TO_EDGE);
  drawAtlasView();
}

// 2D view of the atlas with the mesh triangles drawn at their UV coordinates
function drawAtlasView() {
  const view = ui.atlasView;
  const ctx = view.getContext('2d')!;
  const s = view.width;
  ctx.drawImage(atlas, 0, 0, s, s);
  if (!ui.showWire.checked) return;
  ctx.strokeStyle = 'rgba(0,255,170,0.8)';
  ctx.lineWidth = 0.6;
  ctx.beginPath();
  const uv = data.uvs;
  for (let t = 0; t < data.indices.length; t += 3) {
    const [a, b, c] = [data.indices[t], data.indices[t + 1], data.indices[t + 2]];
    ctx.moveTo(uv[a * 2] * s, uv[a * 2 + 1] * s);
    ctx.lineTo(uv[b * 2] * s, uv[b * 2 + 1] * s);
    ctx.lineTo(uv[c * 2] * s, uv[c * 2 + 1] * s);
    ctx.closePath();
  }
  ctx.stroke();
}

ui.model.addEventListener('change', () => selectModel(ui.model.value));
ui.paint.addEventListener('input', updateAtlas);
ui.atlasMode.addEventListener('change', updateAtlas);
ui.showWire.addEventListener('change', drawAtlasView);
ui.exportBtn.addEventListener('click', async () => {
  ui.exportBtn.disabled = true;
  try {
    const blob = await exportGlb(data, atlas);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${def.id}-uv.glb`;
    a.click();
    URL.revokeObjectURL(url);
  } finally {
    ui.exportBtn.disabled = false;
  }
});

selectModel(MODELS[0].id);
glCtx.enable(glCtx.DEPTH_TEST);
glCtx.enable(glCtx.CULL_FACE); // every face is wound outward, so back faces can be culled

let spin = 0;
let last = performance.now();
function render(now: number) {
  if (ui.autoRotate.checked) spin += ((now - last) / 1000) * 0.4;
  last = now;
  glCtx.clearColor(0.05, 0.05, 0.15, 1);
  glCtx.clear(glCtx.COLOR_BUFFER_BIT | glCtx.DEPTH_BUFFER_BIT);
  if (mesh) {
    glCtx.useProgram(program);
    // model = rotateY(spin) * translate(-center), written out column-major
    const c = Math.cos(spin);
    const s = Math.sin(spin);
    const [cx, cy, cz] = center;
    const model = new Float32Array([c, 0, -s, 0, 0, 1, 0, 0, s, 0, c, 0, -(c * cx + s * cz), -cy, s * cx - c * cz, 1]);
    glCtx.activeTexture(glCtx.TEXTURE0);
    glCtx.bindTexture(glCtx.TEXTURE_2D, texture);
    uniforms.i('uBaseColor', 0);
    uniforms.i('uHasTexture', 1);
    glCtx.uniform4f(glCtx.getUniformLocation(program, 'uBaseColorFactor'), 1, 1, 1, 1);
    const angle = (Number(ui.light.value) * Math.PI) / 180;
    uniforms.m4('uModelMatrix', model);
    uniforms.m4('uViewMatrix', camera.view());
    uniforms.m4('uProjectionMatrix', projection);
    uniforms.v3('uLightPos', [5 * Math.cos(angle), 5, 5 * Math.sin(angle)]);
    uniforms.v3('uViewPos', camera.position());
    uniforms.i('uViewMode', Number(ui.viewMode.value));
    mesh.draw();
  }
  requestAnimationFrame(render);
}
requestAnimationFrame(render);
