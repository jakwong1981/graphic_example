// Rigid-body flight model. Body axes: +x nose, +y up, +z right wing.
// Forces: thrust, lift (CL from angle of attack, with stall), drag (parasite + induced), side force, gravity.
// Torques: control surfaces scale with dynamic pressure; pitch/yaw stability turn the nose into the airflow.
import { V3, Quat, add, scale, dot, cross, len, norm, qMul, qRotate, qNormalize, qAxisAngle } from './math';

export interface Controls {
  pitch: number; // -1..1, +1 nose up
  roll: number; // -1..1, +1 right wing down
  yaw: number; // -1..1, +1 nose right
  boost: boolean; // A: throttle up
  brake: boolean; // Z/S: throttle down + airbrake
}

const G = 9.81;
const MASS = 9000; // kg
const WING_AREA = 32; // m^2
const MAX_THRUST = 80000; // N
const CL0 = 0.22; // trimmed so lift ~= weight at cruise with the nose on the airflow
const CL_ALPHA = 4.8; // per radian
const ALPHA_STALL = 0.27; // ~15.5 degrees
const CD0 = 0.06;
const K_INDUCED = 0.055;
const CRUISE_THROTTLE = 0.5;

export class FlightModel {
  pos: V3 = [0, 0, 0];
  vel: V3 = [0, 0, 0];
  q: Quat = [0, 0, 0, 1];
  w: V3 = [0, 0, 0]; // body angular velocity (roll x, yaw y, pitch z)
  throttle = CRUISE_THROTTLE;
  // telemetry
  alpha = 0;
  airspeed = 0;
  gForce = 1;
  stalled = false;

  reset(pos: V3, heading: number, speed: number) {
    this.pos = [...pos];
    this.q = qAxisAngle([0, 1, 0], heading);
    this.vel = scale(this.forward(), speed);
    this.w = [0, 0, 0];
    this.throttle = CRUISE_THROTTLE;
  }

  forward(): V3 { return qRotate(this.q, [1, 0, 0]); }
  up(): V3 { return qRotate(this.q, [0, 1, 0]); }
  right(): V3 { return qRotate(this.q, [0, 0, 1]); }

  step(dt: number, c: Controls) {
    // Throttle lever: A pushes it up, Z/S pulls it down, otherwise it settles back to cruise
    if (c.boost) this.throttle = Math.min(1, this.throttle + dt * 0.7);
    else if (c.brake) this.throttle = Math.max(0, this.throttle - dt * 0.7);
    else this.throttle += (CRUISE_THROTTLE - this.throttle) * Math.min(1, dt * 0.4);

    const f = this.forward();
    const u = this.up();
    const r = this.right();
    const V = len(this.vel);
    const vhat = V > 0.1 ? scale(this.vel, 1 / V) : f;
    const vb: V3 = [dot(this.vel, f), dot(this.vel, u), dot(this.vel, r)];
    const alpha = Math.atan2(-vb[1], Math.max(vb[0], 0.1));
    const beta = Math.atan2(vb[2], Math.max(vb[0], 0.1));

    const rho = 1.225 * Math.exp(-this.pos[1] / 8500); // thinner air with altitude
    const qd = 0.5 * rho * V * V;

    // Lift coefficient: linear up to the stall, then it falls away
    let cl = CL0 + CL_ALPHA * alpha;
    const clMax = CL0 + CL_ALPHA * ALPHA_STALL;
    this.stalled = alpha > ALPHA_STALL;
    if (this.stalled) cl = clMax * Math.max(0.35, 1 - (alpha - ALPHA_STALL) * 2.5);
    else if (alpha < -ALPHA_STALL) cl = -clMax * 0.6;

    const liftDir = norm(cross(r, vhat)); // perpendicular to the airflow, towards the canopy
    const lift = qd * WING_AREA * cl;
    const drag = qd * WING_AREA * (CD0 + K_INDUCED * cl * cl + (c.brake ? 0.08 : 0) + 0.6 * beta * beta);
    const side = -qd * WING_AREA * 0.8 * Math.sin(beta);
    const thrust = this.throttle * MAX_THRUST * (0.6 + 0.4 * rho / 1.225);

    let F: V3 = scale(f, thrust);
    F = add(F, scale(liftDir, lift));
    F = add(F, scale(vhat, -drag));
    F = add(F, scale(r, side));
    const aero = scale(F, 1 / MASS); // everything except gravity: what the pilot feels
    const acc = add(aero, [0, -G, 0]);
    this.vel = add(this.vel, scale(acc, dt));
    this.pos = add(this.pos, scale(this.vel, dt));

    // Angular dynamics. Authority ~ dynamic pressure, so controls go mushy when slow.
    const auth = Math.min(1.6, Math.max(0.05, qd / (0.5 * 1.225 * 130 * 130)));
    const damp = 0.3 + auth;
    const [wx, wy, wz] = this.w;
    const rollAcc = auth * c.roll * 6.0 - wx * 3.0 * damp;
    const pitchAcc = auth * (c.pitch * 1.9 - alpha * 6.0) - wz * 2.5 * damp;
    const yawAcc = auth * (-c.yaw * 1.2 - beta * 4.0) - wy * 2.0 * damp;
    this.w = [wx + rollAcc * dt, wy + yawAcc * dt, wz + pitchAcc * dt];

    // q' = q + 0.5 * q * (w, 0) * dt   (body-frame angular velocity)
    const dq = qMul(this.q, [this.w[0], this.w[1], this.w[2], 0]);
    this.q = qNormalize([
      this.q[0] + 0.5 * dq[0] * dt,
      this.q[1] + 0.5 * dq[1] * dt,
      this.q[2] + 0.5 * dq[2] * dt,
      this.q[3] + 0.5 * dq[3] * dt,
    ]);

    this.alpha = alpha;
    this.airspeed = V;
    this.gForce = dot(aero, u) / G;
  }
}
