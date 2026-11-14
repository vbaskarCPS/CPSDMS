// src/planner/features/look/art.ts — the drawings the looks are made of (looks.ts): small motifs (a leaf, a mushroom,
// a moon), and what is built from them: a wallpaper that repeats, a strip that runs along the top of the screen, the
// edge of the bottom bar, a little scene for the corner, and paper grain. Everything is drawn here as SVG text in the
// look's own colours, so nothing is downloaded and a look costs a few kilobytes. No React (tested in looks.test.ts).

/** A motif, drawn around 0,0 and about 30 across, in up to three colours: main, second, detail. */
type Motif = (a: string, b: string, c: string) => string;
const dots = (pts: [number, number][], r: number, fill: string) => pts.map(([x, y]) => `<circle cx="${x}" cy="${y}" r="${r}" fill="${fill}"/>`).join('');
const ring = (n: number, rad: number, draw: (i: number) => string) => Array.from({ length: n }, (_, i) => `<g transform="rotate(${(360 / n) * i}) translate(0 ${-rad})">${draw(i)}</g>`).join('');
/** The same shape on the left and on the right. */
const both = (draw: (side: -1 | 1) => string) => `<g>${draw(1)}</g><g transform="scale(-1 1)">${draw(1)}</g>`;
const LEAF = 'M0 -14 C9 -8 9 6 0 14 C-9 6 -9 -8 0 -14Z';
/** A small leaf that grows up from 0,0 (so it can be set on a stem and turned). */
const LEAFLET = 'M0 0 C3.4 -2.5 3.4 -8 0 -11 C-3.4 -8 -3.4 -2.5 0 0Z';
const HEART = 'M0 12 C-16 0 -11 -12 -4 -12 C-1 -12 0 -9 0 -8 C0 -9 1 -12 4 -12 C11 -12 16 0 0 12Z';
const SPARK = 'M0 -14 C1.4 -4 4 -1.4 14 0 C4 1.4 1.4 4 0 14 C-1.4 4 -4 1.4 -14 0 C-4 -1.4 -1.4 -4 0 -14Z';
const STAR = 'M0 -13 L3.6 -4.4 L12.8 -3.6 L5.8 2.4 L8 11.4 L0 6.6 L-8 11.4 L-5.8 2.4 L-12.8 -3.6 L-3.6 -4.4Z';
const HOLLY = 'M0 -12 C1 -9 2 -8 5 -9 C4 -6 4 -4 7 -3 C5 -1 5 1 7 3 C4 4 4 6 5 9 C2 8 1 9 0 12 C-1 9 -2 8 -5 9 C-4 6 -4 4 -7 3 C-5 1 -5 -1 -7 -3 C-4 -4 -4 -6 -5 -9 C-2 -8 -1 -9 0 -12Z';

export const MOTIFS: Record<string, Motif> = {
  // ── leaves and flowers ──
  leaf: (a, _b, c) => `<path d="${LEAF}" fill="${a}"/><path d="M0 -11V12" stroke="${c}" stroke-width="1.1" fill="none"/>`,
  sprig: (a, _b, c) => `<path d="M0 14 C0 4 2 -6 0 -14" stroke="${c}" stroke-width="1.4" fill="none"/>${[-9, -2, 5].map((y, i) => `<path d="${LEAF}" fill="${a}" transform="translate(${i % 2 ? 5 : -5} ${y}) rotate(${i % 2 ? 55 : -55}) scale(.42)"/>`).join('')}<path d="${LEAF}" fill="${a}" transform="translate(0 -12) scale(.4)"/>`,
  fern: (a, _b, c) => `<path d="M-3 14 C-1.5 6 0 -4 3 -14" stroke="${c}" stroke-width="1.2" fill="none" stroke-linecap="round"/>${[0, 1, 2, 3, 4, 5].map(i => { const x = +(-2.3 + i * 0.86).toFixed(1), y = +(10 - i * 4.3).toFixed(1), k = +(1 - i * 0.13).toFixed(2); return `<path d="${LEAFLET}" fill="${a}" transform="translate(${x} ${y}) rotate(-64) scale(${k})"/><path d="${LEAFLET}" fill="${a}" transform="translate(${x} ${y}) rotate(72) scale(${k})"/>`; }).join('')}<path d="${LEAFLET}" fill="${a}" transform="translate(2.6 -11.5) rotate(10) scale(.4)"/>`,
  flower: (a, b) => `${ring(5, 6.5, () => `<circle r="5.6" fill="${a}"/>`)}<circle r="4" fill="${b}"/>`,
  daisy: (a, b) => `${ring(10, 8, () => `<ellipse rx="2.6" ry="6" fill="${a}"/>`)}<circle r="4.4" fill="${b}"/>`,
  blossom: (a, b, c) => `${ring(5, 6.5, () => `<path d="M0 -6 C5 -6 6 2 0 6 C-6 2 -5 -6 0 -6Z" fill="${a}"/>`)}<circle r="2.6" fill="${b}"/>${ring(5, 4.6, () => `<circle r=".9" fill="${c}"/>`)}`,
  tulip: (a, b) => `<path d="M0 0 C0 6 1 10 0 15" stroke="${b}" stroke-width="2" fill="none"/><path d="M0 12 C5 10 8 6 8 3 C4 4 1 7 0 12Z" fill="${b}"/><path d="M-7 -12 C-4 -9 -3 -9 0 -14 C3 -9 4 -9 7 -12 C9 -3 6 2 0 2 C-6 2 -9 -3 -7 -12Z" fill="${a}"/>`,
  rose: (a, b, c) => `<path d="${LEAF}" fill="${b}" transform="translate(-10 7) rotate(-60) scale(.55)"/><path d="${LEAF}" fill="${b}" transform="translate(10 7) rotate(60) scale(.55)"/><circle r="10.5" fill="${a}"/><circle cx="1" cy="-1" r="7.2" fill="${c}" opacity=".2"/><circle cx="-.6" cy=".6" r="4.4" fill="${c}" opacity=".26"/><path d="M-7.5 2.5 A8 8 0 0 1 4 -7 M7.6 -1.5 A8 8 0 0 1 -3 7.4 M-2.2 0 A2.3 2.3 0 1 1 1.6 1.7" stroke="${c}" stroke-width="1.1" fill="none" stroke-linecap="round" opacity=".7"/>`,
  lavender: (a, b) => `<path d="M0 15 C0 6 1 0 0 -6" stroke="${b}" stroke-width="1.3" fill="none"/>${[-13, -9.5, -6, -2.5, 1].map((y, i) => `<ellipse cx="${i % 2 ? 2.2 : -2.2}" cy="${y}" rx="2.4" ry="3" fill="${a}"/>`).join('')}`,
  berry: (a, b) => `<path d="M0 14 C0 4 -1 -2 -6 -8 M0 4 C2 -2 5 -5 9 -7" stroke="${b}" stroke-width="1.2" fill="none"/>${dots([[-6, -10], [9, -9], [1, -5], [-9, -3]], 3, a)}`,
  wheat: (a, _b, c) => `<path d="M0 15 V-4" stroke="${c}" stroke-width="1.2"/>${[-12, -8, -4, 0].map((y, i) => `<path d="${LEAF}" fill="${a}" transform="translate(-3 ${y + 2}) rotate(-28) scale(.22 .34)"/><path d="${LEAF}" fill="${a}" transform="translate(3 ${y + 2}) rotate(28) scale(.22 .34)"/>${i ? '' : `<path d="${LEAF}" fill="${a}" transform="translate(0 -13) scale(.22 .34)"/>`}`).join('')}`,
  laurel: (a, _b, c) => `${[-1, 1].map(s => `<g transform="scale(${s} 1)"><path d="M-2 13 C-12 9 -13 -4 -6 -12" stroke="${c}" stroke-width="1.1" fill="none"/>${[0, 1, 2, 3].map(i => `<path d="${LEAF}" fill="${a}" transform="translate(${-9 - (i === 3 ? -2 : i === 0 ? -3 : 1)} ${8 - i * 6.2}) rotate(${-35 + i * 14}) scale(.3 .42)"/>`).join('')}</g>`).join('')}`,
  olive: (a, b, c) => `<path d="M-13 8 C-4 4 6 -4 13 -12" stroke="${c}" stroke-width="1.3" fill="none"/>${[[-8, 3, -30], [-2, 2, 40], [3, -4, -25], [8, -5, 45]].map(([x, y, r]) => `<path d="${LEAF}" fill="${a}" transform="translate(${x} ${y}) rotate(${r}) scale(.36 .5)"/>`).join('')}${dots([[-4, 8], [6, 2]], 3, b)}`,
  pot: (a, b, c) => `<path d="${LEAF}" fill="${a}" transform="translate(-6 -3.5) rotate(-38) scale(.5)"/><path d="${LEAF}" fill="${a}" transform="translate(6 -3.5) rotate(38) scale(.5)"/><path d="${LEAF}" fill="${a}" transform="translate(0 -7) scale(.56)"/><path d="M0 -13 V1" stroke="${c}" stroke-width=".9" opacity=".6"/><path d="M-7 3 H7 L5.6 13 H-5.6Z" fill="${b}"/><rect x="-8.5" y="0.5" width="17" height="3.6" rx="1" fill="${b}"/><path d="M-8.5 4.1 H8.5" stroke="${c}" stroke-width=".8" opacity=".35"/>`,
  // ── woods and seasons ──
  mushroom: (a, b, c) => `<path d="M-4 0 H4 L5.5 11 C5.5 14 -5.5 14 -5.5 11Z" fill="${b}"/><path d="M-13 1 C-13 -15 13 -15 13 1Z" fill="${a}"/>${dots([[-6, -5], [1, -9], [7, -3]], 2, c)}`,
  acorn: (a, b) => `<path d="M-7 -1 C-7 12 7 12 7 -1Z" fill="${a}"/><path d="M-9 -1 C-9 -11 9 -11 9 -1Z" fill="${b}"/><path d="M0 -9 V-13" stroke="${b}" stroke-width="2" stroke-linecap="round"/>`,
  maple: (a, _b, c) => `<path d="M0 -14 L2.2 -9.5 L5 -11 L4.6 -6 L11 -8.5 L9 -3.5 L13.5 -1.5 L8.5 2 L10.5 7.5 L4.5 6 L1 6.8 L1 13.5 H-1 L-1 6.8 L-4.5 6 L-10.5 7.5 L-8.5 2 L-13.5 -1.5 L-9 -3.5 L-11 -8.5 L-4.6 -6 L-5 -11 L-2.2 -9.5Z" fill="${a}" stroke="${a}" stroke-width="1" stroke-linejoin="round"/><path d="M0 6 V-9 M0 2 L7.5 -3.5 M0 2 L-7.5 -3.5" stroke="${c}" stroke-width=".9" fill="none" opacity=".4" stroke-linecap="round"/>`,
  pumpkin: (a, b, c) => `<ellipse cx="-5.6" cy="2.5" rx="7.6" ry="9.6" fill="${a}"/><ellipse cx="5.6" cy="2.5" rx="7.6" ry="9.6" fill="${a}"/><ellipse cy="2.5" rx="6" ry="10.3" fill="${a}"/><path d="M-3.6 -7 C-7.5 -2 -7.5 8 -3.6 12.4 M3.6 -7 C7.5 -2 7.5 8 3.6 12.4 M0 -7.6 V12.8" stroke="${c}" stroke-width="1" fill="none" opacity=".32" stroke-linecap="round"/><path d="M-1.6 -7.4 C-1.6 -11 0 -13 3.2 -14.2 L4.6 -11.6 C2.6 -11 1.8 -10 1.8 -7.4Z" fill="${b}"/>`,
  pine: (a, b) => `<rect x="-2" y="9" width="4" height="6" fill="${b}"/><path d="M0 -15 L7 -5 H3 L9 3 H4 L11 11 H-11 L-4 3 H-9 L-3 -5 H-7Z" fill="${a}"/>`,
  snow: a => `<g stroke="${a}" stroke-width="1.8" stroke-linecap="round" fill="none">${[0, 60, 120].map(r => `<g transform="rotate(${r})"><path d="M0 -13 V13 M-3.5 -9 L0 -6 L3.5 -9 M-3.5 9 L0 6 L3.5 9"/></g>`).join('')}</g>`,
  holly: (a, b, c) => `${[-1, 1].map(s => `<g transform="translate(${s * 6.5} 3.5) rotate(${s * 56}) scale(.84)"><path d="${HOLLY}" fill="${a}"/><path d="M0 -9 V9" stroke="${c}" stroke-width=".9" opacity=".35"/></g>`).join('')}${dots([[-2.7, -4.6], [2.7, -4.6], [0, -8.8]], 2.9, b)}`,
  snowman: (a, b, c) => `<circle cy="6" r="8.2" fill="${a}"/><circle cy="-5" r="5.6" fill="${a}"/><rect x="-4" y="-15" width="8" height="5.6" fill="${c}"/><rect x="-6.5" y="-10.2" width="13" height="1.9" rx=".9" fill="${c}"/><path d="M-4.8 -.8 H4.8 M3 -.6 L5.6 4.6" stroke="${b}" stroke-width="2.6" stroke-linecap="round"/>${dots([[-2, -6.2], [2, -6.2]], 0.9, c)}<path d="M0 -4.7 L4.6 -3.7 L0 -3Z" fill="${b}"/>${dots([[0, 4.5], [0, 8.5]], 1, c)}`,
  mitten: (a, b, c) => `<ellipse cx="8.4" cy="1.6" rx="3.1" ry="5.2" fill="${a}" transform="rotate(26 8.4 1.6)"/><path d="M-6.5 12 V-2 C-6.5 -11 6.5 -11 6.5 -2 V12Z" fill="${a}"/><rect x="-7.8" y="8" width="15.6" height="6" rx="2" fill="${b}"/><path d="${HEART}" fill="${c}" transform="translate(0 -1) scale(.28)" opacity=".7"/>`,
  // ── sky ──
  star: a => `<path d="${STAR}" fill="${a}"/>`,
  sparkle: a => `<path d="${SPARK}" fill="${a}"/>`,
  moon: a => `<path d="M8 -12.4 A13 13 0 1 0 8 12.4 A13.5 13.5 0 0 1 8 -12.4Z" fill="${a}"/>`,
  sun: (a, b) => `${ring(12, 12, () => `<path d="M-1.4 0 L0 -4 L1.4 0Z" fill="${b}"/>`)}<circle r="8" fill="${a}"/>`,
  cloud: a => `<circle cx="-7" cy="2" r="6" fill="${a}"/><circle cx="1" cy="-3" r="8" fill="${a}"/><circle cx="9" cy="3" r="5" fill="${a}"/><rect x="-12" y="2" width="25" height="6" rx="3" fill="${a}"/>`,
  rainbow: (a, b, c) => `<g fill="none" stroke-linecap="butt"><path d="M-13 9 A13 13 0 0 1 13 9" stroke="${a}" stroke-width="4"/><path d="M-9 9 A9 9 0 0 1 9 9" stroke="${b}" stroke-width="4"/><path d="M-5 9 A5 5 0 0 1 5 9" stroke="${c}" stroke-width="4"/></g>`,
  planet: (a, b, c) => `<g transform="rotate(-20)"><ellipse rx="14" ry="4.2" fill="none" stroke="${b}" stroke-width="1.8"/><circle r="8.2" fill="${a}"/><path d="M-7.6 -3 C-3 -1 3 -1 7.6 -3 M-8 1.5 C-3 3.4 3 3.4 8 1.5" stroke="${c}" stroke-width="1.2" fill="none" opacity=".3"/><path d="M-14 0 A14 4.2 0 0 0 14 0" fill="none" stroke="${b}" stroke-width="1.8"/></g>`,
  // ── hearts, bows and Christmas ──
  heart: a => `<path d="${HEART}" fill="${a}"/>`,
  bow: (a, b) => `<path d="M-1.5 2 C-4 7 -6 11 -8.5 14.5 L-4.6 14 C-2.6 10 -1 6 0 3Z M1.5 2 C4 7 6 11 8.5 14.5 L4.6 14 C2.6 10 1 6 0 3Z" fill="${a}"/><path d="M0 0 C-6 -10 -15 -9 -14 0 C-15 9 -6 10 0 0Z" fill="${a}"/><path d="M0 0 C6 -10 15 -9 14 0 C15 9 6 10 0 0Z" fill="${a}"/><circle r="3.4" fill="${b}"/>`,
  pearls: (a, b) => `${dots([[-12, -7], [-9.2, -2.4], [-5.2, 1.2], [0, 2.6], [5.2, 1.2], [9.2, -2.4], [12, -7]], 2.3, a)}<path d="${HEART}" fill="${b}" transform="translate(0 9.4) scale(.32)"/>`,
  bauble: (a, b, c) => `<rect x="-2.5" y="-13" width="5" height="4" rx="1" fill="${b}"/><circle cy="1" r="10" fill="${a}"/><path d="M-9.5 -1 Q0 3 9.5 -1" stroke="${c}" stroke-width="1.6" fill="none"/><path d="M-8 5 Q0 9 8 5" stroke="${c}" stroke-width="1.2" fill="none"/>`,
  cane: (a, b) => `<path d="M-4 14 V-5 A6 6 0 0 1 8 -5" stroke="${a}" stroke-width="5" fill="none" stroke-linecap="round"/><path d="M-4 14 V-5 A6 6 0 0 1 8 -5" stroke="${b}" stroke-width="5" fill="none" stroke-dasharray="3.2 4.4" stroke-linecap="butt"/>`,
  gift: (a, b, c) => `<rect x="-10" y="-3" width="20" height="16" rx="1.5" fill="${a}"/><rect x="-12" y="-7" width="24" height="5.6" rx="1.5" fill="${a}"/><rect x="-12" y="-7" width="24" height="5.6" rx="1.5" fill="${c}" opacity=".16"/><rect x="-2.2" y="-7" width="4.4" height="20" fill="${b}"/>${both(() => `<path d="M0 -7 C3 -14 10.5 -13.4 8.4 -9.4 C7.4 -7.4 3 -7 0 -7Z" fill="${b}"/>`)}<circle cy="-7.6" r="1.9" fill="${c}"/>`,
  gingerbread: (a, b, c) => `<rect x="-11.5" y="-4.4" width="23" height="6.2" rx="3.1" fill="${a}"/><path d="M-5 -4 H5 V5 L8.4 11.6 A3 3 0 0 1 3 14 L0 8.4 L-3 14 A3 3 0 0 1 -8.4 11.6 L-5 5Z" fill="${a}"/><circle cy="-8.6" r="5.2" fill="${a}"/><path d="M-9.4 -3.4 V.8 M9.4 -3.4 V.8 M-6.6 10.4 L-3.6 12 M6.6 10.4 L3.6 12" stroke="${b}" stroke-width="1.3" stroke-linecap="round"/>${dots([[0, -1], [0, 3.2]], 1.2, b)}${dots([[-1.9, -9.4], [1.9, -9.4]], 0.85, c)}<path d="M-1.9 -7 Q0 -5.4 1.9 -7" stroke="${b}" stroke-width="1" fill="none" stroke-linecap="round"/>`,
  candle: (a, b, c) => `<rect x="-4" y="-3" width="8" height="17" rx="1.5" fill="${a}"/><path d="M0 -14 C4 -9 3 -5 0 -4 C-3 -5 -4 -9 0 -14Z" fill="${b}"/><path d="M-4 3 H4" stroke="${c}" stroke-width="1" opacity=".6"/>`,
  // ── library ──
  book: (a, b, c) => `<rect x="-11" y="-9" width="22" height="18" rx="1.5" fill="${a}"/><rect x="-11" y="-9" width="5" height="18" fill="${b}"/><path d="M-2 -3 H7 M-2 2 H7" stroke="${c}" stroke-width="1.4" stroke-linecap="round"/>`,
  quill: (a, _b, c) => `<path d="M-8 14 C-2 2 4 -8 10 -14 C12 -4 6 6 -4 9Z" fill="${a}"/><path d="M-10 15 C-3 3 3 -6 9 -13" stroke="${c}" stroke-width="1.1" fill="none"/>`,
  key: (a) => `<g stroke="${a}" stroke-width="2.4" fill="none" stroke-linecap="round"><circle cx="-7" cy="-7" r="5"/><path d="M-3.5 -3.5 L10 10 M6 6 L9 3 M9 9 L12 6"/></g>`,
  globe: (a, b, c) => `<circle cy="-2" r="10" fill="${a}"/><g fill="none" stroke="${c}" stroke-width=".9" opacity=".45"><ellipse cy="-2" rx="4.6" ry="10"/><path d="M-10 -2 H10 M-8.4 -7.4 C-3 -5.6 3 -5.6 8.4 -7.4 M-8.4 3.4 C-3 1.6 3 1.6 8.4 3.4"/></g><path d="M-10.6 -8.4 A12.4 12.4 0 0 0 8 8" fill="none" stroke="${b}" stroke-width="1.6" stroke-linecap="round"/><path d="M0 10 V12.4 M-6 13.8 H6" stroke="${b}" stroke-width="2.2" stroke-linecap="round"/>`,
  crystal: (a, b, c) => `<path d="M0 -14 L8 -5 L5 13 H-5 L-8 -5Z" fill="${a}"/><path d="M0 -14 L0 13 M-8 -5 H8" stroke="${c}" stroke-width="1" opacity=".7"/><path d="M0 -14 L8 -5 L0 -5Z" fill="${b}" opacity=".55"/>`,
  // ── small animals ──
  moth: (a, b, c) => `<path d="M0 -2 C-6 -12 -15 -10 -14 -2 C-13 3 -6 3 0 1Z" fill="${a}"/><path d="M0 -2 C6 -12 15 -10 14 -2 C13 3 6 3 0 1Z" fill="${a}"/><path d="M0 1 C-5 2 -10 6 -8 11 C-4 12 -1 7 0 4Z" fill="${b}"/><path d="M0 1 C5 2 10 6 8 11 C4 12 1 7 0 4Z" fill="${b}"/><ellipse rx="1.7" ry="7" cy="2" fill="${c}"/>${dots([[-8, -4], [8, -4]], 1.8, c)}`,
  butterfly: (a, b, c) => `<ellipse cx="-7" cy="-4" rx="7" ry="8" fill="${a}" transform="rotate(-20 -7 -4)"/><ellipse cx="7" cy="-4" rx="7" ry="8" fill="${a}" transform="rotate(20 7 -4)"/><ellipse cx="-5" cy="7" rx="5" ry="5.5" fill="${b}"/><ellipse cx="5" cy="7" rx="5" ry="5.5" fill="${b}"/><ellipse rx="1.6" ry="9" fill="${c}"/>`,
  bee: (a, b, c) => `<ellipse cx="-3.4" cy="-6" rx="4" ry="5.6" fill="${b}" opacity=".8" transform="rotate(-24 -3.4 -6)"/><ellipse cx="3.6" cy="-6" rx="4" ry="5.6" fill="${b}" opacity=".8" transform="rotate(24 3.6 -6)"/><ellipse cx="1" cy="2.4" rx="7.4" ry="5.6" fill="${a}"/><path d="M-1 -2.8 V7.6 M3.4 -2.6 V7.4" stroke="${c}" stroke-width="2.2"/><circle cx="-7.6" cy="2.4" r="3.4" fill="${c}"/><path d="M8.2 2.4 L11.4 2.4" stroke="${c}" stroke-width="1.4" stroke-linecap="round"/><path d="M-9 -.4 L-11.6 -3.4 M-7 -.8 L-7.6 -4.6" stroke="${c}" stroke-width=".9" stroke-linecap="round"/>`,
  bunny: (a, b, c) => `<ellipse cx="-5" cy="-9" rx="3.4" ry="8" fill="${a}"/><ellipse cx="5" cy="-9" rx="3.4" ry="8" fill="${a}"/><ellipse cx="-5" cy="-9" rx="1.5" ry="5.5" fill="${b}"/><ellipse cx="5" cy="-9" rx="1.5" ry="5.5" fill="${b}"/><circle cy="5" r="10" fill="${a}"/>${dots([[-4, 3], [4, 3]], 1.4, c)}<path d="M-1.5 7 Q0 9 1.5 7" stroke="${c}" stroke-width="1.1" fill="none" stroke-linecap="round"/>`,
  fox: (a, b, c) => `<path d="M-12 -12 L-4 -5 H4 L12 -12 L11 2 C9 11 3 14 0 14 C-3 14 -9 11 -11 2Z" fill="${a}"/><path d="M-11 2 C-7 4 -3 8 0 14 C3 8 7 4 11 2 C9 11 3 14 0 14 C-3 14 -9 11 -11 2Z" fill="${b}"/>${dots([[-5, 1], [5, 1]], 1.5, c)}<circle cy="12" r="1.8" fill="${c}"/>`,
  deer: (a, b, c) => `${both(() => `<path d="M3.6 -7 C4.6 -10 7 -11 8 -14.4 M5.4 -10.4 L9.4 -10.6 M4.4 -8.8 L2.6 -12.6" stroke="${b}" stroke-width="1.5" fill="none" stroke-linecap="round"/><ellipse cx="9" cy="-4.6" rx="2.6" ry="5" fill="${a}" transform="rotate(48 9 -4.6)"/><ellipse cx="9" cy="-4.6" rx="1.1" ry="3" fill="${b}" transform="rotate(48 9 -4.6)"/>`)}<path d="M-6.2 -3 C-6.2 -8.6 6.2 -8.6 6.2 -3 C6.2 4 3.2 11.4 0 12.4 C-3.2 11.4 -6.2 4 -6.2 -3Z" fill="${a}"/><ellipse cy="8.6" rx="2.9" ry="3.6" fill="${b}" opacity=".85"/>${dots([[-2.9, -1], [2.9, -1]], 1.2, c)}<ellipse cy="10.2" rx="1.8" ry="1.3" fill="${c}"/>`,
  mouse: (a, b, c) => `<circle cx="-8" cy="-7" r="6" fill="${a}"/><circle cx="8" cy="-7" r="6" fill="${a}"/><circle cx="-8" cy="-7" r="3.2" fill="${b}"/><circle cx="8" cy="-7" r="3.2" fill="${b}"/><path d="M-10 0 C-10 -8 10 -8 10 0 C10 8 4 13 0 13 C-4 13 -10 8 -10 0Z" fill="${a}"/>${dots([[-4, 0], [4, 0]], 1.4, c)}<circle cy="11" r="1.7" fill="${b}"/>`,
  cat: (a, b) => `<path d="M-11 -13 L-4 -7 H4 L11 -13 L11 4 C11 10 6 13 0 13 C-6 13 -11 10 -11 4Z" fill="${a}"/><ellipse cx="-4.5" cy="1" rx="2.2" ry="3" fill="${b}"/><ellipse cx="4.5" cy="1" rx="2.2" ry="3" fill="${b}"/><path d="M-1.2 6 H1.2 L0 7.6Z" fill="${b}"/>`,
  sheep: (a, b, c) => `<path d="M-4 7 V13 M3.6 7.4 V13" stroke="${c}" stroke-width="2" stroke-linecap="round"/>${[[-5, -2, 5.6], [1, -4, 6.2], [6.4, 0, 5.6], [-1, 3.4, 6.2], [-7, 3.4, 4.6], [5.4, 4.4, 4.6]].map(([x, y, r]) => `<circle cx="${x}" cy="${y}" r="${r}" fill="${a}"/>`).join('')}<ellipse cx="-9.6" cy="-.6" rx="3.9" ry="5" fill="${c}" transform="rotate(14 -9.6 -.6)"/><ellipse cx="-6.4" cy="-4.4" rx="1.4" ry="2.7" fill="${c}" transform="rotate(-52 -6.4 -4.4)"/><circle cx="-10.6" cy="-1.8" r=".9" fill="${b}"/>`,
  bird: (a, b, c) => `<path d="M-1 8.4 V13.4 M3 8 V13.4 M-2.6 13.4 H.6 M1.4 13.4 H4.6" stroke="${c}" stroke-width="1.1" fill="none" stroke-linecap="round"/><path d="M-6.4 4.4 L-15.4 9.6 L-12.4 3 L-15.4 .2 L-6.6 -1.4Z" fill="${a}"/><ellipse cx="-.4" cy="2" rx="8.6" ry="7" fill="${a}" transform="rotate(-16 -.4 2)"/><circle cx="6.4" cy="-5" r="5.2" fill="${a}"/><path d="M10.8 -6.6 L15.6 -4.8 L10.8 -3Z" fill="${b}"/><path d="M-5.4 .4 C-.6 -3.6 5.6 -.4 4.6 4.8 C.6 7 -4.4 5.2 -5.4 .4Z" fill="${b}"/><circle cx="7.8" cy="-6" r="1.1" fill="${c}"/>`,
  swan: (a, b, c) => `<path d="M-6.4 5.4 C-3 -1 6 -5 12.4 -6.4 C11 -2 13.4 2 11 6.4 C7 11.4 -5 11.4 -8.4 8Z" fill="${a}"/><path d="M-4 6.4 C-10 4 -12 -3 -8 -8 C-6.4 -10 -4 -10 -3.4 -8.4" stroke="${a}" stroke-width="3.6" fill="none" stroke-linecap="round"/><circle cx="-3.9" cy="-8.8" r="2.5" fill="${a}"/><path d="M-2 -10 L2.6 -8.2 L-2 -7.4Z" fill="${b}"/><circle cx="-4.2" cy="-9.2" r=".7" fill="${c}"/><path d="M-.6 4 C3.4 2 7.4 1 10 -1.4 M1.4 7 C4.4 5.8 7.4 5 9.8 3" stroke="${c}" stroke-width="1" fill="none" opacity=".3" stroke-linecap="round"/>`,
  fish: (a, b, c) => `<path d="M8 0 L14.6 -6 V6Z" fill="${a}"/><path d="M-2 -6 L3.4 -10.4 L4.4 -5Z" fill="${b}"/><path d="M-13 0 C-8 -8.4 4 -8.4 9.4 0 C4 8.4 -8 8.4 -13 0Z" fill="${a}"/><path d="M-4.6 -4.8 C-2.4 -2 -2.4 2 -4.6 4.8" stroke="${c}" stroke-width="1.1" fill="none" opacity=".6"/><circle cx="-8.4" cy="-1.6" r="1.2" fill="${c}"/>`,
  // ── Halloween ──
  ghost: (a, _b, c) => `<path d="M-9 13 V-3 C-9 -17 9 -17 9 -3 V13 L5.5 9.5 L2 13 L-2 9.5 L-5.5 13Z" fill="${a}"/>${dots([[-3.5, -4], [3.5, -4]], 1.8, c)}<ellipse cy="2" rx="1.8" ry="2.6" fill="${c}"/>`,
  bat: a => `<path d="M0 -3 C-4 -9 -11 -9 -15 -5 C-11 -5 -11 -1 -12 2 C-9 0 -6 1 -5 4 C-3 2 -1 2 0 4 C1 2 3 2 5 4 C6 1 9 0 12 2 C11 -1 11 -5 15 -5 C11 -9 4 -9 0 -3Z" fill="${a}"/><path d="M-3 -4 L-2 -8 L0 -5 L2 -8 L3 -4Z" fill="${a}"/>`,
  hat: (a, b, c) => `<ellipse cy="7.4" rx="14" ry="4" fill="${a}"/><path d="M-7.4 6.4 C-5 -2 -2 -10 3.4 -14.4 C2.4 -9 5 -1 7.4 6.4Z" fill="${a}"/><path d="M-6.9 3.2 C-3 5.4 3 5.4 6.5 3.2 L7.4 6.4 C3 8.6 -3 8.6 -7.4 6.4Z" fill="${b}"/><rect x="-2.2" y="3.4" width="4.4" height="4" fill="none" stroke="${c}" stroke-width="1.1"/>`,
  web: a => `<g fill="none" stroke="${a}" stroke-width="1" stroke-linecap="round">${[0, 45, 90, 135].map(r => `<path d="M0 -13.6 V13.6" transform="rotate(${r})"/>`).join('')}${[4.6, 9, 13.4].map(r => `<path d="${Array.from({ length: 8 }, (_, i) => { const p = (k: number, rr: number) => `${+(Math.sin((k * Math.PI) / 4) * rr).toFixed(1)} ${+(-Math.cos((k * Math.PI) / 4) * rr).toFixed(1)}`; return `${i ? '' : `M${p(0, r)} `}Q${p(i + 0.5, r * 0.74)} ${p(i + 1, r)}`; }).join(' ')}"/>`).join('')}</g>`,
  wand: (a, b, c) => `<path d="M-11 12.4 L3 -1.6" stroke="${b}" stroke-width="2.3" stroke-linecap="round"/><path d="${STAR}" fill="${a}" transform="translate(5.6 -5.6) rotate(12) scale(.66)"/><path d="${SPARK}" fill="${c}" transform="translate(-6.4 -8.4) scale(.26)"/><path d="${SPARK}" fill="${c}" transform="translate(11 6.4) scale(.2)"/>`,
  // ── home, table and sea ──
  cottage: (a, b, c) => `<rect x="-10" y="-1" width="20" height="14" fill="${a}"/><path d="M-13 0 L0 -13 L13 0Z" fill="${b}"/><rect x="5" y="-12" width="4" height="7" fill="${b}"/><rect x="-2.5" y="5" width="5" height="8" rx="2.4" fill="${c}"/><rect x="-8" y="3" width="4" height="4" fill="${c}" opacity=".7"/>`,
  teacup: (a, b, c) => `<ellipse cy="11" rx="12" ry="2.6" fill="${b}"/><path d="M-9 -4 H9 C9 6 5 10 0 10 C-5 10 -9 6 -9 -4Z" fill="${a}"/><path d="M9 -2 C15 -3 15 6 7 6" stroke="${a}" stroke-width="2.2" fill="none"/><circle cx="-2" cy="2" r="2.2" fill="${c}"/><path d="M-3 -8 C-5 -11 -1 -12 -3 -15 M3 -8 C1 -11 5 -12 3 -15" stroke="${b}" stroke-width="1.1" fill="none" stroke-linecap="round"/>`,
  shell: (a, _b, c) => `<path d="M-3.4 11 H3.4 L2.4 13.6 H-2.4Z" fill="${a}"/><path d="M0 12 C-16 8 -15 -10 0 -12 C15 -10 16 8 0 12Z" fill="${a}"/><path d="M0 12 V-12 M0 12 C-5 4 -8 -4 -8 -9 M0 12 C5 4 8 -4 8 -9 M0 12 C-9 6 -13 0 -13 -3 M0 12 C9 6 13 0 13 -3" stroke="${c}" stroke-width="1" fill="none" opacity=".6"/>`,
  starfish: a => `<path d="${STAR}" fill="${a}" stroke="${a}" stroke-width="3" stroke-linejoin="round"/>`,
  anchor: a => `<g fill="none" stroke="${a}" stroke-width="2.3" stroke-linecap="round"><circle cy="-11" r="2.6"/><path d="M0 -8.4 V11.4 M-5.6 -4.4 H5.6 M-10 3.4 C-9 9.6 -4 11.6 0 11.6 C4 11.6 9 9.6 10 3.4"/></g>${both(() => `<path d="M12.6 5.6 L9.8 .4 L7.2 5.2Z" fill="${a}"/>`)}`,
  sailboat: (a, b, c) => `<path d="M0 6 V-13.4" stroke="${c}" stroke-width="1.2" stroke-linecap="round"/><path d="M1.6 -13 L11.4 3.6 H1.6Z" fill="${a}"/><path d="M-1.6 -9 L-9.4 3.6 H-1.6Z" fill="${a}" opacity=".75"/><path d="M-12.4 6 H12.4 C10.4 11 6 13 0 13 C-6 13 -10.4 11 -12.4 6Z" fill="${b}"/>`,
  lemon: (a, b, c) => `<path d="${LEAF}" fill="${b}" transform="translate(5.4 -10) rotate(58) scale(.5)"/><g transform="rotate(-14)"><path d="M-12.6 .8 C-12 -1 -10.6 -1.6 -9.8 -3 C-7 -9.4 5 -10.6 9.2 -5 C10.6 -3.4 12.6 -3 13 -.6 C12.6 1 11 1.6 10 3.6 C7 10 -5 10.6 -9.2 5 C-10.4 3.4 -12 3 -12.6 .8Z" fill="${a}"/><path d="M-5.6 -5 C-2 -7.4 3 -7.4 6 -4.6" stroke="${c}" stroke-width="1.1" fill="none" stroke-linecap="round" opacity=".45"/></g>`,
  cherries: (a, b) => `<path d="M-6 6 C-6 -4 0 -10 6 -12 C4 -6 6 0 7 5" stroke="${b}" stroke-width="1.5" fill="none"/><path d="${LEAF}" fill="${b}" transform="translate(9 -11) rotate(70) scale(.4)"/><circle cx="-6" cy="8" r="5.5" fill="${a}"/><circle cx="7" cy="8" r="5.5" fill="${a}"/>`,
  peace: a => `<g fill="none" stroke="${a}" stroke-width="2.5" stroke-linecap="round"><circle r="11.6"/><path d="M0 -11.6 V11.6 M0 0 L-8.2 8.2 M0 0 L8.2 8.2"/></g>`,
  // ── desk ──
  crane: (a, b, c) => `<path d="M-3 4.4 L1 -14 L6.4 4.4Z" fill="${b}" opacity=".85"/><path d="M-3 5 L-11 -9 L-15 -7 L-11.4 -6.4 L-6 5Z" fill="${a}"/><path d="M3 5 L13.4 -8 L7.4 5Z" fill="${a}"/><path d="M-7.4 4 L8.4 4 L1 11.4Z" fill="${a}"/><path d="M1 -14 L1.6 4 M-7.4 4 L1 11.4" stroke="${c}" stroke-width=".8" fill="none" opacity=".35"/>`,
  fan: (a, b, c) => `<path d="M0 12 L-14 -4 A19 19 0 0 1 14 -4Z" fill="${a}"/><path d="M0 12 L-8 -9 M0 12 L0 -11 M0 12 L8 -9" stroke="${c}" stroke-width="1" opacity=".7"/><circle cy="12" r="2" fill="${b}"/>`,
  pencil: (a, b, c) => `<g transform="rotate(40)"><rect x="-3" y="-11" width="6" height="17" fill="${a}"/><rect x="-3" y="-13.6" width="6" height="2.8" fill="${c}" opacity=".55"/><rect x="-3" y="-16" width="6" height="2.8" rx="1.2" fill="${b}"/><path d="M-3 6 L0 13.4 L3 6Z" fill="${b}"/><path d="M-1.2 10.4 L0 13.4 L1.2 10.4Z" fill="${c}"/></g>`,
  clip: a => `<path d="M4 -6 V7 A4.5 4.5 0 0 1 -5 7 V-8.4 A3.2 3.2 0 0 1 1.4 -8.4 V5 A1.4 1.4 0 0 1 -1.4 5 V-5" fill="none" stroke="${a}" stroke-width="1.8" stroke-linecap="round" transform="rotate(24)"/>`,
  envelope: (a, b, c) => `<rect x="-12" y="-8" width="24" height="16.4" rx="1.6" fill="${a}"/><path d="M-11.6 -7.4 L0 2 L11.6 -7.4" stroke="${c}" stroke-width="1.2" fill="none" opacity=".6" stroke-linejoin="round"/><path d="${HEART}" fill="${b}" transform="translate(0 2.6) scale(.26)"/>`,
  cameo: (a, b, c) => `<ellipse rx="10.6" ry="13.6" fill="${a}"/><ellipse rx="8" ry="11" fill="${b}"/><ellipse rx="9.3" ry="12.3" fill="none" stroke="${b}" stroke-width=".7" stroke-dasharray=".2 2.2" stroke-linecap="round"/><path d="M-4.6 8.6 C-4.4 6.4 -3.2 5.4 -1.8 5 L-1.6 2.2 C-4.2 1.8 -6 -.5 -5.6 -3.2 C-7.4 -3.6 -7.6 -6.2 -5.6 -6.4 C-5 -8.6 -2.6 -9.8 -.2 -9.6 C2.4 -9.4 4 -7.6 4 -5.6 L5.4 -3.2 L4.2 -2.6 L4.6 -1.6 L3.9 -1.1 L4.3 -.2 L3.4 1 C2.6 1.8 1.6 2 1.2 2.2 L1.6 4.6 C3.2 5.4 4.6 6.4 4.6 8.6Z" fill="${c}"/>`,
  fleur: (a, b) => `<path d="M0 -14 C4.2 -9 4.6 -3 0 3.4 C-4.6 -3 -4.2 -9 0 -14Z" fill="${a}"/>${both(() => `<path d="M2 3.4 C4 -4 12 -8 12.6 -1 C12.8 3 8 4 7 1 C7 5 4 6.4 2 3.4Z M1.6 6.4 C5 7.4 6 10.4 7.6 11.4 C4.6 12.4 2.6 10.4 1.4 7.4Z" fill="${a}"/>`)}<path d="M0 6 C2.2 9 3 11 0 14.4 C-3 11 -2.2 9 0 6Z" fill="${a}"/><rect x="-6" y="3" width="12" height="3.2" rx="1.2" fill="${b}"/>`,
  dot: a => `<circle r="4" fill="${a}"/>`,
  // for the tech, military, gritty and metal looks (13 Nov)
  gear: (a, b) => `${ring(8, 10.6, () => `<rect x="-2.6" y="-3.2" width="5.2" height="5" rx="1" fill="${a}"/>`)}<circle r="10" fill="${a}"/><circle r="4.2" fill="${b}"/>`,
  bolt: a => `<path d="M3.4 -14 L-8 2 H-1 L-4 14 L8 -3.4 H1Z" fill="${a}" stroke-linejoin="round"/>`,
  chip: (a, b) => `<g stroke="${a}" stroke-width="1.8" stroke-linecap="round">${[-5, 0, 5].map(v => `<path d="M${v} -12 V-8 M${v} 8 V12 M-12 ${v} H-8 M8 ${v} H12"/>`).join('')}</g><rect x="-8.4" y="-8.4" width="16.8" height="16.8" rx="2" fill="${a}"/><rect x="-4" y="-4" width="8" height="8" rx="1" fill="${b}"/>`,
  rocket: (a, b, c) => `${both(() => `<path d="M4 0 L9.4 9 L4 7Z" fill="${b}"/>`)}<path d="M0 -14 C6.4 -8 6.4 2 4.2 7.6 H-4.2 C-6.4 2 -6.4 -8 0 -14Z" fill="${a}"/><circle cy="-4" r="2.6" fill="${c}"/><path d="M-2.6 8 L0 14 L2.6 8Z" fill="${b}"/>`,
  shield: (a, b) => `<path d="M0 -13 L11 -9 V0 C11 7 6 11 0 14 C-6 11 -11 7 -11 0 V-9Z" fill="${a}"/><path d="M0 -9 L7 -6.4 V0 C7 4.6 4 7.4 0 9.6Z" fill="${b}" opacity=".6"/>`,
  crosshair: a => `<g fill="none" stroke="${a}" stroke-width="2" stroke-linecap="round"><circle r="9"/><path d="M0 -14 V-5 M0 5 V14 M-14 0 H-5 M5 0 H14"/></g><circle r="1.6" fill="${a}"/>`,
  skull: (a, b, c) => `<path d="M0 -13 C8 -13 12 -7 12 -1 C12 4 9 6 8 7 V11 H-8 V7 C-9 6 -12 4 -12 -1 C-12 -7 -8 -13 0 -13Z" fill="${a}"/><ellipse cx="-4.6" cy="-1" rx="3" ry="3.4" fill="${c}"/><ellipse cx="4.6" cy="-1" rx="3" ry="3.4" fill="${c}"/><path d="M0 3 L-1.6 6 H1.6Z" fill="${c}"/><path d="M-4 8 V11 M0 8 V11 M4 8 V11" stroke="${b}" stroke-width="1"/>`,
  flame: (a, b) => `<path d="M0 -14 C4 -8 9 -5 8 3 C7 10 3 13 0 14 C-3 13 -7 10 -8 3 C-8 -2 -5 -4 -4 -8 C-2 -4 -1 -3 0 -2 C1 -6 0 -10 0 -14Z" fill="${a}"/><path d="M0 2 C3 5 4 8 2 12 C1 13 -1 13 -2 12 C-4 9 -2 6 0 2Z" fill="${b}"/>`,
  // a patch of camouflage: drawn large and close together, they make the pattern
  blot: a => `<path d="M-12 -3 C-13 -9 -6 -12 -1 -10 C3 -14 11 -12 11 -6 C15 -3 13 4 9 5 C9 11 2 13 -2 10 C-7 13 -13 9 -11 4 C-15 2 -14 -2 -12 -3Z" fill="${a}"/>`,
};
export type MotifId = keyof typeof MOTIFS;

const svg = (w: number, h: number, body: string) => `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${body}</svg>`;
/** An SVG as something CSS can use for a background. */
export const cssUrl = (svgText: string): string => `url("data:image/svg+xml,${encodeURIComponent(svgText).replace(/'/g, '%27').replace(/"/g, '%22')}")`;
const n1 = (v: number) => +v.toFixed(1);
const at = (m: string, x: number, y: number, rot = 0, scale = 1, opacity = 1) => `<g transform="translate(${n1(x)} ${n1(y)}) rotate(${Math.round(rot)}) scale(${+scale.toFixed(2)})"${opacity < 1 ? ` opacity="${opacity}"` : ''}>${m}</g>`;
/** The same "random" numbers every time, so a look's wallpaper doesn't change between visits. */
const dice = (seed: number) => () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
const draw = (id: string, colors: string[], i: number): string => (MOTIFS[id] || MOTIFS.dot)(colors[i % colors.length], colors[(i + 1) % colors.length], colors[(i + 2) % colors.length]);
/** A look names a motif as "lemon", or as "lemon@1" to say which of its colours the drawing starts from (so the lemon
 *  is yellow whatever colour happens to come first). Without the number the colours take turns. */
export const motifName = (spec: string): string => spec.split('@')[0];
const drawNamed = (spec: string, colors: string[], turn: number): string => { const [id, from] = spec.split('@'); return draw(id, colors, from === undefined ? turn : Number(from) || 0); };

export interface Tile { svg: string; size: number }
export const PAPER_KINDS = ['gingham', 'plaid', 'check', 'stripes', 'dots', 'grid', 'trellis', 'waves', 'scales', 'arches', 'tiles', 'stars', 'wash'] as const;
/** How a wallpaper is described in a look: a kind, and what it needs. `fade` (0 to 1) makes this layer fainter than the
 *  others when a look lays two together (a faint check under a scatter of leaves). */
export type Wallpaper =
  | { kind: 'scatter'; motifs: string[]; across?: number; size?: number; turn?: number; scale?: number; fade?: number; colors?: string[] }   // little drawings strewn about
  | { kind: (typeof PAPER_KINDS)[number] | 'none'; size?: number; fade?: number; colors?: string[] };   // colors: this layer's own, in place of the look's

/** One tile of a wallpaper in these colours. It repeats without a seam. `paper` is the page colour, for the patterns
 *  that need to hide what is behind a shape (fish scales). */
export function wallpaper(w: Wallpaper, colors: string[], paper = '#ffffff'): Tile {
  const c = (i: number) => colors[i % colors.length];
  const done = (size: number, body: string): Tile => ({ size, svg: svg(size, size, w.fade !== undefined && w.fade < 1 ? `<g opacity="${w.fade}">${body}</g>` : body) });
  switch (w.kind) {
    case 'scatter': {
      // rows of motifs, every second row shifted half a step (like wallpaper is hung), each one nudged and turned a
      // little; one that hangs over an edge of the tile is drawn again on the other side, so the tile has no seam
      const n = w.across || 4, size = w.size || 224, cell = size / n, rnd = dice(n * 7919 + w.motifs.join('').length * 104729);
      const brick = n % 2 === 0;
      let out = '', k = 0;
      for (let row = 0; row < n; row++) for (let col = 0; col < n; col++, k++) {
        const jx = (rnd() - 0.5) * cell * 0.3, jy = (rnd() - 0.5) * cell * 0.3;
        const x = (col + 0.5 + (brick && row % 2 ? 0.5 : 0)) * cell + jx, y = (row + 0.5) * cell + jy;
        const turn = (rnd() - 0.5) * 2 * (w.turn ?? 24), scale = (w.scale || 1) * (0.8 + rnd() * 0.3), reach = 19 * scale;
        const m = drawNamed(w.motifs[(k + row) % w.motifs.length], colors, k + row);
        for (const dx of [0, -size, size]) for (const dy of [0, -size, size]) {
          if (x + dx + reach < 0 || x + dx - reach > size || y + dy + reach < 0 || y + dy - reach > size) continue;
          out += at(m, x + dx, y + dy, turn, scale);
        }
      }
      return done(size, out);
    }
    case 'gingham': { const s = w.size || 28, h = s / 2; return done(s, `<rect width="${h}" height="${s}" fill="${c(0)}" opacity=".5"/><rect width="${s}" height="${h}" fill="${c(0)}" opacity=".5"/>`); }
    case 'plaid': { const s = w.size || 72; return done(s, `<rect width="${s}" height="${s * 0.34}" fill="${c(0)}" opacity=".42"/><rect width="${s * 0.34}" height="${s}" fill="${c(0)}" opacity=".42"/><rect y="${s * 0.56}" width="${s}" height="${s * 0.1}" fill="${c(1)}" opacity=".5"/><rect x="${s * 0.56}" width="${s * 0.1}" height="${s}" fill="${c(1)}" opacity=".5"/><path d="M0 ${s * 0.84} H${s} M${s * 0.84} 0 V${s}" stroke="${c(2)}" stroke-width="1.6" opacity=".7"/>`); }
    // a tattersall check: thin lines both ways, in two colours turn about
    case 'check': { const s = w.size || 44, h = s / 2; return done(s, `<path d="M0 ${h / 2} H${s} M${h / 2} 0 V${s}" stroke="${c(0)}" stroke-width="1.6" opacity=".8"/><path d="M0 ${h * 1.5} H${s} M${h * 1.5} 0 V${s}" stroke="${c(1)}" stroke-width="1.6" opacity=".8"/>`); }
    case 'stripes': { const s = w.size || 36; return done(s, `<rect width="${s / 2}" height="${s}" fill="${c(0)}" opacity=".45"/><rect x="${s * 0.7}" width="${s * 0.08}" height="${s}" fill="${c(1)}" opacity=".55"/>`); }
    case 'dots': { const s = w.size || 34; return done(s, `<circle cx="${s / 4}" cy="${s / 4}" r="${s * 0.09}" fill="${c(0)}"/><circle cx="${s * 0.75}" cy="${s * 0.75}" r="${s * 0.09}" fill="${c(1)}"/>`); }
    case 'grid': { const s = w.size || 22; return done(s, `<path d="M${s} 0 V${s} H0" stroke="${c(0)}" stroke-width="1" fill="none" opacity=".7"/>`); }
    case 'trellis': { const s = w.size || 46, h = s / 2; return done(s, `<path d="M0 ${h} L${h} 0 L${s} ${h} L${h} ${s}Z" fill="none" stroke="${c(0)}" stroke-width="1.2"/><circle cx="${h}" cy="${h}" r="2.2" fill="${c(1)}"/><circle r="2.2" fill="${c(1)}"/><circle cx="${s}" r="2.2" fill="${c(1)}"/><circle cy="${s}" r="2.2" fill="${c(1)}"/><circle cx="${s}" cy="${s}" r="2.2" fill="${c(1)}"/>`); }
    // rippling lines, like water seen from above
    case 'waves': { const s = w.size || 64, q = s / 4, row = s / 4; return done(s, [0, 1, 2, 3].map(i => `<path d="M${-q} ${n1(row * (i + 0.5))} q${q / 2} ${-row * 0.36} ${q} 0 t${q} 0 t${q} 0 t${q} 0 t${q} 0 t${q} 0" transform="translate(${i % 2 ? q / 2 : 0} 0)" stroke="${c(i % 2)}" stroke-width="${i % 2 ? 1.2 : 1.8}" fill="none" stroke-linecap="round"/>`).join('')); }
    // fish scales (seigaiha): rows of ringed discs, each row half hiding the one above
    case 'scales': {
      const s = w.size || 56, r = s / 2;
      const disc = (cx: number, cy: number) => `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${paper}" stroke="${c(0)}" stroke-width="1.3"/>${[0.7, 0.4].map((k, i) => `<circle cx="${cx}" cy="${cy}" r="${n1(r * k)}" fill="none" stroke="${c(i + 1)}" stroke-width="1.2"/>`).join('')}`;
      return { size: s, svg: `<svg xmlns="http://www.w3.org/2000/svg" width="${s}" height="${r}" viewBox="0 0 ${s} ${r}">${w.fade !== undefined && w.fade < 1 ? `<g opacity="${w.fade}">` : '<g>'}${disc(r, -r / 2)}${disc(0, 0)}${disc(s, 0)}${disc(r, r / 2)}${disc(0, r)}${disc(s, r)}${disc(r, r * 1.5)}</g></svg>` };
    }
    case 'arches': { const s = w.size || 84, h = s / 2; const arch = (cx: number, cy: number) => [0.46, 0.34, 0.22].map((k, i) => `<path d="M${cx - s * k} ${cy} A${s * k} ${s * k} 0 0 1 ${cx + s * k} ${cy}" stroke="${c(i)}" stroke-width="${s * 0.085}" fill="none"/>`).join(''); return done(s, `${arch(h, h)}${arch(0, s)}${arch(s, s)}`); }
    // painted tiles: a four-petalled flower in each, a ring where four tiles meet
    case 'tiles': {
      const s = w.size || 60, h = s / 2;
      const petal = `<path d="M0 ${-h * 0.16} C${h * 0.26} ${-h * 0.3} ${h * 0.24} ${-h * 0.62} 0 ${-h * 0.8} C${-h * 0.24} ${-h * 0.62} ${-h * 0.26} ${-h * 0.3} 0 ${-h * 0.16}Z" fill="${c(0)}"/>`;
      const knot = (x: number, y: number) => `<circle cx="${x}" cy="${y}" r="${n1(h * 0.3)}" fill="none" stroke="${c(1)}" stroke-width="1.6"/><circle cx="${x}" cy="${y}" r="${n1(h * 0.1)}" fill="${c(2)}"/>`;
      return done(s, `<path d="M0 0 H${s} V${s} H0Z" fill="none" stroke="${c(0)}" stroke-width="1" opacity=".55"/><g transform="translate(${h} ${h})">${[0, 90, 180, 270].map(r => `<g transform="rotate(${r})">${petal}</g>`).join('')}<path d="M0 ${-h * 0.34} L${h * 0.34} 0 L0 ${h * 0.34} L${-h * 0.34} 0Z" fill="none" stroke="${c(1)}" stroke-width="1.2" transform="rotate(45)"/><circle r="${n1(h * 0.1)}" fill="${c(2)}"/></g>${knot(0, 0)}${knot(s, 0)}${knot(0, s)}${knot(s, s)}`);
    }
    case 'stars': { const s = w.size || 150, rnd = dice(4242); let out = ''; for (let i = 0; i < 16; i++) { const x = rnd() * s, y = rnd() * s, big = i % 5 === 0; out += big ? at(MOTIFS.sparkle(c(0), '', ''), 12 + x * 0.84, 12 + y * 0.84, 0, 0.5 + rnd() * 0.3) : `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${(0.7 + rnd() * 1.1).toFixed(1)}" fill="${c(i)}"/>`; } return done(s, `${out}<path d="M24 40 L52 28 L74 46 L98 30 M74 46 L80 78 L112 92" stroke="${c(1)}" stroke-width=".8" fill="none" opacity=".6"/>${dots([[24, 40], [52, 28], [74, 46], [98, 30], [80, 78], [112, 92]], 1.8, c(0))}`); }
    // soft blots of colour, like watercolour on wet paper. Each blot is a fading circle, drawn again past every edge
    // it reaches, so the tile repeats without a seam (and there is no blur for the phone to work out)
    case 'wash': {
      const s = w.size || 280;
      const blots: [number, number, number, number][] = [[60, 64, 78, 0], [204, 96, 88, 1], [112, 206, 84, 2], [246, 236, 70, 3], [20, 150, 60, 4], [150, 20, 56, 3]];
      const grads = colors.map((col, i) => `<radialGradient id="w${i}"><stop offset="0" stop-color="${col}" stop-opacity=".75"/><stop offset=".55" stop-color="${col}" stop-opacity=".34"/><stop offset="1" stop-color="${col}" stop-opacity="0"/></radialGradient>`).join('');
      let out = '';
      for (const [x, y, r, i] of blots) for (const dx of [0, -s, s]) for (const dy of [0, -s, s]) {
        if (x + dx + r < 0 || x + dx - r > s || y + dy + r < 0 || y + dy - r > s) continue;
        out += `<circle cx="${x + dx}" cy="${y + dy}" r="${r}" fill="url(#w${i % colors.length})"/>`;
      }
      return done(s, `<defs>${grads}</defs>${out}`);
    }
    default: return { svg: '', size: 0 };
  }
}

/** Paper grain to lay under a wallpaper: fine specks of `ink` and, between them, specks of `light` (white on light
 *  paper, black on dark), so the page gets a tooth without getting darker or lighter overall. `amount` is how strong
 *  (0 to 1). Only the peaks of the noise become specks; the rest of the tile is left clear. */
export function grain(ink: string, amount = 0.5, light = '#ffffff'): Tile {
  const s = 180, k = (2.6 * amount).toFixed(2), off = (-1.3 * amount).toFixed(2);
  const speck = (id: string, seed: number) => `<filter id="${id}" x="0" y="0" width="100%" height="100%"><feTurbulence type="fractalNoise" baseFrequency="1.15" numOctaves="2" seed="${seed}" stitchTiles="stitch"/><feColorMatrix values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 ${k} ${off}"/><feComposite in2="SourceGraphic" operator="in"/></filter>`;
  return { svg: svg(s, s, `<defs>${speck('n', 7)}${speck('m', 23)}</defs><rect width="${s}" height="${s}" fill="${ink}" filter="url(#n)"/><rect width="${s}" height="${s}" fill="${light}" filter="url(#m)"/>`), size: s };
}

/** The strip along the top of the screen (it repeats sideways). `band` is how much of its height, from the top, is a
 *  solid band of the first colour: on a phone that band is stretched up behind the clock. */
export const TOP_EDGES = ['scallop', 'lace', 'bunting', 'garland', 'lights', 'stars', 'vine', 'swag', 'rule', 'zigzag', 'icicles', 'drips', 'ripple', 'bands', 'tape'] as const;
export type TopEdge = (typeof TOP_EDGES)[number] | 'none';
/** Leaves hang down from a garland; everything else hangs the right way up under it. */
const HANGS_DOWN = new Set(['leaf', 'maple', 'holly', 'sprig', 'fern', 'laurel', 'wheat']);
export function topEdge(kind: TopEdge, colors: string[], motif?: string): { svg: string; w: number; h: number; band: number } {
  const c = (i: number) => colors[i % colors.length];
  switch (kind) {
    case 'scallop': return { w: 28, h: 16, band: 2, svg: svg(28, 16, `<path d="M0 0 H28 V2 A14 14 0 0 1 0 2Z" fill="${c(0)}"/>`) };
    case 'lace': return { w: 24, h: 18, band: 4, svg: svg(24, 18, `<path d="M0 0 H24 V4 A12 12 0 0 1 0 4Z" fill="${c(0)}"/><circle cx="12" cy="9" r="2.4" fill="${c(1)}"/><circle cx="4" cy="5" r="1.3" fill="${c(1)}"/><circle cx="20" cy="5" r="1.3" fill="${c(1)}"/>`) };
    case 'bunting': return { w: 96, h: 26, band: 0, svg: svg(96, 26, `<path d="M0 2 Q48 10 96 2" stroke="${c(3)}" stroke-width="1.2" fill="none"/>${[0, 1, 2, 3].map(i => `<path d="M${i * 24 + 2} ${3 + (i === 1 || i === 2 ? 3.4 : 1.4)} L${i * 24 + 22} ${3 + (i === 1 || i === 2 ? 3.6 : 1.6)} L${i * 24 + 12} ${22 + (i === 1 || i === 2 ? 2 : 0)}Z" fill="${c(i)}"/>`).join('')}`) };
    case 'garland': {
      const m = motif || 'leaf', down = HANGS_DOWN.has(motifName(m));
      return { w: 120, h: 34, band: 0, svg: svg(120, 34, `<path d="M0 4 Q30 16 60 6 Q90 -4 120 4" stroke="${c(0)}" stroke-width="2.6" fill="none"/>${[10, 34, 60, 86, 108].map((x, i) => at(drawNamed(m, colors, i), x, (down ? 12 : 18) + (i % 2 ? -3 : 3), down ? (i % 2 ? 150 : 200) : (i % 2 ? -10 : 12), down ? 0.55 : 0.62)).join('')}`) };
    }
    // a string of little lamps
    case 'lights': return { w: 120, h: 26, band: 0, svg: svg(120, 26, `<path d="M0 3 Q30 15 60 5 Q90 -5 120 3" stroke="${c(3)}" stroke-width="1.2" fill="none"/>${[[12, 8.6], [36, 10.6], [60, 5.6], [84, 1.6], [108, 2.6]].map(([x, y], i) => `<rect x="${x - 1.6}" y="${y}" width="3.2" height="3" rx=".8" fill="${c(3)}"/><ellipse cx="${x}" cy="${y + 7.4}" rx="3.6" ry="5" fill="${c(i % 3)}"/><ellipse cx="${x}" cy="${y + 7.4}" rx="6.4" ry="8" fill="${c(i % 3)}" opacity=".22"/>`).join('')}`) };
    case 'stars': return { w: 110, h: 26, band: 0, svg: svg(110, 26, `${[[12, 9, 0.5], [40, 15, 0.34], [66, 7, 0.42], [92, 14, 0.56]].map(([x, y, s], i) => `<path d="M${x} 0 V${y - 5}" stroke="${c(1)}" stroke-width=".7"/>${at(MOTIFS[i % 2 ? 'star' : 'sparkle'](c(i ? 0 : 2), '', ''), x, y, 0, s)}`).join('')}`) };
    case 'vine': return { w: 120, h: 24, band: 0, svg: svg(120, 24, `<path d="M0 8 Q30 18 60 8 Q90 -2 120 8" stroke="${c(0)}" stroke-width="1.6" fill="none"/>${[14, 44, 74, 104].map((x, i) => at(MOTIFS.leaf(c(i % 2), '', c(0)), x, i % 2 ? 4 : 14, i % 2 ? -60 : 120, 0.42)).join('')}${[30, 90].map((x, i) => at(drawNamed(motif || 'flower', colors, i + 1), x, i ? 2 : 13, 0, 0.42)).join('')}`) };
    // cloth draped in loops, a little bow (or the look's motif) where each loop is pinned
    case 'swag': return { w: 88, h: 30, band: 0, svg: svg(88, 30, `<path d="M0 3 Q44 30 88 3 L88 0 H0Z" fill="${c(0)}" opacity=".55"/><path d="M0 3 Q44 30 88 3" stroke="${c(1)}" stroke-width="1.4" fill="none"/><path d="M0 2 Q44 17 88 2" stroke="${c(1)}" stroke-width="1" fill="none" opacity=".6"/>${at(drawNamed(motif || 'bow', colors, 2), 0, 7, 0, 0.5)}${at(drawNamed(motif || 'bow', colors, 2), 88, 7, 0, 0.5)}`) };
    // a fine ruled line with the look's motif set along it
    case 'rule': return { w: 96, h: 24, band: 0, svg: svg(96, 24, `<path d="M0 7 H34 M62 7 H96" stroke="${c(0)}" stroke-width="1.2"/><path d="M0 10.4 H30 M66 10.4 H96" stroke="${c(1)}" stroke-width=".8"/>${dots([[36, 8.6], [60, 8.6]], 1.5, c(1))}${at(drawNamed(motif || 'dot', colors, 0), 48, 10, 0, 0.62)}`) };
    case 'zigzag': return { w: 28, h: 14, band: 0, svg: svg(28, 14, `<path d="M0 0 H28 L14 12Z" fill="${c(0)}"/><path d="M0 0 L14 12 L28 0" stroke="${c(1)}" stroke-width="2" fill="none"/>`) };
    case 'icicles': return { w: 72, h: 30, band: 3, svg: svg(72, 30, `<path d="M0 0 H72 V3 L69 3 L66 20 L62 3 L57 3 L54.6 12 L52 3 L45 3 L41 28 L36.6 3 L30 3 L27.6 15 L25 3 L18 3 L14.6 23 L11 3 L5 3 L3 9 L1 3 L0 3Z" fill="${c(0)}"/><path d="M41 28 L39.6 12 M14.6 23 L13.4 10 M66 20 L64.8 9" stroke="${c(1)}" stroke-width="1" opacity=".7" stroke-linecap="round"/>`) };
    case 'drips': return { w: 60, h: 30, band: 3, svg: svg(60, 30, `<path d="M0 0 H60 V3 C56 3 56 26 52 26 C48 26 49 5 44 5 C39 5 40 16 36 16 C32 16 33 4 28 4 C22 4 24 29 19 29 C14 29 16 6 11 6 C6 6 7 14 4 14 C1 14 2 3 0 3Z" fill="${c(0)}"/>`) };
    // two lines of small waves
    case 'ripple': return { w: 48, h: 18, band: 0, svg: svg(48, 18, `<path d="M0 0 H48 V6 q-6 6 -12 0 t-12 0 t-12 0 t-12 0Z" fill="${c(0)}" opacity=".5"/><path d="M-6 12 q6 -5 12 0 t12 0 t12 0 t12 0 t12 0" stroke="${c(1)}" stroke-width="1.6" fill="none" stroke-linecap="round"/>`) };
    // three stripes straight across
    case 'bands': return { w: 24, h: 18, band: 18, svg: svg(24, 18, `<rect width="24" height="6" fill="${c(0)}"/><rect y="6" width="24" height="6" fill="${c(1)}"/><rect y="12" width="24" height="6" fill="${c(2)}"/>`) };
    // torn-off lengths of patterned paper tape
    case 'tape': return { w: 150, h: 24, band: 0, svg: svg(150, 24, `<g transform="rotate(-3 36 9)"><path d="M6 3 L8 6 L6 9 L8 12 L6 15 H66 L64 12 L66 9 L64 6 L66 3Z" fill="${c(0)}" opacity=".8"/>${dots([[18, 9], [30, 9], [42, 9], [54, 9]], 1.7, c(2))}</g><g transform="rotate(2 112 11)"><path d="M84 6 L86 9 L84 12 L86 15 L84 18 H140 L138 15 L140 12 L138 9 L140 6Z" fill="${c(1)}" opacity=".8"/><path d="M90 9.4 H134 M90 14.6 H134" stroke="${c(3)}" stroke-width="1.4" opacity=".8"/></g>`) };
    default: return { w: 0, h: 0, band: 0, svg: '' };
  }
}

/** The bottom bar's upper edge, cut into a shape: drawn in the bar's colour with the bar's line along it. */
export const BAR_EDGES = ['scallop', 'zigzag', 'wave'] as const;
export type BarEdge = (typeof BAR_EDGES)[number] | 'none';
export function barEdge(kind: BarEdge, fill: string, line: string): { svg: string; w: number; h: number } {
  switch (kind) {
    case 'scallop': return { w: 22, h: 9, svg: svg(22, 9, `<path d="M0 9 A11 9 0 0 1 22 9Z" fill="${fill}"/><path d="M0 9 A11 9 0 0 1 22 9" fill="none" stroke="${line}" stroke-width="1"/>`) };
    case 'zigzag': return { w: 18, h: 8, svg: svg(18, 8, `<path d="M0 8 L9 0 L18 8Z" fill="${fill}"/><path d="M0 8 L9 0 L18 8" fill="none" stroke="${line}" stroke-width="1"/>`) };
    case 'wave': return { w: 44, h: 8, svg: svg(44, 8, `<path d="M0 8 V5 Q11 -3 22 5 T44 5 V8Z" fill="${fill}"/><path d="M0 5 Q11 -3 22 5 T44 5" fill="none" stroke="${line}" stroke-width="1"/>`) };
    default: return { w: 0, h: 0, svg: '' };
  }
}

/** What flies or floats: in a corner scene these go up in the air, not on the ground. */
const IN_THE_AIR = new Set(['rocket', 'bolt', 'butterfly', 'moth', 'bat', 'ghost', 'cloud', 'sun', 'moon', 'star', 'sparkle', 'snow', 'bee', 'planet', 'heart', 'crane', 'web', 'pearls', 'wand']);
/** A little scene for the corner of the screen: up to four motifs, the first one big, on a patch of ground. */
export function corner(motifs: string[], colors: string[], ground?: string): { svg: string; w: number; h: number } {
  if (!motifs.length) return { svg: '', w: 0, h: 0 };
  const [big, mid = big, small = mid, extra] = motifs;
  // where each one stands: [x, y, turn, size] on the ground, or up in the air
  const spot: Record<'big' | 'mid' | 'small' | 'extra', [[number, number, number, number], [number, number, number, number]]> = {
    big: [[106, 62, 3, 2.8], [108, 48, -6, 2.3]],
    mid: [[46, 80, -6, 1.7], [44, 50, -10, 1.35]],
    small: [[148, 92, 8, 1.15], [150, 26, 12, 0.95]],
    extra: [[16, 99, -12, 0.9], [74, 20, -8, 0.75]],
  };
  const put = (spec: string, where: keyof typeof spot, i: number) => { const [x, y, turn, size] = spot[where][IN_THE_AIR.has(motifName(spec)) ? 1 : 0]; return at(drawNamed(spec, colors, i), x, y, turn, size); };
  return { w: 170, h: 120, svg: svg(170, 120, `${ground ? `<ellipse cx="90" cy="107" rx="78" ry="9" fill="${ground}" opacity=".45"/>` : ''}${put(mid, 'mid', 1)}${put(big, 'big', 0)}${put(small, 'small', 2)}${extra ? put(extra, 'extra', 3) : ''}`) };
}
