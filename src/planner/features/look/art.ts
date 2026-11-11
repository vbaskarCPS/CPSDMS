// src/planner/features/look/art.ts — the drawings the looks are made of (looks.ts): small motifs (a leaf, a mushroom,
// a moon), and what is built from them: a wallpaper that repeats, a strip that runs along the top of the screen, the
// edge of the bottom bar, a little scene for the corner, and paper grain. Everything is drawn here as SVG text in the
// look's own colours, so nothing is downloaded and a look costs a few kilobytes. No React (tested in looks.test.ts).

/** A motif, drawn around 0,0 and about 30 across, in up to three colours: main, second, detail. */
type Motif = (a: string, b: string, c: string) => string;
const dots = (pts: [number, number][], r: number, fill: string) => pts.map(([x, y]) => `<circle cx="${x}" cy="${y}" r="${r}" fill="${fill}"/>`).join('');
const ring = (n: number, rad: number, draw: (i: number) => string) => Array.from({ length: n }, (_, i) => `<g transform="rotate(${(360 / n) * i}) translate(0 ${-rad})">${draw(i)}</g>`).join('');
const LEAF = 'M0 -14 C9 -8 9 6 0 14 C-9 6 -9 -8 0 -14Z';
const HEART = 'M0 12 C-16 0 -11 -12 -4 -12 C-1 -12 0 -9 0 -8 C0 -9 1 -12 4 -12 C11 -12 16 0 0 12Z';
const SPARK = 'M0 -14 C1.4 -4 4 -1.4 14 0 C4 1.4 1.4 4 0 14 C-1.4 4 -4 1.4 -14 0 C-4 -1.4 -1.4 -4 0 -14Z';
const STAR = 'M0 -13 L3.6 -4.4 L12.8 -3.6 L5.8 2.4 L8 11.4 L0 6.6 L-8 11.4 L-5.8 2.4 L-12.8 -3.6 L-3.6 -4.4Z';

export const MOTIFS: Record<string, Motif> = {
  leaf: (a, _b, c) => `<path d="${LEAF}" fill="${a}"/><path d="M0 -11V12" stroke="${c}" stroke-width="1.1" fill="none"/>`,
  sprig: (a, _b, c) => `<path d="M0 14 C0 4 2 -6 0 -14" stroke="${c}" stroke-width="1.4" fill="none"/>${[-9, -2, 5].map((y, i) => `<path d="${LEAF}" fill="${a}" transform="translate(${i % 2 ? 5 : -5} ${y}) rotate(${i % 2 ? 55 : -55}) scale(.42)"/>`).join('')}<path d="${LEAF}" fill="${a}" transform="translate(0 -12) scale(.4)"/>`,
  fern: (a, _b, c) => `<path d="M-4 14 C-2 2 2 -6 6 -14" stroke="${c}" stroke-width="1.3" fill="none"/>${[0, 1, 2, 3, 4, 5].map(i => `<path d="${LEAF}" fill="${a}" transform="translate(${-3 + i * 1.7} ${10 - i * 4.4}) rotate(${i % 2 ? 62 : -58}) scale(${0.36 - i * 0.03})"/>`).join('')}`,
  flower: (a, b) => `${ring(5, 6.5, () => `<circle r="5.6" fill="${a}"/>`)}<circle r="4" fill="${b}"/>`,
  daisy: (a, b) => `${ring(10, 8, () => `<ellipse rx="2.6" ry="6" fill="${a}"/>`)}<circle r="4.4" fill="${b}"/>`,
  blossom: (a, b, c) => `${ring(5, 6.5, () => `<path d="M0 -6 C5 -6 6 2 0 6 C-6 2 -5 -6 0 -6Z" fill="${a}"/>`)}<circle r="2.6" fill="${b}"/>${ring(5, 4.6, () => `<circle r=".9" fill="${c}"/>`)}`,
  tulip: (a, b) => `<path d="M0 0 C0 6 1 10 0 15" stroke="${b}" stroke-width="2" fill="none"/><path d="M0 12 C5 10 8 6 8 3 C4 4 1 7 0 12Z" fill="${b}"/><path d="M-7 -12 C-4 -9 -3 -9 0 -14 C3 -9 4 -9 7 -12 C9 -3 6 2 0 2 C-6 2 -9 -3 -7 -12Z" fill="${a}"/>`,
  rose: (a, b, c) => `<path d="${LEAF}" fill="${b}" transform="translate(-10 7) rotate(-60) scale(.55)"/><path d="${LEAF}" fill="${b}" transform="translate(10 7) rotate(60) scale(.55)"/><circle r="10" fill="${a}"/><path d="M-6 0 A6 6 0 1 1 3 5 M-2 -1 A3 3 0 1 1 2 2" stroke="${c}" stroke-width="1.3" fill="none" stroke-linecap="round"/>`,
  lavender: (a, b) => `<path d="M0 15 C0 6 1 0 0 -6" stroke="${b}" stroke-width="1.3" fill="none"/>${[-13, -9.5, -6, -2.5, 1].map((y, i) => `<ellipse cx="${i % 2 ? 2.2 : -2.2}" cy="${y}" rx="2.4" ry="3" fill="${a}"/>`).join('')}`,
  mushroom: (a, b, c) => `<path d="M-4 0 H4 L5.5 11 C5.5 14 -5.5 14 -5.5 11Z" fill="${b}"/><path d="M-13 1 C-13 -15 13 -15 13 1Z" fill="${a}"/>${dots([[-6, -5], [1, -9], [7, -3]], 2, c)}`,
  acorn: (a, b) => `<path d="M-7 -1 C-7 12 7 12 7 -1Z" fill="${a}"/><path d="M-9 -1 C-9 -11 9 -11 9 -1Z" fill="${b}"/><path d="M0 -9 V-13" stroke="${b}" stroke-width="2" stroke-linecap="round"/>`,
  maple: a => `<path d="M0 -14 L3 -6 L10 -9 L7 -1 L13 3 L5 5 L6 12 L0 8 L-6 12 L-5 5 L-13 3 L-7 -1 L-10 -9 L-3 -6Z" fill="${a}"/><path d="M0 8 V15" stroke="${a}" stroke-width="1.6" stroke-linecap="round"/>`,
  pumpkin: (a, b, c) => `<ellipse cx="-6" cy="2" rx="7" ry="10" fill="${a}"/><ellipse cx="6" cy="2" rx="7" ry="10" fill="${a}"/><ellipse cy="2" rx="6" ry="10.5" fill="${c}"/><path d="M0 -8 C0 -12 2 -13 4 -14" stroke="${b}" stroke-width="2.4" fill="none" stroke-linecap="round"/>`,
  star: a => `<path d="${STAR}" fill="${a}"/>`,
  sparkle: a => `<path d="${SPARK}" fill="${a}"/>`,
  moon: a => `<path d="M5 -13 A13 13 0 1 0 5 13 A10.5 10.5 0 1 1 5 -13Z" fill="${a}"/>`,
  sun: (a, b) => `${ring(12, 12, () => `<path d="M-1.4 0 L0 -4 L1.4 0Z" fill="${b}"/>`)}<circle r="8" fill="${a}"/>`,
  cloud: a => `<circle cx="-7" cy="2" r="6" fill="${a}"/><circle cx="1" cy="-3" r="8" fill="${a}"/><circle cx="9" cy="3" r="5" fill="${a}"/><rect x="-12" y="2" width="25" height="6" rx="3" fill="${a}"/>`,
  heart: a => `<path d="${HEART}" fill="${a}"/>`,
  bow: (a, b) => `<path d="M-3 9 L-7 15 M3 9 L7 15" stroke="${a}" stroke-width="3" stroke-linecap="round"/><path d="M0 0 C-6 -10 -15 -9 -14 0 C-15 9 -6 10 0 0Z" fill="${a}"/><path d="M0 0 C6 -10 15 -9 14 0 C15 9 6 10 0 0Z" fill="${a}"/><circle r="3.4" fill="${b}"/>`,
  snow: a => `<g stroke="${a}" stroke-width="1.8" stroke-linecap="round" fill="none">${[0, 60, 120].map(r => `<g transform="rotate(${r})"><path d="M0 -13 V13 M-3.5 -9 L0 -6 L3.5 -9 M-3.5 9 L0 6 L3.5 9"/></g>`).join('')}</g>`,
  holly: (a, b, c) => `${[-1, 1].map(s => `<path d="M0 -13 L3 -9 L7 -9 L5 -4 L9 0 L5 4 L7 9 L3 9 L0 13 L-3 9 L-7 9 L-5 4 L-9 0 L-5 -4 L-7 -9 L-3 -9Z" fill="${a}" transform="translate(${s * 7} 3) rotate(${s * 50}) scale(.72)"/>`).join('')}${dots([[-2.5, -5], [2.5, -5], [0, -9]], 3, b)}<circle cx="-.8" cy="-9.8" r=".9" fill="${c}"/>`,
  pine: (a, b) => `<rect x="-2" y="9" width="4" height="6" fill="${b}"/><path d="M0 -15 L7 -5 H3 L9 3 H4 L11 11 H-11 L-4 3 H-9 L-3 -5 H-7Z" fill="${a}"/>`,
  bauble: (a, b, c) => `<rect x="-2.5" y="-13" width="5" height="4" rx="1" fill="${b}"/><circle cy="1" r="10" fill="${a}"/><path d="M-9.5 -1 Q0 3 9.5 -1" stroke="${c}" stroke-width="1.6" fill="none"/><path d="M-8 5 Q0 9 8 5" stroke="${c}" stroke-width="1.2" fill="none"/>`,
  cane: (a, b) => `<path d="M-4 14 V-5 A6 6 0 0 1 8 -5" stroke="${a}" stroke-width="5" fill="none" stroke-linecap="round"/><path d="M-4 14 V-5 A6 6 0 0 1 8 -5" stroke="${b}" stroke-width="5" fill="none" stroke-dasharray="3.2 4.4" stroke-linecap="butt"/>`,
  candle: (a, b, c) => `<rect x="-4" y="-3" width="8" height="17" rx="1.5" fill="${a}"/><path d="M0 -14 C4 -9 3 -5 0 -4 C-3 -5 -4 -9 0 -14Z" fill="${b}"/><path d="M-4 3 H4" stroke="${c}" stroke-width="1" opacity=".6"/>`,
  book: (a, b, c) => `<rect x="-11" y="-9" width="22" height="18" rx="1.5" fill="${a}"/><rect x="-11" y="-9" width="5" height="18" fill="${b}"/><path d="M-2 -3 H7 M-2 2 H7" stroke="${c}" stroke-width="1.4" stroke-linecap="round"/>`,
  quill: (a, _b, c) => `<path d="M-8 14 C-2 2 4 -8 10 -14 C12 -4 6 6 -4 9Z" fill="${a}"/><path d="M-10 15 C-3 3 3 -6 9 -13" stroke="${c}" stroke-width="1.1" fill="none"/>`,
  key: (a) => `<g stroke="${a}" stroke-width="2.4" fill="none" stroke-linecap="round"><circle cx="-7" cy="-7" r="5"/><path d="M-3.5 -3.5 L10 10 M6 6 L9 3 M9 9 L12 6"/></g>`,
  crystal: (a, b, c) => `<path d="M0 -14 L8 -5 L5 13 H-5 L-8 -5Z" fill="${a}"/><path d="M0 -14 L0 13 M-8 -5 H8" stroke="${c}" stroke-width="1" opacity=".7"/><path d="M0 -14 L8 -5 L0 -5Z" fill="${b}" opacity=".55"/>`,
  moth: (a, b, c) => `<path d="M0 -2 C-6 -12 -15 -10 -14 -2 C-13 3 -6 3 0 1Z" fill="${a}"/><path d="M0 -2 C6 -12 15 -10 14 -2 C13 3 6 3 0 1Z" fill="${a}"/><path d="M0 1 C-5 2 -10 6 -8 11 C-4 12 -1 7 0 4Z" fill="${b}"/><path d="M0 1 C5 2 10 6 8 11 C4 12 1 7 0 4Z" fill="${b}"/><ellipse rx="1.7" ry="7" cy="2" fill="${c}"/>${dots([[-8, -4], [8, -4]], 1.8, c)}`,
  butterfly: (a, b, c) => `<ellipse cx="-7" cy="-4" rx="7" ry="8" fill="${a}" transform="rotate(-20 -7 -4)"/><ellipse cx="7" cy="-4" rx="7" ry="8" fill="${a}" transform="rotate(20 7 -4)"/><ellipse cx="-5" cy="7" rx="5" ry="5.5" fill="${b}"/><ellipse cx="5" cy="7" rx="5" ry="5.5" fill="${b}"/><ellipse rx="1.6" ry="9" fill="${c}"/>`,
  bunny: (a, b, c) => `<ellipse cx="-5" cy="-9" rx="3.4" ry="8" fill="${a}"/><ellipse cx="5" cy="-9" rx="3.4" ry="8" fill="${a}"/><ellipse cx="-5" cy="-9" rx="1.5" ry="5.5" fill="${b}"/><ellipse cx="5" cy="-9" rx="1.5" ry="5.5" fill="${b}"/><circle cy="5" r="10" fill="${a}"/>${dots([[-4, 3], [4, 3]], 1.4, c)}<path d="M-1.5 7 Q0 9 1.5 7" stroke="${c}" stroke-width="1.1" fill="none" stroke-linecap="round"/>`,
  fox: (a, b, c) => `<path d="M-12 -12 L-4 -5 H4 L12 -12 L11 2 C9 11 3 14 0 14 C-3 14 -9 11 -11 2Z" fill="${a}"/><path d="M-11 2 C-7 4 -3 8 0 14 C3 8 7 4 11 2 C9 11 3 14 0 14 C-3 14 -9 11 -11 2Z" fill="${b}"/>${dots([[-5, 1], [5, 1]], 1.5, c)}<circle cy="12" r="1.8" fill="${c}"/>`,
  mouse: (a, b, c) => `<circle cx="-8" cy="-7" r="6" fill="${a}"/><circle cx="8" cy="-7" r="6" fill="${a}"/><circle cx="-8" cy="-7" r="3.2" fill="${b}"/><circle cx="8" cy="-7" r="3.2" fill="${b}"/><path d="M-10 0 C-10 -8 10 -8 10 0 C10 8 4 13 0 13 C-4 13 -10 8 -10 0Z" fill="${a}"/>${dots([[-4, 0], [4, 0]], 1.4, c)}<circle cy="11" r="1.7" fill="${b}"/>`,
  cat: (a, b) => `<path d="M-11 -13 L-4 -7 H4 L11 -13 L11 4 C11 10 6 13 0 13 C-6 13 -11 10 -11 4Z" fill="${a}"/><ellipse cx="-4.5" cy="1" rx="2.2" ry="3" fill="${b}"/><ellipse cx="4.5" cy="1" rx="2.2" ry="3" fill="${b}"/><path d="M-1.2 6 H1.2 L0 7.6Z" fill="${b}"/>`,
  ghost: (a, _b, c) => `<path d="M-9 13 V-3 C-9 -17 9 -17 9 -3 V13 L5.5 9.5 L2 13 L-2 9.5 L-5.5 13Z" fill="${a}"/>${dots([[-3.5, -4], [3.5, -4]], 1.8, c)}<ellipse cy="2" rx="1.8" ry="2.6" fill="${c}"/>`,
  bat: a => `<path d="M0 -3 C-4 -9 -11 -9 -15 -5 C-11 -5 -11 -1 -12 2 C-9 0 -6 1 -5 4 C-3 2 -1 2 0 4 C1 2 3 2 5 4 C6 1 9 0 12 2 C11 -1 11 -5 15 -5 C11 -9 4 -9 0 -3Z" fill="${a}"/><path d="M-3 -4 L-2 -8 L0 -5 L2 -8 L3 -4Z" fill="${a}"/>`,
  bird: (a, b, c) => `<path d="M-12 2 C-12 -8 2 -10 7 -3 L13 -5 L9 0 C9 9 -3 11 -8 6 L-14 9Z" fill="${a}"/><path d="M-6 0 C-1 -2 4 1 4 5 C0 7 -5 5 -6 0Z" fill="${b}"/><circle cx="6" cy="-3" r="1.1" fill="${c}"/>`,
  cottage: (a, b, c) => `<rect x="-10" y="-1" width="20" height="14" fill="${a}"/><path d="M-13 0 L0 -13 L13 0Z" fill="${b}"/><rect x="5" y="-12" width="4" height="7" fill="${b}"/><rect x="-2.5" y="5" width="5" height="8" rx="2.4" fill="${c}"/><rect x="-8" y="3" width="4" height="4" fill="${c}" opacity=".7"/>`,
  teacup: (a, b, c) => `<ellipse cy="11" rx="12" ry="2.6" fill="${b}"/><path d="M-9 -4 H9 C9 6 5 10 0 10 C-5 10 -9 6 -9 -4Z" fill="${a}"/><path d="M9 -2 C15 -3 15 6 7 6" stroke="${a}" stroke-width="2.2" fill="none"/><circle cx="-2" cy="2" r="2.2" fill="${c}"/><path d="M-3 -8 C-5 -11 -1 -12 -3 -15 M3 -8 C1 -11 5 -12 3 -15" stroke="${b}" stroke-width="1.1" fill="none" stroke-linecap="round"/>`,
  shell: (a, _b, c) => `<path d="M0 12 C-16 8 -15 -10 0 -12 C15 -10 16 8 0 12Z" fill="${a}"/><path d="M0 12 V-12 M0 12 C-5 4 -8 -4 -8 -9 M0 12 C5 4 8 -4 8 -9 M0 12 C-9 6 -13 0 -13 -3 M0 12 C9 6 13 0 13 -3" stroke="${c}" stroke-width="1" fill="none" opacity=".75"/>`,
  starfish: a => `<path d="${STAR}" fill="${a}" stroke="${a}" stroke-width="3" stroke-linejoin="round"/>`,
  lemon: (a, b, c) => `<path d="${LEAF}" fill="${b}" transform="translate(8 -9) rotate(50) scale(.6)"/><path d="M-12 2 C-10 -8 6 -11 11 -3 L14 -4 L12 0 C12 9 -4 13 -10 6 L-14 6Z" fill="${a}"/><path d="M-6 -3 C-3 -6 2 -6 5 -4" stroke="${c}" stroke-width="1.2" fill="none" stroke-linecap="round" opacity=".7"/>`,
  olive: (a, b, c) => `<path d="M-13 8 C-4 4 6 -4 13 -12" stroke="${c}" stroke-width="1.3" fill="none"/>${[[-8, 3, -30], [-2, 2, 40], [3, -4, -25], [8, -5, 45]].map(([x, y, r]) => `<path d="${LEAF}" fill="${a}" transform="translate(${x} ${y}) rotate(${r}) scale(.36 .5)"/>`).join('')}${dots([[-4, 8], [6, 2]], 3, b)}`,
  cherries: (a, b) => `<path d="M-6 6 C-6 -4 0 -10 6 -12 C4 -6 6 0 7 5" stroke="${b}" stroke-width="1.5" fill="none"/><path d="${LEAF}" fill="${b}" transform="translate(9 -11) rotate(70) scale(.4)"/><circle cx="-6" cy="8" r="5.5" fill="${a}"/><circle cx="7" cy="8" r="5.5" fill="${a}"/>`,
  rainbow: (a, b, c) => `<g fill="none" stroke-linecap="butt"><path d="M-13 9 A13 13 0 0 1 13 9" stroke="${a}" stroke-width="4"/><path d="M-9 9 A9 9 0 0 1 9 9" stroke="${b}" stroke-width="4"/><path d="M-5 9 A5 5 0 0 1 5 9" stroke="${c}" stroke-width="4"/></g>`,
  crane: (a, b) => `<path d="M-14 -2 L-2 -4 L2 -13 L4 -3 L14 -8 L6 3 L10 12 L0 5 L-8 10 L-4 2Z" fill="${a}"/><path d="M-2 -4 L4 -3 L0 5 L-4 2Z" fill="${b}" opacity=".55"/>`,
  fan: (a, b, c) => `<path d="M0 12 L-14 -4 A19 19 0 0 1 14 -4Z" fill="${a}"/><path d="M0 12 L-8 -9 M0 12 L0 -11 M0 12 L8 -9" stroke="${c}" stroke-width="1" opacity=".7"/><circle cy="12" r="2" fill="${b}"/>`,
  laurel: (a, _b, c) => `${[-1, 1].map(s => `<g transform="scale(${s} 1)"><path d="M-2 13 C-12 9 -13 -4 -6 -12" stroke="${c}" stroke-width="1.1" fill="none"/>${[0, 1, 2, 3].map(i => `<path d="${LEAF}" fill="${a}" transform="translate(${-9 - (i === 3 ? -2 : i === 0 ? -3 : 1)} ${8 - i * 6.2}) rotate(${-35 + i * 14}) scale(.3 .42)"/>`).join('')}</g>`).join('')}`,
  cameo: (a, b, c) => `<ellipse rx="10" ry="13" fill="${a}"/><ellipse rx="7.4" ry="10.4" fill="${b}"/><path d="M-1 -6 C4 -6 4 0 1 1 C5 3 5 8 0 8 C-3 8 -4 5 -3 3 C-5 1 -4 -5 -1 -6Z" fill="${c}"/>`,
  berry: (a, b) => `<path d="M0 14 C0 4 -1 -2 -6 -8 M0 4 C2 -2 5 -5 9 -7" stroke="${b}" stroke-width="1.2" fill="none"/>${dots([[-6, -10], [9, -9], [1, -5], [-9, -3]], 3, a)}`,
  wheat: (a, _b, c) => `<path d="M0 15 V-4" stroke="${c}" stroke-width="1.2"/>${[-12, -8, -4, 0].map((y, i) => `<path d="${LEAF}" fill="${a}" transform="translate(-3 ${y + 2}) rotate(-28) scale(.22 .34)"/><path d="${LEAF}" fill="${a}" transform="translate(3 ${y + 2}) rotate(28) scale(.22 .34)"/>${i ? '' : `<path d="${LEAF}" fill="${a}" transform="translate(0 -13) scale(.22 .34)"/>`}`).join('')}`,
  dot: a => `<circle r="4" fill="${a}"/>`,
};
export type MotifId = keyof typeof MOTIFS;

const svg = (w: number, h: number, body: string) => `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${body}</svg>`;
/** An SVG as something CSS can use for a background. */
export const cssUrl = (svgText: string): string => `url("data:image/svg+xml,${encodeURIComponent(svgText).replace(/'/g, '%27').replace(/"/g, '%22')}")`;
const at = (m: string, x: number, y: number, rot = 0, scale = 1, opacity = 1) => `<g transform="translate(${+x.toFixed(1)} ${+y.toFixed(1)}) rotate(${Math.round(rot)}) scale(${+scale.toFixed(2)})"${opacity < 1 ? ` opacity="${opacity}"` : ''}>${m}</g>`;
/** The same "random" numbers every time, so a look's wallpaper doesn't change between visits. */
const dice = (seed: number) => () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
const draw = (id: string, colors: string[], i: number): string => (MOTIFS[id] || MOTIFS.dot)(colors[i % colors.length], colors[(i + 1) % colors.length], colors[(i + 2) % colors.length]);

export interface Tile { svg: string; size: number }
/** How a wallpaper is described in a look: a kind, and what it needs. */
export type Wallpaper =
  | { kind: 'scatter'; motifs: string[]; across?: number; size?: number; turn?: number; scale?: number }   // little drawings strewn about
  | { kind: 'gingham' | 'plaid' | 'stripes' | 'dots' | 'grid' | 'trellis' | 'waves' | 'arches' | 'tiles' | 'stars' | 'wash' | 'none'; size?: number };

/** One tile of a wallpaper in these colours. It repeats without a seam. */
export function wallpaper(w: Wallpaper, colors: string[]): Tile {
  const c = (i: number) => colors[i % colors.length];
  switch (w.kind) {
    case 'scatter': {
      const n = w.across || 3, size = w.size || 168, cell = size / n, rnd = dice(n * 7919 + w.motifs.join('').length * 104729);
      let out = '', k = 0;
      for (let row = 0; row < n; row++) for (let col = 0; col < n; col++, k++) {
        const jx = (rnd() - 0.5) * cell * 0.34, jy = (rnd() - 0.5) * cell * 0.34;
        out += at(draw(w.motifs[(k + row) % w.motifs.length], colors, k + row), (col + 0.5) * cell + jx, (row + 0.5) * cell + jy, (rnd() - 0.5) * 2 * (w.turn ?? 28), (w.scale || 1) * (0.78 + rnd() * 0.34));
      }
      return { svg: svg(size, size, out), size };
    }
    case 'gingham': { const s = w.size || 28, h = s / 2; return { svg: svg(s, s, `<rect width="${h}" height="${s}" fill="${c(0)}" opacity=".5"/><rect width="${s}" height="${h}" fill="${c(0)}" opacity=".5"/>`), size: s }; }
    case 'plaid': { const s = w.size || 72; return { svg: svg(s, s, `<rect width="${s}" height="${s * 0.34}" fill="${c(0)}" opacity=".42"/><rect width="${s * 0.34}" height="${s}" fill="${c(0)}" opacity=".42"/><rect y="${s * 0.56}" width="${s}" height="${s * 0.1}" fill="${c(1)}" opacity=".5"/><rect x="${s * 0.56}" width="${s * 0.1}" height="${s}" fill="${c(1)}" opacity=".5"/><path d="M0 ${s * 0.84} H${s} M${s * 0.84} 0 V${s}" stroke="${c(2)}" stroke-width="1.6" opacity=".7"/>`), size: s }; }
    case 'stripes': { const s = w.size || 36; return { svg: svg(s, s, `<rect width="${s / 2}" height="${s}" fill="${c(0)}" opacity=".45"/><rect x="${s * 0.7}" width="${s * 0.08}" height="${s}" fill="${c(1)}" opacity=".55"/>`), size: s }; }
    case 'dots': { const s = w.size || 34; return { svg: svg(s, s, `<circle cx="${s / 4}" cy="${s / 4}" r="${s * 0.09}" fill="${c(0)}"/><circle cx="${s * 0.75}" cy="${s * 0.75}" r="${s * 0.09}" fill="${c(1)}"/>`), size: s }; }
    case 'grid': { const s = w.size || 22; return { svg: svg(s, s, `<path d="M${s} 0 V${s} H0" stroke="${c(0)}" stroke-width="1" fill="none" opacity=".7"/>`), size: s }; }
    case 'trellis': { const s = w.size || 46, h = s / 2; return { svg: svg(s, s, `<path d="M0 ${h} L${h} 0 L${s} ${h} L${h} ${s}Z" fill="none" stroke="${c(0)}" stroke-width="1.2"/><circle cx="${h}" cy="${h}" r="2.2" fill="${c(1)}"/><circle r="2.2" fill="${c(1)}"/><circle cx="${s}" r="2.2" fill="${c(1)}"/><circle cy="${s}" r="2.2" fill="${c(1)}"/><circle cx="${s}" cy="${s}" r="2.2" fill="${c(1)}"/>`), size: s }; }
    case 'waves': { const s = w.size || 44, h = s / 2; const arcs = (cx: number, cy: number) => [1, 0.68, 0.36].map((k, i) => `<circle cx="${cx}" cy="${cy}" r="${+(h * k).toFixed(1)}" fill="${i === 1 ? c(2) : 'none'}" fill-opacity=".0" stroke="${c(i === 2 ? 1 : 0)}" stroke-width="1.4"/>`).join(''); return { svg: svg(s, h, `${arcs(0, h)}${arcs(s, h)}${arcs(h, h * 2)}${arcs(h, 0)}`), size: s }; }
    case 'arches': { const s = w.size || 84, h = s / 2; const arch = (cx: number, cy: number) => [0.46, 0.34, 0.22].map((k, i) => `<path d="M${cx - s * k} ${cy} A${s * k} ${s * k} 0 0 1 ${cx + s * k} ${cy}" stroke="${c(i)}" stroke-width="${s * 0.085}" fill="none"/>`).join(''); return { svg: svg(s, s, `${arch(h, h)}${arch(0, s)}${arch(s, s)}`), size: s }; }
    case 'tiles': { const s = w.size || 56, h = s / 2; const petal = `<path d="M0 0 C${h * 0.5} ${-h * 0.3} ${h * 0.5} ${-h * 0.9} 0 ${-h} C${-h * 0.5} ${-h * 0.9} ${-h * 0.5} ${-h * 0.3} 0 0Z" fill="${c(0)}"/>`; return { svg: svg(s, s, `<rect width="${s}" height="${s}" fill="none" stroke="${c(1)}" stroke-width="1.4"/><g transform="translate(${h} ${h})">${[0, 90, 180, 270].map(r => `<g transform="rotate(${r})">${petal}</g>`).join('')}<circle r="${h * 0.16}" fill="${c(2)}"/></g>${[[0, 0], [s, 0], [0, s], [s, s]].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="${h * 0.22}" fill="${c(2)}"/>`).join('')}`), size: s }; }
    case 'stars': { const s = w.size || 150, rnd = dice(4242); let out = ''; for (let i = 0; i < 16; i++) { const x = rnd() * s, y = rnd() * s, big = i % 5 === 0; out += big ? at(MOTIFS.sparkle(c(0), '', ''), 12 + x * 0.84, 12 + y * 0.84, 0, 0.5 + rnd() * 0.3) : `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${(0.7 + rnd() * 1.1).toFixed(1)}" fill="${c(i)}"/>`; } return { svg: svg(s, s, `${out}<path d="M24 40 L52 28 L74 46 L98 30 M74 46 L80 78 L112 92" stroke="${c(1)}" stroke-width=".8" fill="none" opacity=".6"/>${dots([[24, 40], [52, 28], [74, 46], [98, 30], [80, 78], [112, 92]], 1.8, c(0))}`), size: s }; }
    case 'wash': { const s = w.size || 260; return { svg: svg(s, s, `<defs><filter id="b" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="16"/></filter></defs><g filter="url(#b)" opacity=".8">${[[60, 60, 46, 0], [190, 90, 54, 1], [110, 190, 50, 2], [230, 230, 40, 3], [10, 220, 36, 3], [230, -10, 36, 3], [10, -30, 36, 3]].map(([x, y, r, i]) => `<circle cx="${x}" cy="${y}" r="${r}" fill="${c(i)}"/>`).join('')}</g>`), size: s }; }
    default: return { svg: '', size: 0 };
  }
}

/** Paper grain to lay under a wallpaper: `ink` is the colour of the specks, `amount` how strong (0 to 1). */
export function grain(ink: string, amount = 0.5): Tile {
  const s = 180;
  return { svg: svg(s, s, `<defs><filter id="n" x="0" y="0" width="100%" height="100%"><feTurbulence type="fractalNoise" baseFrequency=".9" numOctaves="2" seed="7" stitchTiles="stitch"/><feColorMatrix values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 ${(0.9 * amount).toFixed(2)} 0"/><feComposite in2="SourceGraphic" operator="in"/></filter></defs><rect width="${s}" height="${s}" fill="${ink}" filter="url(#n)"/>`), size: s };
}

/** The strip along the top of the screen (it repeats sideways). */
export type TopEdge = 'scallop' | 'bunting' | 'garland' | 'stars' | 'vine' | 'zigzag' | 'lace' | 'icicles' | 'none';
export function topEdge(kind: TopEdge, colors: string[], motif?: string): { svg: string; w: number; h: number } {
  const c = (i: number) => colors[i % colors.length];
  switch (kind) {
    case 'scallop': return { w: 28, h: 16, svg: svg(28, 16, `<path d="M0 0 H28 V2 A14 14 0 0 1 0 2Z" fill="${c(0)}"/>`) };
    case 'lace': return { w: 24, h: 18, svg: svg(24, 18, `<path d="M0 0 H24 V4 A12 12 0 0 1 0 4Z" fill="${c(0)}"/><circle cx="12" cy="9" r="2.4" fill="${c(1)}"/><circle cx="4" cy="5" r="1.3" fill="${c(1)}"/><circle cx="20" cy="5" r="1.3" fill="${c(1)}"/>`) };
    case 'bunting': return { w: 96, h: 26, svg: svg(96, 26, `<path d="M0 2 Q48 10 96 2" stroke="${c(3)}" stroke-width="1.2" fill="none"/>${[0, 1, 2, 3].map(i => `<path d="M${i * 24 + 2} ${3 + (i === 1 || i === 2 ? 3.4 : 1.4)} L${i * 24 + 22} ${3 + (i === 1 || i === 2 ? 3.6 : 1.6)} L${i * 24 + 12} ${22 + (i === 1 || i === 2 ? 2 : 0)}Z" fill="${c(i)}"/>`).join('')}`) };
    case 'garland': return { w: 120, h: 30, svg: svg(120, 30, `<path d="M0 4 Q30 16 60 6 Q90 -4 120 4" stroke="${c(0)}" stroke-width="3" fill="none"/>${[10, 34, 60, 86, 108].map((x, i) => at(draw(motif || 'leaf', colors, i), x, 12 + (i % 2 ? -3 : 3), i % 2 ? 150 : 200, 0.55)).join('')}`) };
    case 'stars': return { w: 110, h: 26, svg: svg(110, 26, `${[[12, 9, 0.5], [40, 15, 0.34], [66, 7, 0.42], [92, 14, 0.56]].map(([x, y, s], i) => `<path d="M${x} 0 V${y - 5}" stroke="${c(1)}" stroke-width=".7"/>${at(MOTIFS[i % 2 ? 'star' : 'sparkle'](c(i ? 0 : 2), '', ''), x, y, 0, s)}`).join('')}`) };
    case 'vine': return { w: 120, h: 24, svg: svg(120, 24, `<path d="M0 8 Q30 18 60 8 Q90 -2 120 8" stroke="${c(0)}" stroke-width="1.6" fill="none"/>${[14, 44, 74, 104].map((x, i) => at(MOTIFS.leaf(c(i % 2), '', c(0)), x, i % 2 ? 4 : 14, i % 2 ? -60 : 120, 0.42)).join('')}${[30, 90].map((x, i) => at(draw(motif || 'flower', colors, i + 1), x, i ? 2 : 13, 0, 0.42)).join('')}`) };
    case 'zigzag': return { w: 28, h: 14, svg: svg(28, 14, `<path d="M0 0 H28 L14 12Z" fill="${c(0)}"/><path d="M0 0 L14 12 L28 0" stroke="${c(1)}" stroke-width="2" fill="none"/>`) };
    case 'icicles': return { w: 60, h: 30, svg: svg(60, 30, `<path d="M0 0 H60 V3 C56 3 56 26 52 26 C48 26 49 5 44 5 C39 5 40 16 36 16 C32 16 33 4 28 4 C22 4 24 29 19 29 C14 29 16 6 11 6 C6 6 7 14 4 14 C1 14 2 3 0 3Z" fill="${c(0)}"/>`) };
    default: return { w: 0, h: 0, svg: '' };
  }
}

/** The bottom bar's upper edge, cut into a shape: drawn in the bar's colour with the bar's line along it. */
export type BarEdge = 'scallop' | 'zigzag' | 'wave' | 'none';
export function barEdge(kind: BarEdge, fill: string, line: string): { svg: string; w: number; h: number } {
  switch (kind) {
    case 'scallop': return { w: 22, h: 9, svg: svg(22, 9, `<path d="M0 9 A11 9 0 0 1 22 9Z" fill="${fill}"/><path d="M0 9 A11 9 0 0 1 22 9" fill="none" stroke="${line}" stroke-width="1"/>`) };
    case 'zigzag': return { w: 18, h: 8, svg: svg(18, 8, `<path d="M0 8 L9 0 L18 8Z" fill="${fill}"/><path d="M0 8 L9 0 L18 8" fill="none" stroke="${line}" stroke-width="1"/>`) };
    case 'wave': return { w: 44, h: 8, svg: svg(44, 8, `<path d="M0 8 V5 Q11 -3 22 5 T44 5 V8Z" fill="${fill}"/><path d="M0 5 Q11 -3 22 5 T44 5" fill="none" stroke="${line}" stroke-width="1"/>`) };
    default: return { w: 0, h: 0, svg: '' };
  }
}

/** A little scene for the corner of the screen: three motifs, one big, on a patch of ground. */
export function corner(motifs: string[], colors: string[], ground?: string): { svg: string; w: number; h: number } {
  if (!motifs.length) return { svg: '', w: 0, h: 0 };
  const [big, mid = big, small = mid, extra] = motifs;
  return { w: 170, h: 120, svg: svg(170, 120, `${ground ? `<ellipse cx="90" cy="106" rx="78" ry="10" fill="${ground}" opacity=".5"/>` : ''}${at(draw(mid, colors, 1), 44, 78, -8, 1.7)}${at(draw(big, colors, 0), 104, 60, 4, 2.9)}${at(draw(small, colors, 2), 146, 92, 10, 1.15)}${extra ? at(draw(extra, colors, 3), 16, 98, -14, 0.9) : ''}`) };
}
