// Flight simulator over a Hong Kong-style harbour: physics, chase camera, jet effects, weather
import { perspective, lookAt } from './math/matrix';
import { airplane } from './models/airplane';
import { ship } from './models/ship';
import { hkTaxi } from './models/hk-taxi';
import { car } from './models/car';
import { Traffic } from './sim/traffic';
import { SimAudio } from './sim/audio';
import { YouTubeMusic } from './sim/music';
import { V3, add, sub, scale, cross, norm, lerp, len, qAxisAngle, qRotate, modelMatrix } from './sim/math';
import { FlightModel, Controls } from './sim/physics';
import { buildCity, WATER_Y } from './sim/city';
import { paintCityTexture } from './sim/city-textures';
import { ParticlePool } from './sim/particles';
import { WEATHER, WeatherName, blendWeather, cloneWeather, Rain } from './sim/weather';
import { SceneRenderer, Camera, Drawable } from './sim/scene-renderer';
import { emitExhaust, explode, PLANE_SCALE, PLANE_OFFSET } from './sim/effects';

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
const city = buildCity();
const statics: Drawable[] = [];
let seed = 7;
for (const [material, data] of city.batches) {
  statics.push(renderer.mesh(data, renderer.tileTexture(paintCityTexture(material, seed++)), material === 'water'));
}
const plane = renderer.model(airplane);
const shipModel = renderer.model(ship);
// Vehicle fleet: HK urban (red), New Territories (green) and Lantau (blue) taxis + private cars.
// Each variant repaints the same UV atlas with a different body colour.
const fleet = [
  { def: hkTaxi, paint: '#c8102e', scale: 2.0 },
  { def: hkTaxi, paint: '#c8102e', scale: 2.0 },
  { def: hkTaxi, paint: '#2e9e44', scale: 2.0 },
  { def: hkTaxi, paint: '#2a7fd4', scale: 2.0 },
  { def: car, paint: '#f2f2f2', scale: 1.9 },
  { def: car, paint: '#9aa0a8', scale: 1.9 },
  { def: car, paint: '#1b1b1f', scale: 1.9 },
  { def: car, paint: '#1f4fa8', scale: 1.9 },
  { def: car, paint: '#d6a21e', scale: 1.9 },
].map((v) => ({ model: renderer.model({ ...v.def, paint: v.paint }), scale: v.scale }));
const traffic = new Traffic(160, fleet.length);
const IDENTITY = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);

const flame = new ParticlePool(glCtx, renderer.particle, 9000, 1.5, 0);
const smoke = new ParticlePool(glCtx, renderer.particle, 6000, 0.6, 1.5);
const rain = new Rain(5000);

// ---- Flight state ----
const START: V3 = [1500, 320, 200];
const START_HEADING = Math.PI; // nose towards -x: across the harbour to the island
const sim = new FlightModel();
sim.reset(START, START_HEADING, 140);
let crashed = false;
let crashTimer = 0;

// ---- Input ----
const keys = new Set<string>();
const controls: Controls = { pitch: 0, roll: 0, yaw: 0, boost: false, brake: false };
let assist = true; // flight assist: arrows command climb / descend / turn; off = raw pitch & roll
let cameraMode: 'chase' | 'cockpit' = 'chase';
const audio = new SimAudio();
// Background music: https://www.youtube.com/watch?v=ltXZrFpDs6U, played by the embedded YouTube player
const music = new YouTubeMusic('yt-player', 'ltXZrFpDs6U');
music.onState = (text) => {
  $('music-state').textContent = text;
  $('music-btn').setAttribute('aria-pressed', String(music.playing));
};
$('music-btn').addEventListener('click', () => music.toggle());
$<HTMLInputElement>('music-vol').addEventListener('input', (e) => music.setVolume(Number((e.target as HTMLInputElement).value)));
addEventListener('keydown', (e) => {
  if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) e.preventDefault();
  audio.start(); // audio may only start after a user gesture
  keys.add(e.code);
  if (e.code === 'KeyR') resetFlight();
  if (e.code === 'KeyC') toggleCamera();
  if (e.code === 'KeyF') toggleAssist();
  if (e.code === 'KeyM') toggleMute();
  if (e.code === 'KeyB') music.toggle();
  if (e.code === 'Digit1') setWeather('sunny');
  if (e.code === 'Digit2') setWeather('cloudy');
  if (e.code === 'Digit3') setWeather('rain');
});
addEventListener('pointerdown', () => audio.start());
addEventListener('keyup', (e) => keys.delete(e.code));
addEventListener('blur', () => keys.clear());

const clamp = (v: number, lo = -1, hi = 1) => Math.min(hi, Math.max(lo, v));
const MAX_BANK = (55 * Math.PI) / 180;
const CLIMB_RATE = 35; // m/s commanded by Up / Down

// Arrow keys -> control surfaces.
// Assist mode is a small autopilot: Up/Down set a target climb rate, Left/Right set a target bank
// (the bank tilts the lift and turns the plane). Releasing the keys levels the wings and holds altitude.
function readControls(dt: number) {
  const axis = (pos: string, neg: string) => (keys.has(pos) ? 1 : 0) - (keys.has(neg) ? 1 : 0);
  const ramp = (cur: number, target: number) => cur + (target - cur) * Math.min(1, dt * 6);
  const updown = axis('ArrowUp', 'ArrowDown');
  const turn = axis('ArrowRight', 'ArrowLeft');
  controls.boost = keys.has('KeyA');
  controls.brake = keys.has('KeyZ') || keys.has('KeyS');
  if (!assist) {
    controls.pitch = ramp(controls.pitch, updown);
    controls.roll = ramp(controls.roll, turn);
    controls.yaw = ramp(controls.yaw, axis('KeyE', 'KeyQ'));
    return;
  }
  const bank = -Math.asin(clamp(sim.right()[1])); // + = right wing down
  const [rollRate, , pitchRate] = sim.w;
  // Bank to the commanded angle; P on angle + D on roll rate
  const targetBank = turn * MAX_BANK;
  controls.roll = clamp((targetBank - bank) * 2.2 - rollRate * 0.5);
  // Climb-rate hold; don't ask for more climb than the airspeed can give (stall protection)
  let targetVs = updown * CLIMB_RATE;
  targetVs = Math.min(targetVs, (sim.airspeed - 75) * 0.8);
  const vsErr = targetVs - sim.vel[1];
  // In a bank part of the lift goes sideways, so pull a little extra to keep the nose up
  const bankComp = (1 / Math.max(0.4, Math.cos(bank)) - 1) * 0.6;
  controls.pitch = clamp(vsErr * 0.05 + bankComp - pitchRate * 0.4);
  // A touch of rudder into the turn keeps it coordinated (no sideslip)
  controls.yaw = clamp(turn * 0.25 + axis('KeyE', 'KeyQ'));
}

function toggleAssist() {
  assist = !assist;
  $('assist-btn').setAttribute('aria-pressed', String(assist));
}
function toggleMute() {
  audio.start();
  audio.setMuted(!audio.muted);
  $('mute-btn').setAttribute('aria-pressed', String(audio.muted));
  $('mute-btn').textContent = audio.muted ? '🔇 靜音 Muted (M)' : '🔊 聲音 Sound (M)';
}

function resetFlight() {
  sim.reset(START, START_HEADING, 140);
  crashed = false;
  camPos = sub(START, [-40, -10, 0]);
}

function toggleCamera() {
  cameraMode = cameraMode === 'chase' ? 'cockpit' : 'chase';
}
$('cam-btn').addEventListener('click', toggleCamera);
$('assist-btn').addEventListener('click', toggleAssist);
$('mute-btn').addEventListener('click', toggleMute);

// ---- Weather ----
let weatherName: WeatherName = 'sunny';
const weather = cloneWeather(WEATHER.sunny);
const sunDir = norm([-0.45, 0.55, -0.35]);
let flash = 0;
let nextLightning = 5;
function setWeather(name: WeatherName) {
  weatherName = name;
  document.querySelectorAll<HTMLButtonElement>('[data-weather]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.weather === name)));
}
document.querySelectorAll<HTMLButtonElement>('[data-weather]').forEach((b) =>
  b.addEventListener('click', () => setWeather(b.dataset.weather as WeatherName))
);

// ---- Collision ----
function collides(p: V3): boolean {
  if (p[1] < city.groundHeight(p[0], p[2]) + 1.5) return true;
  if (p[1] > 500) return false; // above the tallest tower (ICC ~484 m): skip the box tests
  for (const b of city.colliders) {
    if (p[0] > b.min[0] - 3 && p[0] < b.max[0] + 3 && p[1] > b.min[1] - 3 && p[1] < b.max[1] + 3 && p[2] > b.min[2] - 3 && p[2] < b.max[2] + 3) return true;
  }
  return false;
}

// ---- Camera ----
const FOV = Math.PI / 3;
// Body-frame eye position in model units (after PLANE_OFFSET): x 0.65 + 0.1, y 0.6 + 0.18 + 0.08 - 0.6
const COCKPIT_EYE: V3 = [0.75, 0.26, 0];
let camPos: V3 = sub(START, [-40, -10, 0]);
let camUp: V3 = [0, 1, 0];
function updateCamera(dt: number): Camera {
  const f = sim.forward();
  const u = sim.up();
  let eye: V3;
  let target: V3;
  let up: V3;
  const cockpit = cameraMode === 'cockpit' && !crashed;
  if (cockpit) {
    // Pilot's eye just above the fuselage skin, behind the nose (model x 0.65, y = top of the fuselage + 0.08).
    // Looking ~7 degrees down puts the nose and the top of the fuselage in the lower part of the view.
    eye = add(sim.pos, qRotate(sim.q, scale(COCKPIT_EYE, PLANE_SCALE)));
    target = add(eye, norm(sub(f, scale(u, 0.12))));
    up = u;
    camPos = eye;
    camUp = u;
  } else {
    // Spring-damped chase camera: lags behind, rolls partly with the plane
    const desired = crashed ? add(sim.pos, [60, 40, 60]) : add(sim.pos, add(scale(f, -42), add(scale(u, 8), [0, 4, 0])));
    camPos = lerp(camPos, desired, 1 - Math.exp(-dt * (crashed ? 1 : 5)));
    camUp = norm(lerp(camUp, norm(add([0, 1, 0], scale(u, 0.6))), 1 - Math.exp(-dt * 3)));
    eye = camPos;
    target = crashed ? sim.pos : add(sim.pos, scale(f, 18));
    up = camUp;
  }
  const fwd = norm(sub(target, eye));
  const right = norm(cross(fwd, up));
  const trueUp = cross(right, fwd);
  const aspect = canvas.width / canvas.height;
  return {
    pos: eye, fwd, right, up: trueUp, fov: FOV, aspect,
    view: lookAt(eye, target, up),
    // Closer near plane in the cockpit so the fuselage right under the eye is not clipped
    proj: perspective(FOV, aspect, cockpit ? 0.15 : 0.5, 14000),
  };
}

// ---- HUD ----
const hud = { spd: $('spd'), alt: $('alt'), vs: $('vs'), hdg: $('hdg'), aoa: $('aoa'), g: $('g'), thr: $('thr'), fill: $('throttle-fill'), warn: $('warn') };
let hudTimer = 0;
function updateHud(dt: number) {
  hudTimer -= dt;
  if (hudTimer > 0) return;
  hudTimer = 0.08;
  const f = sim.forward();
  const agl = sim.pos[1] - city.groundHeight(sim.pos[0], sim.pos[2]);
  hud.spd.textContent = `${Math.round(sim.airspeed * 3.6)} km/h`;
  hud.alt.textContent = `${Math.round(sim.pos[1])} m`;
  hud.vs.textContent = `${sim.vel[1] >= 0 ? '+' : ''}${Math.round(sim.vel[1])} m/s`;
  hud.hdg.textContent = `${Math.round(((Math.atan2(f[2], f[0]) * 180) / Math.PI + 450) % 360)}°`;
  hud.aoa.textContent = `${((sim.alpha * 180) / Math.PI).toFixed(1)}°`;
  hud.g.textContent = sim.gForce.toFixed(1);
  const thr = Math.round(sim.throttle * 100);
  hud.thr.textContent = `${thr}%${sim.throttle > 0.85 ? ' 🔥 後燃器' : ''}`;
  hud.fill.style.width = `${thr}%`;
  let warn = '';
  if (crashed) warn = '💥 墜毀 CRASHED<br><small>按 R 重置 / auto reset</small>';
  else if (sim.stalled && sim.airspeed > 5) warn = '⚠ 失速 STALL';
  else if (agl < 90 && sim.vel[1] < -12) warn = '⚠ 拉起 PULL UP';
  hud.warn.innerHTML = warn;
  hud.warn.style.display = warn ? 'block' : 'none';
}

// ---- Resize ----
function resize() {
  const dpr = Math.min(devicePixelRatio, 2);
  canvas.width = Math.round(innerWidth * dpr);
  canvas.height = Math.round(innerHeight * dpr);
}
addEventListener('resize', resize);
resize();

// ---- Movers (ships, taxis) ----
function moverMatrix(pos: V3, heading: number, s: number, bob = 0) {
  return modelMatrix([pos[0], pos[1] + bob, pos[2]], qAxisAngle([0, 1, 0], heading), s);
}
function updateMovers(dt: number) {
  traffic.update(dt);
  for (const m of city.ships) {
    const dir = Math.cos(m.heading) !== 0 && m.axis === 0 ? Math.sign(Math.cos(m.heading)) : -Math.sign(Math.sin(m.heading));
    m.pos[m.axis] += dir * m.speed * dt;
    if (m.pos[m.axis] > m.max) m.pos[m.axis] = m.min;
    if (m.pos[m.axis] < m.min) m.pos[m.axis] = m.max;
  }
}

// ---- Main loop ----
glCtx.enable(glCtx.DEPTH_TEST);
glCtx.enable(glCtx.CULL_FACE);
const STEP = 1 / 120;
let acc = 0;
let time = 0;
let last = performance.now();
let prevCam: V3 = [...camPos];

function frame(now: number) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  time += dt;

  readControls(dt);
  if (!crashed) {
    acc += dt;
    while (acc >= STEP) {
      sim.step(STEP, controls);
      acc -= STEP;
      const nose = add(sim.pos, scale(sim.forward(), PLANE_SCALE * 1.4));
      if (collides(sim.pos) || collides(nose)) {
        crashed = true;
        crashTimer = 4;
        explode(sim.pos, flame, smoke);
        audio.explosion();
        break;
      }
    }
    if (!crashed) emitExhaust(sim, dt, flame, smoke);
  } else if ((crashTimer -= dt) <= 0) {
    resetFlight();
  }
  flame.update(dt);
  smoke.update(dt);
  updateMovers(dt);

  // Weather blending + lightning in the rain
  blendWeather(weather, WEATHER[weatherName], 1 - Math.exp(-dt * 1.2));
  flash *= Math.exp(-dt * 9);
  if (weather.rain > 0.8 && (nextLightning -= dt) <= 0) {
    flash = 1.2;
    audio.thunder();
    nextLightning = 4 + Math.random() * 10;
  }

  const cam = updateCamera(dt);
  const camVel = scale(sub(cam.pos, prevCam), 1 / Math.max(dt, 1e-3));
  prevCam = [...cam.pos];
  if (weather.rain > 0.02) rain.update(dt, cam.pos, len(camVel) > 2000 ? [0, 0, 0] : camVel);

  const state = { cam, weather, sunDir, time, flash, height: canvas.height };
  glCtx.viewport(0, 0, canvas.width, canvas.height);
  glCtx.clear(glCtx.COLOR_BUFFER_BIT | glCtx.DEPTH_BUFFER_BIT);
  renderer.drawSky(state);
  renderer.beginWorld(state);
  for (const d of statics) renderer.draw(d, IDENTITY);
  for (const s of city.ships) {
    // Waterline sits at model y ~0.13; 25x scale gives ~85 m ships
    const bob = Math.sin(time * 0.8 + s.pos[2] * 0.01) * 0.4;
    renderer.draw(shipModel, moverMatrix([s.pos[0], WATER_Y - 0.13 * 25, s.pos[2]], s.heading, 25, bob));
  }
  for (const v of traffic.vehicles) {
    const f = fleet[v.kind];
    renderer.draw(f.model, moverMatrix(traffic.position(v), v.heading, f.scale));
  }
  if (!crashed) renderer.draw(plane, modelMatrix(sim.pos, sim.q, PLANE_SCALE, PLANE_OFFSET));
  renderer.drawParticles(state, smoke, flame);
  renderer.drawRain(state, rain.lines, weather.rain);

  updateHud(dt);
  audio.update({
    throttle: sim.throttle, airspeed: sim.airspeed, stalled: sim.stalled && sim.airspeed > 5,
    rain: weather.rain, crashed, cockpit: cameraMode === 'cockpit',
  });
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
