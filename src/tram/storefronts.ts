// Ground-floor shops and restaurants for the tram street, packed into one 2048x2048 atlas of 512x512 slots.
// Each slot is one shop unit (about 4.5 m wide x 4.4 m tall): lightbox signboard on top, shop window below.
// A matching emission atlas marks what glows at night (signboard, lit interior); black means unlit.
import { mulberry32 } from '../sim/math';

type Kind =
  | 'cafe' | 'roast' | 'noodle' | 'herbal' | 'bakery' | 'pharmacy' | 'gold' | 'mart'
  | 'fashion' | 'tv' | 'dessert' | 'flowers' | 'estate' | 'dried' | 'shutter' | 'seafood';

export interface ShopDef {
  name: string;
  en: string;
  board: string; // signboard background
  fg: string; // signboard text
  light: string; // interior light colour
  kind: Kind;
  open?: boolean; // open frontage (no glass), whole interior visible
  weight: number; // how often it appears along the street
}

// Shop names are made up (generic Hong Kong street shops, no real brands)
export const SHOPS: ShopDef[] = [
  { name: '新樂茶餐廳', en: 'SUN LOK CAFE', board: '#0f5132', fg: '#fde68a', light: '#fff1c9', kind: 'cafe', weight: 3 },
  { name: '金鳳燒臘', en: 'GOLDEN PHOENIX BBQ', board: '#991b1b', fg: '#fde047', light: '#ffcf8a', kind: 'roast', weight: 2 },
  { name: '何記粥麵', en: 'CONGEE & NOODLE', board: '#f8f4e8', fg: '#b91c1c', light: '#fff4d6', kind: 'noodle', weight: 2 },
  { name: '永春涼茶', en: 'HERBAL TEA', board: '#3f2a14', fg: '#fbbf24', light: '#ffd9a0', kind: 'herbal', open: true, weight: 1 },
  { name: '新香餅店', en: 'BAKERY', board: '#7c2d12', fg: '#fed7aa', light: '#ffe2a8', kind: 'bakery', weight: 2 },
  { name: '萬安藥房', en: 'PHARMACY', board: '#0c4a6e', fg: '#f0f9ff', light: '#f4fbff', kind: 'pharmacy', weight: 2 },
  { name: '福星金行', en: 'GOLDSMITH', board: '#b91c1c', fg: '#fde047', light: '#fff2c4', kind: 'gold', weight: 1 },
  { name: '便利店', en: '24 HR MART', board: '#f8fafc', fg: '#15803d', light: '#f2fbff', kind: 'mart', weight: 2 },
  { name: '時尚服裝', en: 'FASHION', board: '#111827', fg: '#f9a8d4', light: '#fff6ee', kind: 'fashion', weight: 2 },
  { name: '永發電器', en: 'ELECTRICAL', board: '#1e3a8a', fg: '#fef08a', light: '#e8f0ff', kind: 'tv', weight: 1 },
  { name: '甜心糖水', en: 'DESSERT', board: '#fbcfe8', fg: '#9d174d', light: '#ffe6f0', kind: 'dessert', weight: 1 },
  { name: '花墟花店', en: 'FLORIST', board: '#14532d', fg: '#f0fdf4', light: '#fff9e6', kind: 'flowers', open: true, weight: 1 },
  { name: '置業地產', en: 'PROPERTY AGENCY', board: '#1d4ed8', fg: '#ffffff', light: '#f7fbff', kind: 'estate', weight: 1 },
  { name: '海昌海味', en: 'DRIED SEAFOOD', board: '#78350f', fg: '#fef3c7', light: '#ffe0a6', kind: 'dried', open: true, weight: 1 },
  { name: '旺舖招租', en: 'SHOP TO LET', board: '#e5e7eb', fg: '#dc2626', light: '#000000', kind: 'shutter', weight: 1 },
  { name: '海景酒家', en: 'SEAFOOD RESTAURANT', board: '#7f1d1d', fg: '#fef08a', light: '#fff0cf', kind: 'seafood', weight: 2 },
];

export const STOREFRONT_ATLAS = 2048;
const SLOT = 512;
const PER_ROW = STOREFRONT_ATLAS / SLOT;

// Atlas UV of shop i at slot coordinates s, t in [0, 1] (t = 0 at the top). Inset so mipmaps do not bleed.
export function storefrontUV(i: number, s: number, t: number): [number, number] {
  const x = (i % PER_ROW) * SLOT + 3 + s * (SLOT - 6);
  const y = Math.floor(i / PER_ROW) * SLOT + 3 + t * (SLOT - 6);
  return [x / STOREFRONT_ATLAS, y / STOREFRONT_ATLAS];
}

// Weighted random shop index
export function pickShop(rnd: () => number): number {
  const total = SHOPS.reduce((s, d) => s + d.weight, 0);
  let r = rnd() * total;
  for (let i = 0; i < SHOPS.length; i++) {
    r -= SHOPS[i].weight;
    if (r < 0) return i;
  }
  return 0;
}
export const SEAFOOD_SHOP = SHOPS.findIndex((s) => s.kind === 'seafood');
export const isShutter = (i: number) => SHOPS[i].kind === 'shutter';

// ---- Drawing helpers (slot-local pixel coordinates) ----
type Ctx = CanvasRenderingContext2D;
const FONT = '"Noto Sans TC", "PingFang HK", "Microsoft JhengHei", sans-serif';
const rect = (c: Ctx, color: string, x: number, y: number, w: number, h: number) => {
  c.fillStyle = color;
  c.fillRect(x, y, w, h);
};
const disc = (c: Ctx, color: string, x: number, y: number, rx: number, ry = rx) => {
  c.fillStyle = color;
  c.beginPath();
  c.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
  c.fill();
};
const pick = <T>(rnd: () => number, a: T[]) => a[Math.floor(rnd() * a.length)];

// Layout of a slot
const BOARD = { y: 0, h: 104 };
const WIN = { x: 26, y: 124, w: 460, h: 388 }; // shop opening between the side pillars

function signboard(c: Ctx, d: ShopDef) {
  rect(c, '#2a2c30', 0, 0, SLOT, SLOT);
  rect(c, d.board, 6, 6, SLOT - 12, BOARD.h - 8);
  c.strokeStyle = 'rgba(0,0,0,0.25)';
  c.lineWidth = 4;
  c.strokeRect(10, 10, SLOT - 20, BOARD.h - 16);
  c.fillStyle = d.fg;
  c.textAlign = 'center';
  c.textBaseline = 'middle';
  const chars = [...d.name].length;
  c.font = `900 ${Math.min(62, 400 / chars)}px ${FONT}`;
  c.fillText(d.name, SLOT / 2, 44);
  c.font = `bold 20px ${FONT}`;
  c.fillText(d.en, SLOT / 2, 86);
  rect(c, '#55585e', 0, BOARD.h + 2, SLOT, 16); // ledge under the board
  rect(c, '#3b3d42', 0, WIN.y, WIN.x, SLOT - WIN.y); // side pillars
  rect(c, '#3b3d42', WIN.x + WIN.w, WIN.y, SLOT - WIN.x - WIN.w, SLOT - WIN.y);
}

// Lit room behind the window: light colour at the top fading to a warm dim floor
function room(c: Ctx, d: ShopDef) {
  const g = c.createLinearGradient(0, WIN.y, 0, SLOT);
  g.addColorStop(0, d.light);
  g.addColorStop(1, '#6b5a48');
  c.fillStyle = g;
  c.fillRect(WIN.x, WIN.y, WIN.w, WIN.h);
  rect(c, 'rgba(255,255,255,0.55)', WIN.x + 20, WIN.y + 6, WIN.w - 40, 6); // ceiling strip light
}

function shelves(c: Ctx, rnd: () => number, rows: number, colors: string[], item: (x: number, y: number) => void) {
  for (let r = 0; r < rows; r++) {
    const y = WIN.y + 40 + r * ((WIN.h - 80) / rows);
    rect(c, '#8b8f96', WIN.x + 10, y + 50, WIN.w - 20, 6);
    for (let x = WIN.x + 18; x < WIN.x + WIN.w - 30; x += 22 + rnd() * 10) {
      c.fillStyle = pick(rnd, colors);
      item(x, y);
    }
  }
}

// ---- Interiors ----
const INTERIOR: Record<Kind, (c: Ctx, rnd: () => number, d: ShopDef) => void> = {
  cafe(c, rnd) {
    for (let i = 0; i < 4; i++) { // menu boards on the back wall
      const x = WIN.x + 30 + i * 108;
      rect(c, i % 2 ? '#fef3c7' : '#dc2626', x, WIN.y + 30, 90, 70);
      for (let k = 0; k < 5; k++) rect(c, i % 2 ? '#7f1d1d' : '#fff', x + 8, WIN.y + 40 + k * 12, 50 + rnd() * 25, 4);
    }
    for (let i = 0; i < 3; i++) { // booths and tables
      const x = WIN.x + 20 + i * 150;
      rect(c, '#1f6f50', x, WIN.y + 190, 22, 120);
      rect(c, '#1f6f50', x + 108, WIN.y + 190, 22, 120);
      rect(c, '#d6c3a0', x + 26, WIN.y + 240, 78, 12);
      rect(c, '#6b4f36', x + 60, WIN.y + 252, 10, 60);
      disc(c, '#fff', x + 46, WIN.y + 234, 9, 5);
      disc(c, '#c08040', x + 84, WIN.y + 234, 7, 5); // milk tea
    }
  },
  roast(c, rnd) {
    rect(c, '#9a3412', WIN.x, WIN.y + 280, WIN.w, 108); // chopping counter
    rect(c, '#d6c3a0', WIN.x + 40, WIN.y + 270, 160, 14);
    rect(c, '#c0c4ca', WIN.x, WIN.y + 34, WIN.w, 5); // hook rail
    for (let x = WIN.x + 30; x < WIN.x + WIN.w - 20; x += 52) {
      const goose = rnd() < 0.6;
      rect(c, '#999', x - 1, WIN.y + 38, 2, 22);
      if (goose) {
        disc(c, '#7c2d12', x, WIN.y + 120, 22, 52);
        disc(c, '#b45309', x - 6, WIN.y + 100, 8, 26); // glossy skin highlight
        rect(c, '#5a1e0a', x - 3, WIN.y + 58, 6, 22); // neck
      } else { // char siu strips
        for (let k = -1; k <= 1; k++) rect(c, k ? '#b91c1c' : '#7f1d1d', x + k * 10 - 4, WIN.y + 60, 8, 110 + rnd() * 30);
      }
    }
  },
  noodle(c, rnd) {
    for (let i = 0; i < 6; i++) { // red menu strips with dish names
      const x = WIN.x + 20 + i * 72;
      rect(c, '#b91c1c', x, WIN.y + 22, 48, 150);
      c.fillStyle = '#fff';
      c.font = `bold 26px ${FONT}`;
      c.textAlign = 'center';
      [...pick(rnd, ['雲吞麵', '牛腩河', '艇仔粥', '魚蛋粉', '炸兩', '豬潤粥'])].forEach((ch, k) => c.fillText(ch, x + 24, WIN.y + 48 + k * 32));
    }
    rect(c, '#c7ccd2', WIN.x, WIN.y + 260, WIN.w, 20); // steel counter
    rect(c, '#9aa1aa', WIN.x, WIN.y + 280, WIN.w, 108);
    for (let x = WIN.x + 30; x < WIN.x + WIN.w - 30; x += 60) {
      disc(c, '#f8fafc', x, WIN.y + 252, 22, 10);
      c.fillStyle = 'rgba(255,255,255,0.35)'; // steam
      for (let k = 0; k < 3; k++) disc(c, 'rgba(255,255,255,0.3)', x + (rnd() - 0.5) * 20, WIN.y + 220 - k * 22, 10 + k * 4, 8 + k * 3);
    }
  },
  herbal(c, rnd) {
    rect(c, '#7f1d1d', WIN.x, WIN.y + 230, WIN.w, 158); // red counter
    for (let k = 0; k < 4; k++) rect(c, '#fbbf24', WIN.x, WIN.y + 240 + k * 36, WIN.w, 3);
    for (let i = 0; i < 4; i++) { // brass urns
      const x = WIN.x + 70 + i * 108;
      const g = c.createLinearGradient(x - 40, 0, x + 40, 0);
      g.addColorStop(0, '#8a5a12');
      g.addColorStop(0.4, '#f6d06b');
      g.addColorStop(1, '#7a4b0e');
      c.fillStyle = g;
      c.beginPath();
      c.ellipse(x, WIN.y + 170, 40, 62, 0, 0, Math.PI * 2);
      c.fill();
      rect(c, '#5b3a0a', x - 14, WIN.y + 96, 28, 16);
    }
    for (let x = WIN.x + 30; x < WIN.x + WIN.w - 20; x += 40) disc(c, rnd() < 0.5 ? '#3b1d0a' : '#6b3a12', x, WIN.y + 226, 14, 6); // bowls of tea
  },
  bakery(c, rnd) {
    rect(c, '#e8e1d4', WIN.x, WIN.y + 290, WIN.w, 98); // glass display counter
    rect(c, 'rgba(255,255,255,0.4)', WIN.x, WIN.y + 290, WIN.w, 8);
    shelves(c, rnd, 3, ['#d08a2e', '#e6a94a', '#b8742a', '#f2c46d'], (x, y) => disc(c, c.fillStyle as string, x + 8, y + 40, 11, 8));
    for (let x = WIN.x + 24; x < WIN.x + WIN.w - 20; x += 30) { // egg tarts
      disc(c, '#a16207', x, WIN.y + 330, 12, 7);
      disc(c, '#fcd34d', x, WIN.y + 328, 8, 4.5);
    }
  },
  pharmacy(c, rnd) {
    shelves(c, rnd, 5, ['#ef4444', '#3b82f6', '#22c55e', '#f59e0b', '#ffffff', '#a855f7', '#14b8a6'], (x, y) => c.fillRect(x, y + 22 + rnd() * 8, 16, 28));
  },
  gold(c, rnd) {
    rect(c, '#7f1d1d', WIN.x, WIN.y, WIN.w, WIN.h);
    rect(c, 'rgba(255,240,200,0.5)', WIN.x, WIN.y, WIN.w, 30);
    for (let r = 0; r < 2; r++) { // glass counters full of gold
      const y = WIN.y + 150 + r * 120;
      rect(c, '#fef9e7', WIN.x + 16, y, WIN.w - 32, 70);
      for (let k = 0; k < 40; k++) disc(c, pick(rnd, ['#f59e0b', '#fcd34d', '#d97706', '#fff7cc']), WIN.x + 26 + rnd() * (WIN.w - 52), y + 12 + rnd() * 48, 3 + rnd() * 5);
      rect(c, '#a16207', WIN.x + 16, y + 70, WIN.w - 32, 8);
    }
  },
  mart(c, rnd) {
    shelves(c, rnd, 4, ['#ef4444', '#facc15', '#22c55e', '#3b82f6', '#f97316', '#ec4899', '#ffffff'], (x, y) => c.fillRect(x, y + 20 + rnd() * 10, 14, 30));
    for (let i = 0; i < 3; i++) rect(c, pick(rnd, ['#fde047', '#f472b6', '#38bdf8']), WIN.x + 30 + i * 150, WIN.y + 300, 90, 60); // posters on the door
  },
  fashion(c, rnd) {
    for (let i = 0; i < 3; i++) { // mannequins
      const x = WIN.x + 90 + i * 140;
      const cloth = pick(rnd, ['#be185d', '#1d4ed8', '#f5f5f4', '#111827', '#ca8a04', '#15803d']);
      disc(c, '#e7d3c0', x, WIN.y + 70, 18);
      c.fillStyle = cloth;
      c.beginPath();
      c.moveTo(x - 34, WIN.y + 96); c.lineTo(x + 34, WIN.y + 96); c.lineTo(x + 50, WIN.y + 290); c.lineTo(x - 50, WIN.y + 290);
      c.fill();
      rect(c, '#555', x - 3, WIN.y + 290, 6, 80);
      rect(c, '#555', x - 24, WIN.y + 368, 48, 6);
    }
  },
  tv(c, rnd) {
    rect(c, '#1f2430', WIN.x, WIN.y, WIN.w, WIN.h);
    for (let r = 0; r < 3; r++) {
      for (let k = 0; k < 4; k++) {
        const x = WIN.x + 18 + k * 110;
        const y = WIN.y + 24 + r * 118;
        rect(c, '#0b0d12', x, y, 100, 80);
        const g = c.createLinearGradient(x, y, x + 100, y + 80);
        g.addColorStop(0, pick(rnd, ['#38bdf8', '#22c55e', '#f472b6', '#facc15']));
        g.addColorStop(1, pick(rnd, ['#1e3a8a', '#7c3aed', '#0f766e']));
        c.fillStyle = g;
        c.fillRect(x + 6, y + 6, 88, 68);
      }
    }
  },
  dessert(c, rnd) {
    for (let i = 0; i < 8; i++) { // photo menu
      const x = WIN.x + 20 + (i % 4) * 110;
      const y = WIN.y + 24 + Math.floor(i / 4) * 80;
      rect(c, '#fff', x, y, 96, 66);
      disc(c, pick(rnd, ['#fbbf24', '#f472b6', '#a3e635', '#fb923c', '#e9d5ff']), x + 48, y + 34, 26, 18);
    }
    for (let i = 0; i < 3; i++) { // round tables and stools
      const x = WIN.x + 80 + i * 150;
      disc(c, '#f9a8d4', x, WIN.y + 270, 46, 12);
      rect(c, '#9d174d', x - 4, WIN.y + 280, 8, 70);
      disc(c, '#be185d', x - 50, WIN.y + 320, 14, 6);
      disc(c, '#be185d', x + 50, WIN.y + 320, 14, 6);
    }
  },
  flowers(c, rnd) {
    for (let r = 0; r < 3; r++) { // tiered display of buckets
      const y = WIN.y + 120 + r * 90;
      for (let x = WIN.x + 30 - r * 6; x < WIN.x + WIN.w - 20; x += 48) {
        rect(c, '#475569', x - 16, y + 30, 32, 40);
        rect(c, '#15803d', x - 18, y - 10, 36, 40);
        const col = pick(rnd, ['#ef4444', '#f9a8d4', '#fde047', '#ffffff', '#c084fc', '#fb923c']);
        for (let k = 0; k < 9; k++) disc(c, col, x + (rnd() - 0.5) * 34, y - 6 + (rnd() - 0.5) * 30, 6 + rnd() * 4);
      }
    }
  },
  estate(c, rnd) {
    for (let r = 0; r < 4; r++) { // listing sheets taped to the glass
      for (let k = 0; k < 6; k++) {
        const x = WIN.x + 14 + k * 74;
        const y = WIN.y + 20 + r * 90;
        rect(c, '#ffffff', x, y, 64, 80);
        rect(c, pick(rnd, ['#dc2626', '#1d4ed8', '#15803d']), x + 4, y + 4, 56, 14);
        for (let l = 0; l < 5; l++) rect(c, '#9ca3af', x + 6, y + 26 + l * 10, 30 + rnd() * 22, 3);
      }
    }
  },
  dried(c, rnd) {
    for (let r = 0; r < 3; r++) { // sloped display of baskets
      const y = WIN.y + 130 + r * 85;
      rect(c, '#6b4423', WIN.x, y + 30, WIN.w, 55);
      for (let x = WIN.x + 34; x < WIN.x + WIN.w - 20; x += 62) {
        disc(c, '#a0773f', x, y + 30, 28, 14);
        const goods = pick(rnd, ['#d97706', '#78350f', '#fde68a', '#9a3412', '#e7e5e4']);
        for (let k = 0; k < 12; k++) disc(c, goods, x + (rnd() - 0.5) * 40, y + 24 + (rnd() - 0.5) * 12, 4 + rnd() * 3);
      }
    }
    for (let x = WIN.x + 40; x < WIN.x + WIN.w; x += 90) rect(c, '#b45309', x, WIN.y + 20, 30, 70); // hanging dried fish
  },
  shutter() {},
  seafood(c, rnd) {
    for (let k = 0; k < 2; k++) { // fish tanks along the front
      const x = WIN.x + 16 + k * 226;
      const g = c.createLinearGradient(0, WIN.y + 170, 0, WIN.y + 330);
      g.addColorStop(0, '#7dd3fc');
      g.addColorStop(1, '#0e7490');
      c.fillStyle = g;
      c.fillRect(x, WIN.y + 170, 200, 160);
      for (let i = 0; i < 6; i++) disc(c, pick(rnd, ['#f97316', '#fca5a5', '#e5e7eb', '#475569']), x + 20 + rnd() * 160, WIN.y + 190 + rnd() * 120, 16, 7);
      for (let i = 0; i < 8; i++) disc(c, 'rgba(255,255,255,0.6)', x + rnd() * 200, WIN.y + 175 + rnd() * 150, 2.5);
      rect(c, '#334155', x, WIN.y + 330, 200, 58);
    }
    for (let i = 0; i < 5; i++) disc(c, '#fde68a', WIN.x + 50 + i * 90, WIN.y + 40, 26, 14); // chandeliers
  },
};

// Paints one slot. Returns which areas glow at night: the signboard and (unless closed) the window.
function paintShop(c: Ctx, e: Ctx, d: ShopDef, rnd: () => number) {
  signboard(c, d);
  // The signboard is a lightbox
  e.drawImage(c.canvas, 0, 0, SLOT, BOARD.h, 0, 0, SLOT, BOARD.h);
  if (d.kind === 'shutter') {
    rect(c, '#9aa0a8', WIN.x, WIN.y, WIN.w, WIN.h);
    for (let y = WIN.y + 4; y < SLOT; y += 10) rect(c, '#7d838b', WIN.x, y, WIN.w, 3);
    rect(c, '#fff', WIN.x + 150, WIN.y + 120, 160, 90); // to-let notice
    c.fillStyle = '#dc2626';
    c.textAlign = 'center';
    c.font = `900 40px ${FONT}`;
    c.fillText('招租', WIN.x + 230, WIN.y + 168);
    return;
  }
  room(c, d);
  INTERIOR[d.kind](c, rnd, d);
  const door = rnd() < 0.5 ? WIN.x + 8 : WIN.x + WIN.w - 128;
  if (!d.open) {
    // Glass frontage: aluminium frames, a door, soft reflections
    c.fillStyle = 'rgba(180,200,215,0.12)';
    c.fillRect(WIN.x, WIN.y, WIN.w, WIN.h);
    rect(c, '#b8bec6', WIN.x, WIN.y, WIN.w, 6);
    rect(c, '#b8bec6', door, WIN.y, 6, WIN.h);
    rect(c, '#b8bec6', door + 120, WIN.y, 6, WIN.h);
    rect(c, '#b8bec6', door + 50, WIN.y + 200, 20, 6); // door handle
    c.fillStyle = 'rgba(255,255,255,0.10)';
    c.beginPath();
    c.moveTo(WIN.x, WIN.y + 300); c.lineTo(WIN.x + 260, WIN.y); c.lineTo(WIN.x + 330, WIN.y); c.lineTo(WIN.x + 70, WIN.y + 388); c.lineTo(WIN.x, WIN.y + 388);
    c.fill();
  } else {
    // Open frontage: roller shutter rolled up into a box under the signboard
    rect(c, '#7d838b', WIN.x, WIN.y, WIN.w, 14);
  }
  // Half-closed shutter on some shops
  const shutter = rnd() < 0.25 ? 40 + rnd() * 80 : 0;
  if (shutter) {
    rect(c, '#9aa0a8', WIN.x, WIN.y, WIN.w, shutter);
    for (let y = WIN.y + 4; y < WIN.y + shutter; y += 10) rect(c, '#7d838b', WIN.x, y, WIN.w, 3);
  }
  rect(c, '#4b4f56', 0, SLOT - 14, SLOT, 14); // step
  // Lit interior glows at night (the shutter part stays dark)
  const y0 = WIN.y + shutter;
  e.globalAlpha = 0.85;
  e.drawImage(c.canvas, WIN.x, y0, WIN.w, SLOT - 14 - y0, WIN.x, y0, WIN.w, SLOT - 14 - y0);
  e.globalAlpha = 1;
}

export function paintStorefronts(seed = 2024): { color: HTMLCanvasElement; emit: HTMLCanvasElement } {
  const make = () => {
    const cv = document.createElement('canvas');
    cv.width = cv.height = STOREFRONT_ATLAS;
    const ctx = cv.getContext('2d')!;
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, STOREFRONT_ATLAS, STOREFRONT_ATLAS);
    return [cv, ctx] as const;
  };
  const [color, cctx] = make();
  const [emit, ectx] = make();
  // Each shop is painted on its own slot-sized canvas so drawing code can use slot-local coordinates
  const slot = document.createElement('canvas');
  slot.width = slot.height = SLOT;
  const sc = slot.getContext('2d')!;
  const slotEmit = document.createElement('canvas');
  slotEmit.width = slotEmit.height = SLOT;
  const se = slotEmit.getContext('2d')!;
  const rnd = mulberry32(seed);
  SHOPS.forEach((d, i) => {
    sc.clearRect(0, 0, SLOT, SLOT);
    se.fillStyle = '#000';
    se.fillRect(0, 0, SLOT, SLOT);
    paintShop(sc, se, d, rnd);
    const x = (i % PER_ROW) * SLOT;
    const y = Math.floor(i / PER_ROW) * SLOT;
    cctx.drawImage(slot, x, y);
    ectx.drawImage(slotEmit, x, y);
  });
  return { color, emit };
}
