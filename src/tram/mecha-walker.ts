// Meshy AI image-to-3D mechas (Zaku, Gundam) as giants walking down the tram street.
// A scan is one rigid mesh with no skeleton, so the legs are found and rigged automatically:
//  1. Slice the mesh into thin horizontal slabs and find the runs of x where vertices sit in each slab.
//  2. The two biggest runs in the bottom slab are the feet. Follow each one upwards slab by slab (a run must overlap
//     the leg's run in the slab below, and is clipped so a gun or shield hanging beside the leg is not picked up).
//  3. Where the two legs merge into one run is the crotch: the hip height. The knee is 58% of the way up.
// Each leg vertex gets a leg weight (fading out over the hip so the skirt armour bends instead of tearing) and a
// below-knee weight; walker.vert.glsl swings the legs about the hips and bends the knees.
import { parseGlb, flatten } from '../zaku/gltf-scene';
import type { WalkerMesh, WalkerPose } from '../sim/scene-renderer';

export interface MechaRig {
  mesh: WalkerMesh;
  image: Blob | undefined;
  min: number[];
  max: number[];
  hipF: number; // hip height as a fraction of the model height
  pivots: { hipR: number[]; hipL: number[]; kneeR: number[]; kneeL: number[] };
  /** Front-most point of the face (model space): where the eye glow goes */
  eye: number[];
}

const SLAB = 0.02; // slab height, fraction of the model height
const BINS = 160; // x resolution of each slab
const KNEE = 0.58; // knee height as a fraction of the hip height

const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

type Run = [number, number, number]; // first bin, last bin, vertex count

/** Model space must be y up, facing +z; the mecha's right side is -x */
export function rigMecha(buffer: ArrayBuffer): MechaRig {
  const scene = parseGlb(buffer);
  const { batches, min, max } = flatten(scene);
  const b = batches[0];
  const P = b.positions;
  const n = P.length / 3;
  const H = max[1] - min[1];
  const W = max[0] - min[0];
  const binOf = (x: number) => Math.min(BINS - 1, Math.max(0, Math.floor(((x - min[0]) / W) * BINS)));
  const slabs = Math.ceil(0.7 / SLAB);
  const hist = Array.from({ length: slabs }, () => new Uint32Array(BINS));
  for (let i = 0; i < n; i++) {
    const s = Math.floor((P[i * 3 + 1] - min[1]) / H / SLAB);
    if (s < slabs) hist[s][binOf(P[i * 3])]++;
  }
  const runs = (h: Uint32Array): Run[] => {
    const out: Run[] = [];
    let start = -1, count = 0;
    for (let x = 0; x <= BINS; x++) {
      const on = x < BINS && h[x] >= 2;
      if (on && start < 0) { start = x; count = 0; }
      if (on) count += h[x];
      if (!on && start >= 0) { out.push([start, x - 1, count]); start = -1; }
    }
    return out;
  };

  // Feet: the two biggest runs in the bottom slabs
  const bottom = runs(hist[0].map((v, i) => v + hist[1][i]));
  const feet = [...bottom].sort((p, q) => q[2] - p[2]).slice(0, 2).sort((p, q) => p[0] - q[0]);
  if (feet.length < 2) throw new Error('Mecha rig: could not find two feet');
  const track: [number, number][][] = [[[feet[0][0], feet[0][1]], [feet[1][0], feet[1][1]]]];
  let hipSlab = slabs - 1;
  for (let s = 1; s < slabs; s++) {
    const prev = track[s - 1];
    const rs = runs(hist[s]);
    const next: [number, number][] = [];
    let merged = false;
    for (let leg = 0; leg < 2; leg++) {
      const [lo, hi] = prev[leg];
      const over = rs.filter((r) => r[1] >= lo - 1 && r[0] <= hi + 1);
      if (!over.length) { next.push([lo, hi]); continue; }
      if (over.some((r) => r[1] >= prev[1 - leg][0] - 1 && r[0] <= prev[1 - leg][1] + 1)) merged = true;
      const grow = Math.max(2, Math.round((hi - lo) * 0.12));
      next.push([Math.max(lo - grow, Math.min(...over.map((r) => r[0]))), Math.min(hi + grow, Math.max(...over.map((r) => r[1])))]);
    }
    if (merged || next[0][1] >= next[1][0]) { hipSlab = s; break; }
    track.push(next);
  }
  const hipF = hipSlab * SLAB;
  const kneeF = hipF * KNEE;
  const top = track[track.length - 1];
  const gap = (top[0][1] + top[1][0]) / 2; // bin between the legs at the crotch
  const xOf = (bin: number) => min[0] + ((bin + 0.5) / BINS) * W;

  // Weights, plus averages for the joint pivots
  const rig = new Float32Array(n * 2);
  const acc = [[0, 0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 0, 0]]; // per leg: hip x z count, knee x z count
  const fadeTop = hipF + 0.03;
  for (let i = 0; i < n; i++) {
    const x = P[i * 3], y = P[i * 3 + 1], z = P[i * 3 + 2];
    const f = (y - min[1]) / H;
    if (f > fadeTop) continue;
    const bin = binOf(x);
    const s = Math.floor(f / SLAB);
    let leg = -1;
    if (s < track.length) {
      for (let k = 0; k < 2; k++) if (bin >= track[s][k][0] - 1 && bin <= track[s][k][1] + 1) leg = k;
    } else if (bin >= top[0][0] - 2 && bin <= top[1][1] + 2) {
      leg = bin < gap ? 0 : 1; // over the hip joint: split at the crotch
    }
    if (leg < 0) continue;
    const side = leg === 0 ? -1 : 1; // leg 0 is at -x: the mecha's right leg
    rig[i * 2] = side * (1 - smooth(hipF - 0.08, fadeTop, f));
    rig[i * 2 + 1] = 1 - smooth(kneeF - 0.03, kneeF + 0.03, f);
    const a = acc[leg];
    if (f > hipF - 0.06 && f < hipF) { a[0] += x; a[1] += z; a[2]++; }
    if (Math.abs(f - kneeF) < 0.02) { a[4] += x; a[5] += z; a[6]++; }
  }
  // Eye: the front-most vertex in the face band (80-92% height) near the centre line
  let eye = [ (min[0] + max[0]) / 2, min[1] + 0.86 * H, -Infinity];
  const cx = (min[0] + max[0]) / 2;
  for (let i = 0; i < n; i++) {
    const f = (P[i * 3 + 1] - min[1]) / H;
    if (f > 0.8 && f < 0.92 && Math.abs(P[i * 3] - cx) < 0.05 * W && P[i * 3 + 2] > eye[2]) eye = [P[i * 3], P[i * 3 + 1], P[i * 3 + 2]];
  }
  if (!Number.isFinite(eye[2])) eye[2] = max[2];
  const at = (f: number) => min[1] + f * H;
  const pivot = (leg: number, knee: boolean) => {
    const a = acc[leg];
    const c = knee ? a[6] : a[2];
    const o = knee ? 4 : 0;
    const fx = xOf((track[track.length - 1][leg][0] + track[track.length - 1][leg][1]) / 2);
    return c ? [a[o] / c, at(knee ? kneeF : hipF), a[o + 1] / c] : [fx, at(knee ? kneeF : hipF), 0];
  };
  return {
    mesh: { positions: P, normals: b.normals, uvs: b.uvs, indices: b.indices, rig },
    image: scene.materials[b.material]?.image,
    min, max, hipF, eye,
    pivots: { hipR: pivot(0, false), hipL: pivot(1, false), kneeR: pivot(0, true), kneeL: pivot(1, true) },
  };
}

const SWING = 0.34; // hip swing amplitude (radians)

/** Leg angles for walk phase `phase` (one stride cycle = 2π) and how far the hips sink */
export function walkPose(rig: MechaRig, phase: number, amount: number): { pose: WalkerPose; drop: number } {
  const A = SWING * amount;
  const B = 0.7 * amount;
  const leg = (ph: number) => ({ hip: -A * Math.sin(ph), knee: B * Math.max(0, Math.cos(ph)) ** 1.5 });
  const L = leg(phase), R = leg(phase + Math.PI);
  // the stance leg (moving back) keeps its foot down, so the hips dip as it tilts
  const legLen = rig.hipF * (rig.max[1] - rig.min[1]);
  const stance = Math.cos(phase) < 0 ? L.hip : R.hip;
  return {
    pose: { ...rig.pivots, hipAngleL: L.hip, hipAngleR: R.hip, kneeAngleL: L.knee, kneeAngleR: R.knee },
    drop: legLen * (1 - Math.cos(stance)),
  };
}

/** Metres walked per radian of phase at display scale `scale`, so the planted foot hardly slides */
export function strideRate(rig: MechaRig, scale: number): number {
  const legLen = rig.hipF * (rig.max[1] - rig.min[1]) * scale;
  return (2 * legLen * Math.sin(SWING)) / Math.PI;
}
