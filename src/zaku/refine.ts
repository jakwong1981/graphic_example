// Refines MS-06S_Char_Zaku_II.glb towards the Char's Zaku II figure (two-tone red, maroon chest and shield,
// red knee armour, machine gun held forward, slimmer shin flares, a shorter commander antenna).
// Parts are addressed by their node index in the source file (see the node dump in the commit notes).
import { GltfScene, SceneNode, Material, Mat4, Primitive, mul, trs, IDENTITY } from './gltf-scene';
import { isBox, roundBox, RoundOptions } from './round-box';

// Source node indices
const N = {
  chestCore: 0, // grey box in the middle of the chest
  shieldGroup: 133, shield: 130, shieldPanel: 131, shieldTop: 132,
  leftArm: 128, // left arm group (pivot = shoulder): shoulder ball, spiked pauldron, upper arm, forearm
  upperArmL: 122, forearmL: 127,
  rightArm: 156, // right arm group (pivot = shoulder); holds the shoulder block, shield, upper arm and forearm
  upperArmR: 134, forearmR: 155, // forearm group pivot = elbow
  gun: 154, // machine gun group in the right hand (pivot = grip)
  kneeL: 160, kneeR: 191, // knee armour
  bellL: 162, rimL: 164, bellR: 193, rimR: 195, // flared shin skirts and their white rims
  antenna: 104,
  head: 106, neck: 59, ventPipes: [86, 102], // head group; the neck cylinder and the two vent-pipe rings stay put
  // Leg chains, hip -> knee -> shin -> foot (group pivots sit at the joints). Right leg = -x.
  legR: [188, 187, 186, 185], legL: [219, 218, 217, 216],
};
// Source material indices
const M = { grey: 0, maroon: 1, white: 3, red: 4, gunmetal: 5, eye: 8, spikeDecal: 9, kneeDecal: 10 };
// Char red, picked from the figure (sRGB 0..255); the source used a lighter coral red #c8434f
const CHAR_RED = [0xbd, 0x33, 0x40];
const SOURCE_RED = [0xc8, 0x43, 0x4f];

export interface Refined { scene: GltfScene; changes: string[] }

const toLinear = (c: number) => Math.pow(c, 2.2);

function find(root: SceneNode, id: number): { node: SceneNode; parentWorld: Mat4 } {
  const walk = (n: SceneNode, world: Mat4): { node: SceneNode; parentWorld: Mat4 } | null => {
    if (n.id === id) return { node: n, parentWorld: world };
    const w = mul(world, n.matrix);
    for (const c of n.children) {
      const r = walk(c, w);
      if (r) return r;
    }
    return null;
  };
  const r = walk(root, IDENTITY);
  if (!r) throw new Error(`Zaku refine: node ${id} not found (different file?)`);
  return r;
}

function invertAffine(m: Mat4): Mat4 {
  const [a, b, c, d, e, f, g, h, i] = [m[0], m[1], m[2], m[4], m[5], m[6], m[8], m[9], m[10]];
  const A = e * i - f * h, B = -(d * i - f * g), C = d * h - e * g;
  const det = a * A + b * B + c * C;
  const r = [
    A / det, -(b * i - c * h) / det, (b * f - c * e) / det,
    B / det, (a * i - c * g) / det, -(a * f - c * d) / det,
    C / det, -(a * h - b * g) / det, (a * e - b * d) / det,
  ];
  const t = [m[12], m[13], m[14]];
  return [
    r[0], r[1], r[2], 0, r[3], r[4], r[5], 0, r[6], r[7], r[8], 0,
    -(r[0] * t[0] + r[3] * t[1] + r[6] * t[2]), -(r[1] * t[0] + r[4] * t[1] + r[7] * t[2]), -(r[2] * t[0] + r[5] * t[1] + r[8] * t[2]), 1,
  ];
}

const axisAngle = (axis: number[], angle: number) => {
  const s = Math.sin(angle / 2);
  return [axis[0] * s, axis[1] * s, axis[2] * s, Math.cos(angle / 2)];
};

const worldOrigin = (root: SceneNode, id: number) => {
  const { node, parentWorld } = find(root, id);
  const w = mul(parentWorld, node.matrix);
  return [w[12], w[13], w[14]];
};

/** Rotates a node by a rotation given in world space, about its own origin or a given world-space pivot */
function rotateWorld(root: SceneNode, id: number, axis: number[], angle: number, about?: number[]) {
  const { node, parentWorld } = find(root, id);
  const world = mul(parentWorld, node.matrix);
  const pivot = about ?? [world[12], world[13], world[14]];
  const R = mul(trs(pivot), mul(trs(undefined, axisAngle(axis, angle)), trs(pivot.map((v) => -v))));
  node.matrix = mul(invertAffine(parentWorld), mul(R, world));
}

const sub = (a: number[], b: number[]) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const unit = (v: number[]) => { const l = Math.hypot(v[0], v[1], v[2]); return [v[0] / l, v[1] / l, v[2] / l]; };
const cross = (a: number[], b: number[]) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a: number[], b: number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/** Smallest rotation of node `from` (about its own pivot) that makes the bone from -> to point along `dir` */
function aim(root: SceneNode, from: number, to: number, dir: number[]) {
  const v = unit(sub(worldOrigin(root, to), worldOrigin(root, from)));
  const t = unit(dir);
  const axis = cross(v, t);
  const s = Math.hypot(axis[0], axis[1], axis[2]);
  if (s < 1e-6) return;
  rotateWorld(root, from, unit(axis), Math.atan2(s, dot(v, t)));
}

/** Turns a node so that its local +y axis points straight up (keeps its heading) */
function level(root: SceneNode, id: number) {
  const { node, parentWorld } = find(root, id);
  const w = mul(parentWorld, node.matrix);
  const up = unit([w[4], w[5], w[6]]);
  const axis = cross(up, [0, 1, 0]);
  const s = Math.hypot(axis[0], axis[1], axis[2]);
  if (s > 1e-6) rotateWorld(root, id, unit(axis), Math.atan2(s, up[1]));
}

/** Moves a node by a world-space offset */
function translateWorld(root: SceneNode, id: number, offset: number[]) {
  const { node, parentWorld } = find(root, id);
  node.matrix = mul(invertAffine(parentWorld), mul(trs(offset), mul(parentWorld, node.matrix)));
}

/** Applies a local transform (in the node's own frame) after its current one */
const local = (root: SceneNode, id: number, m: Mat4) => {
  const { node } = find(root, id);
  node.matrix = mul(node.matrix, m);
};

/** Moves a node's primitives (optionally only those using material `from`) to material `to` */
function recolor(root: SceneNode, id: number, to: number, from?: number) {
  const { node } = find(root, id);
  node.primitives = node.primitives.map((p) => (from === undefined || p.material === from ? { ...p, material: to } : p));
}

/** Repaints the background of a decal texture (pixels close to `bg`, sRGB 0..255) with `to` */
async function repaint(image: Blob, bg: number[], to: number[]): Promise<Blob> {
  const bmp = await createImageBitmap(image);
  const canvas = new OffscreenCanvas(bmp.width, bmp.height);
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(bmp, 0, 0);
  const img = ctx.getImageData(0, 0, bmp.width, bmp.height);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const dist = Math.abs(d[i] - bg[0]) + Math.abs(d[i + 1] - bg[1]) + Math.abs(d[i + 2] - bg[2]);
    if (dist < 60) { d[i] = to[0]; d[i + 1] = to[1]; d[i + 2] = to[2]; }
  }
  ctx.putImageData(img, 0, 0);
  return canvas.convertToBlob({ type: 'image/png' });
}

export async function refineZaku(scene: GltfScene): Promise<Refined> {
  const { root, materials } = scene;
  const changes: string[] = [];
  const add = (m: Material) => materials.push(m) - 1;

  // 1. Colour space. The exporter wrote sRGB colour values into baseColorFactor, which glTF defines as linear,
  //    so every part rendered washed out (pink instead of red, light grey instead of dark grey).
  for (const m of materials) {
    if (!m.image) m.color = [toLinear(m.color[0]), toLinear(m.color[1]), toLinear(m.color[2]), m.color[3]];
  }
  materials[M.red].color = [toLinear(CHAR_RED[0] / 255), toLinear(CHAR_RED[1] / 255), toLinear(CHAR_RED[2] / 255), 1];
  const spike = materials[M.spikeDecal];
  if (spike?.image) spike.image = await repaint(spike.image, SOURCE_RED, CHAR_RED);
  changes.push('顏色空間修正：原檔把 sRGB 色值當作線性色寫入，令紅色變粉紅。轉回線性後變回夏亞紅 Colour factors converted sRGB → linear (pink → Char red); red armour a little deeper, like the figure');

  // 2. Two-tone Char scheme like the figure: maroon chest core and shield, red knee armour
  const deep = add({ name: 'char maroon (deep)', color: [toLinear(0.27), toLinear(0.085), toLinear(0.1), 1], metallic: 0.2, roughness: 0.5, emissive: [0, 0, 0] });
  recolor(root, N.chestCore, M.maroon);
  changes.push('胸口中間由灰色改為深紅 Chest core: grey → maroon');
  recolor(root, N.shield, M.maroon);
  recolor(root, N.shieldTop, M.maroon);
  recolor(root, N.shieldPanel, deep);
  rotateWorld(root, N.shieldGroup, [0, 1, 0], (30 * Math.PI) / 180); // face turned towards the front, as on the figure
  changes.push('肩盾改為深紅、中間面板更深一級，並向前轉 30° Shield: maroon with a darker inset panel, turned 30° to face forward');

  recolor(root, N.kneeL, M.red, M.grey);
  recolor(root, N.kneeR, M.red, M.grey);
  const decal = materials[M.kneeDecal];
  if (decal?.image) {
    const image = await repaint(decal.image, [0x23, 0x27, 0x2c], CHAR_RED);
    decal.image = image;
    decal.metallic = materials[M.red].metallic;
    decal.roughness = materials[M.red].roughness;
  }
  changes.push('膝甲由灰色改為紅色，保留「12」號碼 Knee armour: grey → red, number decal kept');

  // 3. Right arm pose. In the source the arm hangs straight down, pressed into the side of the chest and the
  //    waist armour. Swing it out and forward at the shoulder and bend the elbow, like the figure holding the gun.
  //    Only the upper arm and forearm move; the shoulder block and the shield stay on the shoulder.
  //    The Zaku faces +z, so its right side is -x: rotating about +z by a negative angle moves the hand outwards.
  //    Both shoulder joints sat inside the chest (the arms' inner edges were ~0.4 m into the chest sides), so first
  //    move each whole arm (shoulder armour included) outwards, then swing the arm itself away from the waist.
  translateWorld(root, N.rightArm, [-0.32, 0, 0]);
  translateWorld(root, N.leftArm, [0.32, 0, 0]);
  const shoulderR = worldOrigin(root, N.rightArm);
  for (const id of [N.upperArmR, N.forearmR]) {
    rotateWorld(root, id, [0, 0, 1], (-9 * Math.PI) / 180, shoulderR); // out from the body
    rotateWorld(root, id, [1, 0, 0], (-14 * Math.PI) / 180, shoulderR); // a little forward
  }
  rotateWorld(root, N.forearmR, [1, 0, 0], (-30 * Math.PI) / 180); // bend the elbow
  // The left arm hangs relaxed: a little out and forward, elbow slightly bent
  const shoulderL = worldOrigin(root, N.leftArm);
  for (const id of [N.upperArmL, N.forearmL]) {
    rotateWorld(root, id, [0, 0, 1], (8 * Math.PI) / 180, shoulderL);
    rotateWorld(root, id, [1, 0, 0], (-6 * Math.PI) / 180, shoulderL);
  }
  rotateWorld(root, N.forearmL, [1, 0, 0], (-14 * Math.PI) / 180);
  changes.push('雙手離開身體：兩邊肩膊各向外移 0.32，右手向外擺 9°、向前 14°、手肘屈 30°；左手向外 8°、手肘微屈 14° Both arms clear of the body: shoulders moved out 0.32, right arm out 9° / forward 14° with a 30° elbow bend, left arm out 8° with a 14° elbow bend');
  // The gun follows the forearm; turn it back a little so it points down and forward, as the figure holds it
  rotateWorld(root, N.gun, [1, 0, 0], (12 * Math.PI) / 180);
  rotateWorld(root, N.gun, [0, 0, 1], (-6 * Math.PI) / 180);
  changes.push('機關槍跟手向前斜指地面 Machine gun held pointing down and forward');

  // 4. Standing pose. In the source the legs slant inwards from the hips and the feet are a step apart (one
  //    forward, one back), so the flared shins cross over each other. Straighten each leg joint by joint so
  //    hip, knee, shin and foot line up under the hip with a slight outward splay, then set the feet flat.
  for (const [chain, side] of [[N.legR, -1], [N.legL, 1]] as const) {
    const down = [side * 0.1, -1, 0];
    for (let i = 0; i < chain.length - 1; i++) aim(root, chain[i], chain[i + 1], down);
    level(root, chain[chain.length - 1]);
  }
  changes.push('雙腳改為正常站姿：原本兩腳向內斜、一前一後，小腿交叉；而家髖、膝、小腿、腳逐節拉直，兩腳平排、腳掌貼地 Legs straightened into a normal stance: feet side by side and flat, shins no longer crossing');

  // 5. Proportions: slimmer shin flares, shorter commander antenna
  for (const id of [N.bellL, N.rimL, N.bellR, N.rimR]) local(root, id, trs(undefined, undefined, [0.86, 1, 0.86]));
  changes.push('小腿裙擺收窄 14% Shin flares 14% narrower');
  local(root, N.antenna, mul(trs([0, -0.68, 0]), mul(trs(undefined, undefined, [1, 0.8, 1]), trs([0, 0.68, 0]))));
  changes.push('指揮官天線縮短 20% Commander antenna 20% shorter');

  // Head raised: the dome sat right on the vent pipes, so the Zaku looked neckless. Lift every head part except
  // the pipe rings and the neck, then stretch the neck up to close the gap.
  const LIFT = 0.35;
  const head = find(root, N.head).node;
  for (const c of head.children) {
    if (c.id === N.neck || N.ventPipes.includes(c.id!)) continue;
    translateWorld(root, c.id!, [0, LIFT, 0]);
  }
  {
    const neck = find(root, N.neck).node;
    let lo = Infinity, hi = -Infinity;
    for (const p of neck.primitives) for (let i = 1; i < p.positions.length; i += 3) { lo = Math.min(lo, p.positions[i]); hi = Math.max(hi, p.positions[i]); }
    const k = (hi - lo + LIFT) / (hi - lo);
    local(root, N.neck, mul(trs([0, lo, 0]), mul(trs(undefined, undefined, [1, k, 1]), trs([0, -lo, 0]))));
  }
  changes.push(`頭部升高 ${LIFT}，同通風管拉開距離，頸部跟住拉長 Head raised ${LIFT} clear of the vent pipes, neck stretched to match`);

  // 6. Curves. Every box in the source is a sharp-edged cuboid, so the body reads as a stack of crates.
  //    Rebuild the boxes with rounded edges and gently domed faces; the torso, skirt armour, backpack, shoulder
  //    block get the strongest curvature, like the figure's barrel chest.
  const STYLE: Record<number, RoundOptions> = {};
  for (const id of [2, 3]) STYLE[id] = { radius: 0.24, bulge: 0.14 }; // chest plates either side
  // The chest core sits between and partly inside the side plates: keep its faces nearly flat so its dome
  // does not poke through them
  STYLE[0] = { radius: 0.12, bulge: 0.02 };
  for (const id of [1, 44]) STYLE[id] = { radius: 0.16, bulge: 0.1 }; // collar, abdomen
  for (const id of [50, 51, 52, 54, 56, 57]) STYLE[id] = { radius: 0.09, bulge: 0.1 }; // skirt armour
  for (const id of [45, 46]) STYLE[id] = { radius: 0.22, bulge: 0.1 }; // backpack
  STYLE[129] = { radius: 0.22, bulge: 0.12 }; // right shoulder block
  // The shield keeps its original flat, square-edged shape (closer to the figure than a rounded plate)
  const KEEP = new Set([N.shield, N.shieldPanel, N.shieldTop]);
  const cache = new Map<Primitive[], Map<string, Primitive[]>>();
  let rounded = 0;
  const visit = (n: SceneNode) => {
    if (n.primitives.length && !(n.id !== undefined && KEEP.has(n.id)) && isBox(n.primitives)) {
      const half = Math.min(...[0, 1, 2].map((k) => {
        let lo = Infinity, hi = -Infinity;
        for (const p of n.primitives) for (let i = k; i < p.positions.length; i += 3) { lo = Math.min(lo, p.positions[i]); hi = Math.max(hi, p.positions[i]); }
        return (hi - lo) / 2;
      }));
      // small trims (vents, rims, decal plates) stay crisp
      const style = n.id !== undefined && STYLE[n.id] ? STYLE[n.id] : half >= 0.1 ? { radius: 0.35 * half, bulge: 0.05 } : null;
      if (style) {
        const key = `${style.radius}/${style.bulge}`;
        let byStyle = cache.get(n.primitives);
        if (!byStyle) cache.set(n.primitives, (byStyle = new Map()));
        if (!byStyle.has(key)) byStyle.set(key, roundBox(n.primitives, style));
        n.primitives = byStyle.get(key)!;
        rounded++;
      }
    }
    n.children.forEach(visit);
  };
  visit(root);
  changes.push(`機身加弧度：${rounded} 件方塊零件改為圓角、面微微隆起；胸甲、腰甲、背包同肩甲弧度最大；肩盾保留原本形狀 Curves: ${rounded} box parts rebuilt with rounded edges and domed faces (strongest on the chest, skirt, backpack and shoulder block); the shield keeps its original shape`);

  // 7. Brighter mono-eye
  const eye = materials[M.eye];
  if (eye) eye.emissive = eye.emissive.map((c) => c * 2.5) as [number, number, number];
  changes.push('單眼發光加強 Brighter mono-eye');

  return { scene, changes };
}
