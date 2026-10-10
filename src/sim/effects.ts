// Jet exhaust, afterburner shock diamonds, contrails and crash explosions
import { V3, add, scale, qRotate } from './math';
import { FlightModel } from './physics';
import { ParticlePool } from './particles';

export const PLANE_SCALE = 5; // airplane model units -> metres (about 15 m long)
export const PLANE_OFFSET: V3 = [0.1, -0.6, 0]; // puts the fuselage axis at the body origin
// Engine nozzles in model units (rear of the two engine pods), after PLANE_OFFSET
const NOZZLES: V3[] = [[-0.05 + 0.1, 0.45 - 0.6, 0.6], [-0.05 + 0.1, 0.45 - 0.6, -0.6]];

const jitter = (s: number): V3 => [(Math.random() - 0.5) * s, (Math.random() - 0.5) * s, (Math.random() - 0.5) * s];

export function emitExhaust(p: FlightModel, dt: number, flame: ParticlePool, smoke: ParticlePool) {
  const f = p.forward();
  const thr = p.throttle;
  const afterburner = thr > 0.85;
  for (const local of NOZZLES) {
    const nozzle = add(p.pos, qRotate(p.q, scale(local, PLANE_SCALE)));
    // Flame: particles leave the nozzle backwards relative to the plane
    const n = Math.round((400 + 2600 * thr + (afterburner ? 2500 : 0)) * dt);
    for (let i = 0; i < n; i++) {
      const back = -(60 + 160 * thr) * (0.7 + Math.random() * 0.6);
      const k = Math.random();
      flame.emit(add(nozzle, scale(f, -k * 2)), add(add(p.vel, scale(f, back)), jitter(5)), {
        life: 0.05 + 0.1 * thr + (afterburner ? 0.08 : 0) + Math.random() * 0.04,
        size0: 0.5 + 0.4 * thr,
        size1: 1.2 + 2.0 * thr + (afterburner ? 1.2 : 0),
        alpha: 0.5 + 0.5 * thr,
      });
    }
    // Hot core glow at the nozzle
    flame.emit(nozzle, p.vel, { life: 0.03, size0: 1.2 + thr * 1.4, size1: 1.0, alpha: 1 });
    // Afterburner shock diamonds: bright points at fixed spacing behind the nozzle
    if (afterburner) {
      for (let k = 1; k <= 4; k++) {
        flame.emit(add(nozzle, scale(f, -k * 1.6)), p.vel, { life: 0.025, size0: 1.1 - k * 0.15, size1: 0.6, alpha: 0.9 });
      }
    }
    // Heat haze / smoke trail, thicker contrail at altitude or in humid (rainy) air
    const contrail = p.pos[1] > 700;
    const rate = (contrail ? 120 : 25) * (0.3 + thr);
    const m = rate * dt + Math.random();
    for (let i = 0; i < Math.floor(m); i++) {
      smoke.emit(add(nozzle, scale(f, -3)), add(scale(p.vel, 0.05), jitter(2)), {
        life: contrail ? 6 + Math.random() * 3 : 1.2 + Math.random(),
        size0: 1,
        size1: contrail ? 9 : 4,
        alpha: contrail ? 0.55 : 0.18,
        shade: contrail ? 1.2 : 0.75,
      });
    }
  }
}

export function explode(at: V3, flame: ParticlePool, smoke: ParticlePool) {
  for (let i = 0; i < 900; i++) {
    const d: V3 = jitter(2);
    const s = 15 + Math.random() * 55;
    flame.emit(at, [d[0] * s, Math.abs(d[1]) * s, d[2] * s], { life: 0.4 + Math.random() * 1.1, size0: 3, size1: 12, alpha: 1 });
  }
  for (let i = 0; i < 350; i++) {
    const d: V3 = jitter(2);
    smoke.emit(add(at, jitter(8)), [d[0] * 12, 6 + Math.random() * 14, d[2] * 12], {
      life: 3 + Math.random() * 4, size0: 6, size1: 34, alpha: 0.75, shade: 0.25,
    });
  }
}
