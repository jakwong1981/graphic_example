// Hong Kong tram #80 on a sakura-lined tram street: UV-textured tram, stops, bell, road traffic, petals, weather
import { perspective, lookAt } from './math/matrix';
import { hkTram } from './models/hk-tram';
import { hkTaxi } from './models/hk-taxi';
import { kmbBus } from './models/kmb-bus';
import { car } from './models/car';
import { drawAtlas } from './models/atlas';
import { V3, add, sub, scale, cross, norm, qAxisAngle, qRotate, modelMatrix } from './sim/math';
import { paintCityTexture } from './sim/city-textures';
import { ParticlePool } from './sim/particles';
import { WEATHER, WeatherName, blendWeather, cloneWeather, Rain } from './sim/weather';
import { SceneRenderer, Camera, Drawable } from './sim/scene-renderer';
import { exportGlb } from './image3d/glb-export';
import { buildStreet, STREET_HALF, TRACKS, LANES, RAIL_TOP } from './tram/street';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const canvas = $<HTMLCanvasElement>('glcanvas');
const gl = canvas.getContext('webgl2', { antialias: true });
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
for (const [material, data] of street.batches) {
  const d = renderer.mesh(data, renderer.tileTexture(paintCityTexture(material, seed++)));
  d.emissive = material === 'signs';
  statics.push(d);
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
const fleet = [
  { model: renderer.model(hkTaxi), scale: 2.0, len: 5 },
  { model: renderer.model(hkTaxi), scale: 2.0, len: 5 },
  { model: renderer.model({ ...hkTaxi, paint: '#2e9e44' }), scale: 2.0, len: 5 },
  { model: renderer.model(kmbBus), scale: 1, len: 12.3 },
  { model: renderer.model({ ...car, paint: '#f2f2f2' }), scale: 1.9, len: 4.6 },
  { model: renderer.model({ ...car, paint: '#1b1b1f' }), scale: 1.9, len: 4.6 },
  { model: renderer.model({ ...car, paint: '#1f4fa8' }), scale: 1.9, len: 4.6 },
];
interface Vehicle { lane: 0 | 1; x: number; v: number; vmax: number; kind: number }
const vehicles: Vehicle[] = [];
for (let i = 0; i < 28; i++) {
  const lane = (i % 2) as 0 | 1;
  vehicles.push({ lane, x: -STREET_HALF + (i >> 1) * 34 + Math.random() * 10, v: 8, vmax: 9 + Math.random() * 5, kind: Math.floor(Math.random() * fleet.length) });
}
function updateTraffic(dt: number) {
  const L = 2 * STREET_HALF;
  for (const lane of [0, 1] as const) {
    const dir = lane === 0 ? 1 : -1; // keep left: eastbound on the -z side
    const list = vehicles.filter((v) => v.lane === lane).sort((a, b) => (a.x - b.x) * dir);
    list.forEach((v, i) => {
      const ahead = list[(i + 1) % list.length];
      let gap = (ahead.x - v.x) * dir;
      if (gap <= 0) gap += L; // the leader follows the last car around the wrap
      gap -= (fleet[ahead.kind].len + fleet[v.kind].len) / 2;
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
function updateTram(t: Tram, dt: number) {
  const vmax = Number(ui.speed.value) / 3.6;
  if (t.dwell > 0) {
    t.dwell -= dt;
    if (t.dwell <= 0 && t === main) bell.ring();
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
  t.v = t.v < target ? Math.min(target, t.v + ACCEL * dt) : Math.max(target, t.v - BRAKE * 1.6 * dt);
  t.x += t.dir * t.v * dt;
  // The street repeats every PERIOD metres, so wrapping is invisible (the camera wraps with the tram)
  const w = wrapX(t.x);
  if (w !== t.x && t === main) {
    petals.shift(w - t.x);
    if (prevEye) prevEye[0] += w - t.x;
  }
  t.x = w;
}
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

// ---- Weather ----
let weatherName: WeatherName = 'sunny';
const weather = cloneWeather(WEATHER.sunny);
const sunDir = norm([0.35, 0.75, 0.45]);
let flash = 0;
let nextLightning = 6;
function setWeather(name: WeatherName) {
  weatherName = name;
  document.querySelectorAll<HTMLButtonElement>('[data-weather]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.weather === name)));
}
document.querySelectorAll<HTMLButtonElement>('[data-weather]').forEach((b) => b.addEventListener('click', () => setWeather(b.dataset.weather as WeatherName)));
const rain = new Rain(4000);

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
type CamMode = 'street' | 'classic' | 'front' | 'side' | 'top' | 'ride';
const PRESETS: Record<Exclude<CamMode, 'ride'>, { yaw: number; pitch: number; dist: number }> = {
  street: { yaw: -0.18, pitch: 0.22, dist: 46 }, // down the street from ahead of the tram
  classic: { yaw: -0.55, pitch: 0.06, dist: 14 }, // 3/4 front from the kerb, like the photo
  front: { yaw: 0, pitch: 0.06, dist: 16 },
  side: { yaw: -Math.PI / 2, pitch: 0.12, dist: 7.8 }, // from the kerb-side pavement: doors and livery
  top: { yaw: 0.0, pitch: 1.2, dist: 60 },
};
let mode: CamMode = 'street';
const orbit = { ...PRESETS.street };
let goal: typeof orbit | null = null;
let rideLook = 0;
function setCamera(m: CamMode) {
  mode = m;
  if (m !== 'ride') goal = { ...PRESETS[m] };
  rideLook = 0;
  document.querySelectorAll<HTMLButtonElement>('[data-cam]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.cam === m)));
}
document.querySelectorAll<HTMLButtonElement>('[data-cam]').forEach((b) => b.addEventListener('click', () => setCamera(b.dataset.cam as CamMode)));

let dragging = false;
canvas.addEventListener('pointerdown', (e) => { dragging = true; goal = null; canvas.setPointerCapture(e.pointerId); bell.start(); });
canvas.addEventListener('pointerup', () => (dragging = false));
canvas.addEventListener('pointermove', (e) => {
  if (!dragging) return;
  if (mode === 'ride') { rideLook = Math.max(-1.5, Math.min(1.5, rideLook - e.movementX * 0.005)); return; }
  orbit.yaw -= e.movementX * 0.006;
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
  if (mode === 'ride') {
    // Upper deck, front bench, looking out of the front window
    const q = qAxisAngle([0, 1, 0], main.dir > 0 ? 0 : Math.PI);
    const base: V3 = [main.x, RAIL_TOP, main.z];
    eye = add(base, qRotate(q, [5.3, 3.55, 0]));
    const look = qRotate(q, [Math.cos(rideLook), -0.08, -Math.sin(rideLook)]);
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
    const c = Math.cos(orbit.pitch);
    eye = add(target, scale([c * Math.cos(orbit.yaw), Math.sin(orbit.pitch), c * Math.sin(orbit.yaw)], orbit.dist));
  }
  const fwd = norm(sub(target, eye));
  const right = norm(cross(fwd, [0, 1, 0]));
  return {
    pos: eye, fwd, right, up: cross(right, fwd), fov: FOV, aspect,
    view: lookAt(eye, target, [0, 1, 0]),
    proj: perspective(FOV, aspect, mode === 'ride' ? 0.1 : 0.3, 4000),
  };
}

// ---- Keys, export, resize ----
addEventListener('keydown', (e) => {
  if (e.code === 'Space') { e.preventDefault(); bell.start(); bell.ring(); }
  if (e.code === 'KeyV') setCamera(mode === 'ride' ? 'street' : 'ride');
  if (e.code === 'KeyP') ui.drive.checked = !ui.drive.checked;
  if (e.code === 'Digit1') setWeather('sunny');
  if (e.code === 'Digit2') setWeather('cloudy');
  if (e.code === 'Digit3') setWeather('rain');
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
const hud = { spd: $('spd'), state: $('state'), next: $('next'), pos: $('pos') };
let hudTimer = 0;
function updateHud(dt: number) {
  if ((hudTimer -= dt) > 0) return;
  hudTimer = 0.15;
  const { stop, dist } = nextStop(main);
  hud.spd.textContent = `${Math.round(main.v * 3.6)} km/h`;
  hud.state.textContent = main.dwell > 0 ? `停站 At stop ${Math.ceil(main.dwell)}s` : main.v > 0.3 ? '行駛中 Running' : '停車 Stopped';
  hud.next.textContent = `${stop.name} (${Math.round(dist)} m)`;
  hud.pos.textContent = `${Math.round(main.x)} m`;
}

// ---- Main loop ----
glCtx.enable(glCtx.DEPTH_TEST);
glCtx.enable(glCtx.CULL_FACE);
let time = 0;
let last = performance.now();
let prevEye: V3 | null = null;
function frame(now: number) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  time += dt;

  for (const t of trams) updateTram(t, dt);
  if (ui.traffic.checked) updateTraffic(dt);
  blendWeather(weather, WEATHER[weatherName], 1 - Math.exp(-dt * 1.2));
  flash *= Math.exp(-dt * 9);
  if (weather.rain > 0.8 && (nextLightning -= dt) <= 0) {
    flash = 1.0;
    nextLightning = 6 + Math.random() * 10;
  }

  const cam = camera(dt);
  emitPetals(dt, cam.pos);
  petals.update(dt);
  const camVel = prevEye ? scale(sub(cam.pos, prevEye), 1 / Math.max(dt, 1e-3)) : [0, 0, 0];
  prevEye = [...cam.pos];
  if (weather.rain > 0.02) rain.update(dt, cam.pos, Math.hypot(...camVel) > 200 ? [0, 0, 0] : camVel);

  const state = { cam, weather, sunDir, time, flash, height: canvas.height };
  glCtx.viewport(0, 0, canvas.width, canvas.height);
  glCtx.clear(glCtx.COLOR_BUFFER_BIT | glCtx.DEPTH_BUFFER_BIT);
  renderer.drawSky(state);
  renderer.beginWorld(state);
  for (const m of offsetMatrices) for (const d of statics) renderer.draw(d, m);
  for (const dx of OFFSETS) for (const t of trams) renderer.draw(t.model, tramMatrix(t, dx));
  if (ui.traffic.checked) {
    for (const v of vehicles) {
      const f = fleet[v.kind];
      const heading = v.lane === 0 ? 0 : Math.PI;
      for (const dx of OFFSETS) renderer.draw(f.model, modelMatrix([v.x + dx, 0, LANES[v.lane]], qAxisAngle([0, 1, 0], heading), f.scale));
    }
  }
  renderer.drawPetals(state, petals);
  renderer.drawRain(state, rain.lines, weather.rain);
  updateHud(dt);
  requestAnimationFrame(frame);
}
const IDENTITY = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
requestAnimationFrame(frame);
