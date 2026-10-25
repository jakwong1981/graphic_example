// Neon and shop signs for the tram street, all packed into one 1024x1024 atlas.
// Horizontal signs use 256x128 slots in the top half, vertical signs 128x256 slots in the bottom half.
export interface SignDef {
  text: string;
  sub?: string;
  bg: string;
  border: string;
  fg: string;
  vertical?: boolean;
}

export const SIGNS: SignDef[] = [
  { text: '香港冰室', sub: 'HK CAFE & BAKERY', bg: '#0f172a', border: '#ec4899', fg: '#f472b6' },
  { text: '蘭芳茶餐廳', sub: 'MILK TEA • DIM SUM', bg: '#064e3b', border: '#38bdf8', fg: '#fde047' },
  { text: '和昌大押', bg: '#451a03', border: '#fbbf24', fg: '#fde047' },
  { text: '金都酒樓', sub: 'SEAFOOD RESTAURANT', bg: '#7f1d1d', border: '#fbbf24', fg: '#fef08a' },
  { text: '周大福珠寶', sub: 'JEWELLERY', bg: '#111827', border: '#f59e0b', fg: '#fcd34d' },
  { text: '大藥房', sub: 'PHARMACY', bg: '#0c4a6e', border: '#22d3ee', fg: '#a5f3fc' },
  { text: '新華書局', sub: 'BOOKS', bg: '#14532d', border: '#a3e635', fg: '#d9f99d' },
  { text: '找換店', sub: 'MONEY CHANGER', bg: '#1e1b4b', border: '#f472b6', fg: '#fbcfe8' },
  { text: '押', bg: '#b91c1c', border: '#fde047', fg: '#fff7ed', vertical: true },
  { text: '麻雀耍樂', bg: '#14532d', border: '#4ade80', fg: '#bbf7d0', vertical: true },
  { text: '跌打醫館', bg: '#7c2d12', border: '#fb923c', fg: '#fed7aa', vertical: true },
  { text: '海鮮酒家', bg: '#831843', border: '#f472b6', fg: '#fce7f3', vertical: true },
  { text: '時裝', bg: '#1e3a8a', border: '#60a5fa', fg: '#dbeafe', vertical: true },
  { text: '旅店', bg: '#4c1d95', border: '#c084fc', fg: '#f3e8ff', vertical: true },
];

export const SIGN_ATLAS = 1024;

// Pixel rectangle of a sign in the atlas
export function signSlot(index: number): { x: number; y: number; w: number; h: number } {
  const s = SIGNS[index];
  const k = SIGNS.slice(0, index).filter((o) => !!o.vertical === !!s.vertical).length;
  return s.vertical
    ? { x: (k % 8) * 128, y: 512 + Math.floor(k / 8) * 256, w: 128, h: 256 }
    : { x: (k % 4) * 256, y: Math.floor(k / 4) * 128, w: 256, h: 128 };
}

export function paintSignAtlas(): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = c.height = SIGN_ATLAS;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#1a1a1e'; // also used for sign edges (sampled from the last pixels)
  ctx.fillRect(0, 0, SIGN_ATLAS, SIGN_ATLAS);
  SIGNS.forEach((s, i) => {
    const { x, y, w, h } = signSlot(i);
    ctx.fillStyle = s.bg;
    ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = s.border;
    ctx.lineWidth = 8;
    ctx.strokeRect(x + 8, y + 8, w - 16, h - 16);
    ctx.save();
    ctx.shadowColor = s.fg;
    ctx.shadowBlur = 12;
    ctx.fillStyle = s.fg;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    if (s.vertical) {
      const chars = [...s.text];
      const size = Math.min(80, 200 / chars.length);
      ctx.font = `900 ${size}px "Noto Sans TC", "PingFang HK", sans-serif`;
      chars.forEach((ch, k) => ctx.fillText(ch, x + w / 2, y + h / 2 + (k - (chars.length - 1) / 2) * size * 1.05));
    } else {
      const size = Math.min(64, 220 / [...s.text].length);
      ctx.font = `900 ${size}px "Noto Sans TC", "PingFang HK", sans-serif`;
      ctx.fillText(s.text, x + w / 2, y + (s.sub ? h * 0.42 : h / 2));
      if (s.sub) {
        ctx.font = 'bold 18px sans-serif';
        ctx.fillText(s.sub, x + w / 2, y + h * 0.76);
      }
    }
    ctx.restore();
  });
  return c;
}
