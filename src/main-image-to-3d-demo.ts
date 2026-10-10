// Image to 3D: estimate depth from a 2D picture, displace a grid, preview it, export as GLB
import vertexSource from './shaders/model.vert.glsl?raw';
import fragmentSource from './shaders/model.frag.glsl?raw';
import { createProgram } from './webgl/shader-program';
import { createMesh, Mesh } from './webgl/mesh';
import { createUniforms } from './webgl/uniforms';
import { createOrbitCamera } from './webgl/orbit-camera';
import { identity, perspective } from './math/matrix';
import { estimateDepth, samplePixels, depthToImageData } from './image3d/depth';
import { buildRelief, ReliefMesh } from './image3d/relief';
import { exportGlb } from './image3d/glb-export';

const MAX_TEXTURE = 2048;

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
const camera = createOrbitCamera(canvas, 3);
const projection = perspective(Math.PI / 4, canvas.width / canvas.height, 0.05, 100);
const texture = glCtx.createTexture();

const ui = {
  imageFile: $<HTMLInputElement>('image-file'),
  depthFile: $<HTMLInputElement>('depth-file'),
  status: $('status'),
  stats: $('stats'),
  sat: $<HTMLInputElement>('sat'),
  blur: $<HTMLInputElement>('blur'),
  gamma: $<HTMLInputElement>('gamma'),
  invert: $<HTMLInputElement>('invert'),
  res: $<HTMLInputElement>('res'),
  scale: $<HTMLInputElement>('scale'),
  tear: $<HTMLInputElement>('tear'),
  solid: $<HTMLInputElement>('solid'),
  viewMode: $<HTMLSelectElement>('view-mode'),
  light: $<HTMLInputElement>('light'),
  exportBtn: $<HTMLButtonElement>('export'),
  colorPreview: $<HTMLCanvasElement>('color-preview'),
  depthPreview: $<HTMLCanvasElement>('depth-preview'),
};

// Source photo, stored at texture resolution; also used as the exported PNG
const colorCanvas = document.createElement('canvas');
let depthSource: HTMLCanvasElement | null = null;
let mesh: Mesh | null = null;
let relief: ReliefMesh | null = null;
let baseName = 'relief';

function drawPlaceholder() {
  colorCanvas.width = 1024;
  colorCanvas.height = 576;
  const ctx = colorCanvas.getContext('2d')!;
  const bg = ctx.createLinearGradient(0, 0, 0, 576);
  bg.addColorStop(0, '#1b1f3a');
  bg.addColorStop(1, '#3a1b2a');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, 1024, 576);
  const glow = ctx.createRadialGradient(512, 288, 10, 512, 288, 220);
  glow.addColorStop(0, '#ffd27a');
  glow.addColorStop(1, 'rgba(255,120,60,0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, 1024, 576);
  ctx.fillStyle = '#fff';
  ctx.font = 'bold 56px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('Drop an image here', 512, 300);
}

function setImage(source: CanvasImageSource & { width: number; height: number }) {
  const s = Math.min(1, MAX_TEXTURE / Math.max(source.width, source.height));
  colorCanvas.width = Math.round(source.width * s);
  colorCanvas.height = Math.round(source.height * s);
  colorCanvas.getContext('2d')!.drawImage(source, 0, 0, colorCanvas.width, colorCanvas.height);
  uploadTexture();
  rebuild();
}

function uploadTexture() {
  glCtx.bindTexture(glCtx.TEXTURE_2D, texture);
  glCtx.pixelStorei(glCtx.UNPACK_FLIP_Y_WEBGL, false);
  glCtx.texImage2D(glCtx.TEXTURE_2D, 0, glCtx.RGBA, glCtx.RGBA, glCtx.UNSIGNED_BYTE, colorCanvas);
  glCtx.generateMipmap(glCtx.TEXTURE_2D);
  glCtx.texParameteri(glCtx.TEXTURE_2D, glCtx.TEXTURE_MIN_FILTER, glCtx.LINEAR_MIPMAP_LINEAR);
  glCtx.texParameteri(glCtx.TEXTURE_2D, glCtx.TEXTURE_WRAP_S, glCtx.CLAMP_TO_EDGE);
  glCtx.texParameteri(glCtx.TEXTURE_2D, glCtx.TEXTURE_WRAP_T, glCtx.CLAMP_TO_EDGE);
}

function rebuild() {
  // Grid keeps the photo's aspect ratio; resolution = vertices along the longer side
  const res = Number(ui.res.value);
  const aspect = colorCanvas.height / colorCanvas.width;
  const W = aspect <= 1 ? res : Math.max(2, Math.round(res / aspect));
  const H = aspect <= 1 ? Math.max(2, Math.round(res * aspect)) : res;

  const depth = estimateDepth(
    samplePixels(depthSource ?? colorCanvas, W, H),
    {
      saturationWeight: Number(ui.sat.value),
      blurRadius: depthSource ? 0 : (Number(ui.blur.value) * res) / 256,
      invert: ui.invert.checked,
      gamma: Number(ui.gamma.value),
    },
    depthSource !== null
  );
  relief = buildRelief(depth, {
    depthScale: Number(ui.scale.value),
    tearThreshold: Number(ui.tear.value),
    solidBack: ui.solid.checked,
  });
  mesh?.dispose();
  mesh = createMesh(glCtx, program, relief);

  drawPreview(ui.colorPreview, colorCanvas);
  const depthCanvas = document.createElement('canvas');
  depthCanvas.width = W;
  depthCanvas.height = H;
  depthCanvas.getContext('2d')!.putImageData(depthToImageData(depth), 0, 0);
  drawPreview(ui.depthPreview, depthCanvas);

  ui.stats.textContent = `${W}x${H} grid, ${(relief.positions.length / 3).toLocaleString()} vertices, ${(relief.indices.length / 3).toLocaleString()} triangles`;
  updateLabels();
}

function drawPreview(target: HTMLCanvasElement, source: HTMLCanvasElement) {
  target.height = Math.round((target.width * source.height) / source.width);
  const ctx = target.getContext('2d')!;
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(source, 0, 0, target.width, target.height);
}

function updateLabels() {
  $('sat-value').textContent = ui.sat.value;
  $('blur-value').textContent = ui.blur.value;
  $('gamma-value').textContent = ui.gamma.value;
  $('res-value').textContent = ui.res.value;
  $('scale-value').textContent = ui.scale.value;
  $('tear-value').textContent = Number(ui.tear.value) >= 1 ? 'off' : ui.tear.value;
}

async function loadImageFile(file: File): Promise<ImageBitmap> {
  if (!file.type.startsWith('image/')) throw new Error(`${file.name} is not an image`);
  return createImageBitmap(file);
}

async function onImage(file: File) {
  try {
    const bitmap = await loadImageFile(file);
    baseName = file.name.replace(/\.[^.]+$/, '') || 'relief';
    depthSource = null;
    ui.depthFile.value = '';
    setImage(bitmap);
    bitmap.close();
    ui.status.textContent = `Loaded ${file.name} (${colorCanvas.width}x${colorCanvas.height}), heuristic depth`;
  } catch (err) {
    ui.status.textContent = `Error: ${(err as Error).message}`;
  }
}

async function onDepth(file: File) {
  try {
    const bitmap = await loadImageFile(file);
    depthSource = document.createElement('canvas');
    depthSource.width = bitmap.width;
    depthSource.height = bitmap.height;
    depthSource.getContext('2d')!.drawImage(bitmap, 0, 0);
    bitmap.close();
    rebuild();
    ui.status.textContent = `Using depth map ${file.name}`;
  } catch (err) {
    ui.status.textContent = `Error: ${(err as Error).message}`;
  }
}

ui.imageFile.addEventListener('change', () => ui.imageFile.files?.[0] && onImage(ui.imageFile.files[0]));
ui.depthFile.addEventListener('change', () => ui.depthFile.files?.[0] && onDepth(ui.depthFile.files[0]));

// Drag and drop onto the 3D view
const container = $('canvas-container');
container.addEventListener('dragover', (e) => {
  e.preventDefault();
  container.classList.add('dragover');
});
container.addEventListener('dragleave', () => container.classList.remove('dragover'));
container.addEventListener('drop', (e) => {
  e.preventDefault();
  container.classList.remove('dragover');
  const file = e.dataTransfer?.files[0];
  if (file) onImage(file);
});

// Rebuilding a 512-wide grid takes a moment, so coalesce slider input to one rebuild per frame
let pending = false;
const scheduleRebuild = () => {
  if (pending) return;
  pending = true;
  requestAnimationFrame(() => {
    pending = false;
    rebuild();
  });
};
[ui.sat, ui.blur, ui.gamma, ui.res, ui.scale, ui.tear].forEach((el) => el.addEventListener('input', scheduleRebuild));
[ui.invert, ui.solid].forEach((el) => el.addEventListener('change', scheduleRebuild));

ui.exportBtn.addEventListener('click', async () => {
  if (!relief) return;
  ui.exportBtn.disabled = true;
  try {
    const blob = await exportGlb(relief, colorCanvas);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${baseName}-3d.glb`;
    a.click();
    URL.revokeObjectURL(url);
    ui.status.textContent = `Exported ${a.download} (${(blob.size / 1048576).toFixed(1)} MB)`;
  } catch (err) {
    ui.status.textContent = `Export failed: ${(err as Error).message}`;
  } finally {
    ui.exportBtn.disabled = false;
  }
});

drawPlaceholder();
uploadTexture();
rebuild();

glCtx.enable(glCtx.DEPTH_TEST);
glCtx.disable(glCtx.CULL_FACE);
const model = identity();
function render() {
  glCtx.clearColor(0.05, 0.05, 0.15, 1);
  glCtx.clear(glCtx.COLOR_BUFFER_BIT | glCtx.DEPTH_BUFFER_BIT);
  if (mesh) {
    glCtx.useProgram(program);
    glCtx.activeTexture(glCtx.TEXTURE0);
    glCtx.bindTexture(glCtx.TEXTURE_2D, texture);
    uniforms.i('uBaseColor', 0);
    uniforms.i('uHasTexture', 1);
    glCtx.uniform4f(glCtx.getUniformLocation(program, 'uBaseColorFactor'), 1, 1, 1, 1);
    const angle = (Number(ui.light.value) * Math.PI) / 180;
    uniforms.m4('uModelMatrix', model);
    uniforms.m4('uViewMatrix', camera.view());
    uniforms.m4('uProjectionMatrix', projection);
    uniforms.v3('uLightPos', [3 * Math.cos(angle), 2, 3 + 3 * Math.sin(angle)]);
    uniforms.v3('uViewPos', camera.position());
    uniforms.i('uViewMode', Number(ui.viewMode.value));
    mesh.draw();
  }
  requestAnimationFrame(render);
}
render();
