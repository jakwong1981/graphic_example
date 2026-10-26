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
import { SceneRenderer, Camera, Drawable, SceneLights, MAX_LAMPS, MAX_SPOTS } from './sim/scene-renderer';
import { applyTimeOfDay, formatHour, TimeOfDay } from './sim/daynight';
import { Windscreen } from './sim/windscreen';
import { Wiper, WiperMode, wiperSpeed, buildWiperMesh, WIPER, WIPER_PIVOT_LOCAL, LOWER_PANE, UPPER_PANE } from './tram/wiper';
import { exportGlb } from './image3d/glb-export';
import { loadGlb } from './loaders/glb';
import { buildStreet, STREET_HALF, TRACKS, LANES, RAIL_TOP, CROSSINGS, ZEBRA_HALF } from './tram/street';
import { Pedestrians, Mover, buildPersonMesh } from './tram/pedestrians';

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
  const { color, emit } = paintCityMaterial(material, seed++);
  const d = renderer.mesh(data, renderer.tileTexture(color));
  if (emit) d.emitTexture = renderer.tileTexture(emit);
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
// lightY / halfW: headlight height and half spacing in metres
const fleet = [
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
    const kind = fleet.push({ model: { ...model, data: m }, scale: 1, len: m.max[0] - m.min[0], lightY: 0.8, halfW: 0.8 }) - 1;
    for (const lane of [0, 1]) {
      const v = vehicles.find((c) => c.lane === lane && fleet[c.kind].len < 6); // a car-sized slot
      if (v) { v.kind = kind; v.vmax = Math.min(v.vmax, 10); } // vans are in no hurry
    }
  })
  .catch((e) => console.warn('Ice cream van not loaded:', e));

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
type CamMode = 'street' | 'classic' | 'front' | 'side' | 'top' | 'ride' | 'driver';
type CabMode = 'ride' | 'driver';
const isCab = (m: CamMode): m is CabMode => m === 'ride' || m === 'driver';
const PRESETS: Record<Exclude<CamMode, CabMode>, { yaw: number; pitch: number; dist: number }> = {
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
    const c = Math.cos(orbit.pitch);
    eye = add(target, scale([c * Math.cos(orbit.yaw), Math.sin(orbit.pitch), c * Math.sin(orbit.yaw)], orbit.dist));
  }
  const fwd = norm(sub(target, eye));
  const right = norm(cross(fwd, [0, 1, 0]));
  return {
    pos: eye, fwd, right, up: cross(right, fwd), fov: FOV, aspect,
    view: lookAt(eye, target, [0, 1, 0]),
    proj: perspective(FOV, aspect, isCab(mode) ? 0.1 : 0.3, 4000),
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
  if (e.code === 'KeyN') goToHour(nightNow > 0.5 ? 12 : 22);
  if (e.code === 'KeyC') setCamera(mode === 'driver' ? 'street' : 'driver');
  if (e.code === 'KeyW') setWipers(wiperMode === 'auto' ? 'on' : wiperMode === 'on' ? 'off' : 'auto');
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
  hud.spd.textContent = `${Math.round(main.v * 3.6)} km/h`;
  hud.state.textContent = main.dwell > 0 ? `停站 At stop ${Math.ceil(main.dwell)}s` : main.v > 0.3 ? '行駛中 Running' : '停車 Stopped';
  hud.next.textContent = `${stop.name} (${Math.round(dist)} m)`;
  hud.pos.textContent = `${Math.round(main.x)} m`;
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

  updateClock(dt);
  const tod = applyTimeOfDay(lit, weather, hour);
  nightNow = tod.night;
  updateLights(dt, tod, cam.pos);
  updateWipers(dt);
  if (ui.peds.checked) {
    const movers: Mover[] = trams.map((t) => ({ x: t.x, dir: t.dir, v: t.v, half: TRAM.L + 0.1, decel: TRAM_DECEL }));
    if (ui.traffic.checked) for (const v of vehicles) movers.push({ x: v.x, dir: v.lane === 0 ? 1 : -1, v: v.v, half: fleet[v.kind].len / 2, decel: CAR_DECEL });
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
  glCtx.clear(glCtx.COLOR_BUFFER_BIT | glCtx.DEPTH_BUFFER_BIT);
  renderer.drawSky(state);
  renderer.beginWorld(state);
  for (const m of offsetMatrices) for (const d of statics) renderer.draw(d, m);
  for (const dx of OFFSETS) for (const t of trams) {
    renderer.draw(t.model, tramMatrix(t, dx));
    renderer.draw(wiperModel, wiperMatrix(t, dx));
  }
  if (ui.traffic.checked) {
    for (const v of vehicles) {
      const f = fleet[v.kind];
      const heading = v.lane === 0 ? 0 : Math.PI;
      for (const dx of OFFSETS) renderer.draw(f.model, modelMatrix([v.x + dx, 0, LANES[v.lane]], qAxisAngle([0, 1, 0], heading), f.scale));
    }
  }
  renderer.drawCrowd(state, crowd);
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
