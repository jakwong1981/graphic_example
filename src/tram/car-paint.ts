// Turns the reduced Meshy AI sports car (public/flying-car.glb) into a smooth painted roadster.
// The scan's texture is a mosaic of tiny islands, so the baked vertex colours read as red/black blotches and
// the headlights, wheels and glass never resolve. This replaces those colours from the shape itself:
//  1. Taubin smoothing evens the panels, then the normals are rebuilt and blurred so a clear coat can mirror
//     the sky without sparkling on every dent;
//  2. each vertex is tagged from the bounding box (nose at -x): red paint, dark tyres and rims, dark glass,
//     and emissive head and tail lamps. Paint, trim and lamps are separate meshes.
// Wheel and cabin tests are fractions of the bounding box, measured on the decimated unit-size scan
// (about 0.45 long, wheels near u = 0.17 and 0.86, sitting in the bottom quarter of the height).

export interface CarMeshIn { positions: Float32Array; normals: Float32Array; uvs: Float32Array; indices: ArrayLike<number>; vertexColors: Float32Array | null }
export interface CarPart { positions: Float32Array; normals: Float32Array; uvs: Float32Array; colors: Float32Array; indices: Uint32Array }

export const PAINT_SRGB: [number, number, number] = [0.78, 0.04, 0.05]; // candy red, as in the reference roadster
const TYRE = [0.012, 0.012, 0.014], RIM = [0.07, 0.07, 0.075];
const GLASS = [0.03, 0.035, 0.045];
const HEAD = [0.93, 0.96, 1], TAIL = [1, 0.05, 0.03];

export function paintCar(m: CarMeshIn, min: number[], max: number[]): { body: CarPart; trim: CarPart; lights: CarPart } {
  const P = new Float32Array(m.positions);
  const nv = P.length / 3;
  const I = Uint32Array.from(m.indices);

  // neighbours of every vertex (CSR)
  const deg = new Uint32Array(nv + 1);
  for (let t = 0; t < I.length; t += 3) for (let k = 0; k < 3; k++) deg[I[t + k] + 1] += 2;
  for (let i = 0; i < nv; i++) deg[i + 1] += deg[i];
  const nb = new Uint32Array(deg[nv]);
  const fill = deg.slice(0, nv);
  for (let t = 0; t < I.length; t += 3) {
    for (let k = 0; k < 3; k++) {
      const a = I[t + k];
      nb[fill[a]++] = I[t + ((k + 1) % 3)];
      nb[fill[a]++] = I[t + ((k + 2) % 3)];
    }
  }
  // Wheels are marked on the unsmoothed scan and then left alone. Smoothing the whole shell melts each
  // tyre into the arch, so the dark paint and the red body share one soft surface.
  const span0 = (a: number, b: number) => (b - a) || 1;
  const hx0 = span0(min[0], max[0]), hy0 = span0(min[1], max[1]);
  const halfW0 = Math.max(-min[2], max[2]);
  const axles = [0.22, 0.83]; // front and rear contact patches on this scan
  const axleY = min[1] + hy0 * 0.18;
  const wheelR = hy0 * 0.18;
  const wheel = new Uint8Array(nv); // 1 tyre, 2 rim; 0 is not a wheel
  for (let i = 0; i < nv; i++) {
    const x = P[i * 3], y = P[i * 3 + 1], z = Math.abs(P[i * 3 + 2]);
    if (z < halfW0 * 0.55) continue;
    for (const au of axles) {
      const d = Math.hypot(x - (min[0] + hx0 * au), y - axleY);
      if (d < wheelR) wheel[i] = d < wheelR * 0.48 ? 2 : 1;
    }
  }
  const tmp = new Float32Array(P.length);
  const laplace = (f: number) => {
    for (let i = 0; i < nv; i++) {
      if (wheel[i]) {
        // round the disc using other wheel vertices only, so it does not melt into the red arch
        const s = deg[i], e = deg[i + 1];
        let x = 0, y = 0, z = 0, n = 0;
        for (let j = s; j < e; j++) if (wheel[nb[j]]) {
          const p = nb[j] * 3; x += P[p]; y += P[p + 1]; z += P[p + 2]; n++;
        }
        if (!n) { tmp.set(P.subarray(i * 3, i * 3 + 3), i * 3); continue; }
        const c = 1 / n;
        tmp[i * 3] = P[i * 3] + f * (x * c - P[i * 3]);
        tmp[i * 3 + 1] = P[i * 3 + 1] + f * (y * c - P[i * 3 + 1]);
        tmp[i * 3 + 2] = P[i * 3 + 2] + f * (z * c - P[i * 3 + 2]);
        continue;
      }
      const s = deg[i], e = deg[i + 1];
      if (e === s) { tmp.set(P.subarray(i * 3, i * 3 + 3), i * 3); continue; }
      let x = 0, y = 0, z = 0;
      for (let j = s; j < e; j++) { const n = nb[j] * 3; x += P[n]; y += P[n + 1]; z += P[n + 2]; }
      const c = 1 / (e - s);
      tmp[i * 3] = P[i * 3] + f * (x * c - P[i * 3]);
      tmp[i * 3 + 1] = P[i * 3 + 1] + f * (y * c - P[i * 3 + 1]);
      tmp[i * 3 + 2] = P[i * 3 + 2] + f * (z * c - P[i * 3 + 2]);
    }
    P.set(tmp);
  };
  for (let it = 0; it < 10; it++) { laplace(0.5); laplace(-0.53); }

  // smooth normals: area-weighted face normals, each face turned to point away from the car's centre line (the
  // scan's winding and normals are inconsistent, which shows as blotches under a glossy coat)
  const N = new Float32Array(P.length);
  const cy = (min[1] + max[1]) / 2, axisX = 0.6 * Math.max(-min[0], max[0]);
  for (let t = 0; t < I.length; t += 3) {
    const a = I[t] * 3, b = I[t + 1] * 3, c = I[t + 2] * 3;
    const e1 = [P[b] - P[a], P[b + 1] - P[a + 1], P[b + 2] - P[a + 2]];
    const e2 = [P[c] - P[a], P[c + 1] - P[a + 1], P[c + 2] - P[a + 2]];
    let fx = e1[1] * e2[2] - e1[2] * e2[1], fy = e1[2] * e2[0] - e1[0] * e2[2], fz = e1[0] * e2[1] - e1[1] * e2[0];
    const mx = (P[a] + P[b] + P[c]) / 3, my = (P[a + 1] + P[b + 1] + P[c + 1]) / 3, mz = (P[a + 2] + P[b + 2] + P[c + 2]) / 3;
    const out = [mx - Math.max(-axisX, Math.min(axisX, mx)), my - cy, mz]; // from the nearest point on the axis
    if (fx * out[0] + fy * out[1] + fz * out[2] < 0) { fx = -fx; fy = -fy; fz = -fz; }
    for (const v of [a, b, c]) { N[v] += fx; N[v + 1] += fy; N[v + 2] += fz; }
  }
  const normalize = () => {
    for (let i = 0; i < nv; i++) {
      const l = Math.hypot(N[i * 3], N[i * 3 + 1], N[i * 3 + 2]) || 1;
      for (let k = 0; k < 3; k++) N[i * 3 + k] /= l;
    }
  };
  normalize();
  // then blur the normals over the neighbours: the clear coat mirrors every small dent, so the panels need
  // smoother shading than the shape itself (normals that disagree a lot, at creases, are left alone)
  const NB = new Float32Array(N.length);
  for (let it = 0; it < 10; it++) {
    for (let i = 0; i < nv; i++) {
      if (wheel[i]) { NB.set(N.subarray(i * 3, i * 3 + 3), i * 3); continue; }
      let x = N[i * 3], y = N[i * 3 + 1], z = N[i * 3 + 2];
      for (let j = deg[i]; j < deg[i + 1]; j++) {
        if (wheel[nb[j]]) continue;
        const n = nb[j] * 3;
        const d = N[n] * N[i * 3] + N[n + 1] * N[i * 3 + 1] + N[n + 2] * N[i * 3 + 2];
        if (d < 0.3) continue; // a crease (or the other side of a thin part)
        x += N[n]; y += N[n + 1]; z += N[n + 2];
      }
      NB[i * 3] = x; NB[i * 3 + 1] = y; NB[i * 3 + 2] = z;
    }
    N.set(NB);
    normalize();
  }

  // what each vertex is. 0 along x is the nose, 1 the tail; 0 along y is the ground.
  // 0 paint, 1 tyre, 2 rim, 3 skirt, 4 glass, 5 headlamp, 6 tail lamp.
  const span = (a: number, b: number) => (b - a) || 1;
  const hx = span(min[0], max[0]), hy = span(min[1], max[1]);
  const halfW = Math.max(-min[2], max[2]);
  const kind = new Uint8Array(nv);
  for (let i = 0; i < nv; i++) {
    const x = P[i * 3], y = P[i * 3 + 1], z = Math.abs(P[i * 3 + 2]);
    const u = (x - min[0]) / hx, v = (y - min[1]) / hy;
    const nx = N[i * 3], ny = N[i * 3 + 1];
    let k = wheel[i]; // full disc, kept off the smoothed body
    // slim lamps on the nose and a bar across the tail, where the faces actually point that way
    if (!k && u < 0.12 && v > 0.46 && v < 0.6 && z > halfW * 0.35 && nx < -0.45) k = 5;
    if (!k && u > 0.9 && v > 0.46 && v < 0.58 && nx > 0.5) k = 6;
    // windscreen and the open cabin: dark, and glossy so it mirrors the sky
    if (!k && v > 0.52 && u > 0.36 && u < 0.72 && z < halfW * 0.62 && ny > 0.2) k = 4;
    kind[i] = k;
  }
  const colorOf = (i: number): number[] => {
    const up = Math.max(0, N[i * 3 + 1]);
    switch (kind[i]) {
      case 1: return TYRE;
      case 2: return RIM;
      case 4: return GLASS;
      case 5: return HEAD;
      case 6: return TAIL;
      default: return [
        PAINT_SRGB[0] * (0.72 + 0.4 * up),
        PAINT_SRGB[1] * (0.55 + 0.7 * up),
        PAINT_SRGB[2] * (0.5 + 0.6 * up),
      ];
    }
  };
  const C = new Float32Array(nv * 3);
  for (let i = 0; i < nv; i++) C.set(colorOf(i), i * 3);

  // 0 clear coat (paint, glass), 1 matte wheels, 2 emissive lamps. A single wheel vertex claims the triangle,
  // so the disc is solid instead of a red fringe where it meets the arch.
  const group = (k: number) => (k === 5 || k === 6 ? 2 : k === 1 || k === 2 ? 1 : 0);
  const extract = (g: number): CarPart => {
    const pos: number[] = [], nor: number[] = [], col: number[] = [], idx: number[] = [];
    const map = new Map<number, number>();
    for (let t = 0; t < I.length; t += 3) {
      const vs = [I[t], I[t + 1], I[t + 2]];
      const votes = [0, 0, 0];
      for (const v of vs) votes[group(kind[v])]++;
      const win = votes[2] >= 2 ? 2 : votes[1] >= 1 ? 1 : 0;
      if (win !== g) continue;
      for (const v of vs) {
        let o = map.get(v);
        if (o === undefined) {
          o = pos.length / 3;
          map.set(v, o);
          pos.push(P[v * 3], P[v * 3 + 1], P[v * 3 + 2]);
          nor.push(N[v * 3], N[v * 3 + 1], N[v * 3 + 2]);
          const src = g === 1 && kind[v] !== 1 && kind[v] !== 2
            ? TYRE
            : g === 2 && group(kind[v]) !== 2
              ? C.subarray((vs.find((w) => group(kind[w]) === 2) ?? v) * 3, (vs.find((w) => group(kind[w]) === 2) ?? v) * 3 + 3)
              : C.subarray(v * 3, v * 3 + 3);
          col.push(src[0], src[1], src[2]);
        }
        idx.push(o);
      }
    }
    const n = pos.length / 3;
    return {
      positions: Float32Array.from(pos), normals: Float32Array.from(nor), uvs: new Float32Array(n * 2),
      colors: Float32Array.from(col), indices: Uint32Array.from(idx),
    };
  };
  return { body: extract(0), trim: extract(1), lights: extract(2) };
}

// ---- UV layout of the paintwork: a box projection into five atlas regions ----
// Each body triangle goes to the region its (smoothed) normal faces most; its corners are copied per region, so
// the projections never smear across a region border. Every region is laid out as seen from outside the car,
// with "right" in the image being the viewer's right, so lettering reads the right way round.
// Atlas (u right, v down, as canvas pixels):
//   | left side (z < 0)  | right side (z > 0) |   v 0 .. 0.35
//   | top (x, z)         | front | back       |   v 0.35 .. 1 (front / back: v 0.35 .. 0.7)
export type Region = 'left' | 'right' | 'top' | 'front' | 'back';
export const ATLAS: Record<Region, [number, number, number, number]> = { // u0, v0, u1, v1
  left: [0, 0, 0.5, 0.35], right: [0.5, 0, 1, 0.35], top: [0, 0.35, 0.5, 1], front: [0.5, 0.35, 0.75, 0.7], back: [0.75, 0.35, 1, 0.7],
};
const REGIONS: Region[] = ['left', 'right', 'top', 'front', 'back'];

function unwrapBody(P: Float32Array, N: Float32Array, idx: number[], min: number[], max: number[]): CarPart {
  const xn = (x: number) => (x - min[0]) / (max[0] - min[0]); // 0 at the nose (-x), 1 at the tail
  const yn = (y: number) => (y - min[1]) / (max[1] - min[1]); // 0 at the bottom
  const zn = (z: number) => (z - min[2]) / (max[2] - min[2]); // 0 on the left (-z)
  // [horizontal, vertical-from-top] in 0..1 inside a region, as seen from outside
  const local = (r: Region, x: number, y: number, z: number): [number, number] => {
    switch (r) {
      case 'left': return [1 - xn(x), 1 - yn(y)]; // seen from -z: the nose is on the right
      case 'right': return [xn(x), 1 - yn(y)]; // seen from +z: the nose is on the left
      case 'top': return [xn(x), zn(z)]; // seen from above, nose on the left, left side at the top
      case 'front': return [zn(z), 1 - yn(y)]; // seen from -x (ahead of the nose): the car's right (+z) is on the right
      case 'back': return [1 - zn(z), 1 - yn(y)];
    }
  };
  const pos: number[] = [], nor: number[] = [], uv: number[] = [], out: number[] = [];
  const map = new Map<number, number>();
  for (let t = 0; t < idx.length; t += 3) {
    const a = idx[t], b = idx[t + 1], c = idx[t + 2];
    const nx = N[a * 3] + N[b * 3] + N[c * 3], ny = N[a * 3 + 1] + N[b * 3 + 1] + N[c * 3 + 1], nz = N[a * 3 + 2] + N[b * 3 + 2] + N[c * 3 + 2];
    const ax = Math.abs(nx), ay = Math.abs(ny) * 0.9, az = Math.abs(nz); // sides win ties against the top
    let r: Region;
    if (ny > 0 && ay >= ax && ay >= az) r = 'top';
    else if (az >= ax || ny < 0 && ay >= ax) r = nz < 0 ? 'left' : 'right'; // underside panels: the side's paint
    else r = nx < 0 ? 'front' : 'back';
    const ri = REGIONS.indexOf(r);
    for (const v of [a, b, c]) {
      const key = v * 5 + ri;
      let o = map.get(key);
      if (o === undefined) {
        o = pos.length / 3;
        map.set(key, o);
        pos.push(P[v * 3], P[v * 3 + 1], P[v * 3 + 2]);
        nor.push(N[v * 3], N[v * 3 + 1], N[v * 3 + 2]);
        const [h, k] = local(r, P[v * 3], P[v * 3 + 1], P[v * 3 + 2]);
        const [u0, v0, u1, v1] = ATLAS[r];
        uv.push(u0 + h * (u1 - u0), v0 + k * (v1 - v0));
      }
      out.push(o);
    }
  }
  const n = pos.length / 3;
  return { positions: new Float32Array(pos), normals: new Float32Array(nor), uvs: new Float32Array(uv), colors: new Float32Array(n * 3).fill(1), indices: Uint32Array.from(out) };
}

// ---- The painted atlas: base colour, and an emission map for the lights (lit after dark) ----
export function paintCarAtlas(size = 2048): { color: HTMLCanvasElement; emit: HTMLCanvasElement } {
  const W = size, H = size / 2;
  const color = document.createElement('canvas'), emit = document.createElement('canvas');
  color.width = emit.width = W;
  color.height = emit.height = H;
  const g = color.getContext('2d')!, e = emit.getContext('2d')!;
  e.fillStyle = '#000';
  e.fillRect(0, 0, W, H);
  // region rectangle in pixels, and a helper that draws with 0..1 coordinates inside it
  const box = (r: Region) => { const [u0, v0, u1, v1] = ATLAS[r]; return { x: u0 * W, y: v0 * H, w: (u1 - u0) * W, h: (v1 - v0) * H }; };
  const rect = (ctx: CanvasRenderingContext2D, r: Region, x0: number, y0: number, x1: number, y1: number) => {
    const b = box(r);
    ctx.fillRect(b.x + x0 * b.w, b.y + y0 * b.h, (x1 - x0) * b.w, (y1 - y0) * b.h);
  };
  const line = (r: Region, pts: [number, number][], width: number, style: string) => {
    const b = box(r);
    g.strokeStyle = style;
    g.lineWidth = width;
    g.beginPath();
    pts.forEach(([x, y], i) => (i ? g.lineTo : g.moveTo).call(g, b.x + x * b.w, b.y + y * b.h));
    g.stroke();
  };

  // metallic red: lighter towards the top of each panel, with fine flake noise
  for (const r of REGIONS) {
    const b = box(r);
    const grad = g.createLinearGradient(0, b.y, 0, b.y + b.h);
    const top = r === 'top';
    grad.addColorStop(0, top ? '#c4161c' : '#c9181e');
    grad.addColorStop(top ? 1 : 0.75, top ? '#a81217' : '#a01015');
    grad.addColorStop(1, top ? '#a81217' : '#7a0b0f');
    g.fillStyle = grad;
    g.fillRect(b.x, b.y, b.w, b.h);
  }
  const img = g.getImageData(0, 0, W, H);
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < img.data.length; i += 4) {
    const f = (rnd() - 0.5) * 18;
    img.data[i] = Math.max(0, Math.min(255, img.data[i] + f));
    img.data[i + 1] = Math.max(0, Math.min(255, img.data[i + 1] + f * 0.25));
    img.data[i + 2] = Math.max(0, Math.min(255, img.data[i + 2] + f * 0.25));
  }
  g.putImageData(img, 0, 0);

  const seam = 'rgba(40, 0, 0, 0.85)', shine = 'rgba(255, 170, 160, 0.35)';
  for (const side of ['left', 'right'] as Region[]) {
    // 0 = nose, 1 = tail along the side (the left side is laid out mirrored)
    const X = (t: number) => (side === 'left' ? 1 - t : t);
    // black side skirt and a dark sill line
    g.fillStyle = '#141416';
    rect(g, side, 0, 0.86, 1, 1);
    line(side, [[0, 0.86], [1, 0.86]], 3, '#3a0507');
    // shoulder character line: a highlight over a soft shadow
    line(side, [[X(0.08), 0.42], [X(0.55), 0.39], [X(0.95), 0.41]], 6, 'rgba(80, 0, 0, 0.35)');
    line(side, [[X(0.08), 0.405], [X(0.55), 0.375], [X(0.95), 0.395]], 3, shine);
    // door: front and rear seams, and the handle
    line(side, [[X(0.36), 0.36], [X(0.35), 0.84]], 3, seam);
    line(side, [[X(0.6), 0.36], [X(0.62), 0.84]], 3, seam);
    g.fillStyle = '#d8d8dc';
    rect(g, side, Math.min(X(0.54), X(0.585)), 0.47, Math.max(X(0.54), X(0.585)), 0.5);
    // fuel-free badge: a small chrome "T" plate on the front wing
    g.fillStyle = '#e4e4e8';
    rect(g, side, Math.min(X(0.2), X(0.235)), 0.5, Math.max(X(0.2), X(0.235)), 0.56);
  }
  // top: bonnet seams and centre crease, boot lid
  line('top', [[0.06, 0.25], [0.3, 0.2], [0.3, 0.8], [0.06, 0.75]], 3, seam);
  line('top', [[0.04, 0.5], [0.28, 0.5]], 4, shine);
  line('top', [[0.78, 0.22], [0.96, 0.26], [0.96, 0.74], [0.78, 0.78]], 3, seam);

  // front: slim headlights at the top corners, the lower intake, a small badge
  g.fillStyle = '#1a1a1e';
  rect(g, 'front', 0.22, 0.72, 0.78, 0.9);
  for (const [x0, x1] of [[0.06, 0.3], [0.7, 0.94]]) {
    g.fillStyle = '#f2f4f8';
    rect(g, 'front', x0, 0.4, x1, 0.5);
    e.fillStyle = '#fff6e6';
    rect(e, 'front', x0, 0.4, x1, 0.5);
  }
  g.fillStyle = '#e8e8ec';
  rect(g, 'front', 0.47, 0.45, 0.53, 0.53);

  // back: full-width light bar, a wordmark plate and the black diffuser
  g.fillStyle = '#e0141a';
  rect(g, 'back', 0.04, 0.32, 0.96, 0.42);
  e.fillStyle = '#ff2a20';
  rect(e, 'back', 0.04, 0.32, 0.96, 0.42);
  g.fillStyle = '#18181b';
  rect(g, 'back', 0.15, 0.78, 0.85, 1);
  const bb = box('back');
  g.fillStyle = '#e6e6ea';
  g.font = `bold ${Math.round(bb.h * 0.09)}px sans-serif`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText('T E S L A', bb.x + bb.w * 0.5, bb.y + bb.h * 0.55);
  return { color, emit };
}
