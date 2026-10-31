// MS-06S Char's Zaku II: the Meshy AI image-to-3D model in a studio with shadows
import { perspective } from './math/matrix';
import { parseGlb } from './zaku/gltf-scene';
import { Viewer, Model } from './zaku/viewer';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const canvas = $<HTMLCanvasElement>('glcanvas');
const gl = canvas.getContext('webgl2', { antialias: true });
if (!gl) {
  alert('WebGL2 not supported');
  throw new Error('WebGL2 not supported');
}
const viewer = new Viewer(gl);
const HEIGHT = 5; // displayed height in scene units
const status = $('status');

// Meshy AI image-to-3D scan: one textured mesh of about a million vertices (76 MB)
const MESHY_URL = './Meshy_AI_Red_Mecha_Zaku_1031004947_image-to-3d-texture.glb';
let model: Model | null = null;

async function fetchWithProgress(url: string, label: string): Promise<ArrayBuffer> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  const total = Number(res.headers.get('Content-Length')) || 0;
  if (!res.body) return res.arrayBuffer();
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let loaded = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    loaded += value.length;
    status.textContent = `${label} ${(loaded / 1048576).toFixed(0)}${total ? ` / ${(total / 1048576).toFixed(0)}` : ''} MB…`;
  }
  const all = new Uint8Array(loaded);
  let o = 0;
  for (const c of chunks) { all.set(c, o); o += c.length; }
  return all.buffer;
}

fetchWithProgress(MESHY_URL, 'Loading')
  .then((buf) => {
    status.textContent = 'Building mesh…';
    const scene = parseGlb(buf);
    const m = viewer.upload(scene);
    const tris = scene.root.children.reduce((s, n) => s + n.primitives.reduce((t, p) => t + p.indices.length / 3, 0), 0);
    status.textContent = 'Decoding 4096 × 4096 textures…';
    // Show the model only once its textures are on the GPU, so it does not flash up untextured (white)
    return m.ready.then(() => {
      model = m;
      status.textContent = `${(tris / 1e6).toFixed(2)} M triangles · base colour + metallic-roughness + normal maps`;
    });
  })
  .catch((e) => { status.textContent = `Failed: ${e.message}`; console.error(e); });

// Stand the model on the floor, centred, scaled to HEIGHT
function placement(m: Model): Float32Array {
  const s = HEIGHT / (m.max[1] - m.min[1]);
  const cx = (m.min[0] + m.max[0]) / 2, cz = (m.min[2] + m.max[2]) / 2;
  return new Float32Array([s, 0, 0, 0, 0, s, 0, 0, 0, 0, s, 0, -cx * s, -m.min[1] * s, -cz * s, 1]);
}

// ---- Camera: orbit, presets ----
const orbit = { yaw: 0.45, pitch: 0.12, dist: 11 };
const PRESETS: Record<string, number> = { front: 0, three: 0.6, side: Math.PI / 2, back: Math.PI };
let yawGoal: number | null = null;
const ui = { spin: $<HTMLInputElement>('spin'), light: $<HTMLInputElement>('light') };
document.querySelectorAll<HTMLButtonElement>('[data-view]').forEach((b) => b.addEventListener('click', () => { yawGoal = PRESETS[b.dataset.view!]; ui.spin.checked = false; }));
let dragging = false;
canvas.addEventListener('pointerdown', (e) => { dragging = true; yawGoal = null; canvas.setPointerCapture(e.pointerId); });
canvas.addEventListener('pointerup', () => (dragging = false));
canvas.addEventListener('pointermove', (e) => {
  if (!dragging) return;
  orbit.yaw -= e.movementX * 0.008;
  orbit.pitch = Math.max(-0.2, Math.min(1.3, orbit.pitch + e.movementY * 0.006));
});
canvas.addEventListener('wheel', (e) => {
  e.preventDefault();
  orbit.dist = Math.max(4, Math.min(40, orbit.dist * Math.exp(e.deltaY * 0.001)));
}, { passive: false });
ui.light.addEventListener('input', () => {
  const a = (Number(ui.light.value) * Math.PI) / 180;
  const d: [number, number, number] = [Math.sin(a) * 0.55, 0.83, Math.cos(a) * 0.55];
  const l = Math.hypot(...d);
  viewer.keyDir = d.map((v) => v / l) as [number, number, number];
});

function resize() {
  const dpr = Math.min(devicePixelRatio, 2);
  canvas.width = Math.round(innerWidth * dpr);
  canvas.height = Math.round(innerHeight * dpr);
}
addEventListener('resize', resize);
resize();

// Optional URL parameters for screenshots: ?yaw=0&pitch=0.1&dist=11
const params = new URLSearchParams(location.search);
for (const k of ['yaw', 'pitch', 'dist'] as const) if (params.has(k)) orbit[k] = Number(params.get(k));
if (params.has('yaw')) ui.spin.checked = false;

let last = performance.now();
function frame(now: number) {
  const dt = Math.max(0, Math.min(0.05, (now - last) / 1000));
  last = now;
  if (ui.spin.checked && !dragging) orbit.yaw += dt * 0.35;
  if (yawGoal !== null) {
    let d = yawGoal - orbit.yaw;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    orbit.yaw += d * (1 - Math.exp(-dt * 5));
    if (Math.abs(d) < 1e-3) yawGoal = null;
  }
  const target: [number, number, number] = [-0.8, HEIGHT * 0.5, 0]; // leave room for the side panel
  const c = Math.cos(orbit.pitch);
  const eye: [number, number, number] = [
    target[0] + Math.sin(orbit.yaw) * c * orbit.dist,
    target[1] + Math.sin(orbit.pitch) * orbit.dist,
    target[2] + Math.cos(orbit.yaw) * c * orbit.dist,
  ];
  const items = model ? [{ model, matrix: placement(model) }] : [];
  viewer.render(items, eye, target, perspective((35 * Math.PI) / 180, canvas.width / canvas.height, 0.1, 200), canvas.width, canvas.height);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
