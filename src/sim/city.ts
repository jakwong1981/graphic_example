// Hong Kong-style city: island skyline + harbour + Kowloon side with a container port, hills behind both
import { V3, mulberry32 } from './math';
import { CityBuilder, Box3 } from './city-builder';
import { MaterialName } from './city-textures';
import type { MeshData } from '../webgl/mesh';

export interface Cone { x: number; z: number; r: number; h: number }
export interface Mover { pos: V3; heading: number; speed: number; axis: 0 | 2; min: number; max: number }

export interface City {
  batches: Map<MaterialName, MeshData>;
  colliders: Box3[];
  cones: Cone[];
  ships: Mover[];
  groundHeight(x: number, z: number): number;
}

export const WATER_Y = -3;
const BLOCK = 120;
const ISLAND = { x0: -2600, x1: 600, z0: -2600, z1: 2600 };
const KOWLOON = { x0: 1800, x1: 4400, z0: -2600, z1: 2600 };
const FACADES: MaterialName[] = ['glass', 'office', 'residential', 'residential2', 'glass', 'office'];

export function buildCity(seed = 1997): City {
  const rnd = mulberry32(seed);
  const b = new CityBuilder();
  const pick = <T>(a: T[]) => a[Math.floor(rnd() * a.length)];
  const range = (lo: number, hi: number) => lo + rnd() * (hi - lo);

  // Ground: two land masses with concrete sea walls, and the sea
  for (const L of [ISLAND, KOWLOON]) b.box(L.x0, L.x1, -8, 0, L.z0, L.z1, 'concrete', 'road', false);
  b.flat('water', [[-12000, WATER_Y, -12000], [12000, WATER_Y, -12000], [12000, WATER_Y, 12000], [-12000, WATER_Y, 12000]], [0, -100, 0]);

  // Facade colours: multipliers on the texture, chosen per building so the skyline is not uniform
  const PALETTES: Partial<Record<MaterialName, V3[]>> = {
    glass: [[0.85, 0.95, 1.1], [0.75, 1.05, 0.9], [1.15, 0.9, 0.65], [1.1, 1.1, 1.1], [0.7, 1.0, 1.0], [0.6, 0.65, 0.75], [1.05, 0.8, 0.9]],
    office: [[1.05, 0.98, 0.85], [1.15, 1.15, 1.15], [1.1, 0.75, 0.6], [0.85, 0.92, 1.05], [1.1, 1.0, 0.75], [0.8, 0.8, 0.82]],
    residential: [[1.1, 0.82, 0.85], [1.1, 1.02, 0.7], [0.85, 1.08, 0.9], [1.15, 0.88, 0.72], [0.95, 0.88, 1.1], [0.82, 0.95, 1.12], [1.12, 1.12, 1.12]],
    residential2: [[1, 1, 1], [1.1, 0.95, 0.85], [0.9, 1.1, 0.95], [1.15, 0.9, 0.95], [0.85, 0.85, 1.05]],
  };
  const tinted = (mat: MaterialName): MaterialName => {
    const palette = PALETTES[mat];
    const c = palette ? pick(palette) : ([1, 1, 1] as V3);
    const k = range(0.92, 1.08); // small brightness variation within a colour
    b.color = [c[0] * k, c[1] * k, c[2] * k];
    return mat;
  };
  const facade = () => tinted(pick(FACADES));

  // Rooftop plant room, gives towers a less "extruded" look
  const roofBox = (cx: number, cz: number, s: number, y: number) =>
    b.box(cx - s, cx + s, y, y + range(4, 9), cz - s * 0.7, cz + s * 0.7, 'concrete', 'roof', false);

  // ---- Building types (all fit inside a 92 m lot centred at cx, cz) ----
  const types = {
    box(cx: number, cz: number, h: number) {
      const w = range(16, 40), d = range(16, 40);
      b.box(cx - w, cx + w, 0, h, cz - d, cz + d, facade(), 'roof');
      roofBox(cx, cz, Math.min(w, d) * 0.4, h);
    },
    cylinder(cx: number, cz: number, h: number) {
      const r = range(18, 32);
      b.prism(cx, cz, r, 0, h, 24, tinted(pick(['glass', 'landmark', 'office'] as MaterialName[])), 'roof');
      b.prism(cx, cz, r * 0.6, h, h + 8, 24, 'glass', 'roof');
    },
    polygon(cx: number, cz: number, h: number) {
      const seg = pick([3, 5, 6, 8]);
      b.prism(cx, cz, range(24, 40), 0, h, seg, facade(), 'roof', { rot: rnd() * Math.PI });
    },
    stepped(cx: number, cz: number, h: number) {
      let w = range(30, 42), d = range(30, 42), y = 0;
      const mat = facade();
      for (const frac of [0.5, 0.3, 0.2]) {
        b.box(cx - w, cx + w, y, y + h * frac, cz - d, cz + d, mat, 'roof');
        y += h * frac;
        w *= 0.72;
        d *= 0.72;
      }
    },
    spire(cx: number, cz: number, h: number) {
      const r = range(24, 34);
      const rot = Math.PI / 4;
      b.prism(cx, cz, r, 0, h, 4, tinted(pick(['glass', 'landmark'] as MaterialName[])), null, { rot, taper: 0.8 });
      b.prism(cx, cz, r * 0.8, h, h + r, 4, 'landmark', null, { rot, taper: 0 }); // pyramid roof
      b.prism(cx, cz, 1.2, h + r * 0.8, h + r + 40, 6, 'concrete', 'roof'); // mast
    },
    residential(cx: number, cz: number, h: number) {
      // HK cruciform housing blocks, 2-4 per lot
      const n = 2 + Math.floor(rnd() * 3);
      const mat = tinted(pick(['residential', 'residential2'] as MaterialName[]));
      for (let k = 0; k < n; k++) {
        const ox = cx + (k % 2 ? 22 : -22);
        const oz = cz + (k < 2 ? -22 : 22);
        const hh = h * range(0.8, 1.1);
        b.box(ox - 17, ox + 17, 0, hh, oz - 6, oz + 6, mat, 'roof');
        b.box(ox - 6, ox + 6, 0, hh, oz - 17, oz + 17, mat, 'roof');
      }
    },
  };
  type TypeName = keyof typeof types;
  const islandMix: TypeName[] = ['box', 'box', 'cylinder', 'polygon', 'stepped', 'spire', 'residential', 'residential'];
  const kowloonMix: TypeName[] = ['box', 'residential', 'residential', 'residential', 'polygon', 'stepped'];

  // ---- Landmarks ----
  const taken = new Set<string>();
  const lotKey = (cx: number, cz: number) => `${Math.floor(cx / BLOCK)},${Math.floor(cz / BLOCK)}`;
  const landmark = (cx: number, cz: number, build: () => void) => {
    taken.add(lotKey(cx, cz));
    build();
  };
  // IFC-like: square tiers + crown fins
  landmark(540, -300, () => {
    const tiers: [number, number, number][] = [[28, 0, 300], [25, 300, 350], [22, 350, 385], [18, 385, 410]];
    for (const [s, y0, y1] of tiers) b.box(540 - s, 540 + s, y0, y1, -300 - s, -300 + s, 'landmark', 'roof');
    for (const [dx, dz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
      b.box(540 + dx * 16 - 1.5, 540 + dx * 16 + 1.5, 410, 428, -300 + dz * 16 - 1.5, -300 + dz * 16 + 1.5, 'landmark', 'roof');
    }
  });
  // Bank of China-like: square base, then triangular, sloping prisms + twin masts
  landmark(420, 180, () => {
    b.box(395, 445, 0, 120, 155, 205, 'landmark', 'roof');
    b.prism(420, 180, 35, 120, 230, 4, 'landmark', 'roof', { rot: Math.PI / 4, taper: 0.75 });
    b.prism(420, 180, 26, 230, 315, 3, 'landmark', 'roof', { taper: 0.45 });
    for (const dz of [-4, 4]) b.prism(416, 180 + dz, 1.2, 300, 367, 6, 'concrete', null);
  });
  // Central Plaza-like: triangular tower, pyramid top, spire
  landmark(300, 420, () => {
    b.prism(300, 420, 40, 0, 310, 3, 'glass', null, { rot: 0.3 });
    b.prism(300, 420, 40, 310, 335, 3, 'landmark', null, { rot: 0.3, taper: 0 });
    b.prism(300, 420, 1.5, 320, 374, 6, 'concrete', null);
  });
  // ICC-like on the Kowloon waterfront
  landmark(1860, 300, () => {
    b.box(1828, 1892, 0, 440, 268, 332, 'landmark', 'roof');
    b.prism(1860, 300, 45, 440, 484, 4, 'landmark', 'roof', { rot: Math.PI / 4, taper: 0.7 });
  });

  // Hills (x, z, radius, height); defined before the blocks so lots on the slopes can be skipped
  const HILLS: [number, number, number, number][] = [
    [-2150, 0, 900, 550], // the Peak
    [-1950, 1500, 650, 380],
    [-1950, -1500, 700, 430],
    [4000, 0, 750, 495], // Lion Rock
    [3800, 1700, 600, 350],
    [3850, -1650, 650, 410],
  ];
  const onHill = (cx: number, cz: number) => HILLS.some(([x, z, r]) => Math.hypot(cx - x, cz - z) < r + 40);

  // ---- Fill the city blocks: every lot on both landmasses, except hills, landmarks and ~3% plazas ----
  const fillLand = (L: typeof ISLAND, mix: TypeName[], height: (cx: number, cz: number) => number, avoid: (cx: number, cz: number) => boolean) => {
    // Lots stay aligned to multiples of BLOCK so they match the road texture tiles
    for (let x0 = Math.ceil(L.x0 / BLOCK) * BLOCK; x0 + BLOCK <= L.x1; x0 += BLOCK) {
      for (let z0 = Math.ceil(L.z0 / BLOCK) * BLOCK; z0 + BLOCK <= L.z1; z0 += BLOCK) {
        const cx = x0 + BLOCK / 2;
        const cz = z0 + BLOCK / 2;
        if (taken.has(lotKey(cx, cz)) || avoid(cx, cz) || onHill(cx, cz) || rnd() < 0.03) continue;
        types[pick(mix)](cx, cz, height(cx, cz));
      }
    }
  };
  // Island: tallest on the waterfront and in the middle, lower towards the hills
  fillLand(ISLAND, islandMix, (cx, cz) => {
    const t = Math.min(1, Math.max(0, (cx + 1800) / 2400));
    const zf = Math.exp(-((cz / 900) ** 2));
    return (40 + 260 * t * t * (0.5 + 0.5 * zf)) * range(0.45, 1);
  }, () => false);
  // Kowloon: denser, lower; leave the north-west for the container port
  fillLand(KOWLOON, kowloonMix, (cx) => (40 + 130 * Math.max(0.15, 1 - (cx - 1800) / 2200)) * range(0.5, 1), (cx, cz) => cx < 2300 && cz > 1000);

  b.color = [1, 1, 1]; // port, piers and hills keep their texture colours

  // ---- Container port on the Kowloon waterfront ----
  for (let z = 1080; z < 2300; z += 70) {
    for (let x = 1850; x < 2250; x += 60) {
      if (rnd() < 0.15) continue;
      const layers = 1 + Math.floor(rnd() * 3);
      b.box(x, x + 48, 0, 7.8 * layers, z, z + 12, 'container', 'roof');
    }
  }
  for (let z = 1100; z < 2300; z += 220) { // gantry cranes reaching over the water
    b.box(1805, 1810, 0, 55, z, z + 4, 'crane', null);
    b.box(1845, 1850, 0, 55, z, z + 4, 'crane', null);
    b.box(1805, 1810, 0, 55, z + 24, z + 28, 'crane', null);
    b.box(1845, 1850, 0, 55, z + 24, z + 28, 'crane', null);
    b.box(1740, 1870, 55, 62, z, z + 28, 'crane', 'crane');
  }
  // Piers on the island side
  for (const z of [-900, -500, 700, 1100]) b.box(600, 700, -8, 1, z, z + 24, 'concrete', 'concrete', true);

  // ---- Hills ----
  const cones: Cone[] = [];
  const hill = (x: number, z: number, r: number, h: number) => {
    b.prism(x, z, r, WATER_Y, h, 28, 'hill', 'hill', { taper: 0.08, jitter: 0.15, rnd, collide: false });
    cones.push({ x, z, r: r * 0.95, h });
  };
  for (const [x, z, r, h] of HILLS) hill(x, z, r, h);

  // ---- Moving traffic: ships in the harbour (road traffic lives in traffic.ts) ----
  const ships: Mover[] = [];
  for (let i = 0; i < 9; i++) {
    const dir = rnd() < 0.5 ? 1 : -1;
    ships.push({ pos: [range(780, 1650), WATER_Y, range(-2500, 2500)], heading: dir * Math.PI / 2, speed: range(4, 9), axis: 2, min: -2600, max: 2600 });
  }

  const onLand = (x: number, z: number) =>
    [ISLAND, KOWLOON].some((L) => x > L.x0 && x < L.x1 && z > L.z0 && z < L.z1);
  const groundHeight = (x: number, z: number) => {
    let h = onLand(x, z) ? 0 : WATER_Y;
    for (const c of cones) {
      const d = Math.hypot(x - c.x, z - c.z);
      if (d < c.r) h = Math.max(h, WATER_Y + (c.h - WATER_Y) * (1 - d / c.r));
    }
    return h;
  };

  return { batches: b.finish(), colliders: b.colliders, cones, ships, groundHeight };
}
