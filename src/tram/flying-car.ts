// Flying car for the tram street: an arcade hover-car held up by four lift jets under the body.
// Units are metres and seconds. The car's local frame faces +x with +y up (as the road traffic models), and
// `pos` is the centre of the underside. The street repeats along x, so the caller wraps `pos[0]`.
import { V3, Quat, qAxisAngle, qMul } from '../sim/math';
import type { Box3 } from '../sim/city-builder';

export interface FlyInput {
  throttle: number; // -1 (reverse / brake) .. 1 (forward)
  turn: number; // -1 (right) .. 1 (left)
  lift: number; // -1 (descend) .. 1 (climb)
}
export const NO_INPUT: FlyInput = { throttle: 0, turn: 0, lift: 0 };

/** Something moving in the street the car can hit (a tram, a road vehicle, a mecha): a box and its velocity */
export interface Obstacle { min: V3; max: V3; vel: V3 }

const RESTITUTION = 0.55; // share of the closing speed the car bounces back with (0 = dead stop, 1 = elastic)
const SCRAPE = 0.85; // along the contact the car keeps this share of its sliding speed, relative to the obstacle

const ACCEL = 16; // m/s^2 at full throttle
const DRAG = 0.35; // 1/s: top speed ACCEL / DRAG, about 46 m/s (165 km/h)
const IDLE_DRAG = 0.9; // 1/s with the throttle released, so it settles into a hover
const GRIP = 2.5; // 1/s: sideways slide dies away, so it corners like a car rather than a hovercraft
const TURN_RATE = 1.3; // rad/s
const CLIMB = 10; // m/s at full lift
const HOVER = 0.6; // lowest height of the underside above the ground (m)
const CEILING = 450;
const Z_LIMIT = 700; // the city ends this far from the tram street

export class FlyingCar {
  vel: V3 = [0, 0, 0];
  bank = 0; // visual roll about the nose (radians, + = right side down); turning left leans left
  pitch = 0; // visual nose-up (radians)
  /** Strength of the lift jets 0..1, for the flames and their light */
  thrust = 0.5;
  /** Speed of the last bump into a building (m/s), cleared by the caller */
  impact = 0;
  /** Height the car holds when there is no lift input (m above the street); set by the height slider */
  hold: number;
  /** Resting on a roof this frame */
  private landed = false;

  pos: V3;
  yaw: number;
  private half: V3;
  /** `half`: half length, height and width of the body (m) */
  constructor(pos: V3, yaw: number, half: V3) {
    this.pos = pos;
    this.yaw = yaw;
    this.half = half;
    this.hold = pos[1];
  }

  /** Lowest and highest height it will hold */
  static readonly MIN_HEIGHT = HOVER;
  static readonly MAX_HEIGHT = CEILING;

  /** Body size once the model has loaded */
  resize(half: V3) { this.half = half; }

  get speed() { return Math.hypot(this.vel[0], this.vel[1], this.vel[2]); }

  /** Orientation of the body: yaw, then nose pitch, then bank */
  get rotation(): Quat {
    return qMul(qAxisAngle([0, 1, 0], this.yaw), qMul(qAxisAngle([0, 0, 1], this.pitch), qAxisAngle([1, 0, 0], this.bank)));
  }

  update(dt: number, input: FlyInput, solids: Box3[], period: number, obstacles: Obstacle[] = []) {
    const v = this.vel;
    const fwd: V3 = [Math.cos(this.yaw), 0, -Math.sin(this.yaw)];
    const side: V3 = [-fwd[2], 0, fwd[0]];
    const fv = v[0] * fwd[0] + v[2] * fwd[2];
    // steering works best with a little speed but still turns on the spot
    this.yaw += input.turn * TURN_RATE * (0.55 + 0.45 * Math.min(1, Math.abs(fv) / 12)) * dt * (fv < -0.5 ? -1 : 1);
    // horizontal: thrust along the nose, drag, and grip against sideways sliding
    const drag = Math.exp(-(input.throttle === 0 ? IDLE_DRAG : DRAG) * dt);
    const sv = v[0] * side[0] + v[2] * side[2];
    const fv2 = (fv + input.throttle * ACCEL * dt) * drag;
    const sv2 = sv * Math.exp(-GRIP * dt) * drag;
    const nf: V3 = [Math.cos(this.yaw), 0, -Math.sin(this.yaw)];
    const ns: V3 = [-nf[2], 0, nf[0]];
    v[0] = nf[0] * fv2 + ns[0] * sv2;
    v[2] = nf[2] * fv2 + ns[2] * sv2;
    // vertical: climb or descend while asked to (moving the held height along), otherwise ease to the held height
    const hold = Math.min(CEILING, Math.max(HOVER, this.hold));
    const vyGoal = input.lift !== 0 ? input.lift * CLIMB : Math.max(-CLIMB, Math.min(CLIMB, (hold - this.pos[1]) * 1.2));
    v[1] += (vyGoal - v[1]) * (1 - Math.exp(-2.5 * dt));

    for (let k = 0; k < 3; k++) this.pos[k] += v[k] * dt;
    const p = this.pos;
    if (p[1] < HOVER) { p[1] = HOVER; v[1] = Math.max(0, v[1]); }
    if (p[1] > CEILING) { p[1] = CEILING; v[1] = Math.min(0, v[1]); }
    if (Math.abs(p[2]) > Z_LIMIT) { p[2] = Math.sign(p[2]) * Z_LIMIT; v[2] = 0; }
    this.collide(solids, period);
    this.bump(obstacles, period, dt, input.throttle !== 0);
    if (input.lift !== 0) this.hold = p[1];
    else if (this.landed) this.hold = Math.max(this.hold, p[1]); // resting on a roof: hold there, no pushing down

    // body language: lean into turns, nose down when accelerating, up when climbing
    const k = 1 - Math.exp(-4 * dt);
    const bankGoal = -input.turn * 0.32 * Math.min(1, 0.3 + Math.abs(fv2) / 20);
    const pitchGoal = -input.throttle * 0.07 + v[1] * 0.012;
    this.bank += (bankGoal - this.bank) * k;
    this.pitch += (pitchGoal - this.pitch) * k;
    // jets: enough to hover, more to climb or push, less when dropping
    const climb = v[1] / CLIMB;
    const goal = 0.45 + 0.45 * Math.max(0, climb) - 0.3 * Math.max(0, -climb) + 0.2 * Math.abs(input.throttle);
    this.thrust += (Math.min(1, Math.max(0.12, goal)) - this.thrust) * (1 - Math.exp(-6 * dt));
  }

  /**
   * Bounce off moving things. The car's box (as for buildings, a square footprint that ignores yaw) is pushed out
   * of each obstacle along the axis of least overlap. Along that axis the car takes the obstacle's speed and
   * bounces back with part of the closing speed; along the contact it scrapes and loses a little. Obstacles are
   * much heavier (trams, buses, 8 m mechas), so they carry on as they were. Landing on top rides along with it.
   */
  private bump(obstacles: Obstacle[], period: number, dt: number, driving: boolean) {
    const p = this.pos, v = this.vel, h = this.half;
    const r = Math.max(h[0], h[2]);
    const half: V3 = [r, h[1], r];
    for (const o of obstacles) {
      const c: V3 = [p[0], p[1] + h[1], p[2]];
      // the nearest repeat of the obstacle along x
      const dx = Math.round((c[0] - (o.min[0] + o.max[0]) / 2) / period) * period;
      const lo: V3 = [o.min[0] + dx, o.min[1], o.min[2]], hi: V3 = [o.max[0] + dx, o.max[1], o.max[2]];
      let axis = -1, depth = Infinity, dir = 0;
      for (let k = 0; k < 3; k++) {
        const below = c[k] + half[k] - lo[k]; // overlap if pushed towards -k
        const above = hi[k] - (c[k] - half[k]); // overlap if pushed towards +k
        if (below <= 0 || above <= 0) { axis = -1; break; } // apart on this axis: no contact
        const d = Math.min(below, above);
        if (d < depth) { depth = d; axis = k; dir = below < above ? -1 : 1; }
      }
      if (axis < 0) continue;
      p[axis] += depth * dir;
      const rel = v[axis] - o.vel[axis];
      const closing = -rel * dir; // speed towards the obstacle
      if (closing > 0) {
        this.impact = Math.max(this.impact, closing);
        // a gentle touch (resting on a roof, being nudged) just settles; a real hit bounces and scrapes
        const hit = closing > 1.5;
        v[axis] = o.vel[axis] + (hit ? closing * RESTITUTION : 0) * dir;
        if (hit) for (let k = 0; k < 3; k++) if (k !== axis) v[k] = o.vel[k] + (v[k] - o.vel[k]) * SCRAPE;
      }
    }
    // Resting on a roof (just touching, within a few cm) with the throttle released: friction carries the car
    // along with it. Driving, the jets slide it freely so it can fly off.
    if (driving) return;
    for (const o of obstacles) {
      const dx = Math.round((p[0] - (o.min[0] + o.max[0]) / 2) / period) * period;
      if (p[0] + r <= o.min[0] + dx || p[0] - r >= o.max[0] + dx || p[2] + r <= o.min[2] || p[2] - r >= o.max[2]) continue;
      const gap = p[1] - o.max[1];
      if (gap < -0.05 || gap > 0.06) continue;
      // not `landed`: the held height stays put, so once the vehicle has gone the car sinks back to it
      const k = 1 - Math.exp(-8 * dt);
      v[0] += (o.vel[0] - v[0]) * k;
      v[2] += (o.vel[2] - v[2]) * k;
    }
  }

  // Push the body (an axis-aligned box around the car, ignoring yaw) out of any building it overlaps
  private collide(solids: Box3[], period: number) {
    const p = this.pos, v = this.vel, h = this.half;
    const r = Math.max(h[0], h[2]); // yaw-proof footprint
    const c: V3 = [p[0], p[1] + h[1], p[2]];
    this.landed = false;
    for (const b of solids) {
      // the nearest repeat of the building along x
      const dx = Math.round((c[0] - (b.min[0] + b.max[0]) / 2) / period) * period;
      const x0 = b.min[0] + dx - r, x1 = b.max[0] + dx + r;
      const y1 = b.max[1] + h[1], z0 = b.min[2] - r, z1 = b.max[2] + r;
      if (c[0] <= x0 || c[0] >= x1 || c[1] >= y1 || c[2] <= z0 || c[2] >= z1) continue;
      // smallest way out: a side, or up onto the roof
      const outs: [number, number, number][] = [[0, x0 - c[0], -1], [0, x1 - c[0], 1], [2, z0 - c[2], -1], [2, z1 - c[2], 1], [1, y1 - c[1], 1]];
      let best = outs[0];
      for (const o of outs) if (Math.abs(o[1]) < Math.abs(best[1])) best = o;
      const [axis, d, dir] = best;
      p[axis] += d;
      c[axis] += d;
      if (axis === 1) this.landed = true;
      const into = -v[axis] * dir; // speed towards the wall
      if (into > 0) {
        this.impact = Math.max(this.impact, into);
        v[axis] += into * dir * 1.2; // a small bounce
      }
    }
  }
}
