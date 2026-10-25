// Tileable UV textures for the city, painted on canvases. Sizes in metres per tile live in TILE (city.ts).
import { mulberry32 } from './math';
import { paintSignAtlas } from '../tram/signs';

export type MaterialName =
  | 'glass' | 'office' | 'residential' | 'residential2' | 'landmark'
  | 'roof' | 'road' | 'concrete' | 'water' | 'hill' | 'container' | 'crane'
  // tram street
  | 'tonglau' | 'shopfront' | 'pawn' | 'paving' | 'asphalt' | 'trackbed' | 'steel' | 'yellow' | 'white'
  | 'bark' | 'blossom' | 'polegreen' | 'boc' | 'signs' | 'grass';

const SIZE = 512;

function canvas(): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = c.height = SIZE;
  return [c, c.getContext('2d')!];
}

function speckle(ctx: CanvasRenderingContext2D, rnd: () => number, n: number, colors: string[], size: number) {
  for (let i = 0; i < n; i++) {
    ctx.fillStyle = colors[Math.floor(rnd() * colors.length)];
    const s = size * (0.5 + rnd());
    ctx.fillRect(rnd() * SIZE, rnd() * SIZE, s, s);
  }
}

// Facade tiles are 8 m x 8 m: 2 bays (4 m) x 2 floors (4 m), so 64 px per metre
const PAINTERS: Record<MaterialName, (ctx: CanvasRenderingContext2D, rnd: () => number) => void> = {
  glass(ctx, rnd) {
    for (let fy = 0; fy < 2; fy++) {
      for (let bx = 0; bx < 4; bx++) {
        const l = 0.85 + rnd() * 0.3;
        const g = ctx.createLinearGradient(0, fy * 256, 0, fy * 256 + 256);
        g.addColorStop(0, `rgb(${120 * l},${170 * l},${195 * l})`);
        g.addColorStop(1, `rgb(${40 * l},${80 * l},${110 * l})`);
        ctx.fillStyle = g;
        ctx.fillRect(bx * 128, fy * 256, 128, 256);
      }
    }
    ctx.fillStyle = 'rgba(255,255,255,0.12)'; // sky reflection streak
    ctx.beginPath();
    ctx.moveTo(0, 380); ctx.lineTo(512, 120); ctx.lineTo(512, 200); ctx.lineTo(0, 460);
    ctx.fill();
    ctx.fillStyle = '#c9d1d6'; // mullions and transoms
    for (let x = 0; x < SIZE; x += 128) ctx.fillRect(x, 0, 5, SIZE);
    for (let y = 0; y < SIZE; y += 256) ctx.fillRect(0, y, SIZE, 18);
  },
  office(ctx, rnd) {
    ctx.fillStyle = '#c4c0b8';
    ctx.fillRect(0, 0, SIZE, SIZE);
    speckle(ctx, rnd, 600, ['rgba(0,0,0,0.05)', 'rgba(255,255,255,0.06)'], 6);
    for (let y = 0; y < SIZE; y += 256) {
      const g = ctx.createLinearGradient(0, y + 60, 0, y + 200);
      g.addColorStop(0, '#5a7488');
      g.addColorStop(1, '#1e2c3a');
      ctx.fillStyle = g; // ribbon window per floor
      ctx.fillRect(0, y + 60, SIZE, 140);
      ctx.fillStyle = '#9aa0a6';
      for (let x = 0; x < SIZE; x += 64) ctx.fillRect(x, y + 60, 4, 140);
    }
  },
  residential(ctx, rnd) { residentialTile(ctx, rnd, '#e6d8bd'); },
  residential2(ctx, rnd) { residentialTile(ctx, rnd, '#a9c0c8'); },
  landmark(ctx, rnd) {
    ctx.fillStyle = '#26323e';
    ctx.fillRect(0, 0, SIZE, SIZE);
    for (let x = 0; x < SIZE; x += 64) {
      ctx.fillStyle = `rgba(110,150,180,${0.15 + rnd() * 0.2})`;
      ctx.fillRect(x + 6, 0, 52, SIZE);
    }
    ctx.fillStyle = '#c9a65a'; // gold vertical fins
    for (let x = 0; x < SIZE; x += 128) ctx.fillRect(x, 0, 10, SIZE);
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    for (let y = 0; y < SIZE; y += 128) ctx.fillRect(0, y, SIZE, 6);
  },
  roof(ctx, rnd) {
    ctx.fillStyle = '#8a8a86';
    ctx.fillRect(0, 0, SIZE, SIZE);
    speckle(ctx, rnd, 1500, ['#7d7d79', '#979792', '#6f6f6b'], 5);
    ctx.fillStyle = '#5f6062';
    for (let i = 0; i < 6; i++) ctx.fillRect(rnd() * 440, rnd() * 440, 40 + rnd() * 40, 30 + rnd() * 40);
  },
  // One 120 m city block: 7 m of road on each edge, 4 m pavement, plaza in the middle (4.27 px/m)
  road(ctx, rnd) {
    const m = SIZE / 120;
    ctx.fillStyle = '#383a3d';
    ctx.fillRect(0, 0, SIZE, SIZE);
    speckle(ctx, rnd, 1200, ['#33353a', '#404246'], 3);
    ctx.fillStyle = '#b8b4aa';
    ctx.fillRect(7 * m, 7 * m, 106 * m, 106 * m);
    ctx.fillStyle = '#9b988f';
    ctx.fillRect(11 * m, 11 * m, 98 * m, 98 * m);
    speckle(ctx, rnd, 300, ['rgba(0,0,0,0.08)'], 8);
    ctx.fillStyle = '#e8e8e0'; // dashed centre lines along the tile edges
    for (let p = 14 * m; p < SIZE - 14 * m; p += 6 * m) {
      ctx.fillRect(p, 0, 3 * m, 0.4 * m);
      ctx.fillRect(p, SIZE - 0.4 * m, 3 * m, 0.4 * m);
      ctx.fillRect(0, p, 0.4 * m, 3 * m);
      ctx.fillRect(SIZE - 0.4 * m, p, 0.4 * m, 3 * m);
    }
    ctx.fillStyle = '#f2f2ea'; // zebra crossings
    for (let k = 0; k < 6; k++) {
      ctx.fillRect(7 * m + k * 1.2 * m, 0, 0.6 * m, 7 * m);
      ctx.fillRect(0, 7 * m + k * 1.2 * m, 7 * m, 0.6 * m);
    }
    ctx.fillStyle = '#3f6e37'; // street trees
    for (let p = 15 * m; p < SIZE - 10 * m; p += 12 * m) {
      for (const [x, y] of [[p, 9 * m], [p, SIZE - 9 * m], [9 * m, p], [SIZE - 9 * m, p]]) {
        ctx.beginPath();
        ctx.arc(x, y, 1.8 * m, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  },
  concrete(ctx, rnd) {
    ctx.fillStyle = '#a8a49b';
    ctx.fillRect(0, 0, SIZE, SIZE);
    speckle(ctx, rnd, 1500, ['#9c988f', '#b3afa6', '#8f8b83'], 4);
    ctx.fillStyle = 'rgba(0,0,0,0.15)';
    ctx.fillRect(0, 0, SIZE, 4);
    ctx.fillRect(0, 0, 4, SIZE);
  },
  water(ctx, rnd) {
    ctx.fillStyle = '#1d4a63';
    ctx.fillRect(0, 0, SIZE, SIZE);
    ctx.strokeStyle = 'rgba(160,200,220,0.12)';
    ctx.lineWidth = 2;
    for (let i = 0; i < 120; i++) {
      const x = rnd() * SIZE;
      const y = rnd() * SIZE;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.quadraticCurveTo(x + 15, y - 4, x + 30, y);
      ctx.stroke();
    }
  },
  hill(ctx, rnd) {
    ctx.fillStyle = '#3b6533';
    ctx.fillRect(0, 0, SIZE, SIZE);
    speckle(ctx, rnd, 2500, ['#2f5629', '#477a3c', '#56843f', '#2a4a24'], 10);
    speckle(ctx, rnd, 60, ['#7d7a6c'], 14); // rocks
  },
  // 24 m x 8 m: 4 containers of 6 m side by side, 3 high
  container(ctx, rnd) {
    const colors = ['#b5342b', '#2d5fa3', '#d98c1f', '#3d8a52', '#7a7f86', '#e2d7c0', '#5b3a7a', '#1f8a8a'];
    const w = SIZE / 4;
    const h = SIZE / 3;
    for (let row = 0; row < 3; row++) {
      for (let col = 0; col < 4; col++) {
        ctx.fillStyle = colors[Math.floor(rnd() * colors.length)];
        ctx.fillRect(col * w, row * h, w, h);
        ctx.fillStyle = 'rgba(0,0,0,0.18)'; // corrugation
        for (let x = col * w; x < (col + 1) * w; x += 8) ctx.fillRect(x, row * h, 3, h);
        ctx.fillStyle = 'rgba(0,0,0,0.5)';
        ctx.fillRect(col * w, row * h, w, 3);
        ctx.fillRect(col * w, row * h, 3, h);
      }
    }
  },
  crane(ctx) {
    for (let i = 0; i < 4; i++) {
      ctx.fillStyle = i % 2 ? '#f0f0f0' : '#c8322a';
      ctx.fillRect(0, i * 128, SIZE, 128);
    }
    ctx.strokeStyle = 'rgba(0,0,0,0.4)'; // lattice
    ctx.lineWidth = 6;
    for (let x = -SIZE; x < SIZE; x += 64) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x + SIZE, SIZE);
      ctx.stroke();
    }
  },

  // ---- Tram street (tram-demo) ----
  // One tong lau bay: 4 m wide x 3.5 m floor, window with grille, balcony slab, AC unit
  tonglau(ctx, rnd) {
    ctx.fillStyle = '#ece6da';
    ctx.fillRect(0, 0, SIZE, SIZE);
    speckle(ctx, rnd, 400, ['rgba(0,0,0,0.05)', 'rgba(255,255,255,0.08)'], 6);
    const lit = rnd() < 0.3;
    ctx.fillStyle = lit ? '#e8cf8a' : '#2b3540';
    ctx.fillRect(90, 90, 330, 250);
    ctx.fillStyle = '#5b6470'; // window grille
    for (let x = 90; x <= 420; x += 33) ctx.fillRect(x, 90, 4, 250);
    ctx.fillRect(90, 210, 330, 5);
    ctx.fillStyle = rnd() < 0.5 ? '#3f6e8c' : '#7a8b5a'; // half-open shutter / awning
    ctx.fillRect(90, 80, 330, 26);
    ctx.fillStyle = '#c9c2b4'; // balcony slab and railing
    ctx.fillRect(0, 380, SIZE, 30);
    ctx.fillStyle = '#9a9387';
    for (let x = 10; x < SIZE; x += 22) ctx.fillRect(x, 410, 6, 70);
    ctx.fillRect(0, 410, SIZE, 8);
    if (rnd() < 0.7) { ctx.fillStyle = '#f4f4f2'; ctx.fillRect(440, 250, 60, 50); } // AC unit
    if (rnd() < 0.5) { // laundry
      ctx.fillStyle = '#666';
      ctx.fillRect(60, 360, 400, 4);
      for (let x = 80; x < 440; x += 50) { ctx.fillStyle = ['#e44', '#48c', '#fff', '#fc4'][Math.floor(rnd() * 4)]; ctx.fillRect(x, 364, 30, 40); }
    }
    ctx.fillStyle = 'rgba(0,0,0,0.08)'; // rain stains
    for (let i = 0; i < 6; i++) ctx.fillRect(rnd() * SIZE, 410, 8, 102);
  },
  // Ground-floor shop: 4 m x 4.5 m, fascia, lit window, half-open roller shutter
  shopfront(ctx, rnd) {
    ctx.fillStyle = '#2d2f34';
    ctx.fillRect(0, 0, SIZE, SIZE);
    ctx.fillStyle = ['#b91c1c', '#1d4ed8', '#047857', '#a16207', '#6d28d9'][Math.floor(rnd() * 5)];
    ctx.fillRect(0, 30, SIZE, 70); // fascia board
    const g = ctx.createLinearGradient(0, 120, 0, SIZE);
    g.addColorStop(0, '#fde9b0');
    g.addColorStop(1, '#c48a3a');
    ctx.fillStyle = g;
    ctx.fillRect(30, 120, 452, 392);
    speckle(ctx, rnd, 60, ['#a0522d', '#e9d5a1', '#7a4a2a', '#e6e6e6'], 30); // goods on shelves
    ctx.fillStyle = '#9aa0a8'; // roller shutter
    const shutter = 120 + rnd() * 160;
    ctx.fillRect(30, 120, 452, shutter - 120);
    ctx.fillStyle = '#7d838b';
    for (let y = 124; y < shutter; y += 10) ctx.fillRect(30, y, 452, 3);
  },
  // The Pawn: cream veranda bay with a tall shuttered window and balustrade (3.4 m x 3.6 m)
  pawn(ctx, rnd) {
    ctx.fillStyle = '#f3dfa2';
    ctx.fillRect(0, 0, SIZE, SIZE);
    speckle(ctx, rnd, 300, ['rgba(120,80,20,0.06)'], 8);
    ctx.fillStyle = '#7c4a1e'; // cornice
    ctx.fillRect(0, 0, SIZE, 26);
    ctx.fillStyle = '#1e293b';
    ctx.fillRect(140, 70, 232, 330);
    ctx.fillStyle = '#2f6b4f'; // green louvred shutters
    ctx.fillRect(96, 70, 44, 330);
    ctx.fillRect(372, 70, 44, 330);
    ctx.fillStyle = '#fef3c7';
    ctx.fillRect(150, 80, 212, 6);
    ctx.fillStyle = '#e9cf88'; // balustrade
    ctx.fillRect(40, 400, 432, 20);
    for (let x = 50; x < 470; x += 30) ctx.fillRect(x, 420, 14, 70);
    ctx.fillRect(40, 488, 432, 24);
  },
  paving(ctx, rnd) {
    ctx.fillStyle = '#a9a39a';
    ctx.fillRect(0, 0, SIZE, SIZE);
    for (let y = 0; y < SIZE; y += 128) {
      for (let x = 0; x < SIZE; x += 128) {
        const l = 150 + rnd() * 30;
        ctx.fillStyle = `rgb(${l},${l - 6},${l - 14})`;
        ctx.fillRect(x + 3, y + 3, 122, 122);
      }
    }
    speckle(ctx, rnd, 500, ['rgba(0,0,0,0.06)'], 4);
  },
  asphalt(ctx, rnd) {
    ctx.fillStyle = '#34363a';
    ctx.fillRect(0, 0, SIZE, SIZE);
    speckle(ctx, rnd, 3000, ['#2e3034', '#3d3f44', '#2a2b2f'], 3);
    speckle(ctx, rnd, 20, ['rgba(0,0,0,0.25)'], 40); // patches
  },
  // Granite setts between and around the rails
  trackbed(ctx, rnd) {
    ctx.fillStyle = '#55575b';
    ctx.fillRect(0, 0, SIZE, SIZE);
    for (let y = 0; y < SIZE; y += 32) {
      const off = (y / 32) % 2 ? 24 : 0;
      for (let x = -48; x < SIZE; x += 48) {
        const l = 95 + rnd() * 35;
        ctx.fillStyle = `rgb(${l},${l},${l + 4})`;
        ctx.fillRect(x + off + 2, y + 2, 44, 28);
      }
    }
  },
  steel(ctx, rnd) {
    ctx.fillStyle = '#b8bec6';
    ctx.fillRect(0, 0, SIZE, SIZE);
    speckle(ctx, rnd, 200, ['#9aa1aa', '#cfd4da'], 6);
  },
  yellow(ctx) {
    ctx.fillStyle = '#f2c230';
    ctx.fillRect(0, 0, SIZE, SIZE);
  },
  white(ctx) {
    ctx.fillStyle = '#ecebe6';
    ctx.fillRect(0, 0, SIZE, SIZE);
  },
  bark(ctx, rnd) {
    ctx.fillStyle = '#4a2e2b';
    ctx.fillRect(0, 0, SIZE, SIZE);
    for (let i = 0; i < 80; i++) {
      ctx.fillStyle = rnd() < 0.5 ? '#3a2220' : '#5c3a35';
      ctx.fillRect(rnd() * SIZE, 0, 3 + rnd() * 8, SIZE);
    }
  },
  // Sakura blossom: dense pink clusters with lighter and deeper petals
  blossom(ctx, rnd) {
    ctx.fillStyle = '#f4a6c6';
    ctx.fillRect(0, 0, SIZE, SIZE);
    const colors = ['#fce7f3', '#fbcfe8', '#f9a8d4', '#f472b6', '#ec4899', '#ffffff'];
    for (let i = 0; i < 2600; i++) {
      ctx.fillStyle = colors[Math.floor(rnd() * colors.length)];
      ctx.beginPath();
      ctx.arc(rnd() * SIZE, rnd() * SIZE, 2 + rnd() * 6, 0, Math.PI * 2);
      ctx.fill();
    }
    speckle(ctx, rnd, 40, ['#5c3a35'], 6); // twigs showing through
  },
  polegreen(ctx, rnd) {
    ctx.fillStyle = '#0b4d3a';
    ctx.fillRect(0, 0, SIZE, SIZE);
    speckle(ctx, rnd, 300, ['#08402f', '#0f5c46'], 6);
  },
  // Bank of China Tower: blue glass with the white X bracing spanning each 12 m tile
  boc(ctx) {
    const g = ctx.createLinearGradient(0, 0, SIZE, SIZE);
    g.addColorStop(0, '#5aa7d6');
    g.addColorStop(1, '#1f4e79');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, SIZE, SIZE);
    ctx.fillStyle = 'rgba(20,40,70,0.35)';
    for (let y = 0; y < SIZE; y += 16) ctx.fillRect(0, y, SIZE, 2);
    for (let x = 0; x < SIZE; x += 32) ctx.fillRect(x, 0, 2, SIZE);
    ctx.strokeStyle = '#f1f5f9';
    ctx.lineWidth = 14;
    ctx.beginPath();
    ctx.moveTo(0, 0); ctx.lineTo(SIZE, SIZE);
    ctx.moveTo(SIZE, 0); ctx.lineTo(0, SIZE);
    ctx.rect(0, 0, SIZE, SIZE);
    ctx.stroke();
  },
  // Sign atlas (explicit UVs, see tram/signs.ts); painted separately at 1024x1024
  signs() {},
  grass(ctx, rnd) {
    ctx.fillStyle = '#5a9a3a';
    ctx.fillRect(0, 0, SIZE, SIZE);
    const colors = ['#4c8a30', '#6cae45', '#7cc152', '#3f7a2a', '#8fcf63'];
    for (let i = 0; i < 4000; i++) {
      ctx.fillStyle = colors[Math.floor(rnd() * colors.length)];
      ctx.fillRect(rnd() * SIZE, rnd() * SIZE, 2, 4 + rnd() * 8); // blades
    }
  },
};

function residentialTile(ctx: CanvasRenderingContext2D, rnd: () => number, base: string) {
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, SIZE, SIZE);
  speckle(ctx, rnd, 500, ['rgba(0,0,0,0.05)'], 6);
  for (let fy = 0; fy < 4; fy++) { // 4 small floors of 2 m in the tile (HK flats are dense)
    for (let bx = 0; bx < 4; bx++) {
      const x = bx * 128 + 24;
      const y = fy * 128 + 28;
      ctx.fillStyle = rnd() < 0.25 ? '#e9d79a' : '#2b3742'; // some lit windows
      ctx.fillRect(x, y, 56, 62);
      ctx.fillStyle = '#f3f3f3'; // air conditioner box
      if (rnd() < 0.6) ctx.fillRect(x + 64, y + 34, 30, 22);
      ctx.fillStyle = '#777'; // laundry pole
      if (rnd() < 0.3) ctx.fillRect(x - 4, y + 66, 70, 3);
    }
  }
  ctx.fillStyle = 'rgba(0,0,0,0.06)'; // rain stains
  for (let i = 0; i < 12; i++) ctx.fillRect(rnd() * SIZE, 0, 6 + rnd() * 10, SIZE);
}

export function paintCityTexture(name: MaterialName, seed: number): HTMLCanvasElement {
  if (name === 'signs') return paintSignAtlas();
  const [c, ctx] = canvas();
  PAINTERS[name](ctx, mulberry32(seed));
  return c;
}
