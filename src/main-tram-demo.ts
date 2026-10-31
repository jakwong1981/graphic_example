// Hong Kong tram #80 on a sakura-lined tram street: UV-textured tram, stops, bell, road traffic, petals, weather
import { perspective, lookAt } from './math/matrix';
import { hkTram, TRAM } from './models/hk-tram';
import { hkTaxi } from './models/hk-taxi';
import { kmbBus } from './models/kmb-bus';
import { car } from './models/car';
import { drawAtlas } from './models/atlas';
import { V3, add, sub, scale, cross, norm, qAxisAngle, qRotate, qMul, modelMatrix } from './sim/math';
import { paintCityMaterial } from './sim/city-textures';
import { ParticlePool } from './sim/particles';
import { WEATHER, WeatherName, blendWeather, cloneWeather, Rain } from './sim/weather';
import { SceneRenderer, Camera, Drawable, SceneLights, MAX_LAMPS, MAX_SPOTS, Walker } from './sim/scene-renderer';
import { applyTimeOfDay, formatHour, TimeOfDay } from './sim/daynight';
import { Windscreen } from './sim/windscreen';
import { Wiper, WiperMode, wiperSpeed, buildWiperMesh, WIPER, WIPER_PIVOT_LOCAL, LOWER_PANE, UPPER_PANE } from './tram/wiper';
import { exportGlb } from './image3d/glb-export';
import { loadGlb } from './loaders/glb';
import { rigMecha, walkPose, strideRate, MechaRig } from './tram/mecha-walker';
import { buildStreet, STREET_HALF, TRACKS, LANES, RAIL_TOP, CROSSINGS, ZEBRA_HALF, HSBC_SITE } from './tram/street';
import { parseGlb, flatten } from './zaku/gltf-scene';
import { Pedestrians, Mover, buildPersonMesh } from './tram/pedestrians';
import { FlyingCar, FlyInput, NO_INPUT } from './tram/flying-car';
import { paintCar, paintCarAtlas } from './tram/car-paint';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const canvas = $<HTMLCanvasElement>('glcanvas');
const gl = canvas.getContext('webgl2', { antialias: true, stencil: true }); // stencil: mecha shadows
if (!gl) {
  alert('WebGL2 not supported');
  throw new Error('WebGL2 not supported');
}
const glCtx: WebGL2RenderingContext = gl;
const renderer = new SceneRenderer(glCtx);

// ---- Scene ----
const street = buildStreet();
const statics: Drawable[] = [];
let seed = 11;
const proceduralTree: Drawable[] = []; // trunk and blossom of the built-in sakura (hidden once the model loads)
for (const [material, data] of street.batches) {
  const { color, emit } = paintCityMaterial(material, seed++);
  const d = renderer.mesh(data, renderer.tileTexture(color));
  if (emit) d.emitTexture = renderer.tileTexture(emit);
  d.emissive = material === 'signs';
  statics.push(d);
  if (material === 'bark' || material === 'blossom') proceduralTree.push(d);
}

// ---- Cherry blossom trees: the Meshy AI tree (reduced to 39k triangles by scripts/decimate-glb.ts) replaces the
// built-in ones at every planting spot. Until it has loaded, or if it fails, the built-in trees stay.
const TREE_HEIGHT = 7; // metres, like the built-in trees
const TREE_DEPTH = 0.5; // squash across the pavement so the canopy stays clear of the facades and the bus lane
let treeModel: { drawable: Drawable; matrices: Float32Array[] } | null = null;
loadGlb('./cherry-blossom-tree.glb')
  .then((m) => {
    if (!m.baseColorImage) throw new Error('no texture');
    const drawable = renderer.mesh(m, renderer.tileTexture(m.baseColorImage));
    drawable.doubleSided = true;
    const s0 = TREE_HEIGHT / (m.max[1] - m.min[1]);
    const cx = (m.min[0] + m.max[0]) / 2, cz = (m.min[2] + m.max[2]) / 2;
    // T(spot) * R_y(0 or pi) * S(sx, sy, sz) * T(-canopy centre, -bottom): canopy centred over the planting spot
    const matrices = street.trees.map((t, i) => {
      const s = s0 * t.scale;
      const flip = i % 2 ? -1 : 1; // half of them turned round, so they do not all look the same
      const sx = s * flip, sy = s, sz = s * TREE_DEPTH * flip;
      return new Float32Array([
        sx, 0, 0, 0,
        0, sy, 0, 0,
        0, 0, sz, 0,
        t.x - cx * sx, 0.15 - m.min[1] * sy, t.z - cz * sz, 1,
      ]);
    });
    treeModel = { drawable, matrices };
    for (const d of proceduralTree) statics.splice(statics.indexOf(d), 1);
  })
  .catch((e) => console.warn('Cherry blossom tree model not loaded, keeping the built-in trees:', e));
// ---- HSBC Main Building (public/hsbc.glb): a landmark beside the Bank of China Tower, at the same scale ----
// The scene's BOC is a 0.82 scale model (300 m to the mast tips against the real 367 m), so the real 179 m HSBC
// building becomes about 146 m. Lit like the rest of the city (sun, sky, fog, wet streets), with lit floors behind
// the glass after dark, a glowing sign, and a ground shadow cast with the mecha shadow pass.
const HSBC_HEIGHT = 179 * (300 / 367);
interface Landmark { parts: Drawable[]; shadow: Walker; scale: number; offset: V3 }
let hsbc: Landmark | null = null;
const solidTexture = (css: string) => {
  const c = document.createElement('canvas');
  c.width = c.height = 4;
  const x = c.getContext('2d')!;
  x.fillStyle = css;
  x.fillRect(0, 0, 4, 4);
  return renderer.tileTexture(c);
};
(async () => {
  const res = await fetch('./hsbc.glb');
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const scene = parseGlb(await res.arrayBuffer());
  const { batches, min, max } = flatten(scene);
  const white = solidTexture('#fff');
  const parts: Drawable[] = [];
  for (const b of batches) {
    const m = scene.materials[b.material];
    // glTF colour factors are linear; the world shader treats texture x vertex colour as sRGB
    const glass = /glass/i.test(m.name ?? '');
    const k = glass ? 0.72 : 1; // the glass reads too pale without transmission and reflections
    const c = [0, 1, 2].map((i) => Math.pow(m.color[i], 1 / 2.2) * k);
    const colors = new Float32Array((b.positions.length / 3) * 3);
    for (let i = 0; i < colors.length; i += 3) colors.set(c, i);
    let texture = white;
    if (m.image) {
      const bmp = await createImageBitmap(m.image, { imageOrientation: 'none', premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
      texture = renderer.tileTexture(bmp);
      bmp.close();
    }
    const d = renderer.mesh({ positions: b.positions, normals: b.normals, uvs: b.uvs, colors, indices: b.indices }, texture);
    d.doubleSided = true;
    if (glass) d.emitTexture = solidTexture('rgb(115,102,75)'); // offices lit behind the glass at night (about as bright as the city's office windows)
    if (/sign/i.test(m.name ?? '')) d.emissive = true; // illuminated sign
    parts.push(d);
  }
  // One rigid "walker" of the whole building, for the planar ground shadow
  const n = batches.reduce((t, b) => t + b.positions.length / 3, 0);
  const all = { positions: new Float32Array(n * 3), normals: new Float32Array(n * 3), uvs: new Float32Array(n * 2), indices: new Uint32Array(batches.reduce((t, b) => t + b.indices.length, 0)), rig: new Float32Array(n * 2) };
  let vo = 0, io = 0;
  for (const b of batches) {
    all.positions.set(b.positions, vo * 3);
    all.normals.set(b.normals, vo * 3);
    all.uvs.set(b.uvs, vo * 2);
    for (let i = 0; i < b.indices.length; i++) all.indices[io + i] = b.indices[i] + vo;
    vo += b.positions.length / 3;
    io += b.indices.length;
  }
  const scale = HSBC_HEIGHT / (max[1] - min[1]);
  // street-facing side (+z, the side with the exterior masts) towards the tram street
  hsbc = { parts, shadow: renderer.walker(all, white), scale, offset: [-(min[0] + max[0]) / 2, -min[1], -(min[2] + max[2]) / 2] };
  // a solid block for the flying car (the masts and the roof crane stick out a little)
  const hx = ((max[0] - min[0]) / 2) * scale, hz = ((max[2] - min[2]) / 2) * scale;
  street.solids.push({ min: [HSBC_SITE.x - hx, 0, HSBC_SITE.z - hz], max: [HSBC_SITE.x + hx, HSBC_HEIGHT, HSBC_SITE.z + hz] });
})().catch((e) => console.warn('HSBC building not loaded:', e));
const NO_POSE = { hipR: [0, 0, 0], hipL: [0, 0, 0], kneeR: [0, 0, 0], kneeL: [0, 0, 0], hipAngleR: 0, hipAngleL: 0, kneeAngleR: 0, kneeAngleL: 0 };
const UPRIGHT = qAxisAngle([0, 1, 0], 0);
/** Draws the copies of the HSBC building near the camera; returns the matrix of the nearest one (for its shadow) */
function drawHsbc(camX: number): Float32Array | null {
  if (!hsbc) return null;
  let nearest: Float32Array | null = null, best = Infinity;
  for (const dx of OFFSETS) {
    const x = HSBC_SITE.x + dx;
    const d = Math.abs(x - camX);
    if (d > 800) continue;
    const M = modelMatrix([x, 0, HSBC_SITE.z], UPRIGHT, hsbc.scale, hsbc.offset);
    for (const p of hsbc.parts) renderer.draw(p, M);
    if (d < best) { best = d; nearest = M; }
  }
  return nearest;
}
const treeOffset = new Float32Array(16);
/** Draws each tree once, in the copy of the street nearest the camera */
function drawTrees(camX: number) {
  if (!treeModel) return;
  for (const M of treeModel.matrices) {
    const rel = wrapX(M[12] - camX); // trunk x relative to the camera, in the nearest copy
    if (Math.abs(rel) > 260) continue;
    treeOffset.set(M);
    treeOffset[12] = camX + rel;
    renderer.draw(treeModel.drawable, treeOffset);
  }
}

// Trams: #80 in its red advert livery runs eastbound; a green tram runs the other way
const tram80 = renderer.model(hkTram);
const tramGreen = renderer.model({ ...hkTram, paint: '#1f7a3d' });
const atlasCanvas = document.createElement('canvas');
drawAtlas(atlasCanvas, hkTram.regions, hkTram.painters, hkTram.paint, 'painted');
$<HTMLCanvasElement>('atlas').getContext('2d')!.drawImage(atlasCanvas, 0, 0, 512, 512);

interface Tram {
  x: number;
  v: number;
  dir: 1 | -1;
  z: number;
  dwell: number;
  model: Drawable;
}
const STOPS: { x: number; name: string }[] = [
  { x: -150, name: '軒尼詩道 Hennessy Rd' },
  { x: -40, name: '修頓球場 Southorn Playground' },
  { x: 26, name: '和昌大押 The Pawn' },
  { x: 130, name: '金鐘 Admiralty' },
];
const trams: Tram[] = [
  { x: -95, v: 0, dir: 1, z: TRACKS[0], dwell: 0, model: tram80 },
  { x: 60, v: 6, dir: -1, z: TRACKS[1], dwell: 0, model: tramGreen },
];
const main = trams[0];

// The street is built for x in [-S, S) and drawn three times (offsets -PERIOD, 0, +PERIOD),
// so it looks endless; everything that moves wraps into [-S, S).
const PERIOD = 2 * STREET_HALF;
const OFFSETS = [-PERIOD, 0, PERIOD];
const wrapX = (x: number) => ((((x + STREET_HALF) % PERIOD) + PERIOD) % PERIOD) - STREET_HALF;
const offsetMatrices = OFFSETS.map((dx) => new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, dx, 0, 0, 1]));

// ---- Road traffic: taxis, buses and cars with simple car-following ----
// lightY / halfW: headlight height and half spacing in metres; `mecha` marks a walking giant (drawn separately)
interface Mecha {
  rig: MechaRig; walker: Walker; phase: number; amount: number; zOffset: number; role: MechaRole;
  headHalf: number; // half width of the head (m), for lamp clearance
  inward: number; // current sidestep towards the road centre (m)
  turn: number; // body yaw while sidestepping (radians)
  eyeColor: number[];
  eyeGlow: ParticlePool; // one sprite at the eye, additive
  stepCos: [number, number]; // last cos(phase) of each leg, to catch the moment a foot comes down
}
interface FleetEntry { model: Drawable; scale: number; len: number; lightY: number; halfW: number; mecha?: Mecha }
const fleet: FleetEntry[] = [
  { model: renderer.model(hkTaxi), scale: 2.0, len: 5, lightY: 0.7, halfW: 0.65 },
  { model: renderer.model(hkTaxi), scale: 2.0, len: 5, lightY: 0.7, halfW: 0.65 },
  { model: renderer.model({ ...hkTaxi, paint: '#2e9e44' }), scale: 2.0, len: 5, lightY: 0.7, halfW: 0.65 },
  { model: renderer.model(kmbBus), scale: 1, len: 12.3, lightY: 0.9, halfW: 0.95 },
  { model: renderer.model({ ...car, paint: '#f2f2f2' }), scale: 1.9, len: 4.6, lightY: 0.65, halfW: 0.65 },
  { model: renderer.model({ ...car, paint: '#1b1b1f' }), scale: 1.9, len: 4.6, lightY: 0.65, halfW: 0.65 },
  { model: renderer.model({ ...car, paint: '#1f4fa8' }), scale: 1.9, len: 4.6, lightY: 0.65, halfW: 0.65 },
];
interface Vehicle { lane: 0 | 1; x: number; v: number; vmax: number; kind: number }
const vehicles: Vehicle[] = [];
for (let i = 0; i < 28; i++) {
  const lane = (i % 2) as 0 | 1;
  vehicles.push({ lane, x: -STREET_HALF + (i >> 1) * 34 + Math.random() * 10, v: 8, vmax: 9 + Math.random() * 5, kind: Math.floor(Math.random() * fleet.length) });
}
// Ice cream van (scanned GLB model, 4.8 m, front = +x like the other vehicles): loads in the background,
// then two vehicles, one per direction, turn into vans
loadGlb('./icecream-van.glb')
  .then((m) => {
    const texture = m.baseColorImage ? renderer.tileTexture(m.baseColorImage) : renderer.tileTexture(document.createElement('canvas'));
    const model = renderer.mesh(m, texture);
    model.doubleSided = true;
    const kind = fleet.push({ model, scale: 1, len: m.max[0] - m.min[0], lightY: 0.8, halfW: 0.8 }) - 1;
    for (const lane of [0, 1]) {
      const v = vehicles.find((c) => c.lane === lane && fleet[c.kind].len < 6); // a car-sized slot
      if (v) { v.kind = kind; v.vmax = Math.min(v.vmax, 10); } // vans are in no hurry
    }
  })
  .catch((e) => console.warn('Ice cream van not loaded:', e));

// ---- Walking mechas: Meshy AI image-to-3D scans with automatically rigged legs (see tram/mecha-walker.ts) ----
// Each one takes a car's place in a traffic lane (the cars behind queue up). They are sized to fit between the
// tram and the kerb, and walk a little towards the pavement.
//  - walk:     the Zaku and the Mecha Figure walk down the eastbound lane at their own pace (trams and cars pass)
//  - oncoming: the Psycho Mk-II walks towards the #80 tram in the westbound lane; once it has passed, it comes
//              round again from further up the street
// Both ease towards the road centre to keep their heads clear of the street lamp arms (see avoidLamps).
type MechaRole = 'walk' | 'oncoming';
const MECHAS = [
  // start: metres ahead of the #80 tram at load time (negative: behind it, in view of the default street camera)
  // eye: colour of the eye glow (linear RGB)
  { url: './Meshy_AI_Red_Mecha_Zaku_1031004947_image-to-3d-texture.glb', name: '渣古 Zaku', height: 8.5, lane: 0 as const, role: 'walk' as MechaRole, start: 45, eye: [1.0, 0.1, 0.45] },
  { url: './Meshy_AI_gundam_mecha_model_1031011724_image-to-3d-texture.glb', name: '精神感應 Mk-II', height: 8, lane: 1 as const, role: 'oncoming' as MechaRole, start: 160, eye: [0.25, 1.0, 0.45] },
  { url: './Meshy_AI_Mecha_Figure_1031021918_image-to-3d-texture.glb', name: '機械人 Mecha Figure', height: 8.5, lane: 0 as const, role: 'walk' as MechaRole, start: -30, eye: [0.3, 0.75, 1.0] },
];
const ONCOMING_START = 160; // the Psycho Mk-II comes round again this far ahead of the tram
const ONCOMING_END = -70; // and is sent round again once it is this far behind
const MECHA_SPEED = 3.2; // m/s: a brisk giant's walk
const mechaStatus = $('mecha-status');
const mechaNames = new Map<Vehicle, string>();
async function loadMecha(def: (typeof MECHAS)[number]) {
  const res = await fetch(def.url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const rig = rigMecha(await res.arrayBuffer());
  if (!rig.image) throw new Error('no base colour texture');
  const bmp = await createImageBitmap(rig.image, { imageOrientation: 'none', premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
  const walker = renderer.walker(rig.mesh, renderer.tileTexture(bmp));
  bmp.close();
  const scale = def.height / (rig.max[1] - rig.min[1]);
  const width = (rig.max[0] - rig.min[0]) * scale;
  const len = (rig.max[2] - rig.min[2]) * scale; // its depth: walking along x, the model's z becomes the length
  // Keep its inner side clear of the tram (tram side at |z| = 3.1)
  const zOffset = Math.max(0, 3.25 + width / 2 - Math.abs(LANES[def.lane]));
  // Head width: the x extent of the vertices in the top 12% of the model (the head and antenna)
  let hx0 = Infinity, hx1 = -Infinity;
  const P = rig.mesh.positions, yTop = rig.max[1] - 0.12 * (rig.max[1] - rig.min[1]);
  for (let i = 0; i < P.length; i += 3) if (P[i + 1] > yTop) { hx0 = Math.min(hx0, P[i]); hx1 = Math.max(hx1, P[i]); }
  const headHalf = Number.isFinite(hx0) ? ((hx1 - hx0) / 2) * scale : 0.7;
  const mecha: Mecha = {
    rig, walker, phase: 0, amount: 0, zOffset, role: def.role, headHalf, inward: 0, turn: 0,
    eyeColor: def.eye, eyeGlow: new ParticlePool(glCtx, renderer.particle, 1, 0, 0), stepCos: [1, 1],
  };
  const kind = fleet.push({ model: fleet[0].model, scale, len, lightY: 0, halfW: 0, mecha }) - 1;
  let v = vehicles.find((c) => c.lane === def.lane && !fleet[c.kind].mecha && fleet[c.kind].len < 6);
  if (!v) vehicles.push((v = { lane: def.lane, x: 0, v: 0, vmax: 0, kind }));
  v.kind = kind;
  v.vmax = MECHA_SPEED;
  v.v = MECHA_SPEED;
  v.x = wrapX(main.x + def.start);
  // clear cars standing where it appears
  for (const o of vehicles) if (o !== v && o.lane === v.lane && !fleet[o.kind].mecha && Math.abs(wrapX(o.x - v.x)) < 15) o.x = wrapX(v.x + (def.lane === 0 ? 30 : -30));
  mechaNames.set(v, def.name);
  return def.name;
}
// Load one after the other: each file is 75-120 MB
(async () => {
  const done: string[] = [];
  for (const def of MECHAS) {
    mechaStatus.textContent = `載入 Loading ${def.name}…`;
    try { done.push(await loadMecha(def)); } catch (e) { console.warn(`${def.name} not loaded:`, e); }
  }
  mechaStatus.textContent = done.length ? `${done.join(' + ')} 行緊 walking` : '載入失敗 Not loaded';
})();
// ---- Mecha effects: ground shadows, eye glow, footstep dust / splashes and a little camera shake ----
const dust = new ParticlePool(glCtx, renderer.particle, 1500, 1.4, 0.25);
const noFlame = new ParticlePool(glCtx, renderer.particle, 1, 0, 0);
let shake = 0; // camera shake amplitude (m), decays
/** World matrix of a mecha this frame (the copy of the street nearest the camera) */
function mechaMatrix(v: Vehicle, f: FleetEntry, near: number, drop: number): Float32Array {
  const m = f.mecha!;
  const { min, max } = m.rig;
  const side = Math.sign(LANES[v.lane]);
  const z = side * (Math.abs(LANES[v.lane]) + m.zOffset - m.inward);
  // the model faces +z: face the direction of travel (+x eastbound, -x westbound), turned a little towards the
  // road centre (-side in z) while sidestepping. yaw = atan2(facing x, facing z)
  const dir = v.lane === 0 ? 1 : -1;
  const yaw = Math.atan2(dir * Math.cos(m.turn), -side * Math.sin(m.turn));
  const x = near + wrapX(v.x - near);
  return modelMatrix([x, -drop * f.scale, z], qAxisAngle([0, 1, 0], yaw), f.scale, [-(min[0] + max[0]) / 2, -min[1], -(min[2] + max[2]) / 2]);
}
const xform = (M: Float32Array, p: number[]): V3 => [
  M[0] * p[0] + M[4] * p[1] + M[8] * p[2] + M[12],
  M[1] * p[0] + M[5] * p[1] + M[9] * p[2] + M[13],
  M[2] * p[0] + M[6] * p[1] + M[10] * p[2] + M[14],
];
/** A foot has just come down: kick up dust (or spray in the rain) and shake the camera if it is close */
function footstep(v: Vehicle, f: FleetEntry, leg: 0 | 1, eye: V3) {
  const m = f.mecha!;
  const M = mechaMatrix(v, f, eye[0], 0);
  const hip = leg === 0 ? m.rig.pivots.hipR : m.rig.pivots.hipL;
  const knee = leg === 0 ? m.rig.pivots.kneeR : m.rig.pivots.kneeL;
  const foot = xform(M, [hip[0], m.rig.min[1], knee[2]]);
  foot[1] = Math.abs(foot[2]) > 7 ? 0.2 : 0.05;
  const wet = weather.rain;
  const n = Math.round(22 * m.amount);
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2;
    const sp = 1.2 + Math.random() * 2.2;
    const p: V3 = [foot[0] + Math.cos(a) * 0.8, foot[1] + 0.1, foot[2] + Math.sin(a) * 0.8];
    if (wet > 0.3 && i % 2 === 0) {
      // water thrown up from the wet road: brighter, quicker, falls back
      dust.emit(p, [Math.cos(a) * sp * 1.3, 2.5 + Math.random() * 2, Math.sin(a) * sp * 1.3], { life: 0.7 + Math.random() * 0.3, size0: 0.25, size1: 0.6, alpha: 0.55, shade: 1.15 });
    } else {
      dust.emit(p, [Math.cos(a) * sp, 0.3 + Math.random() * 0.8, Math.sin(a) * sp], { life: 1.4 + Math.random() * 0.8, size0: 0.6, size1: 2.4 + Math.random(), alpha: 0.45 * (1 - wet * 0.6), shade: 0.72 + Math.random() * 0.1 });
    }
  }
  const d = Math.hypot(foot[0] - eye[0], foot[1] - eye[1], foot[2] - eye[2]);
  shake = Math.max(shake, 0.22 * m.amount * Math.max(0, 1 - d / 70));
}

// ---- Flying car: the Meshy AI red sports car (reduced to 40k triangles in public/flying-car.glb by
// scripts/decimate-glb.ts) held up by four lift jets under the body. It hovers over the street until the flying
// camera (F) hands you the controls: W/S or arrows to drive, A/D or arrows to steer, Space/E up, Shift/Q down.
const CAR_LENGTH = 4.6; // metres, about a Tesla Model S
const CAR_MODEL_YAW = Math.PI; // the Meshy model's nose points along -x: turn it to +x
interface CarModel { parts: Drawable[]; shadow: Walker; scale: number; offset: V3; jets: V3[]; heads: V3[]; tails: V3[] }
let carModel: CarModel | null = null;
// starts hovering low over the middle of the road, level with the street lamps: the tram wires (z = +-2.1) and
// the lamp heads (z = +-5.3) are clear of the 2.2 m wide body there
const flyer = new FlyingCar([30, 7, 0], 0, [CAR_LENGTH / 2, 0.65, 1.1]);
// Height slider: sets the height the car holds; climbing or descending with the keys moves the slider along
const heightUi = { slider: $<HTMLInputElement>('fly-height'), label: $('fly-height-val') };
heightUi.slider.min = String(FlyingCar.MIN_HEIGHT);
const showHeight = () => {
  heightUi.label.textContent = flyer.hold.toFixed(1);
  heightUi.slider.setAttribute('aria-valuetext', `${flyer.hold.toFixed(1)} m`);
};
heightUi.slider.addEventListener('input', () => { flyer.hold = Number(heightUi.slider.value); showHeight(); });
heightUi.slider.value = String(flyer.hold);
showHeight();
loadGlb('./flying-car.glb')
  .then((m) => {
    // smoothed surface; the body panels get their own UV layout and a painted atlas (lights glow after dark);
    // dark tyres / rims / cockpit in vertex colours (see car-paint.ts)
    const white = solidTexture('#fff');
    const { body: paintwork, trim } = paintCar(m, m.min, m.max);
    const atlas = paintCarAtlas();
    const body = renderer.mesh(paintwork, renderer.tileTexture(atlas.color));
    body.emitTexture = renderer.tileTexture(atlas.emit);
    body.doubleSided = true;
    const trimDrawable = renderer.mesh(trim, white);
    trimDrawable.doubleSided = true;
    const s = CAR_LENGTH / (m.max[0] - m.min[0]);
    const W = (m.max[2] - m.min[2]) * s, H = (m.max[1] - m.min[1]) * s;
    flyer.resize([CAR_LENGTH / 2, H / 2, W / 2]);
    const n = m.positions.length / 3;
    const shadow = renderer.walker({ positions: m.positions, normals: m.normals, uvs: m.uvs, indices: Uint32Array.from(m.indices), rig: new Float32Array(n * 2) }, solidTexture('#fff'));
    // points in the car's frame (metres from the centre of the underside, nose along +x)
    const L = CAR_LENGTH;
    const jets: V3[] = [];
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) jets.push([sx * 0.3 * L, 0.15, sz * 0.3 * W]);
    const heads: V3[] = [-1, 1].map((sz) => [L / 2 - 0.1, H * 0.42, sz * 0.33 * W]);
    const tails: V3[] = [-1, 1].map((sz) => [-L / 2 + 0.08, H * 0.5, sz * 0.36 * W]);
    carModel = { parts: [body, trimDrawable], shadow, scale: s, offset: [-(m.min[0] + m.max[0]) / 2, -m.min[1], -(m.min[2] + m.max[2]) / 2], jets, heads, tails };
  })
  .catch((e) => console.warn('Flying car model not loaded:', e));
const flames = new ParticlePool(glCtx, renderer.particle, 2400, 3.0, 3.0); // drag, then the hot gas rises
const jetWash = new ParticlePool(glCtx, renderer.particle, 600, 1.2, 0.4); // dust / spray blown off the ground
const jetGlow = new ParticlePool(glCtx, renderer.particle, 8, 0, 0); // bright nozzle cores
const keys = new Set<string>();
addEventListener('keydown', (e) => keys.add(e.code));
addEventListener('keyup', (e) => keys.delete(e.code));
addEventListener('blur', () => keys.clear());
const held = (...codes: string[]) => codes.some((c) => keys.has(c));
function flyInput(): FlyInput {
  return {
    throttle: (held('KeyW', 'ArrowUp') ? 1 : 0) - (held('KeyS', 'ArrowDown') ? 1 : 0),
    turn: (held('KeyA', 'ArrowLeft') ? 1 : 0) - (held('KeyD', 'ArrowRight') ? 1 : 0),
    lift: (held('Space', 'KeyE') ? 1 : 0) - (held('ShiftLeft', 'ShiftRight', 'KeyQ') ? 1 : 0),
  };
}
(window as any).dbgSnap = (yaw = 0, pitch = 0.2, dist = 12) => { orbit.yaw = behindCar() + yaw; orbit.pitch = pitch; orbit.dist = dist; goal = null; flyLook = yaw; }; // TEMP-FLY
let carX = flyer.pos[0]; // x of the copy of the car drawn this frame (nearest the camera)
const carPos = (): V3 => [carX, flyer.pos[1] + Math.sin(time * 1.7) * 0.08 * (1 - Math.min(1, flyer.speed / 6)), flyer.pos[2]];
const carRotation = () => qMul(flyer.rotation, qAxisAngle([0, 1, 0], CAR_MODEL_YAW));
function carMatrix(): Float32Array | null {
  if (!carModel) return null;
  return modelMatrix(carPos(), carRotation(), carModel.scale, carModel.offset);
}
function updateCar(dt: number, flying: boolean, eye: V3) {
  const holdBefore = flyer.hold;
  flyer.update(dt, flying ? flyInput() : NO_INPUT, street.solids, PERIOD);
  if (flyer.hold !== holdBefore && document.activeElement !== heightUi.slider) {
    heightUi.slider.value = String(Math.min(Number(heightUi.slider.max), flyer.hold));
    showHeight();
  }
  flyer.pos[0] = wrapX(flyer.pos[0]);
  if (flyer.impact > 3) shake = Math.max(shake, Math.min(0.5, flyer.impact * 0.04));
  flyer.impact = 0;
  // the copy nearest the camera; particles move with it when that changes
  const x = eye[0] + wrapX(flyer.pos[0] - eye[0]);
  if (x !== carX) { flames.shift(x - carX); jetWash.shift(x - carX); }
  carX = x;
  flames.update(dt);
  jetWash.update(dt);
  jetGlow.count = 0;
  if (!carModel) return;
  const q = flyer.rotation; // car frame (nose +x), not the model's
  const p = carPos();
  const down = qRotate(q, [0, -1, 0]);
  const t = flyer.thrust;
  const v = flyer.vel;
  for (const j of carModel.jets) {
    const n = qRotate(q, j);
    const o: V3 = [p[0] + n[0], p[1] + n[1], p[2] + n[2]];
    glow(jetGlow, add(o, scale(down, 0.1)), 0.9 + 0.7 * t, 0.6 + 0.6 * t);
    // a short, hot plume blasted downwards; the sprites take on the car's speed so the jet stays attached
    const count = Math.floor(220 * (0.4 + t) * dt + Math.random()); // sprites per second per jet, rounded at random
    for (let i = 0; i < count; i++) {
      const sp = 9 + 9 * t + Math.random() * 4;
      const jx = (Math.random() - 0.5) * 1.6, jz = (Math.random() - 0.5) * 1.6;
      const at = Math.random() * 0.3; // spread along the jet, so it does not flicker at low frame rates
      flames.emit(add(o, scale(down, at)), [down[0] * sp + jx + v[0], down[1] * sp + v[1] * 0.9, down[2] * sp + jz + v[2]], {
        life: 0.12 + 0.12 * t + Math.random() * 0.08, size0: 0.28 + 0.12 * t, size1: 0.75 + 0.5 * t, alpha: 0.75,
      });
    }
  }
  // close to the ground the jets kick up dust, or spray off a wet road
  const alt = flyer.pos[1];
  if (alt < 9) {
    const k = (1 - alt / 9) * t;
    const wet = weather.rain;
    const ground = Math.abs(p[2]) > 7 ? 0.17 : 0.03;
    for (let i = 0, n = Math.floor(160 * k * dt + Math.random()); i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = 4 + Math.random() * 5;
      const g: V3 = [p[0] + Math.cos(a) * 1.2, ground + 0.1, p[2] + Math.sin(a) * 1.2];
      jetWash.emit(g, [Math.cos(a) * sp + v[0] * 0.5, 0.4 + Math.random() * (wet > 0.3 ? 2.5 : 0.8), Math.sin(a) * sp + v[2] * 0.5], {
        life: 0.8 + Math.random() * 0.6, size0: 0.5, size1: 2.2, alpha: 0.35 * k + 0.1, shade: wet > 0.3 ? 1.1 : 0.75 + Math.random() * 0.1,
      });
    }
  }
}
/** The jets light up the car's underside and the street below like a warm lamp; head and tail lights after dark */
function carLights() {
  if (!carModel) return;
  const q = flyer.rotation;
  const p = carPos();
  const slot = Math.min(lights.lampCount, MAX_LAMPS - 1);
  lights.lamps.set([p[0], p[1] - 0.4, p[2], 2.5 * flyer.thrust * (0.35 + 0.65 * lampK)], slot * 4);
  lights.lampCount = slot + 1;
  if (headK < 0.01) return;
  for (const h of carModel.heads) glow(headGlow, add(p, qRotate(q, h)), 0.6, headK);
  for (const t of carModel.tails) glow(tailGlow, add(p, qRotate(q, t)), 0.4, 0.8 * headK);
}

// ---- Street lamp avoidance ----
// The lamp arms reach over the kerb lanes at 7.5-7.9 m, about head height for the mechas. While passing a lamp a
// mecha eases sideways towards the road centre until its head is clear of the arm, then eases back. That brings it
// over the tram track on its side, so it only steps in when no tram is about to pass; otherwise it slows down and
// waits before the lamp until the tram has gone by.
const LAMP_ZONE = [4, 14]; // fully sidestepped within 4 m of a lamp, back in the lane beyond 14 m
const lampXs = [-1, 1].map((side) => street.lamps.filter((l) => Math.sign(l[2]) === side));
const smoothstep = (a: number, b: number, x: number) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
/** Updates the sidestep and returns the walking speed to aim for */
function avoidLamps(v: Vehicle, m: Mecha, dt: number): number {
  const dir = v.lane === 0 ? 1 : -1;
  const side = Math.sign(LANES[v.lane]);
  const lamps = lampXs[side < 0 ? 0 : 1];
  // nearest lamp on this kerb, signed distance along the walking direction (> 0: still ahead)
  let d = Infinity, head = 5.3;
  for (const l of lamps) {
    const dl = wrapX(l[0] - v.x) * dir;
    if (Math.abs(dl) < Math.abs(d)) { d = dl; head = Math.abs(l[2]); }
  }
  const lane = Math.abs(LANES[v.lane]) + m.zOffset; // |z| of its path
  const clear = head - 0.55 - m.headHalf - 0.3; // |z| at which the head passes inside the lamp housing
  const need = Math.max(0, lane - clear);
  let want = need * (1 - smoothstep(LAMP_ZONE[0], LAMP_ZONE[1], Math.abs(d)));
  // Tram on the track it would step over, going the same way: is one inside the danger window?
  let target = MECHA_SPEED;
  const tramNear = trams.some((t) => {
    if (t.z !== TRACKS[v.lane] || t.dir !== dir) return false;
    const rel = wrapX(t.x - v.x) * dir; // > 0: the tram is ahead of the mecha
    return rel > -70 && rel < TRAM.L + 8; // coming up from behind, or alongside
  });
  if (tramNear && m.inward < 0.2 && want > 0.2) {
    want = 0; // do not step in front of the tram
    if (d > 0) target = Math.min(target, Math.max(0, (d - LAMP_ZONE[1]) * 0.8)); // stop short of the lamp and wait
  }
  const prev = m.inward;
  m.inward += (want - m.inward) * Math.min(1, dt * 1.6); // ease, never jump
  // lean the body a little into the sidestep
  const lateral = (m.inward - prev) / Math.max(dt, 1e-3);
  m.turn += (Math.atan2(lateral, Math.max(0.5, v.v)) * 0.8 - m.turn) * Math.min(1, dt * 4);
  return target;
}

// Mechas step over anything in the way: pedestrians see them coming and wait (see the movers list), and the cars
// behind queue up.
function updateMechas(dt: number) {
  const L = 2 * STREET_HALF;
  for (const v of vehicles) {
    const f = fleet[v.kind];
    if (!f.mecha) continue;
    let target = avoidLamps(v, f.mecha, dt);
    // Keep a safe distance behind another mecha in the same lane (e.g. one waiting at a lamp for a tram)
    const dir = v.lane === 0 ? 1 : -1;
    for (const o of vehicles) {
      if (o === v || o.lane !== v.lane || !fleet[o.kind].mecha) continue;
      const gap = wrapX(o.x - v.x) * dir - (fleet[o.kind].len + f.len) / 2;
      if (gap > -2) target = Math.min(target, Math.max(0, (gap - 6) * 0.6));
    }
    v.v += (target - v.v) * Math.min(1, dt * (target < v.v ? 2.5 : 1.2));
    if (f.mecha.role === 'oncoming' && wrapX(v.x - main.x) < ONCOMING_END) {
      // it has walked past the tram: send it round to come towards the tram again
      v.x = wrapX(main.x + ONCOMING_START);
      f.mecha.inward = 0;
    }
    v.x += (v.lane === 0 ? 1 : -1) * v.v * dt;
    if (v.x > STREET_HALF) v.x -= L;
    if (v.x < -STREET_HALF) v.x += L;
    const m = f.mecha;
    const moving = v.v > 0.15;
    m.amount += ((moving ? Math.min(1, v.v / 1.5) : 0) - m.amount) * Math.min(1, dt * 3); // legs settle when it stops
    if (moving) m.phase += (v.v * dt) / strideRate(m.rig, f.scale);
    // A foot comes down when its leg starts moving back (cos of its phase turns negative); the right leg is half
    // a cycle behind the left (see walkPose)
    for (const leg of [0, 1] as const) {
      const c = Math.cos(m.phase + (leg === 0 ? Math.PI : 0));
      if (m.stepCos[leg] >= 0 && c < 0 && m.amount > 0.3 && prevEye) footstep(v, f, leg, prevEye);
      m.stepCos[leg] = c;
    }
  }
}

// ---- Zebra crossings: anything on the road gives way when someone is on or waiting at a crossing ----
const peds = new Pedestrians(80);
const crowd = renderer.crowd(buildPersonMesh(), 80);

const CAR_DECEL = 6;
const TRAM_DECEL = 1.1 * 1.6;
/** Distance from the front to the stop line of the next occupied crossing this mover can still stop for */
// queueRear: rear of a slow vehicle ahead; cars do not stop on the stripes when the queue has no room past them
function zebraGap(x: number, dir: number, half: number, v: number, decel: number, queueRear: number | null = null) {
  let best = Infinity;
  CROSSINGS.forEach((c, i) => {
    const cx = x + wrapX(c - x);
    const gap = (cx - dir * (ZEBRA_HALF + 1.2) - (x + dir * half)) * dir;
    const room = queueRear === null ? Infinity : ((((queueRear - (cx + dir * (ZEBRA_HALF + 0.5))) * dir) % PERIOD) + PERIOD) % PERIOD;
    const jammed = gap < 40 && room < 2 * half + 1;
    if (!peds.blocked[i] && !jammed) return;
    // still stops if it crept past the line, unless it can no longer stop before the stripes
    if (gap > -1.25 && gap + 1.2 >= (v * v) / (2 * decel) - 0.3) best = Math.min(best, gap);
  });
  return best;
}

function updateTraffic(dt: number) {
  const L = 2 * STREET_HALF;
  for (const lane of [0, 1] as const) {
    const dir = lane === 0 ? 1 : -1; // keep left: eastbound on the -z side
    const list = vehicles.filter((v) => v.lane === lane).sort((a, b) => (a.x - b.x) * dir);
    list.forEach((v, i) => {
      if (fleet[v.kind].mecha) return; // mechas walk on their own (walkMechas); cars treat them as the car ahead
      const ahead = list[(i + 1) % list.length];
      let gap = (ahead.x - v.x) * dir;
      if (gap <= 0) gap += L; // the leader follows the last car around the wrap
      gap -= (fleet[ahead.kind].len + fleet[v.kind].len) / 2;
      gap = Math.min(gap, zebraGap(v.x, dir, fleet[v.kind].len / 2, v.v, CAR_DECEL, ahead.v < 2 ? ahead.x - dir * fleet[ahead.kind].len / 2 : null) + 2.4); // stop ~0.6 m before the line
      const target = Math.max(0, Math.min(v.vmax, (gap - 3) * 0.7));
      v.v += Math.max(-6, Math.min(2, (target - v.v) * 2)) * dt;
      v.x += dir * Math.max(0, v.v) * dt;
      if (v.x > STREET_HALF) v.x -= L;
      if (v.x < -STREET_HALF) v.x += L;
    });
  }
}

// ---- Tram driving: accelerate, brake for stops, dwell, ring the bell ----
const ui = {
  drive: $<HTMLInputElement>('drive'),
  stops: $<HTMLInputElement>('stops'),
  speed: $<HTMLInputElement>('speed'),
  petals: $<HTMLInputElement>('petals'),
  traffic: $<HTMLInputElement>('traffic'),
  peds: $<HTMLInputElement>('peds'),
  autoBell: $<HTMLInputElement>('autobell'),
};
ui.speed.addEventListener('input', () => ($('speed-val').textContent = ui.speed.value));
const ACCEL = 0.9;
const BRAKE = 1.1;
function nextStop(t: Tram) {
  let best: { x: number; name: string } | null = null;
  let bestD = Infinity;
  for (const s of STOPS) {
    let d = (s.x - t.x) * t.dir;
    if (d < 0.5) d += PERIOD; // behind us: the stop in the next copy of the street
    if (d < bestD) { bestD = d; best = s; }
  }
  return { stop: best!, dist: bestD };
}
// While running, the driver rings "ding ding" every so often to warn traffic and pedestrians
let bellTimer = 2;
const nextBell = () => 6 + Math.random() * 8;
function autoBell(t: Tram, dt: number) {
  if (t !== main || !ui.autoBell.checked || t.v < 1.5) return;
  if ((bellTimer -= dt) <= 0) {
    bell.ring();
    bellTimer = nextBell();
  }
}
function updateTram(t: Tram, dt: number) {
  const vmax = Number(ui.speed.value) / 3.6;
  if (t.dwell > 0) {
    t.dwell -= dt;
    if (t.dwell <= 0 && t === main) { bell.ring(); bellTimer = 3 + Math.random() * 3; } // pulling away from the stop
    return;
  }
  let target = ui.drive.checked ? vmax : 0;
  if (ui.stops.checked) {
    const { dist } = nextStop(t);
    target = Math.min(target, Math.sqrt(2 * BRAKE * Math.max(0, dist - 0.3)));
    if (dist < 0.6 && t.v < 0.6) {
      t.v = 0;
      t.x += t.dir * dist; // settle exactly at the stop
      t.dwell = 6;
      return;
    }
  }
  const zebra = zebraGap(t.x, t.dir, TRAM.L + 0.1, t.v, TRAM_DECEL);
  if (zebra < Infinity) target = Math.min(target, Math.sqrt(2 * BRAKE * Math.max(0, zebra - 0.5)));
  t.v = t.v < target ? Math.min(target, t.v + ACCEL * dt) : Math.max(target, t.v - BRAKE * 1.6 * dt);
  t.x += t.dir * t.v * dt;
  autoBell(t, dt);
  // The street repeats every PERIOD metres, so wrapping is invisible (the camera wraps with the tram)
  const w = wrapX(t.x);
  if (w !== t.x && t === main) {
    petals.shift(w - t.x);
    if (prevEye) prevEye[0] += w - t.x;
  }
  t.x = w;
}
// Each tram has its own wiper on the driver's window (the green one is out of step)
const wipers = new Map<Tram, Wiper>(trams.map((t, i) => [t, new Wiper(i * 0.7)]));
const wiperTex = (() => {
  const c = document.createElement('canvas');
  c.width = c.height = 4;
  const x = c.getContext('2d')!;
  x.fillStyle = '#1c1d20';
  x.fillRect(0, 0, 4, 4);
  return renderer.tileTexture(c);
})();
const wiperModel = renderer.mesh(buildWiperMesh(), wiperTex);
const wiperMatrix = (t: Tram, dx: number) => {
  const q = qAxisAngle([0, 1, 0], t.dir > 0 ? 0 : Math.PI);
  const pos = add([t.x + dx, RAIL_TOP, t.z], qRotate(q, WIPER_PIVOT_LOCAL));
  return modelMatrix(pos, qMul(q, qAxisAngle([1, 0, 0], -wipers.get(t)!.angle)), 1); // wiper +z -> glass angle
};
const tramMatrix = (t: Tram, dx = 0) => modelMatrix([t.x + dx, RAIL_TOP, t.z], qAxisAngle([0, 1, 0], t.dir > 0 ? 0 : Math.PI), 1);

// ---- Bell: "ding ding" with Web Audio (two strikes of a struck metal bell) ----
const bell = {
  ctx: null as AudioContext | null,
  start() {
    if (!this.ctx) this.ctx = new AudioContext();
    if (this.ctx.state === 'suspended') this.ctx.resume();
  },
  ring() {
    if (!this.ctx) return;
    const ctx = this.ctx;
    for (const delay of [0, 0.28]) {
      const t = ctx.currentTime + delay;
      // inharmonic partials make it sound like metal rather than a pure tone
      for (const [f, a] of [[1180, 0.25], [2360, 0.08], [3150, 0.05], [590, 0.06]] as const) {
        const o = ctx.createOscillator();
        o.frequency.value = f;
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(a, t + 0.005);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 1.1);
        o.connect(g).connect(ctx.destination);
        o.start(t);
        o.stop(t + 1.2);
      }
    }
  },
};
$('bell').addEventListener('click', () => { bell.start(); bell.ring(); });
// Browsers only allow sound after a user gesture: unlock audio on the first click or key press anywhere
for (const ev of ['pointerdown', 'keydown'] as const) addEventListener(ev, () => bell.start(), { once: true });

// ---- Weather ----
let weatherName: WeatherName = 'sunny';
const weather = cloneWeather(WEATHER.sunny);
let flash = 0;
let nextLightning = 6;
function setWeather(name: WeatherName) {
  weatherName = name;
  document.querySelectorAll<HTMLButtonElement>('[data-weather]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.weather === name)));
}
document.querySelectorAll<HTMLButtonElement>('[data-weather]').forEach((b) => b.addEventListener('click', () => setWeather(b.dataset.weather as WeatherName)));
const rain = new Rain(4000);

// ---- Wipers (auto / on / off) and the water on the driver's glass ----
let wiperMode: WiperMode = 'auto';
function setWipers(m: WiperMode) {
  wiperMode = m;
  document.querySelectorAll<HTMLButtonElement>('[data-wipers]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.wipers === m)));
}
document.querySelectorAll<HTMLButtonElement>('[data-wipers]').forEach((b) => b.addEventListener('click', () => setWipers(b.dataset.wipers as WiperMode)));
let glassWet = 0; // builds up quickly in rain, dries slowly afterwards
function updateWipers(dt: number) {
  const target = weather.rain;
  glassWet += (target - glassWet) * (1 - Math.exp(-dt * (target > glassWet ? 0.8 : 0.12)));
  const { speed, interval } = wiperSpeed(wiperMode, weather.rain);
  for (const w of wipers.values()) w.update(dt, time, speed, interval);
}
const windscreen = new Windscreen(glCtx);

// ---- Time of day: 24 h slider, presets, optional running clock ----
const lit = cloneWeather(WEATHER.sunny); // weather after the time of day is applied (what gets rendered)
const timeUi = { hour: $<HTMLInputElement>('hour'), flow: $<HTMLInputElement>('timeflow'), label: $('hour-val') };
let hour = Number(timeUi.hour.value);
let hourGoal: number | null = null;
const HOURS_PER_SECOND = 0.1; // running clock: a day in 4 minutes
function showHour() {
  timeUi.label.textContent = formatHour(hour);
  timeUi.hour.value = String(hour);
  timeUi.hour.setAttribute('aria-valuetext', formatHour(hour));
}
function goToHour(h: number) {
  hourGoal = h;
}
timeUi.hour.addEventListener('input', () => { hourGoal = null; hour = Number(timeUi.hour.value); showHour(); });
document.querySelectorAll<HTMLButtonElement>('[data-hour]').forEach((b) => b.addEventListener('click', () => goToHour(Number(b.dataset.hour))));
function updateClock(dt: number) {
  if (hourGoal !== null) {
    // glide to the preset along the shorter way round the clock
    let d = hourGoal - hour;
    d -= 24 * Math.round(d / 24);
    const step = Math.sign(d) * Math.min(Math.abs(d), Math.max(0.5, Math.abs(d) * 2.5) * dt);
    hour += step;
    if (Math.abs(d) < 0.01) { hour = hourGoal; hourGoal = null; }
  } else if (timeUi.flow.checked) {
    hour += HOURS_PER_SECOND * dt;
  }
  hour = ((hour % 24) + 24) % 24;
  showHour();
}
showHour();

// ---- Night lights: street lamps, shop lighting, headlights (auto / on / off) ----
type HeadlightMode = 'auto' | 'on' | 'off';
let headlightMode: HeadlightMode = 'auto';
function setHeadlights(m: HeadlightMode) {
  headlightMode = m;
  document.querySelectorAll<HTMLButtonElement>('[data-headlights]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.headlights === m)));
}
document.querySelectorAll<HTMLButtonElement>('[data-headlights]').forEach((b) => b.addEventListener('click', () => setHeadlights(b.dataset.headlights as HeadlightMode)));

const lights: SceneLights = {
  emit: 0,
  lamps: new Float32Array(MAX_LAMPS * 4),
  lampCount: 0,
  lampColor: [1.0, 0.74, 0.45],
  spotPos: new Float32Array(MAX_SPOTS * 4),
  spotDir: new Float32Array(MAX_SPOTS * 4),
  spotCount: 0,
  spotColor: [1.0, 0.95, 0.85],
};
const LAMP_POWER = 4;
const HEADLIGHT_POWER = 3;
let lampK = 0; // street lamps (they switch on at dusk on a light sensor)
let headK = 0; // vehicle headlights
const lampGlow = new ParticlePool(glCtx, renderer.particle, 512, 0, 0);
const headGlow = new ParticlePool(glCtx, renderer.particle, 512, 0, 0);
const tailGlow = new ParticlePool(glCtx, renderer.particle, 512, 0, 0);
const beaconGlow = new ParticlePool(glCtx, renderer.particle, 64, 0, 0);
const glow = (pool: ParticlePool, p: V3, size: number, alpha: number) => pool.emit(p, [0, 0, 0], { life: 1, size0: size, size1: size, alpha });
const smooth01 = (a: number, b: number, x: number) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

// Light sources nearest the camera; the last ones fade out before they are dropped, so nothing pops
function nearest<T extends { d: number }>(list: T[], max: number): { item: T; fade: number }[] {
  list.sort((a, b) => a.d - b.d);
  const cut = list[max]?.d ?? Infinity;
  return list.slice(0, max).map((item) => ({ item, fade: Math.min(1, Math.max(0, (cut - item.d) / 20)) }));
}

interface Headlight { front: V3; dir: number; halfW: number; back: V3; d: number }
let lightsInit = false;
function updateLights(dt: number, tod: TimeOfDay, eye: V3) {
  const k = lightsInit ? 1 - Math.exp(-dt * 3) : 1; // no fade-in on page load
  lightsInit = true;
  lampK += ((tod.night > 0.25 ? 1 : 0) - lampK) * k;
  const autoOn = tod.night > 0.3 || weather.rain > 0.5; // HK drivers switch on in heavy rain too
  const headOn = headlightMode === 'on' || (headlightMode === 'auto' && autoOn);
  headK += ((headOn ? 1 : 0) - headK) * k;
  lights.emit = Math.max(smooth01(0.1, 0.6, tod.night), weather.rain * 0.25);

  // Street lamps: nearest copy of each lamp to the camera
  lampGlow.count = 0;
  const lampList = street.lamps.map(([x, y, z]) => {
    const wx = eye[0] + wrapX(x - eye[0]);
    return { p: [wx, y, z] as V3, d: Math.hypot(wx - eye[0], y - eye[1], z - eye[2]) };
  });
  lights.lampCount = 0;
  if (lampK > 0.01) {
    nearest(lampList, MAX_LAMPS).forEach(({ item, fade }, i) => {
      lights.lamps.set([...item.p, LAMP_POWER * lampK * fade], i * 4);
      lights.lampCount = i + 1;
    });
    for (const dx of OFFSETS) for (const [x, y, z] of street.lamps) glow(lampGlow, [x + dx, y, z], 1.8, 0.9 * lampK);
  }

  // Headlights of the trams and the road traffic
  headGlow.count = 0;
  tailGlow.count = 0;
  lights.spotCount = 0;
  if (headK < 0.01) return;
  const heads: Headlight[] = [];
  const addVehicle = (x: number, z: number, dir: number, halfLen: number, y: number, halfW: number) => {
    for (const dx of OFFSETS) {
      const front: V3 = [x + dx + dir * halfLen, y, z];
      heads.push({ front, back: [x + dx - dir * halfLen, y, z], dir, halfW, d: Math.hypot(front[0] - eye[0], y - eye[1], z - eye[2]) });
    }
  };
  for (const t of trams) addVehicle(t.x, t.z, t.dir, TRAM.L + 0.1, RAIL_TOP + 1.0, 0);
  if (ui.traffic.checked) {
    for (const v of vehicles) {
      const f = fleet[v.kind];
      if (f.mecha) continue; // no headlights on a mecha
      addVehicle(v.x, LANES[v.lane], v.lane === 0 ? 1 : -1, f.len / 2, f.lightY, f.halfW);
    }
  }
  for (const h of heads) {
    if (h.d > 400) continue;
    const pairs = h.halfW > 0 ? [-h.halfW, h.halfW] : [0];
    for (const o of pairs) glow(headGlow, [h.front[0], h.front[1], h.front[2] + o], h.halfW > 0 ? 0.7 : 0.9, headK);
    for (const o of h.halfW > 0 ? pairs : [-0.7, 0.7]) glow(tailGlow, [h.back[0], h.back[1], h.back[2] + o], 0.45, 0.8 * headK);
  }
  nearest(heads, MAX_SPOTS).forEach(({ item, fade }, i) => {
    const p = item.front;
    lights.spotPos.set([p[0] + item.dir * 0.2, p[1], p[2], HEADLIGHT_POWER * headK * fade], i * 4);
    const d = norm([item.dir, -0.1, 0]);
    lights.spotDir.set([...d, 0], i * 4);
    lights.spotCount = i + 1;
  });
}

// ---- Sakura petals ----
const petals = new ParticlePool(glCtx, renderer.particle, 4000, 0, 0);
function emitPetals(dt: number, near: V3) {
  if (!ui.petals.checked) return;
  // nearest copy of each tree to the camera, so petals keep falling across the seam
  const trees = street.blossoms
    .map(([x, y, z, r]) => [near[0] + wrapX(x - near[0]), y, z, r] as [number, number, number, number])
    .filter(([x]) => Math.abs(x - near[0]) < 130);
  if (!trees.length) return;
  const wet = weather.rain;
  const n = Math.floor(160 * dt + Math.random());
  for (let i = 0; i < n; i++) {
    const [x, y, z, r] = trees[Math.floor(Math.random() * trees.length)];
    const fall = 0.6 + Math.random() * 0.5 + wet * 2;
    const p: V3 = [x + (Math.random() - 0.5) * 2 * r, y + (Math.random() - 0.3) * r * 0.8, z + (Math.random() - 0.5) * 2 * r];
    petals.emit(p, [0.6 + Math.random() * 0.8, -fall, (Math.random() - 0.5) * 0.6], {
      life: p[1] / fall + 0.3, size0: 0.07, size1: 0.06, alpha: 0.95, shade: Math.random() * 6.28,
    });
  }
}

// ---- Camera: orbit around the #80 tram, presets, upper-deck ride view ----
type CamMode = 'street' | 'classic' | 'front' | 'side' | 'top' | 'ride' | 'driver' | 'mecha' | 'fly';
type CabMode = 'ride' | 'driver';
const isCab = (m: CamMode): m is CabMode => m === 'ride' || m === 'driver';
const PRESETS: Record<Exclude<CamMode, CabMode>, { yaw: number; pitch: number; dist: number }> = {
  street: { yaw: -0.18, pitch: 0.22, dist: 46 }, // down the street from ahead of the tram
  classic: { yaw: -0.55, pitch: 0.06, dist: 14 }, // 3/4 front from the kerb, like the photo
  front: { yaw: 0, pitch: 0.06, dist: 16 },
  side: { yaw: -Math.PI / 2, pitch: 0.12, dist: 7.8 }, // from the kerb-side pavement: doors and livery
  top: { yaw: 0.0, pitch: 1.2, dist: 60 },
  mecha: { yaw: -0.7, pitch: 0.15, dist: 24 }, // 3/4 view of the mecha being followed
  fly: { yaw: Math.PI, pitch: 0.2, dist: 12 }, // chase view behind the flying car (yaw follows the car)
};
let flyLook = 0; // drag offset of the chase view around the car; eases back behind it
/** Orbit yaw that puts the camera behind the car (the car faces (cos yaw, 0, -sin yaw)) */
const behindCar = () => Math.PI - flyer.yaw + flyLook;
let mechaIndex = -1; // which mecha the mecha camera follows
let mode: CamMode = 'street';
const orbit = { ...PRESETS.street };
let goal: typeof orbit | null = null;
let rideLook = 0;
function setCamera(m: CamMode) {
  if (m === 'mecha') {
    const list = [...mechaNames.keys()];
    if (!list.length) return; // none loaded yet
    mechaIndex = mode === 'mecha' ? (mechaIndex + 1) % list.length : 0;
    const btn = document.querySelector<HTMLButtonElement>('[data-cam=mecha]');
    if (btn) btn.textContent = `🤖 跟拍 ${mechaNames.get(list[mechaIndex])}（再撳換下一隻）`;
  }
  mode = m;
  if (!isCab(m)) goal = { ...PRESETS[m] };
  rideLook = 0;
  document.querySelectorAll<HTMLButtonElement>('[data-cam]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.cam === m)));
}
document.querySelectorAll<HTMLButtonElement>('[data-cam]').forEach((b) => b.addEventListener('click', () => setCamera(b.dataset.cam as CamMode)));

let dragging = false;
canvas.addEventListener('pointerdown', (e) => { dragging = true; goal = null; canvas.setPointerCapture(e.pointerId); bell.start(); });
canvas.addEventListener('pointerup', () => (dragging = false));
canvas.addEventListener('pointermove', (e) => {
  if (!dragging) return;
  if (isCab(mode)) { rideLook = Math.max(-1.5, Math.min(1.5, rideLook - e.movementX * 0.005)); return; }
  if (mode === 'fly') flyLook -= e.movementX * 0.006;
  else orbit.yaw -= e.movementX * 0.006;
  orbit.pitch = Math.max(0.0, Math.min(1.45, orbit.pitch + e.movementY * 0.005));
});
canvas.addEventListener('wheel', (e) => {
  e.preventDefault();
  goal = null;
  orbit.dist = Math.max(5, Math.min(300, orbit.dist * Math.exp(e.deltaY * 0.001)));
}, { passive: false });

const FOV = (55 * Math.PI) / 180;
function camera(dt: number): Camera {
  const aspect = canvas.width / canvas.height;
  let eye: V3;
  let target: V3;
  if (isCab(mode)) {
    // Upper deck front bench, or the driver's position at the front of the lower deck
    const q = qAxisAngle([0, 1, 0], main.dir > 0 ? 0 : Math.PI);
    const base: V3 = [main.x, RAIL_TOP, main.z];
    eye = add(base, qRotate(q, mode === 'ride' ? [4.85, 3.5, 0] : [4.9, 1.95, 0]));
    const look = qRotate(q, [Math.cos(rideLook), mode === 'ride' ? -0.08 : -0.05, -Math.sin(rideLook)]);
    target = add(eye, look);
  } else {
    if (goal) {
      const k = 1 - Math.exp(-dt * 3);
      let dy = goal.yaw - orbit.yaw;
      dy = Math.atan2(Math.sin(dy), Math.cos(dy));
      orbit.yaw += dy * k;
      orbit.pitch += (goal.pitch - orbit.pitch) * k;
      orbit.dist += (goal.dist - orbit.dist) * k;
    }
    target = [main.x, 2.2, main.z];
    const followed = mode === 'mecha' ? [...mechaNames.keys()][mechaIndex] : undefined;
    if (followed) {
      const f = fleet[followed.kind];
      const m = f.mecha!;
      const side = Math.sign(LANES[followed.lane]);
      target = [followed.x, 0.5 * (m.rig.max[1] - m.rig.min[1]) * f.scale, side * (Math.abs(LANES[followed.lane]) + m.zOffset - m.inward)];
      // walking east the camera sits ahead of it as for the tram; walking west, swing round to its front
      if (goal && followed.lane === 1) goal.yaw = Math.PI - PRESETS.mecha.yaw;
    }
    if (mode === 'fly') {
      // third-person chase view: swings round behind the car as it turns
      target = add(carPos(), [0, 1.3, 0]);
      if (!dragging) flyLook *= Math.exp(-dt * 1.2);
      if (goal) goal.yaw = behindCar();
      else {
        let dy = behindCar() - orbit.yaw;
        dy = Math.atan2(Math.sin(dy), Math.cos(dy));
        orbit.yaw += dy * (1 - Math.exp(-dt * 4));
      }
    }
    const c = Math.cos(orbit.pitch);
    eye = add(target, scale([c * Math.cos(orbit.yaw), Math.sin(orbit.pitch), c * Math.sin(orbit.yaw)], orbit.dist));
  }
  // footsteps of a nearby mecha shake the camera a little
  shake *= Math.exp(-dt * 6);
  if (shake > 0.005) {
    const j: V3 = [(Math.random() - 0.5) * shake, (Math.random() - 0.5) * shake, (Math.random() - 0.5) * shake];
    eye = add(eye, j);
    target = add(target, scale(j, 0.5));
  }
  const fwd = norm(sub(target, eye));
  const right = norm(cross(fwd, [0, 1, 0]));
  return {
    pos: eye, fwd, right, up: cross(right, fwd), fov: FOV, aspect,
    view: lookAt(eye, target, [0, 1, 0]),
    proj: perspective(FOV, aspect, isCab(mode) ? 0.1 : 0.3, 4000),
  };
}

// ---- Music: YouTube's embedded player, created on the first click (a user gesture, so it may start playing) ----
const MUSIC_VIDEO = 'K5t-1v-IZ9k';
const musicBtn = $<HTMLButtonElement>('music-play');
const musicBox = $('music-player');
function toggleMusic() {
  const playing = musicBox.childElementCount > 0;
  musicBox.replaceChildren();
  if (!playing) {
    const f = document.createElement('iframe');
    // privacy-enhanced domain; loop by playing the same video as a one-item playlist
    f.src = `https://www.youtube-nocookie.com/embed/${MUSIC_VIDEO}?autoplay=1&loop=1&playlist=${MUSIC_VIDEO}&rel=0`;
    f.title = '迷人的危险 - YouTube';
    f.allow = 'autoplay; encrypted-media; picture-in-picture';
    f.referrerPolicy = 'strict-origin-when-cross-origin';
    musicBox.append(f);
  }
  musicBtn.setAttribute('aria-pressed', String(!playing));
  musicBtn.textContent = playing ? '▶ 播放音樂 Play music (M)' : '■ 停止音樂 Stop music (M)';
}
musicBtn.addEventListener('click', toggleMusic);

// ---- Keys, export, resize ----
addEventListener('keydown', (e) => {
  const flying = mode === 'fly';
  if (flying && (e.code.startsWith('Arrow') || e.code === 'Space')) e.preventDefault(); // no page scrolling
  if (e.code === 'KeyF') setCamera(flying ? 'street' : 'fly');
  if (e.code === 'Space' && !flying) { e.preventDefault(); bell.start(); bell.ring(); }
  if (e.code === 'KeyV') setCamera(mode === 'ride' ? 'street' : 'ride');
  if (e.code === 'KeyP') ui.drive.checked = !ui.drive.checked;
  if (e.code === 'Digit1') setWeather('sunny');
  if (e.code === 'Digit2') setWeather('cloudy');
  if (e.code === 'Digit3') setWeather('rain');
  if (e.code === 'KeyN') goToHour(nightNow > 0.5 ? 12 : 22);
  if (e.code === 'KeyC') setCamera(mode === 'driver' ? 'street' : 'driver');
  if (e.code === 'KeyW' && !flying) setWipers(wiperMode === 'auto' ? 'on' : wiperMode === 'on' ? 'off' : 'auto');
  if (e.code === 'KeyM') toggleMusic();
  if (e.code === 'KeyH') setHeadlights(headlightMode === 'auto' ? 'on' : headlightMode === 'on' ? 'off' : 'auto');
});
$<HTMLButtonElement>('export').addEventListener('click', async (e) => {
  const btn = e.currentTarget as HTMLButtonElement;
  btn.disabled = true;
  try {
    const blob = await exportGlb(hkTram.build(), atlasCanvas);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'hk-tram-80.glb';
    a.click();
    URL.revokeObjectURL(url);
  } finally {
    btn.disabled = false;
  }
});
function resize() {
  const dpr = Math.min(devicePixelRatio, 2);
  canvas.width = Math.round(innerWidth * dpr);
  canvas.height = Math.round(innerHeight * dpr);
}
addEventListener('resize', resize);
resize();

// ---- HUD ----
const hud = { spd: $('spd'), state: $('state'), next: $('next'), pos: $('pos'), clock: $('clock') };
let hudTimer = 0;
function updateHud(dt: number) {
  if ((hudTimer -= dt) > 0) return;
  hudTimer = 0.15;
  const { stop, dist } = nextStop(main);
  const flying = mode === 'fly';
  hud.spd.textContent = `${Math.round((flying ? flyer.speed : main.v) * 3.6)} km/h`;
  hud.state.textContent = flying ? `🚗 飛行中 Flying · 高度 ${Math.round(flyer.pos[1])} m`
    : main.dwell > 0 ? `停站 At stop ${Math.ceil(main.dwell)}s` : main.v > 0.3 ? '行駛中 Running' : '停車 Stopped';
  hud.next.textContent = `${stop.name} (${Math.round(dist)} m)`;
  hud.pos.textContent = `${Math.round(flying ? flyer.pos[0] : main.x)} m`;
  hud.clock.textContent = `${formatHour(hour)} ${headK > 0.5 ? '💡' : ''}`;
}

// ---- Main loop ----
glCtx.enable(glCtx.DEPTH_TEST);
glCtx.enable(glCtx.CULL_FACE);
let time = 0;
let last = performance.now();
let prevEye: V3 | null = null;
let nightNow = 0;
function frame(now: number) {
  const dt = Math.max(0, Math.min(0.05, (now - last) / 1000)); // rAF timestamps can precede the last performance.now()
  last = now;
  time += dt;

  for (const t of trams) updateTram(t, dt);
  if (ui.traffic.checked) updateTraffic(dt);
  updateMechas(dt); // the mechas walk even with road traffic switched off
  updateCar(dt, mode === 'fly', prevEye ?? flyer.pos);
  blendWeather(weather, WEATHER[weatherName], 1 - Math.exp(-dt * 1.2));
  flash *= Math.exp(-dt * 9);
  if (weather.rain > 0.8 && (nextLightning -= dt) <= 0) {
    flash = 1.0;
    nextLightning = 6 + Math.random() * 10;
  }

  const cam = camera(dt);
  emitPetals(dt, cam.pos);
  petals.update(dt);
  dust.update(dt);
  const camVel = prevEye ? scale(sub(cam.pos, prevEye), 1 / Math.max(dt, 1e-3)) : [0, 0, 0];
  prevEye = [...cam.pos];
  if (weather.rain > 0.02) rain.update(dt, cam.pos, Math.hypot(...camVel) > 200 ? [0, 0, 0] : camVel);

  updateClock(dt);
  const tod = applyTimeOfDay(lit, weather, hour);
  nightNow = tod.night;
  updateLights(dt, tod, cam.pos);
  carLights();
  updateWipers(dt);
  if (ui.peds.checked) {
    const movers: Mover[] = trams.map((t) => ({ x: t.x, dir: t.dir, v: t.v, half: TRAM.L + 0.1, decel: TRAM_DECEL }));
    for (const v of vehicles) {
      const mecha = !!fleet[v.kind].mecha;
      if (mecha || ui.traffic.checked) movers.push({ x: v.x, dir: v.lane === 0 ? 1 : -1, v: v.v, half: fleet[v.kind].len / 2, decel: mecha ? 0.05 : CAR_DECEL });
    }
    const active = 0.3 + 0.7 * (1 - tod.night); // fewer people out late at night
    peds.update(dt, { movers, rain: weather.rain, active });
    crowd.count = peds.write(crowd.instances, cam.pos, active, weather.rain);
  } else {
    peds.blocked.fill(false);
    crowd.count = 0;
  }
  // Amber beacons at the zebra crossings blink once a second
  beaconGlow.count = 0;
  const blink = Math.sin(time * Math.PI * 2) > 0 ? 1 : 0.15;
  for (const dx of OFFSETS) for (const [x, y, z] of street.beacons) glow(beaconGlow, [x + dx, y, z], 0.9, blink * (0.35 + 0.65 * tod.night));
  const cab = isCab(mode);

  const state = { cam, weather: lit, sunDir: tod.lightDir, time, flash, height: canvas.height, lights, night: tod.night };
  if (cab) windscreen.begin(canvas.width, canvas.height);
  glCtx.viewport(0, 0, canvas.width, canvas.height);
  glCtx.clear(glCtx.COLOR_BUFFER_BIT | glCtx.DEPTH_BUFFER_BIT | glCtx.STENCIL_BUFFER_BIT);
  renderer.drawSky(state);
  renderer.beginWorld(state);
  for (const m of offsetMatrices) for (const d of statics) renderer.draw(d, m);
  drawTrees(cam.pos[0]);
  const hsbcMatrix = drawHsbc(cam.pos[0]);
  for (const dx of OFFSETS) for (const t of trams) {
    renderer.draw(t.model, tramMatrix(t, dx));
    renderer.draw(wiperModel, wiperMatrix(t, dx));
  }
  const mechaShadows: Parameters<typeof renderer.drawWalkerShadows>[1] = [];
  for (const v of vehicles) {
    const f = fleet[v.kind];
    const heading = v.lane === 0 ? 0 : Math.PI;
    if (!f.mecha && !ui.traffic.checked) continue;
    {
      if (f.mecha) {
        // Millions of triangles: draw only the copy of the street nearest the camera
        const m = f.mecha;
        if (Math.abs(wrapX(v.x - cam.pos[0])) > 600) continue;
        const { pose, drop } = walkPose(m.rig, m.phase, m.amount);
        const matrix = mechaMatrix(v, f, cam.pos[0], drop);
        renderer.drawWalker(state, m.walker, matrix, pose);
        mechaShadows.push({ walker: m.walker, model: matrix, pose });
        // eye glow: pulses slowly, brighter in the dark and in the rain
        m.eyeGlow.count = 0;
        const pulse = 0.75 + 0.25 * Math.sin(time * 2.6 + v.x);
        m.eyeGlow.emit(xform(matrix, m.rig.eye), [0, 0, 0], { life: 1, size0: 1.1, size1: 1.1, alpha: pulse * (0.45 + 0.9 * tod.night + 0.3 * weather.rain) });
        continue;
      }
      for (const dx of OFFSETS) renderer.draw(f.model, modelMatrix([v.x + dx, 0, LANES[v.lane]], qAxisAngle([0, 1, 0], heading), f.scale));
    }
  }
  const flyMatrix = carMatrix();
  if (carModel && flyMatrix) {
    for (const p of carModel.parts) renderer.draw(p, flyMatrix);
    mechaShadows.push({ walker: carModel.shadow, model: flyMatrix, pose: NO_POSE });
  }
  renderer.drawCrowd(state, crowd);
  // Mecha shadows from the sun (or moon): darker in strong sunlight, faint under cloud, rain or at night
  const sunLum = (lit.sunColor[0] + lit.sunColor[1] + lit.sunColor[2]) / 3;
  if (hsbc && hsbcMatrix) mechaShadows.push({ walker: hsbc.shadow, model: hsbcMatrix, pose: NO_POSE });
  renderer.drawWalkerShadows(state, mechaShadows, tod.lightDir, 0.12 + 0.48 * Math.min(1, sunLum / 1.2));
  renderer.drawParticles(state, jetWash, noFlame);
  renderer.drawParticles(state, dust, flames); // footstep dust, then the flying car's jet flames (additive)
  renderer.drawGlows(state, jetGlow, [1.0, 0.62, 0.3]);
  for (const v of vehicles) {
    const m = fleet[v.kind].mecha;
    if (m && m.eyeGlow.count) renderer.drawGlows(state, m.eyeGlow, m.eyeColor);
  }
  renderer.drawGlows(state, lampGlow, [1.0, 0.78, 0.5]);
  renderer.drawGlows(state, beaconGlow, [1.0, 0.6, 0.1]);
  renderer.drawGlows(state, headGlow, [1.0, 0.97, 0.88]);
  renderer.drawGlows(state, tailGlow, [0.9, 0.06, 0.04]);
  renderer.drawPetals(state, petals);
  renderer.drawRain(state, rain.lines, weather.rain);
  if (cab) {
    const driver = mode === 'driver';
    windscreen.end({
      cam, tramPos: [main.x, RAIL_TOP, main.z], tramDir: main.dir, glassX: TRAM.L,
      paneY: driver ? LOWER_PANE : UPPER_PANE, wiper: driver,
      pivot: WIPER.pivot, blade: WIPER.blade, sweep: WIPER.sweep, wipe: wipers.get(main)!.wipe,
      time, wet: glassWet, rate: 0.3 + 1.7 * weather.rain,
      // cab lit by daylight, plus the saloon lights after dark
      wall: lit.ambSky.map((a, i) => a * 1.3 + lit.sunColor[i] * 0.08 + lights.emit * [0.35, 0.3, 0.22][i] + flash * 0.5) as V3,
    });
  }
  updateHud(dt);
  requestAnimationFrame(frame);
}
const IDENTITY = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
requestAnimationFrame(frame);
