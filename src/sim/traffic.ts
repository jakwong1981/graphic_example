// Random traffic on the road grid. Roads run along every multiple of BLOCK in x and z.
// Vehicles drive to the next junction, then pick straight / left / right at random (no U-turns unless stuck),
// keep left like in Hong Kong, and sometimes wait at a junction as if at a red light.
import { mulberry32 } from './math';

const BLOCK = 120;
const LANE = 3.5; // metres from the road centre line
// Directions: 0 = +x, 1 = +z, 2 = -x, 3 = -z
const DX = [1, 0, -1, 0];
const DZ = [0, 1, 0, -1];

interface Area { i0: number; i1: number; j0: number; j1: number } // junction index ranges (inclusive)

export interface Vehicle {
  i: number; // target junction
  j: number;
  x: number; // road-centre position (lane offset is applied when drawing)
  z: number;
  dir: number;
  speed: number;
  maxSpeed: number;
  wait: number; // seconds left at a red light
  heading: number; // smoothed render heading (radians about +y)
  kind: number;
  area: Area;
}

// Island: x -1800..480, Kowloon: x 1800..3600 (stays south of the container port)
const AREAS: Area[] = [
  { i0: -15, i1: 4, j0: -9, j1: 10 },
  { i0: 15, i1: 30, j0: -9, j1: 8 },
];

const headingOf = (dir: number) => Math.atan2(-DZ[dir], DX[dir]); // model +x -> (cos, -sin) in x/z
const inArea = (a: Area, i: number, j: number) => i >= a.i0 && i <= a.i1 && j >= a.j0 && j <= a.j1;

export class Traffic {
  readonly vehicles: Vehicle[] = [];
  private rnd: () => number;

  constructor(count: number, kinds: number, seed = 42) {
    this.rnd = mulberry32(seed);
    const r = this.rnd;
    for (let n = 0; n < count; n++) {
      const area = AREAS[n % 3 === 2 ? 1 : 0]; // 2/3 on the island
      const i = area.i0 + Math.floor(r() * (area.i1 - area.i0 + 1));
      const j = area.j0 + Math.floor(r() * (area.j1 - area.j0 + 1));
      const v: Vehicle = {
        i, j, x: i * BLOCK, z: j * BLOCK, dir: Math.floor(r() * 4), speed: 0,
        maxSpeed: 8 + r() * 9, wait: 0, heading: 0, kind: Math.floor(r() * kinds), area,
      };
      this.chooseNext(v, true);
      // start part-way along the first block so cars are spread out
      const t = r();
      v.x = (v.i - DX[v.dir] * t) * BLOCK;
      v.z = (v.j - DZ[v.dir] * t) * BLOCK;
      v.heading = headingOf(v.dir);
      this.vehicles.push(v);
    }
  }

  // At a junction: straight 50%, left/right 25% each, only onto roads inside the area
  private chooseNext(v: Vehicle, initial = false) {
    const ci = initial ? v.i : v.i;
    const cj = initial ? v.j : v.j;
    const options: number[] = [];
    for (const [d, w] of [[v.dir, 2], [(v.dir + 1) % 4, 1], [(v.dir + 3) % 4, 1]] as const) {
      if (inArea(v.area, ci + DX[d], cj + DZ[d])) for (let k = 0; k < w; k++) options.push(d);
    }
    v.dir = options.length ? options[Math.floor(this.rnd() * options.length)] : (v.dir + 2) % 4;
    v.i = ci + DX[v.dir];
    v.j = cj + DZ[v.dir];
  }

  update(dt: number) {
    for (const v of this.vehicles) {
      if (v.wait > 0) {
        v.wait -= dt;
        v.speed = 0;
      } else {
        v.speed += (v.maxSpeed - v.speed) * Math.min(1, dt * 1.5); // accelerate away gently
      }
      const tx = v.i * BLOCK;
      const tz = v.j * BLOCK;
      const remaining = Math.abs(tx - v.x) + Math.abs(tz - v.z);
      const step = v.speed * dt;
      if (step >= remaining) {
        v.x = tx;
        v.z = tz;
        this.chooseNext(v);
        if (this.rnd() < 0.25) v.wait = 1 + this.rnd() * 4; // red light
      } else {
        v.x += DX[v.dir] * step;
        v.z += DZ[v.dir] * step;
      }
      // Smoothly rotate towards the travel direction (shortest way round)
      let d = headingOf(v.dir) - v.heading;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      v.heading += d * Math.min(1, dt * 6);
    }
  }

  // World position with the keep-left lane offset; left of travel direction (dx, dz) is (dz, -dx)
  position(v: Vehicle): [number, number, number] {
    return [v.x + DZ[v.dir] * LANE, 0, v.z - DX[v.dir] * LANE];
  }
}
