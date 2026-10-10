// Small vector / quaternion helpers for the flight sim
export type V3 = [number, number, number];
export type Quat = [number, number, number, number]; // x, y, z, w

export const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const scale = (a: V3, s: number): V3 => [a[0] * s, a[1] * s, a[2] * s];
export const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const len = (a: V3) => Math.hypot(a[0], a[1], a[2]);
export const norm = (a: V3): V3 => scale(a, 1 / (len(a) || 1));
export const lerp = (a: V3, b: V3, t: number): V3 => add(a, scale(sub(b, a), t));

export function qMul(a: Quat, b: Quat): Quat {
  const [ax, ay, az, aw] = a;
  const [bx, by, bz, bw] = b;
  return [
    aw * bx + ax * bw + ay * bz - az * by,
    aw * by - ax * bz + ay * bw + az * bx,
    aw * bz + ax * by - ay * bx + az * bw,
    aw * bw - ax * bx - ay * by - az * bz,
  ];
}

// v' = v + w*t + u x t,  t = 2 u x v
export function qRotate(q: Quat, v: V3): V3 {
  const u: V3 = [q[0], q[1], q[2]];
  const t = scale(cross(u, v), 2);
  return add(add(v, scale(t, q[3])), cross(u, t));
}

export function qAxisAngle(axis: V3, angle: number): Quat {
  const s = Math.sin(angle / 2);
  return [axis[0] * s, axis[1] * s, axis[2] * s, Math.cos(angle / 2)];
}

export function qNormalize(q: Quat): Quat {
  const l = Math.hypot(...q) || 1;
  return [q[0] / l, q[1] / l, q[2] / l, q[3] / l];
}

// Column-major T(pos) * R(q) * S(s) * T(offset)
export function modelMatrix(pos: V3, q: Quat, s: number, offset: V3 = [0, 0, 0]): Float32Array {
  const [x, y, z, w] = q;
  const c0: V3 = [1 - 2 * (y * y + z * z), 2 * (x * y + w * z), 2 * (x * z - w * y)];
  const c1: V3 = [2 * (x * y - w * z), 1 - 2 * (x * x + z * z), 2 * (y * z + w * x)];
  const c2: V3 = [2 * (x * z + w * y), 2 * (y * z - w * x), 1 - 2 * (x * x + y * y)];
  const t = add(pos, scale(add(add(scale(c0, offset[0]), scale(c1, offset[1])), scale(c2, offset[2])), s));
  return new Float32Array([
    c0[0] * s, c0[1] * s, c0[2] * s, 0,
    c1[0] * s, c1[1] * s, c1[2] * s, 0,
    c2[0] * s, c2[1] * s, c2[2] * s, 0,
    t[0], t[1], t[2], 1,
  ]);
}

// Deterministic PRNG so the city is the same every load
export function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
