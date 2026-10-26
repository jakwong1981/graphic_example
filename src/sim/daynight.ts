// Time of day on top of the weather: sun path over 24 hours, dusk colours, moonlit night.
// The weather presets describe daytime light; this module darkens and tints them for the hour.
import { V3, norm } from './math';
import { WeatherParams } from './weather';

const srgb = (r: number, g: number, b: number) => [r, g, b].map((c) => Math.pow(c, 2.2));
const smoothstep = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
const mixInto = (out: number[], a: number[], b: number[], t: number) => {
  for (let i = 0; i < out.length; i++) out[i] = a[i] + (b[i] - a[i]) * t;
};

// Night palette (linear). Clear nights are deep blue; overcast nights glow orange from the city lights.
const NIGHT = {
  skyTop: srgb(0.015, 0.03, 0.08),
  fogClear: srgb(0.06, 0.08, 0.14),
  fogCity: srgb(0.2, 0.15, 0.13),
  ambSky: srgb(0.11, 0.13, 0.2),
  ambGround: srgb(0.07, 0.065, 0.07),
  moon: srgb(0.6, 0.68, 0.85).map((c) => c * 0.22),
};
const DUSK = { sun: srgb(1.0, 0.5, 0.22), fog: srgb(0.98, 0.6, 0.42), skyTop: srgb(0.28, 0.32, 0.6) };

export interface TimeOfDay {
  lightDir: V3; // sun, or the moon at night
  sunDir: V3;
  night: number; // 0 day .. 1 night
  dusk: number; // 0..1 around sunrise / sunset
}

// Sun rises in the east (+x, down the street) at 06:00, highest at noon, sets at 18:00
export function sunDirection(hour: number): V3 {
  const a = ((hour - 6) / 24) * Math.PI * 2;
  return norm([Math.cos(a) * 0.85, Math.sin(a), 0.42]);
}

export function formatHour(hour: number): string {
  const m = Math.round(hour * 60) % (24 * 60);
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

/** Writes the time-of-day lighting for `hour` into `out`, starting from the daytime weather `w`. */
export function applyTimeOfDay(out: WeatherParams, w: WeatherParams, hour: number): TimeOfDay {
  const sun = sunDirection(hour);
  const sy = sun[1];
  const day = smoothstep(-0.1, 0.18, sy);
  const dusk = smoothstep(-0.14, 0.02, sy) * (1 - smoothstep(0.02, 0.35, sy));
  const clear = w.sunVis;

  // Direct light: the sun above the horizon, the moon (opposite the sun) below. Both fade to zero at the switch.
  let lightDir: V3;
  if (sy > -0.04) {
    lightDir = sun;
    const k = smoothstep(-0.04, 0.12, sy);
    const warm = 1 - smoothstep(0.0, 0.45, sy);
    for (let i = 0; i < 3; i++) out.sunColor[i] = w.sunColor[i] * k * (1 + (DUSK.sun[i] - 1) * warm);
  } else {
    lightDir = norm([-sun[0], -sun[1], -0.3]);
    const k = 1 - smoothstep(-0.25, -0.04, sy);
    for (let i = 0; i < 3; i++) out.sunColor[i] = NIGHT.moon[i] * k * (0.15 + 0.85 * clear);
  }

  const nightFog = NIGHT.fogClear.map((c, i) => c + (NIGHT.fogCity[i] - c) * w.cloudCover);
  mixInto(out.ambSky, NIGHT.ambSky, w.ambSky, day);
  mixInto(out.ambGround, NIGHT.ambGround, w.ambGround, day);
  mixInto(out.skyTop, NIGHT.skyTop, w.skyTop, day);
  mixInto(out.fog, nightFog, w.fog, day);
  // Dusk: orange horizon, violet zenith, warmer ambient (only where the sun gets through)
  const dk = dusk * (0.25 + 0.75 * clear);
  mixInto(out.fog, out.fog, DUSK.fog, dk * 0.65);
  mixInto(out.skyTop, out.skyTop, DUSK.skyTop, dk * 0.45);
  for (let i = 0; i < 3; i++) out.ambSky[i] *= 1 + (DUSK.sun[i] - 1) * dk * 0.35;

  out.sunVis = w.sunVis;
  out.fogDensity = w.fogDensity;
  out.cloudCover = w.cloudCover;
  out.rain = w.rain;
  out.wet = w.wet;
  return { lightDir, sunDir: sun, night: 1 - day, dusk };
}
