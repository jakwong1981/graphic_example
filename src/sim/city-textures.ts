// Tileable UV textures for the city, painted on canvases. Sizes in metres per tile live in TILE (city.ts).
import { mulberry32 } from './math';

export type MaterialName =
  | 'glass' | 'office' | 'residential' | 'residential2' | 'landmark'
  | 'roof' | 'road' | 'concrete' | 'water' | 'hill' | 'container' | 'crane';

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
  const [c, ctx] = canvas();
  PAINTERS[name](ctx, mulberry32(seed));
  return c;
}
