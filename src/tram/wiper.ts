// Windscreen wiper on the driver's (lower deck, centre) front window of the tram.
// Glass coordinates are tram-local (z, y) on the front plane x = TRAM.L; wiper angle 0 points along +z.
import { CityBuilder } from '../sim/city-builder';
import type { MeshData } from '../webgl/mesh';
import { V3 } from '../sim/math';
import { TRAM } from '../models/hk-tram';

export const WIPER = {
  pivot: [0, 1.43] as [number, number], // bottom centre of the driver's pane (z, y)
  blade: [0.1, 0.55] as [number, number], // blade covers these radii from the pivot
  sweep: [0.8, Math.PI - 0.8] as [number, number], // parked at sweep[0]
};
export const WIPE_BINS = 128;
// Front window panes (tram-local y) for the two cab views
export const LOWER_PANE: [number, number] = [1.4, 2.3];
export const UPPER_PANE: [number, number] = [3.0, 3.95];

export type WiperMode = 'auto' | 'on' | 'off';

// Stroke speed (strokes / s, a full out-and-back takes 2 / speed s) and the pause when parked
export function wiperSpeed(mode: WiperMode, rain: number): { speed: number; interval: number } {
  if (mode === 'off' || (mode === 'auto' && rain < 0.05)) return { speed: 0, interval: 0 };
  if (rain > 0.75) return { speed: 1.8, interval: 0 }; // fast
  if (mode === 'on' || rain > 0.35) return { speed: 1.0, interval: 0 }; // slow
  return { speed: 1.1, interval: 3 }; // intermittent drizzle setting
}

export class Wiper {
  angle = WIPER.sweep[0];
  /** Time each angular bin of the swept area was last wiped (drives the windscreen shader) */
  readonly wipe = new Float32Array(WIPE_BINS).fill(-1e4);
  private s = 0; // stroke progress: 0 parked side, 1 far side
  private dir = 0; // 0 parked, +1 outward, -1 returning
  private pause: number;

  constructor(delay = 0) {
    this.pause = delay;
  }

  update(dt: number, time: number, speed: number, interval: number) {
    const prev = this.angle;
    if (this.dir === 0 && speed > 0 && (this.pause -= dt) <= 0) this.dir = 1;
    if (this.dir !== 0) {
      this.s += this.dir * dt * (speed > 0 ? speed : 1.2); // switched off mid-stroke: finish and park
      if (this.s >= 1) { this.s = 1; this.dir = -1; }
      if (this.s <= 0) { this.s = 0; this.dir = 0; this.pause = interval; }
    }
    const [a0, a1] = WIPER.sweep;
    this.angle = a0 + (a1 - a0) * (0.5 - 0.5 * Math.cos(Math.PI * this.s)); // eased like a crank linkage
    const bin = (a: number) => Math.floor(((a - a0) / (a1 - a0)) * WIPE_BINS);
    const lo = Math.max(0, bin(Math.min(prev, this.angle)));
    const hi = Math.min(WIPE_BINS - 1, bin(Math.max(prev, this.angle)));
    if (prev !== this.angle) for (let i = lo; i <= hi; i++) this.wipe[i] = time;
  }
}

// Wiper arm + rubber blade in wiper space: +z along the arm, +x out of the glass. Closed boxes, so it reads from inside too.
export function buildWiperMesh(): MeshData {
  const b = new CityBuilder();
  const solid = (x0: number, x1: number, y0: number, y1: number, z0: number, z1: number) => {
    b.box(x0, x1, y0, y1, z0, z1, 'steel', 'steel', false);
    b.flat('steel', [[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]], [(x0 + x1) / 2, y1, (z0 + z1) / 2]);
  };
  const [r0, r1] = WIPER.blade;
  solid(0, 0.03, -0.02, 0.02, -0.02, 0.02); // spindle hub
  solid(0.012, 0.024, -0.006, 0.006, 0, r1 - 0.03); // arm
  solid(0.022, 0.04, -0.011, 0.011, r0, r1); // blade
  return b.finish().get('steel')!;
}

export const WIPER_PIVOT_LOCAL: V3 = [TRAM.L + 0.004, WIPER.pivot[1], WIPER.pivot[0]];
