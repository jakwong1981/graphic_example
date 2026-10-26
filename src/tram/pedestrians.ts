// Pedestrians on the tram street: walk the pavements, browse shop windows, put up umbrellas in the rain
// and cross the road at the zebra crossings once the traffic has stopped for them.
// Rendering is instanced (see crowd.vert.glsl); this module builds the person mesh and runs the crowd.
import { V3, mulberry32 } from '../sim/math';
import type { CrowdMesh } from '../sim/scene-renderer';
import { CROWD_STRIDE } from '../sim/scene-renderer';
import { CROSSINGS, ZEBRA_HALF, KERB_EDGE, STREET_HALF } from './street';

// ---- Person mesh (faces +x, feet at y = 0) ----
type Slot = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7; // skin, shirt, trousers, hair, shoes, umbrella, bag, umbrella pole
type Part = 0 | 1 | 2 | 3 | 4; // rigid, left leg, right leg, left arm, right arm

export function buildPersonMesh(): CrowdMesh {
  const P: number[] = [], N: number[] = [], A: number[] = [], I: number[] = [];
  const tri = (a: V3, b: V3, c: V3, n: V3, slot: Slot, part: Part) => {
    // wind counter-clockwise as seen from the side the normal points to
    const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const cr = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
    if (cr[0] * n[0] + cr[1] * n[1] + cr[2] * n[2] < 0) [b, c] = [c, b];
    const base = P.length / 3;
    for (const p of [a, b, c]) { P.push(...p); N.push(...n); A.push(slot, part); }
    I.push(base, base + 1, base + 2);
  };
  const box = (x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, slot: Slot, part: Part = 0) => {
    const faces: [V3, V3[]][] = [
      [[1, 0, 0], [[x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [x1, y0, z1]]],
      [[-1, 0, 0], [[x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0]]],
      [[0, 1, 0], [[x0, y1, z0], [x0, y1, z1], [x1, y1, z1], [x1, y1, z0]]],
      [[0, -1, 0], [[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]]],
      [[0, 0, 1], [[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]]],
      [[0, 0, -1], [[x0, y0, z0], [x0, y1, z0], [x1, y1, z0], [x1, y0, z0]]],
    ];
    for (const [n, q] of faces) { tri(q[0], q[1], q[2], n, slot, part); tri(q[0], q[2], q[3], n, slot, part); }
  };
  for (const [s, leg, arm] of [[1, 1, 3], [-1, 2, 4]] as const) {
    const z = s * 0.1;
    box(-0.06, 0.15, 0, 0.07, z - 0.055, z + 0.055, 4, leg); // shoe
    box(-0.065, 0.065, 0.07, 0.92, z - 0.06, z + 0.06, 2, leg); // leg
    const za = s * 0.245;
    box(-0.05, 0.05, 1.1, 1.44, za - 0.045, za + 0.045, 1, arm); // sleeve
    box(-0.04, 0.04, 0.84, 1.1, za - 0.035, za + 0.035, 0, arm); // forearm and hand
  }
  box(-0.12, 0.12, 0.88, 1.0, -0.2, 0.2, 2); // hips
  box(-0.11, 0.12, 1.0, 1.46, -0.2, 0.2, 1); // torso
  box(-0.04, 0.04, 1.46, 1.53, -0.04, 0.04, 0); // neck
  box(-0.1, 0.11, 1.52, 1.74, -0.09, 0.09, 0); // head
  box(-0.12, 0.06, 1.67, 1.79, -0.105, 0.105, 3); // hair (top and back)
  box(-0.125, -0.06, 1.55, 1.67, -0.1, 0.1, 3);
  // Shopping bag hanging from the left hand (swings with the arm)
  box(-0.08, 0.1, 0.56, 0.84, 0.3, 0.36, 6, 3);
  // Umbrella held in the right hand: pole and an octagonal canopy, visible from above and below
  const [ux, uz] = [0.2, -0.24];
  box(ux - 0.012, ux + 0.012, 0.84, 2.1, uz - 0.012, uz + 0.012, 7);
  const ring: V3[] = [];
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    ring.push([ux + Math.cos(a) * 0.55, 1.92, uz + Math.sin(a) * 0.55]);
  }
  const apex: V3 = [ux, 2.12, uz];
  for (let i = 0; i < 8; i++) {
    const a = ring[i], b = ring[(i + 1) % 8];
    const mx = (a[0] + b[0]) / 2 - ux, mz = (a[2] + b[2]) / 2 - uz;
    const l = Math.hypot(mx, mz, 0.9);
    tri(apex, a, b, [mx / l, 0.9 / l, mz / l], 5, 0);
    tri(apex, a, b, [-mx / l, -0.9 / l, -mz / l], 5, 0);
  }
  return { positions: new Float32Array(P), normals: new Float32Array(N), parts: new Float32Array(A), indices: new Uint16Array(I) };
}

// ---- Crowd simulation ----
type State = 'walk' | 'browse' | 'toKerb' | 'wait' | 'cross' | 'fromKerb';
interface Person {
  x: number; z: number; y: number;
  side: 1 | -1; // pavement: +1 south (z > 0), -1 north
  lane: number; // |z| of the walking line on the pavement
  dir: 1 | -1; // walking direction along x
  pace: number; // preferred walking speed
  speed: number;
  heading: number;
  phase: number;
  dodge: number; // sidestep to the left for oncoming people
  state: State;
  timer: number;
  crossing: number; // index into CROSSINGS
  cx: number; // x where this person crosses
  cooldown: number;
  scale: number;
  shirt: V3; pants: V3; skin: V3; hair: number; umb: V3;
  umbrellaAt: number; // rain level at which this person opens the umbrella
  bag: boolean;
  rank: number; // 0..1, people with a high rank stay home at night
}

/** Something on the road that must not hit a pedestrian */
export interface Mover { x: number; dir: number; v: number; half: number; decel: number }

const LANES_Z = [8.35, 10.25]; // kerb-side line (between lamps and trees) and the shop-window line
const KERB_WAIT = KERB_EDGE + 0.3;
const S = STREET_HALF;
const PERIOD = 2 * S;
const wrapX = (x: number) => ((((x + S) % PERIOD) + PERIOD) % PERIOD) - S;

const SHIRTS: V3[] = [[0.95, 0.95, 0.93], [0.12, 0.12, 0.14], [0.16, 0.24, 0.45], [0.55, 0.57, 0.6], [0.72, 0.16, 0.18], [0.95, 0.75, 0.8], [0.62, 0.8, 0.92], [0.92, 0.82, 0.45], [0.3, 0.5, 0.35]];
const PANTS: V3[] = [[0.1, 0.1, 0.12], [0.14, 0.18, 0.32], [0.62, 0.55, 0.42], [0.25, 0.35, 0.55], [0.4, 0.4, 0.42]];
const SKINS: V3[] = [[0.95, 0.8, 0.68], [0.9, 0.74, 0.6], [0.82, 0.64, 0.5], [0.66, 0.48, 0.36], [0.98, 0.86, 0.76]];
const UMBRELLAS: V3[] = [[0.08, 0.08, 0.1], [0.12, 0.2, 0.45], [0.75, 0.12, 0.15], [0.95, 0.75, 0.15], [0.2, 0.55, 0.35], [0.85, 0.85, 0.88], [0.55, 0.3, 0.65]];

export class Pedestrians {
  readonly people: Person[] = [];
  /** Per crossing: someone is on it or waiting at the kerb, so traffic must give way */
  readonly blocked: boolean[] = CROSSINGS.map(() => false);
  private rnd: () => number;

  constructor(count: number, seed = 77) {
    const rnd = (this.rnd = mulberry32(seed));
    const pick = <T>(a: T[]) => a[Math.floor(rnd() * a.length)];
    for (let i = 0; i < count; i++) {
      const side = rnd() < 0.5 ? 1 : -1;
      const lane = pick(LANES_Z) + (rnd() - 0.5) * 0.3;
      const dir = rnd() < 0.5 ? 1 : -1;
      const pace = 1.05 + rnd() * 0.45;
      this.people.push({
        x: -S + rnd() * PERIOD, z: side * lane, y: 0.15, side, lane, dir, pace, speed: pace,
        heading: dir > 0 ? 0 : Math.PI, phase: rnd() * 6.28, dodge: 0,
        state: 'walk', timer: 0, crossing: 0, cx: 0, cooldown: rnd() * 10,
        scale: 0.9 + rnd() * 0.16,
        shirt: pick(SHIRTS), pants: pick(PANTS), skin: pick(SKINS), hair: rnd() < 0.8 ? rnd() * 0.2 : 0.4 + rnd() * 0.6, umb: pick(UMBRELLAS),
        umbrellaAt: 0.15 + rnd() * 0.45, bag: rnd() < 0.3, rank: i / count,
      });
    }
  }

  /** Is it safe to step onto crossing ci? Every mover must be clear of it or able to stop before it. */
  private safe(ci: number, movers: Mover[]) {
    const c = CROSSINGS[ci];
    for (const m of movers) {
      const cx = m.x + wrapX(c - m.x);
      const front = (cx - m.dir * ZEBRA_HALF - (m.x + m.dir * m.half)) * m.dir; // front to the near edge
      const rear = (m.x - m.dir * m.half - (cx + m.dir * ZEBRA_HALF)) * m.dir; // rear past the far edge
      if (rear > 0.3 || front > 60) continue; // gone, or far away
      if (m.v <= 0.3) { if (front < 0) return false; continue; } // stopped: fine unless it is on the stripes
      // Moving: it must be able to stop comfortably where traffic waits, about 1.8 m back from the stripes
      if (front - 1.8 < (m.v * m.v) / (2 * m.decel) + 1) return false;
    }
    return true;
  }

  update(dt: number, opts: { movers: Mover[]; rain: number; active: number }) {
    const { movers, rain } = opts;
    const rnd = this.rnd;
    const hurry = 1 + rain * 0.3;
    this.blocked.fill(false);
    for (const p of this.people) {
      const visible = p.rank < opts.active;
      let target: [number, number] | null = null; // point to walk to (states other than walk/browse)
      let vx = 0, vz = 0;
      p.cooldown -= dt;
      switch (p.state) {
        case 'walk': {
          // Slow down behind someone slower, step left for oncoming people
          let speed = p.pace * hurry;
          let dodge = 0;
          for (const o of this.people) {
            if (o === p || o.side !== p.side || o.state !== 'walk') continue;
            const ahead = wrapX(o.x - p.x) * p.dir;
            if (ahead <= 0 || ahead > 2.5 || Math.abs(o.z - p.z) > 0.5) continue;
            if (o.dir === p.dir) { if (ahead < 1.1) speed = Math.min(speed, o.speed); } else dodge = 0.38;
          }
          p.dodge += (dodge - p.dodge) * Math.min(1, dt * 4);
          p.speed += (speed - p.speed) * Math.min(1, dt * 3);
          vx = p.dir * p.speed;
          vz = (p.side * p.lane - p.dir * p.dodge - p.z) * 2; // keep left (-z is the left when facing +x)
          // Browse a shop window now and then
          if (p.lane > 9.5 && rnd() < dt * 0.04) { p.state = 'browse'; p.timer = 3 + rnd() * 6; }
          // Cross the road at a zebra crossing
          if (visible && p.cooldown <= 0) {
            CROSSINGS.forEach((c, i) => {
              if (p.state === 'walk' && Math.abs(wrapX(c - p.x)) < 0.6) {
                p.cooldown = 8;
                if (rnd() < 0.2) { p.state = 'toKerb'; p.crossing = i; p.cx = c + (rnd() - 0.5) * 2.6; }
              }
            });
          }
          break;
        }
        case 'browse':
          if ((p.timer -= dt) <= 0) { p.state = 'walk'; if (rnd() < 0.4) p.dir = -p.dir as 1 | -1; }
          p.speed = 0;
          p.heading = p.side > 0 ? -Math.PI / 2 : Math.PI / 2; // face the shop
          break;
        case 'toKerb':
          target = [p.cx, p.side * KERB_WAIT];
          break;
        case 'wait':
          p.speed = 0;
          p.heading = p.side > 0 ? Math.PI / 2 : -Math.PI / 2; // face across the road
          if (this.safe(p.crossing, movers)) p.state = 'cross';
          break;
        case 'cross':
          target = [p.cx, -p.side * KERB_WAIT];
          break;
        case 'fromKerb':
          target = [p.cx, p.side * p.lane];
          break;
      }
      if (target) {
        const dx = wrapX(target[0] - p.x), dz = target[1] - p.z;
        const d = Math.hypot(dx, dz);
        const v = p.pace * hurry * (p.state === 'cross' ? 1.15 : 1);
        if (d < 0.08) {
          if (p.state === 'toKerb') p.state = 'wait';
          else if (p.state === 'cross') { p.side = -p.side as 1 | -1; p.lane = LANES_Z[0] + (rnd() - 0.5) * 0.3; p.state = 'fromKerb'; }
          else if (p.state === 'fromKerb') { p.state = 'walk'; p.dir = rnd() < 0.5 ? 1 : -1; p.cooldown = 30; }
        } else {
          vx = (dx / d) * v;
          vz = (dz / d) * v;
        }
      }
      if (p.state === 'wait' || p.state === 'cross') this.blocked[p.crossing] = true;
      // Integrate, face the walking direction, animate the stride
      p.x = wrapX(p.x + vx * dt);
      p.z += vz * dt;
      const sp = Math.hypot(vx, vz);
      if (sp > 0.2) {
        const want = Math.atan2(-vz, vx);
        let dh = want - p.heading;
        dh = Math.atan2(Math.sin(dh), Math.cos(dh));
        p.heading += dh * Math.min(1, dt * 8);
      }
      if (p.state !== 'walk') p.speed = sp;
      p.phase += sp * dt * 5.2;
      p.y = Math.abs(p.z) > KERB_EDGE ? 0.15 : 0;
    }
  }

  /** Writes instance data for the visible people (nearest copy of the street to the camera); returns the count */
  write(out: Float32Array, eye: V3, active: number, rain: number): number {
    let n = 0;
    for (const p of this.people) {
      const busy = p.state === 'toKerb' || p.state === 'wait' || p.state === 'cross' || p.state === 'fromKerb';
      if (p.rank >= active && !busy) continue;
      const x = eye[0] + wrapX(p.x - eye[0]);
      if (Math.abs(x - eye[0]) > 220) continue;
      const amp = Math.min(1, p.speed / 1.2) * 0.42;
      const flags = (rain > p.umbrellaAt ? 1 : 0) | (p.bag ? 2 : 0);
      out.set([x, p.y, p.z, p.heading, p.phase, amp, p.scale, flags, ...p.shirt, ...p.pants, ...p.skin, p.hair, ...p.umb], n * CROWD_STRIDE);
      n++;
    }
    return n;
  }
}
