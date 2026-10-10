// Weather presets (colours in sRGB, converted to linear for the shaders) and smooth blending between them
export type WeatherName = 'sunny' | 'cloudy' | 'rain';

export interface WeatherParams {
  sunColor: number[];
  sunVis: number; // how much of the sun disk / direct light gets through
  ambSky: number[];
  ambGround: number[];
  skyTop: number[];
  fog: number[];
  fogDensity: number;
  cloudCover: number;
  rain: number; // 0..1 rain intensity
  wet: number; // 0..1 wet surfaces
}

const srgb = (r: number, g: number, b: number) => [r, g, b].map((c) => Math.pow(c, 2.2));

export const WEATHER: Record<WeatherName, WeatherParams> = {
  sunny: {
    sunColor: srgb(1.0, 0.95, 0.85).map((c) => c * 1.6), sunVis: 1,
    ambSky: srgb(0.42, 0.5, 0.62), ambGround: srgb(0.25, 0.23, 0.2),
    skyTop: srgb(0.22, 0.45, 0.85), fog: srgb(0.66, 0.78, 0.92), fogDensity: 0.00011,
    cloudCover: 0.3, rain: 0, wet: 0,
  },
  cloudy: {
    sunColor: srgb(0.85, 0.85, 0.85).map((c) => c * 0.55), sunVis: 0.15,
    ambSky: srgb(0.55, 0.57, 0.6), ambGround: srgb(0.3, 0.3, 0.3),
    skyTop: srgb(0.5, 0.53, 0.57), fog: srgb(0.62, 0.64, 0.67), fogDensity: 0.00032,
    cloudCover: 0.85, rain: 0, wet: 0.1,
  },
  rain: {
    sunColor: srgb(0.7, 0.72, 0.78).map((c) => c * 0.25), sunVis: 0,
    ambSky: srgb(0.4, 0.43, 0.48), ambGround: srgb(0.18, 0.19, 0.2),
    skyTop: srgb(0.3, 0.32, 0.36), fog: srgb(0.4, 0.43, 0.47), fogDensity: 0.0009,
    cloudCover: 1.0, rain: 1, wet: 1,
  },
};

export function blendWeather(cur: WeatherParams, target: WeatherParams, t: number) {
  for (const key of Object.keys(target) as (keyof WeatherParams)[]) {
    const a = cur[key];
    const b = target[key];
    if (Array.isArray(a) && Array.isArray(b)) for (let i = 0; i < a.length; i++) a[i] += (b[i] - a[i]) * t;
    else (cur[key] as number) += ((b as number) - (a as number)) * t;
  }
}

export const cloneWeather = (w: WeatherParams): WeatherParams => JSON.parse(JSON.stringify(w));

// Rain: streaks kept in a box around the camera; streak direction uses velocity relative to the camera
export class Rain {
  private drops: Float32Array;
  readonly lines: Float32Array;
  constructor(readonly count: number) {
    this.drops = new Float32Array(count * 3);
    this.lines = new Float32Array(count * 6);
    for (let i = 0; i < count; i++) this.drops.set([(Math.random() - 0.5) * 160, Math.random() * 120 - 50, (Math.random() - 0.5) * 160], i * 3);
  }

  update(dt: number, cam: number[], camVel: number[]) {
    const fall = [2, -28, 1]; // light wind
    const rel = [fall[0] - camVel[0], fall[1] - camVel[1], fall[2] - camVel[2]];
    const streak = 0.025;
    for (let i = 0; i < this.count; i++) {
      const o = i * 3;
      for (let k = 0; k < 3; k++) {
        // drops stored relative to the camera: they move with rel velocity, wrapped into the box
        let v = this.drops[o + k] + rel[k] * dt;
        const half = k === 1 ? 60 : 80;
        const c = k === 1 ? 10 : 0;
        if (v > c + half) v -= 2 * half;
        if (v < c - half) v += 2 * half;
        this.drops[o + k] = v;
        this.lines[i * 6 + k] = cam[k] + v;
        this.lines[i * 6 + 3 + k] = cam[k] + v - rel[k] * streak;
      }
    }
  }
}
