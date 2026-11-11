// src/planner/features/decor/library.ts — the sticker library: every sticker a person can put on a planner page, in
// the eight groups Rosh asked for. Each one is a small drawing written here as SVG text in its own fixed colours (a
// sticker looks the same on Vijay's navy as on Rosh's plum), so nothing is downloaded. About fifty come from the looks'
// motifs (look/art.ts); the rest are drawn below in the same flat style. A sticker is shown as a picture (srcOf), never
// as part of the page, so its drawing can't clash with anything on the screen. No React (tested in decor.test.ts).
import { MOTIFS } from '../look/art';

export type GroupId = 'woodland' | 'flowers' | 'ribbons' | 'seasons' | 'tape' | 'arrows' | 'icons' | 'paper';
/** The groups, in the order the tray shows them. */
export const GROUPS: { id: GroupId; name: string }[] = [
  { id: 'woodland', name: 'Woodland' },
  { id: 'flowers', name: 'Flowers' },
  { id: 'ribbons', name: 'Ribbons & frames' },
  { id: 'seasons', name: 'Seasons' },
  { id: 'tape', name: 'Washi tape' },
  { id: 'arrows', name: 'Arrows & labels' },
  { id: 'icons', name: 'Tasks & moods' },
  { id: 'paper', name: 'Paper' },
];

/** How a sticker is finished: `cut` = a white edge and a soft shadow, like a sticker cut from a sheet (it reads on any
 *  page, light or dark); `pen` = the same with a thinner edge, for hand-drawn lines; `paper` = a soft shadow only;
 *  `tape` = nothing, and a little see-through. */
type Finish = 'cut' | 'pen' | 'paper' | 'tape';
/** One sticker. `w` × `h` is the shape of its picture (edge and shadow included); `size` is how many pixels its longer
 *  side gets when it is first put on a page. */
export interface StickerArt { id: string; name: string; group: GroupId; w: number; h: number; size: number; svg: string }

// ── colours and small shapes ──
const INK = '#3b3044', CREAM = '#fff3e0', BLUSH = '#f7a8b8', KRAFT = '#d2a679', KRAFT_2 = '#b8895a';
const PINK = '#f48fb1', ROSE = '#e86a92', RED = '#e05a4f', GOLD = '#ffd166', GOLD_2 = '#f6a93b', BLUE = '#7cc0e8', BLUE_2 = '#5a9bd5';
const GREEN = '#6aa56b', GREEN_2 = '#4f8a5b', MINT = '#7dbb7e', LILAC = '#b39ddb', LILAC_2 = '#8e7cc3', BROWN = '#a9774f', BROWN_2 = '#8a5a3c';
const f = (n: number) => +n.toFixed(2);
const circ = (cx: number, cy: number, r: number, fill: string, more = '') => `<circle cx="${f(cx)}" cy="${f(cy)}" r="${f(r)}" fill="${fill}"${more}/>`;
const oval = (cx: number, cy: number, rx: number, ry: number, fill: string, more = '') => `<ellipse cx="${f(cx)}" cy="${f(cy)}" rx="${rx}" ry="${ry}" fill="${fill}"${more}/>`;
/** A line drawn with a pen: round ends, nothing filled in. */
const pen = (d: string, color = INK, width = 2, more = '') => `<path d="${d}" stroke="${color}" stroke-width="${width}" fill="none" stroke-linecap="round" stroke-linejoin="round"${more}/>`;
/** The same thing `n` times in a ring around (cx, cy), `rad` out from the middle. */
const around = (n: number, cx: number, cy: number, rad: number, draw: (i: number) => string, start = 0) => Array.from({ length: n }, (_, i) => `<g transform="rotate(${f(start + (360 / n) * i)} ${cx} ${cy}) translate(${cx} ${f(cy - rad)})">${draw(i)}</g>`).join('');
/** A five-petal flower. */
const bloom = (cx: number, cy: number, r: number, petal: string, mid: string) => around(5, cx, cy, r * 0.6, () => circ(0, 0, r * 0.52, petal)) + circ(cx, cy, r * 0.4, mid);
const eyes = (x1: number, x2: number, y: number, r = 2.2) => [x1, x2].map(x => circ(x, y, r, INK) + circ(x + r * 0.32, y - r * 0.36, r * 0.3, '#fff')).join('');
const blush = (x1: number, x2: number, y: number, r = 3) => [x1, x2].map(x => circ(x, y, r, BLUSH, ' opacity=".7"')).join('');
const HEART = 'M32 54 C10 38 8 22 20 16 C27 13 32 19 32 23 C32 19 37 13 44 16 C56 22 54 38 32 54Z';   // in a 64 box
const STAR = 'M32 6 L39.6 22.6 L57.7 24.6 L44.3 36.9 L48 54.7 L32 45.8 L16 54.7 L19.7 36.9 L6.3 24.6 L24.4 22.6Z';   // in a 64 box
const LEAF = 'M0 -8 C5 -4 5 4 0 8 C-5 4 -5 -4 0 -8Z';   // around 0,0
/** The same "random" numbers every time, so a torn edge is torn the same way on every phone. */
const dice = (seed: number) => () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);

// ── putting a sticker together ──
/** The whole picture for a drawing `w` × `h`: room around it for the edge and the shadow, and the finish. */
function finished(body: string, w: number, h: number, finish: Finish): { svg: string; w: number; h: number } {
  const long = Math.max(w, h);
  const k = finish === 'tape' ? 0 : finish === 'cut' ? long * 0.036 : finish === 'pen' ? long * 0.024 : long * 0.02;   // the edge's thickness
  const pad = finish === 'tape' ? 0 : f(k * (finish === 'paper' ? 2.4 : 3));
  const W = f(w + pad * 2), H = f(h + pad * 2), box = `x="${-pad}" y="${-pad}" width="${W}" height="${H}"`;
  const shadow = (from: string, dy: number, blur: number, strength: number) => `<feOffset in="${from}" dy="${f(dy)}"/><feGaussianBlur stdDeviation="${f(blur)}"/><feComponentTransfer result="sh"><feFuncA type="linear" slope="${strength}"/></feComponentTransfer>`;
  const filter = finish === 'tape' ? ''
    : finish === 'paper' ? `<filter id="fin" filterUnits="userSpaceOnUse" ${box}>${shadow('SourceAlpha', k * 0.7, k * 0.8, 0.34)}<feMerge><feMergeNode in="sh"/><feMergeNode in="SourceGraphic"/></feMerge></filter>`
      // the white edge: the drawing's outline grown by k, smoothed, then made solid
      : `<filter id="fin" filterUnits="userSpaceOnUse" ${box}><feMorphology in="SourceAlpha" operator="dilate" radius="${f(k)}"/><feGaussianBlur stdDeviation="${f(k * 0.36)}"/><feComponentTransfer result="rim"><feFuncA type="linear" slope="6" intercept="-1.6"/></feComponentTransfer>${shadow('rim', k * 0.45, k * 0.55, 0.36)}<feFlood flood-color="#fff"/><feComposite in2="rim" operator="in" result="edge"/><feMerge><feMergeNode in="sh"/><feMergeNode in="edge"/><feMergeNode in="SourceGraphic"/></feMerge></filter>`;
  return { w: W, h: H, svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${-pad} ${-pad} ${W} ${H}" width="${W}" height="${H}">${filter ? `<defs>${filter}</defs><g filter="url(#fin)">${body}</g>` : body}</svg>` };
}
const list: StickerArt[] = [];
/** A drawing of ours: `body` is drawn in a box `w` × `h` from 0,0. */
function add(group: GroupId, id: string, name: string, body: string, opt: { w?: number; h?: number; size?: number; finish?: Finish } = {}) {
  const w = opt.w ?? 64, h = opt.h ?? 64;
  list.push({ id, name, group, size: opt.size ?? 72, ...finished(body, w, h, opt.finish ?? 'cut') });
}
/** One of the looks' motifs (drawn around 0,0, about 30 across) in colours chosen here. A motif that isn't there
 *  any more (the looks are still being drawn) is left out, it doesn't break the library. */
function motif(group: GroupId, id: string, name: string, colors: [string, string?, string?], from = id, size = 64) {
  const draw = MOTIFS[from];
  if (!draw) return;
  list.push({ id, name, group, size, ...finished(`<g transform="translate(17 17)">${draw(colors[0], colors[1] ?? colors[0], colors[2] ?? INK)}</g>`, 34, 34, 'cut') });
}

// ── 1. woodland animals and butterflies ──
motif('woodland', 'fox', 'Fox', ['#e07b39', CREAM, INK]);
add('woodland', 'hedgehog', 'Hedgehog',
  `<path d="M15 30 L11 21 L20 24 L20 13 L28 20 L32 9 L38 18 L45 10 L47 20 L56 15 L55 26 L62 28 L56 35Z" fill="${BROWN_2}"/><path d="M12 46 C8 30 18 16 34 15 C50 14 60 28 58 42 C57 48 52 51 46 51 H20 C15 51 13 49 12 46Z" fill="${BROWN_2}"/>`
  + pen('M33 24 l2 5 M42 22 l1 5 M49 29 l-1 5 M38 33 l1 5 M47 39 l-1 5 M39 43 l1 4', '#6d4630', 1.8)
  + `<path d="M5 44 C8 33 18 29 27 33 C33 37 33 51 24 51 H14 C9 51 4 49 5 44Z" fill="#f3d9b1"/>${oval(26, 32, 3.4, 4, '#e7c391')}${circ(6, 43.5, 2.6, INK)}${eyes(17, 17, 39.5, 2)}${circ(21.5, 45, 2.6, BLUSH, ' opacity=".7"')}`
  + pen('M9.5 47.5 Q12.5 49.5 15.5 47.5', INK, 1.3) + oval(25, 52, 4.5, 2.4, '#6d4630') + oval(45, 52, 4.5, 2.4, '#6d4630'));
add('woodland', 'owl', 'Owl',
  `<path d="M16 20 L14 8 L24 14 C29 12 35 12 40 14 L50 8 L48 20 C52 26 54 34 52 42 C50 52 42 58 32 58 C22 58 14 52 12 42 C10 34 12 26 16 20Z" fill="${BROWN}"/>${oval(32, 45, 12, 11.5, '#f3d9b1')}`
  + pen('M26 41 l3 3 l3 -3 l3 3 l3 -3 M27 48 l2.5 2.5 l2.5 -2.5 l2.5 2.5 l2.5 -2.5', '#c9976a', 1.6)
  + `<path d="M12 36 C10 44 12 50 18 54 C16 46 16 40 16 34Z" fill="${BROWN_2}"/><path d="M52 36 C54 44 52 50 46 54 C48 46 48 40 48 34Z" fill="${BROWN_2}"/>${circ(24, 27, 8, '#fff')}${circ(40, 27, 8, '#fff')}${eyes(25, 39, 27, 3.6)}<path d="M29 31 H35 L32 37Z" fill="${GOLD_2}"/>`);
add('woodland', 'deer', 'Deer',
  pen('M22 19 C20 13 16 11 14 5 M19 13 L12 13 M21 16 L24 9 M42 19 C44 13 48 11 50 5 M45 13 L52 13 M43 16 L40 9', BROWN_2, 3)
  + `${oval(12, 27, 7, 4, '#c98d5b', ' transform="rotate(-25 12 27)"')}${oval(52, 27, 7, 4, '#c98d5b', ' transform="rotate(25 52 27)"')}<path d="M18 25 C18 16 46 16 46 25 C48 37 42 56 32 56 C22 56 16 37 18 25Z" fill="#d49a66"/>${oval(32, 47, 8, 7.5, CREAM)}${oval(32, 43.5, 3.6, 2.6, INK)}`
  + eyes(25, 39, 33, 2.3) + blush(21.5, 42.5, 39, 2.6) + circ(28, 23, 1.4, CREAM) + circ(36, 23, 1.4, CREAM) + circ(32, 26, 1.2, CREAM) + pen('M29 50 Q32 52.5 35 50', INK, 1.3));
add('woodland', 'squirrel', 'Squirrel',
  `<path d="M40 57 C60 54 63 30 53 20 C46 13 37 18 40 27 C42 21 48 22 49 28 C51 38 46 48 36 54Z" fill="#c9683a"/>${oval(28, 46, 14, 12, '#d9814f')}${oval(27, 49, 8, 8, CREAM)}<path d="M16 19 L14 6 L24 14Z" fill="#d9814f"/><path d="M36 19 L38 6 L28 14Z" fill="#d9814f"/>${circ(26, 26, 13, '#d9814f')}${oval(26, 31.5, 9, 6, CREAM)}`
  + eyes(20.5, 31.5, 24.5, 2.1) + oval(26, 29, 2, 1.5, INK) + pen('M23.5 32.5 Q26 34.5 28.5 32.5', INK, 1.2) + blush(17, 35, 30, 2.2));
motif('woodland', 'bunny', 'Bunny', ['#ece3da', BLUSH, INK]);
motif('woodland', 'mouse', 'Mouse', ['#b9b3c4', BLUSH, INK]);
add('woodland', 'bear', 'Bear',
  `${circ(14, 16, 8, BROWN)}${circ(14, 16, 4, '#f3c9a0')}${circ(50, 16, 8, BROWN)}${circ(50, 16, 4, '#f3c9a0')}${circ(32, 34, 22, BROWN)}${oval(32, 42, 10, 8, '#f3d9b1')}${oval(32, 38.5, 3.6, 2.6, INK)}`
  + pen('M32 41 V44 M28 46 Q32 49 36 46', INK, 1.4) + eyes(23, 41, 30, 2.4) + blush(18, 46, 38, 3));
/** A plump little bird: its body, its breast and its wing. */
const bird = (id: string, name: string, body: string, breast: string, wing: string) => add('woodland', id, name,
  pen('M28 53 V60 M37 52 V60', BROWN_2, 2) + `<path d="M13 37 L2 30 L5 40 L1 47 L15 45Z" fill="${wing}"/><path d="M10 38 C10 24 22 14 36 14 C48 14 56 22 56 32 C56 46 44 54 30 54 C18 54 10 48 10 38Z" fill="${body}"/><path d="M22 50 C20 40 28 33 40 33 C48 33 53 36 55.4 37 C53 48 42 54 30 54 C27 54 24 52.5 22 50Z" fill="${breast}"/><path d="M15 33 C21 25 34 27 38 35 C34 44 21 43 15 33Z" fill="${wing}"/><path d="M54.5 25 L63 28.5 L55 32.5Z" fill="${GOLD_2}"/>`
  + eyes(46, 46, 24.5, 2.4) + circ(50, 31, 2.3, BLUSH, ' opacity=".7"'));
bird('bird', 'Bluebird', BLUE, CREAM, BLUE_2);
bird('robin', 'Robin', '#b98a62', '#e8634f', BROWN_2);
motif('woodland', 'cat', 'Cat', ['#9a94ad', INK]);
motif('woodland', 'butterfly', 'Butterfly', ['#f6a05a', GOLD, INK]);
motif('woodland', 'butterfly-blue', 'Blue butterfly', ['#8ecae6', LILAC, INK], 'butterfly');
motif('woodland', 'moth', 'Moth', ['#dccbb0', '#b8a07e', '#6d5a48']);
add('woodland', 'bee', 'Bee',
  `${oval(25, 20, 9, 12, '#cfeaff', ' transform="rotate(-20 25 20)"')}${oval(40, 19, 9, 12, '#e3f3ff', ' transform="rotate(20 40 19)"')}${oval(32, 39, 19, 14, GOLD)}<path d="M30 25.1 C27 31 27 47 30 52.9 L36 53 C33 47 33 31 36 25Z" fill="${INK}"/><path d="M42.5 27.4 C40.5 33 40.5 45 42.5 50.6 L47 48.3 C45.4 43 45.4 35 47 29.7Z" fill="${INK}"/><path d="M50 37 L58 39 L50 42Z" fill="${INK}"/>`
  + pen('M19 27 C17 21 13 21 12 17 M24 26 C24 20 21 18 21 14', INK, 1.6) + eyes(19.5, 19.5, 36.5, 2) + pen('M16.5 41.5 Q19.5 44.5 22.5 41.5', INK, 1.3) + circ(24, 41, 2.2, BLUSH, ' opacity=".8"'));
add('woodland', 'ladybird', 'Ladybird',
  pen('M27 14 C26 9 23 8 21 7 M37 14 C38 9 41 8 43 7', INK, 1.6) + `<path d="M20 23 C22 12 42 12 44 23 C40 27 24 27 20 23Z" fill="${INK}"/>${oval(32, 37, 20, 18, RED)}<path d="M32 19 V55" stroke="${INK}" stroke-width="2"/>${circ(22, 33, 4, INK)}${circ(42, 33, 4, INK)}${circ(25, 46, 3.4, INK)}${circ(39, 46, 3.4, INK)}${circ(27, 18.5, 1.7, '#fff')}${circ(37, 18.5, 1.7, '#fff')}`);
add('woodland', 'snail', 'Snail',
  pen('M11.5 31 L8 22 M14.5 31 L17 22', '#f0cf85', 2.6) + circ(8, 21, 2.3, INK) + circ(17, 21, 2.3, INK)
  + `<path d="M9 50 C5 40 8 29 13 29 C17 29 19 38 19 44 L46 44 C54 44 58 48 58 53 H13 C10.5 53 9.5 52 9 50Z" fill="#f0cf85"/>${circ(37, 33, 15, LILAC)}`
  + pen('M27 33 A10 10 0 1 1 37 43 A6.6 6.6 0 1 1 43.6 36.4 A3.4 3.4 0 1 1 40.2 33', LILAC_2, 2.2) + pen('M10.5 41 Q12.5 43 14.5 41', INK, 1.2) + circ(15.5, 38.5, 1.6, BLUSH, ' opacity=".8"'));
motif('woodland', 'cottage', 'Cottage', ['#f3d9b1', RED, BROWN_2]);

// ── 2. flowers and plants ──
motif('flowers', 'rose', 'Rose', ['#e05a6d', '#5d9c6a', '#a8324a']);
motif('flowers', 'tulip', 'Tulip', [ROSE, '#5d9c6a']);
motif('flowers', 'daisy', 'Daisy', ['#ffffff', GOLD]);
motif('flowers', 'flower', 'Pink flower', [PINK, GOLD]);
motif('flowers', 'blossom', 'Blossom', ['#f9c5d5', '#fff3c4', ROSE]);
motif('flowers', 'lavender', 'Lavender', [LILAC, GREEN]);
add('flowers', 'sunflower', 'Sunflower',
  pen('M32 38 C33 46 31 54 32 62', '#5d9c6a', 3.4) + `<path d="M32 53 C40 46 48 48 51 54 C44 59 36 59 32 53Z" fill="${GREEN}"/>`
  + around(14, 32, 26, 15.5, () => oval(0, 0, 4.2, 8.5, '#ffc93c')) + around(14, 32, 26, 12.5, () => oval(0, 0, 3.2, 6.6, GOLD_2), 12.86)
  + circ(32, 26, 10, '#7a4a2b') + around(8, 32, 26, 5.6, () => circ(0, 0, 1.1, BROWN)) + circ(32, 26, 1.4, BROWN));
add('flowers', 'bouquet', 'Bouquet',
  `<path d="M32 40 C20 34 14 24 14 13 C24 18 30 28 32 40Z" fill="${GREEN}"/><path d="M32 40 C44 34 50 24 50 13 C40 18 34 28 32 40Z" fill="${GREEN_2}"/><path d="M17 32 L47 32 L36 61 H28Z" fill="#e8c9a0"/><path d="M32 32 L47 32 L36 61 H32Z" fill="${KRAFT}"/>`
  + bloom(22, 22, 9, PINK, GOLD) + bloom(42, 22, 9, LILAC, '#fff3c4') + bloom(32, 12, 9.5, '#ffb35c', '#fff3c4') + bloom(32, 29, 8, '#fff', GOLD)
  + `<path d="M32 47 C27 42 22 43 23 47 C22 51 27 52 32 47Z M32 47 C37 42 42 43 41 47 C42 51 37 52 32 47Z" fill="${ROSE}"/>${circ(32, 47, 1.9, '#c4486a')}`);
add('flowers', 'wreath', 'Wreath',
  `<circle cx="32" cy="32" r="20" fill="none" stroke="#8a6a4a" stroke-width="2"/>` + around(14, 32, 32, 20, i => `<path d="${LEAF}" fill="${i % 2 ? GREEN : GREEN_2}" transform="rotate(${i % 2 ? 62 : 112})"/>`)
  + around(7, 32, 32, 20, () => circ(0, 0, 2.3, RED), 13) + bloom(17, 20, 6, '#fff', GOLD) + bloom(47, 20, 6, PINK, '#fff3c4')
  + `<path d="M32 52 C26 46 20 47 21 52 C20 57 26 58 32 52Z M32 52 C38 46 44 47 43 52 C44 57 38 58 32 52Z" fill="${ROSE}"/><path d="M30 53 L26 62 L31 59 L32 54Z M34 53 L38 62 L33 59 L32 54Z" fill="#c4486a"/>${circ(32, 52, 2.2, '#c4486a')}`);
add('flowers', 'potplant', 'Pot plant',
  `<path d="M32 40 C30 27 24 18 13 15 C13 28 20 37 32 40Z" fill="${GREEN}"/><path d="M32 40 C34 27 40 18 51 15 C51 28 44 37 32 40Z" fill="${GREEN_2}"/><path d="M32 40 C26 29 28 14 32 5 C36 14 38 29 32 40Z" fill="${MINT}"/>`
  + pen('M32 38 V12 M30 37 C27 29 22 23 17 19 M34 37 C37 29 42 23 47 19', '#3f7350', 1.1, ' opacity=".55"') + `<path d="M20 42 H44 L41 59 H23Z" fill="#d9814f"/><rect x="18" y="37" width="28" height="7" rx="2.2" fill="#c9683a"/>` + pen('M25 49 H39', '#f0a67a', 1.6, ' opacity=".8"'));
add('flowers', 'monstera', 'Big leaf',
  `<defs><mask id="cuts"><rect width="64" height="64" fill="#fff"/><path d="M4 28 L25 31 L5 36Z M8 42 L26 41 L13 50Z M60 28 L39 31 L59 36Z M56 42 L38 41 L51 50Z" fill="#000"/>${oval(24, 22, 2.4, 3.6, '#000')}${oval(40, 22, 2.4, 3.6, '#000')}</mask></defs><path d="M32 59 C12 53 6 32 14 16 C20 7 30 9 32 17 C34 9 44 7 50 16 C58 32 52 53 32 59Z" fill="${GREEN_2}" mask="url(#cuts)"/>`
  + pen('M32 57 C31 42 32 28 32 19', MINT, 1.8));
motif('flowers', 'leaf', 'Leaf', [GREEN, GREEN, '#3f7350']);
motif('flowers', 'sprig', 'Sprig', [MINT, MINT, GREEN_2]);
motif('flowers', 'laurel', 'Laurel', [MINT, MINT, GREEN_2]);
motif('flowers', 'olive', 'Olive branch', ['#8aa862', '#6b4a7a', '#5c7a3f']);
motif('flowers', 'berry', 'Berries', [RED, '#6d5a48']);
motif('flowers', 'wheat', 'Wheat', ['#e9b949', '#e9b949', '#b8862d']);
motif('flowers', 'mushroom', 'Mushroom', [RED, CREAM, '#ffffff']);
motif('flowers', 'acorn', 'Acorn', ['#d9a066', BROWN_2]);

// ── 3. ribbons, bows, lace and vintage frames ──
add('ribbons', 'bow-pink', 'Pink bow',
  `<path d="M30 32 L19 57 L27 52 L31 59 L35 34Z" fill="${ROSE}"/><path d="M34 32 L45 57 L37 52 L33 59 L29 34Z" fill="${ROSE}"/><path d="M32 29 C22 12 5 13 7 28 C5 43 22 44 32 29Z" fill="${PINK}"/><path d="M32 29 C42 12 59 13 57 28 C59 43 42 44 32 29Z" fill="${PINK}"/><path d="M32 29 C24 21 13 20 11 28 C13 35 24 35 32 29Z" fill="${ROSE}"/><path d="M32 29 C40 21 51 20 53 28 C51 35 40 35 32 29Z" fill="${ROSE}"/><rect x="27" y="22" width="10" height="14" rx="4.4" fill="#f9b3cb"/>`);
motif('ribbons', 'bow', 'Red bow', ['#e05a6d', '#c4486a']);
add('ribbons', 'banner', 'Ribbon banner',
  `<path d="M3 13 H27 V37 H3 L11 25Z" fill="#c4486a"/><path d="M117 13 H93 V37 H117 L109 25Z" fill="#c4486a"/><path d="M18 31 L27 37 V31Z" fill="#8f2f4c"/><path d="M102 31 L93 37 V31Z" fill="#8f2f4c"/><rect x="18" y="6" width="84" height="25" rx="1.5" fill="${ROSE}"/>`
  + `<path d="M22 10.5 H98 M22 26.5 H98" stroke="#fff" stroke-width="1.1" stroke-dasharray="3 3" opacity=".75"/>`, { w: 120, h: 44, size: 150 });
add('ribbons', 'ribbon-wave', 'Wavy ribbon',
  `<path d="M3 13 C23 1 40 1 60 13 C80 25 97 25 117 13 L113 20 L117 27 C97 39 80 39 60 27 C40 15 23 15 3 27 L7 20Z" fill="${BLUE}"/>` + pen('M9 20 C26 9 42 10 60 20 C78 30 94 31 111 20', '#fff', 1.6, ' stroke-dasharray=".1 4.6" opacity=".9"'), { w: 120, h: 40, size: 150 });
add('ribbons', 'rosette', 'Rosette',
  `<path d="M23 38 L15 62 L24 56 L29 63 L33 40Z" fill="${BLUE_2}"/><path d="M41 38 L49 62 L40 56 L35 63 L31 40Z" fill="#4a86c0"/>` + around(14, 32, 25, 17.5, () => circ(0, 0, 4.6, BLUE)) + circ(32, 25, 18, BLUE) + circ(32, 25, 12.5, CREAM)
  + `<path d="${STAR}" fill="${GOLD}" transform="translate(32 25) scale(.3) translate(-32 -31)"/>`);
add('ribbons', 'bunting', 'Bunting',
  pen('M4 7 Q70 25 136 7', '#8a6a4a', 1.6) + [[18, 10.6, -7, PINK], [44, 14.8, -4, GOLD], [70, 16.2, 0, MINT], [96, 14.8, 4, BLUE], [122, 10.6, 7, LILAC]].map(([x, y, r, c]) => `<path d="M-10 0 H10 L0 21Z" fill="${c}" transform="translate(${x} ${y}) rotate(${r})"/>`).join(''), { w: 140, h: 42, size: 170 });
add('ribbons', 'lace', 'Lace trim',
  `<defs><mask id="holes"><rect width="160" height="30" fill="#fff"/>${Array.from({ length: 8 }, (_, i) => circ(10 + i * 20, 15.5, 3, '#000') + circ(4 + i * 20, 12.5, 1.2, '#000') + circ(16 + i * 20, 12.5, 1.2, '#000') + circ(5.5 + i * 20, 5.5, 1.3, '#000') + circ(14.5 + i * 20, 5.5, 1.3, '#000') + circ(i * 20, 8, 1, '#000')).join('')}</mask></defs><g mask="url(#holes)"><rect y="1" width="160" height="12" fill="#fdf4e1"/>${Array.from({ length: 8 }, (_, i) => circ(10 + i * 20, 13, 10, '#fdf4e1')).join('')}</g>`,
  { w: 160, h: 26, size: 170, finish: 'paper' });
add('ribbons', 'doily', 'Doily',
  `<defs><mask id="holes"><rect width="64" height="64" fill="#fff"/>${around(16, 32, 32, 25.5, () => circ(0, 0, 1.7, '#000'))}${around(12, 32, 32, 16.5, () => oval(0, 0, 2.1, 4.2, '#000'))}${around(8, 32, 32, 7.5, () => circ(0, 0, 1.5, '#000'))}</mask></defs><g mask="url(#holes)">${around(16, 32, 32, 25, () => circ(0, 0, 5.2, '#fdf4e1'))}${circ(32, 32, 25, '#fdf4e1')}</g>`, { finish: 'paper', size: 96 });
add('ribbons', 'frame-oval', 'Oval frame',
  `<path fill-rule="evenodd" d="M32 8 C50 8 58 24 58 44 C58 64 50 78 32 78 C14 78 6 64 6 44 C6 24 14 8 32 8Z M32 15.5 C18.5 15.5 13 28 13 44 C13 60 18.5 70.5 32 70.5 C45.5 70.5 51 60 51 44 C51 28 45.5 15.5 32 15.5Z" fill="#d9a441"/><ellipse cx="32" cy="43" rx="22.3" ry="31.2" fill="none" stroke="#fff3c4" stroke-width="1.3" stroke-dasharray=".1 3.2" stroke-linecap="round"/><path d="M22 10 C25 2 30 3 32 7 C34 3 39 2 42 10 C37 7 34 9 32 12 C30 9 27 7 22 10Z" fill="#b8862d"/>${circ(32, 6, 2.6, '#f3c969')}`,
  { w: 64, h: 82, size: 130 });
add('ribbons', 'frame-square', 'Picture frame',
  `<path fill-rule="evenodd" d="M7 4 H73 A3 3 0 0 1 76 7 V57 A3 3 0 0 1 73 60 H7 A3 3 0 0 1 4 57 V7 A3 3 0 0 1 7 4Z M12 12 V52 H68 V12Z" fill="${BROWN}"/><rect x="7.5" y="7.5" width="65" height="49" rx="1" fill="none" stroke="#f3d9b1" stroke-width=".9"/>${[[8, 8], [72, 8], [8, 56], [72, 56]].map(([x, y]) => circ(x, y, 5, BROWN_2) + circ(x, y, 1.8, '#f3d9b1')).join('')}`,
  { w: 80, h: 64, size: 140 });
add('ribbons', 'frame-round', 'Scalloped frame',
  `<defs><mask id="hole"><rect width="64" height="64" fill="#fff"/>${circ(32, 32, 18.5, '#000')}</mask></defs><g mask="url(#hole)">${around(14, 32, 32, 24, () => circ(0, 0, 5.6, PINK))}${circ(32, 32, 24.5, PINK)}</g><circle cx="32" cy="32" r="21.2" fill="none" stroke="#fff" stroke-width="1.2" stroke-dasharray=".1 3.3" stroke-linecap="round"/>`, { size: 110 });

// ── 4. the seasons ──
motif('seasons', 'maple', 'Maple leaf', ['#d9662e']);
motif('seasons', 'pumpkin', 'Pumpkin', ['#ee8a3c', '#5d9c6a', '#f6a55c']);
motif('seasons', 'ghost', 'Ghost', ['#ffffff', '#ffffff', INK]);
motif('seasons', 'bat', 'Bat', ['#6a58a0']);
motif('seasons', 'blackcat', 'Black cat', [INK, GOLD], 'cat');
motif('seasons', 'snow', 'Snowflake', [BLUE]);
add('seasons', 'snowman', 'Snowman',
  pen('M19 41 L8 33 M10.5 35 L9 29.5 M45 41 L56 33 M53.5 35 L55 29.5', BROWN_2, 2) + `${circ(32, 45, 15, '#fff')}<path d="M19 50 C24 58.5 40 58.5 45 50 C40 55.5 24 55.5 19 50Z" fill="#dcecfb"/>${circ(32, 23, 11, '#fff')}<path d="M21.5 31 C28 35 36 35 42.5 31 L44 35.5 C36 39.5 28 39.5 20 35.5Z" fill="${RED}"/><path d="M37 37 L42 48 L36.5 48 L34 38Z" fill="#c4483f"/><rect x="24" y="5" width="16" height="9.5" rx="1.5" fill="${INK}"/><rect x="20" y="12.6" width="24" height="3.6" rx="1.8" fill="${INK}"/><rect x="24" y="9.6" width="16" height="2.8" fill="${RED}"/>`
  + circ(28, 21.5, 1.6, INK) + circ(36, 21.5, 1.6, INK) + `<path d="M32 24 L41.5 26.4 L32 28.2Z" fill="#f6903b"/>` + circ(32, 44, 1.7, INK) + circ(32, 50.5, 1.7, INK));
add('seasons', 'mitten', 'Mitten',
  `<path d="M21 35 C12 31 8 22 12 18 C16 15 20 20 23 27Z" fill="#c4483f"/><path d="M20 30 C20 16 28 8 36 8 C44 8 48 16 48 26 V43 H20Z" fill="${RED}"/><rect x="17" y="42" width="34" height="13" rx="4.5" fill="${CREAM}"/>`
  + pen('M24 45 V52 M30 45 V52 M36 45 V52 M42 45 V52', '#e0c9a8', 1.5) + pen('M34 18 V32 M28 21.5 L40 28.5 M28 28.5 L40 21.5', '#fff', 1.9));
motif('seasons', 'holly', 'Holly', ['#3f8a5b', RED, '#ffffff']);
motif('seasons', 'pine', 'Pine tree', ['#3f8a5b', BROWN_2]);
motif('seasons', 'bauble', 'Bauble', [RED, '#d9a441', '#fff3c4']);
motif('seasons', 'cane', 'Candy cane', ['#ffffff', RED]);
motif('seasons', 'candle', 'Candle', [CREAM, GOLD_2, '#e0c9a8']);
add('seasons', 'umbrella', 'Umbrella',
  pen('M32 4 V9', INK, 2.4) + pen('M32 33 V52 C32 58.5 40.5 58.5 40.5 52', BROWN_2, 3)
  + `<path d="M6 34 C6 16 18 8 32 8 C46 8 58 16 58 34 C54 30 49 30 45 34 C41 30 36 30 32 34 C28 30 23 30 19 34 C15 30 10 30 6 34Z" fill="${BLUE}"/><path d="M32 8 C24 14 20 24 19 34 C23 30 28 30 32 34Z" fill="${BLUE_2}" opacity=".6"/><path d="M32 8 C40 14 44 24 45 34 C49 30 54 30 58 34 C58 16 46 8 32 8Z" fill="${BLUE_2}" opacity=".3"/>`
  + [[12, 43], [21, 50], [51, 44]].map(([x, y]) => `<path d="M${x} ${y} c-2.6 3.8 -2.6 6.4 0 6.4 c2.6 0 2.6 -2.6 0 -6.4Z" fill="${BLUE_2}"/>`).join(''));
motif('seasons', 'rainbow', 'Rainbow', [PINK, GOLD, BLUE]);
motif('seasons', 'cloud', 'Cloud', ['#f2f8ff']);
motif('seasons', 'sun', 'Sun', [GOLD, GOLD_2]);
add('seasons', 'icecream', 'Ice cream',
  `<path d="M21 33 H43 L32 61Z" fill="#e0b071"/>` + pen('M25 39 L35.5 51 M30 34 L39.5 44 M39 39 L28.5 51 M34 34 L24.5 44', '#c2905e', 1.2)
  + `${circ(32, 24, 13.5, '#f9c5d5')}<path d="M18.5 26 C18.5 35 24 35 24 30.5 C24 37 30 37 30 31.5 C30 36 36 36.5 36 31.5 C36 36 42 36 42 30.5 C42 34 45.5 33 45.5 26Z" fill="#f9c5d5"/>${circ(32, 9.5, 3.8, '#e0455a')}`
  + pen('M32 6 C33 3 35 2.5 37 2.5', '#5d9c6a', 1.5) + [[25, 19, 30, BLUE_2], [36, 16, -40, GOLD_2], [39, 25, 20, MINT], [29, 27, -20, LILAC_2], [22, 27, 60, GOLD_2]].map(([x, y, r, c]) => `<rect x="-2.2" y="-.9" width="4.4" height="1.8" rx=".9" fill="${c}" transform="translate(${x} ${y}) rotate(${r})"/>`).join(''));
motif('seasons', 'lemon', 'Lemon', ['#ffe066', GREEN, '#ffffff']);
motif('seasons', 'cherries', 'Cherries', ['#e0455a', '#5d9c6a']);
motif('seasons', 'shell', 'Shell', ['#f9c5d5', '#f9c5d5', '#e08aa5']);
motif('seasons', 'starfish', 'Starfish', ['#f6a05a']);
add('seasons', 'kite', 'Kite',
  `<path d="M34 5 L16 26 L34 26Z" fill="${LILAC}"/><path d="M34 5 L52 26 L34 26Z" fill="${GOLD}"/><path d="M34 26 L52 26 L34 50Z" fill="${BLUE}"/><path d="M34 26 L16 26 L34 50Z" fill="${PINK}"/>` + pen('M34 50 C29 54 39 56 34 60 C32 62 29 62 27 61', INK, 1.4)
  + `<path d="M30.5 52.5 L36.5 55.5 L36.5 51.5 L30.5 55.5Z" fill="${RED}"/><path d="M31 58 L37 61 L37 57 L31 61Z" fill="${RED}"/>`);
add('seasons', 'moon', 'Moon', `<path d="M40 8 A24 24 0 1 0 56 44 A22 22 0 0 1 40 8Z" fill="#ffe08a"/>${circ(23, 30, 3, '#f3c969')}${circ(31, 45, 2.3, '#f3c969')}${circ(20, 41, 1.6, '#f3c969')}<path d="${STAR}" fill="${GOLD}" transform="translate(50 20) scale(.22) translate(-32 -31)"/>`);
motif('seasons', 'star', 'Star', [GOLD]);
motif('seasons', 'sparkle', 'Sparkle', [GOLD]);

// ── 5. washi tape: strips with torn ends, a little see-through ──
/** A strip `w` × `h` whose short ends are torn. */
function strip(w: number, h: number, seed: number): string {
  const r = dice(seed), n = 6, s = h / n;
  const right = Array.from({ length: n + 1 }, (_, i) => `L${f(w - (i % 2 ? 0 : 3.4) - r() * 1.6)} ${f(i * s)}`);
  const left = Array.from({ length: n + 1 }, (_, i) => `L${f((i % 2 ? 0 : 3.4) + r() * 1.6)} ${f(h - i * s)}`);
  return `M4 0 ${right.join(' ')} ${left.join(' ')}Z`;
}
function tape(id: string, name: string, base: string, pattern: string, opt: { w?: number; h?: number; see?: number } = {}) {
  const w = opt.w ?? 160, h = opt.h ?? 34;
  add('tape', id, name, `<defs>${pattern}<clipPath id="torn"><path d="${strip(w, h, id.length * 977 + w)}"/></clipPath></defs><g clip-path="url(#torn)" opacity="${opt.see ?? 0.9}"><rect width="${w}" height="${h}" fill="${base}"/>${pattern ? `<rect width="${w}" height="${h}" fill="url(#pat)"/>` : ''}<rect width="${w}" height="2.2" fill="#fff" opacity=".22"/><rect y="${h - 2.2}" width="${w}" height="2.2" fill="#000" opacity=".06"/></g>`,
    { w, h, size: w > 100 ? 170 : 90, finish: 'tape' });
}
const pat = (w: number, h: number, body: string, turn = 0) => `<pattern id="pat" width="${w}" height="${h}" patternUnits="userSpaceOnUse"${turn ? ` patternTransform="rotate(${turn})"` : ''}>${body}</pattern>`;
const tinyHeart = (x: number, y: number, s: number, fill: string) => `<path d="${HEART}" fill="${fill}" transform="translate(${x} ${y}) scale(${s}) translate(-32 -34)"/>`;
const tinyStar = (x: number, y: number, s: number, fill: string) => `<path d="${STAR}" fill="${fill}" transform="translate(${x} ${y}) scale(${s}) translate(-32 -31)"/>`;
tape('tape-stripes', 'Striped tape', '#fbd0dd', pat(12, 12, `<rect width="6" height="12" fill="${PINK}"/>`, 45));
tape('tape-dots', 'Dotted tape', '#a9dcc4', pat(12, 12, circ(3, 3, 2, '#fff') + circ(9, 9, 2, '#fff')));
tape('tape-floral', 'Floral tape', '#fff1d6', pat(30, 34, bloom(8, 10, 6.5, PINK, GOLD) + bloom(23, 25, 6, '#ff9d7a', '#fff3c4') + `<path d="${LEAF}" fill="${MINT}" transform="translate(21 8) rotate(40) scale(.55)"/><path d="${LEAF}" fill="${MINT}" transform="translate(8 25) rotate(-50) scale(.55)"/>`));
tape('tape-gingham', 'Gingham tape', '#e6f1fc', pat(12, 12, `<rect width="6" height="12" fill="${BLUE_2}" opacity=".5"/><rect width="12" height="6" fill="${BLUE_2}" opacity=".5"/>`));
tape('tape-hearts', 'Hearts tape', '#ffe0e9', pat(20, 17, tinyHeart(5, 5, 0.17, '#e8546f') + tinyHeart(15, 13, 0.17, PINK)));
tape('tape-stars', 'Starry tape', '#44548f', pat(22, 17, tinyStar(5, 5, 0.15, GOLD) + tinyStar(16, 12, 0.11, '#fff3c4') + circ(12, 3, 0.8, '#fff') + circ(3, 13, 0.7, '#fff')));
tape('tape-chevron', 'Zigzag tape', '#ffe08a', pat(16, 11.4, `<path d="M-2 9.5 L8 2.5 L18 9.5" stroke="#fff" stroke-width="3" fill="none"/>`));
tape('tape-leaves', 'Leafy tape', '#dcecd6', pat(24, 17, `<path d="${LEAF}" fill="${GREEN}" transform="translate(6 5) rotate(50) scale(.6)"/><path d="${LEAF}" fill="${MINT}" transform="translate(17 12) rotate(-40) scale(.6)"/>${circ(14, 3, 1, GREEN_2)}${circ(3, 14, 1, GREEN_2)}`));
tape('tape-grid', 'Grid tape', '#d9cdf2', pat(8.5, 8.5, `<path d="M8.5 0 V8.5 H0" stroke="#fff" stroke-width="1.3" fill="none"/>`));
tape('tape-rainbow', 'Rainbow tape', '#fff', pat(160, 34, ['#f9a8bb', '#ffcf99', '#fff0a6', '#b9e4c2', '#b5d9f5'].map((c, i) => `<rect y="${f(i * 6.8)}" width="160" height="7" fill="${c}"/>`).join('')));
tape('tape-kraft', 'Kraft tape', KRAFT, pat(34, 34, pen('M4 6 h5 M20 3 h4 M12 15 h6 M27 19 h4 M5 26 h4 M18 29 h6', KRAFT_2, 1, ' opacity=".7"')), { see: 0.94 });
tape('tape-masking', 'Masking tape', '#f6e9c9', pat(7, 34, `<path d="M3.5 0 V34" stroke="#e3d2a8" stroke-width=".8"/>`), { w: 84, h: 34 });

// ── 6. hand-drawn arrows, marks and labels ──
const CORAL = '#f0705a', TEAL = '#2a9d8f';
add('arrows', 'arrow', 'Arrow', pen('M6 28 C22 21 42 19 62 22', INK, 3.4) + pen('M51 11 L63 22 L52 33', INK, 3.4), { w: 70, h: 44, size: 90, finish: 'pen' });
add('arrows', 'arrow-swoop', 'Swooping arrow', pen('M8 8 C9 32 26 44 54 39', CORAL, 3.4) + pen('M43 29 L55 39 L43 48', CORAL, 3.4), { w: 64, h: 54, size: 90, finish: 'pen' });
add('arrows', 'arrow-loop', 'Loopy arrow', pen('M5 42 C16 22 31 16 35 27 C38 36 26 40 24 31 C22 19 42 11 62 17', TEAL, 3.2) + pen('M52 8 L63 17 L53 27', TEAL, 3.2), { w: 70, h: 50, size: 100, finish: 'pen' });
add('arrows', 'arrow-down', 'Arrow down', pen('M22 6 C27 20 19 34 23 52', INK, 3.4) + pen('M12 41 L23 54 L33 40', INK, 3.4), { w: 46, h: 60, size: 84, finish: 'pen' });
add('arrows', 'ring', 'Circled', pen('M36 7 C14 4 5 20 7 33 C9 50 31 56 48 50 C63 44 63 20 48 11 C40 7 29 7 21 12', CORAL, 3.2), { w: 68, h: 60, size: 110, finish: 'pen' });
add('arrows', 'underline', 'Underline', pen('M6 12 C34 6 66 9 114 6 M14 23 C42 17 74 20 106 18', INK, 3.2), { w: 120, h: 30, size: 150, finish: 'pen' });
add('arrows', 'squiggle', 'Squiggle', pen('M6 17 q7.5 -13 15 0 t15 0 t15 0 t15 0 t15 0 t15 0 t15 0', TEAL, 3.2), { w: 120, h: 30, size: 150, finish: 'pen' });
add('arrows', 'highlight', 'Highlighter', `<path d="M5 8 C30 4 80 6 116 5 L118 21 C84 24 34 22 3 25Z" fill="#ffe14d" opacity=".62"/>`, { w: 120, h: 30, size: 150, finish: 'tape' });
add('arrows', 'brace', 'Bracket', pen('M22 5 C12 5 15 16 15 22 C15 28 12 31 6 32 C12 33 15 36 15 42 C15 48 12 59 22 59', INK, 3.2), { w: 28, h: 64, size: 90, finish: 'pen' });
add('arrows', 'burst', 'Starburst', `<path d="M32 4 L37 15 L47 8 L47 20 L59 19 L52 29 L62 36 L50 40 L54 52 L42 49 L38 61 L30 51 L20 59 L19 46 L6 46 L13 35 L3 26 L15 23 L13 10 L25 15Z" fill="#fff6c9" stroke="${GOLD_2}" stroke-width="2.6" stroke-linejoin="round"/>`, { size: 96, finish: 'pen' });
add('arrows', 'marks', 'Look here', pen('M10 34 L22 30 M18 14 L27 23 M38 6 L38 19', CORAL, 3.6), { w: 46, h: 42, size: 60, finish: 'pen' });
add('arrows', 'tick-pen', 'Pen tick', pen('M7 27 L20 41 L49 7', '#3d9a5f', 5), { w: 56, h: 48, size: 60, finish: 'pen' });
add('arrows', 'cross-pen', 'Pen cross', pen('M8 8 L40 41 M41 7 L7 42', RED, 5), { w: 48, h: 48, size: 56, finish: 'pen' });
add('arrows', 'heart-pen', 'Pen heart', pen('M30 50 C8 36 4 20 14 12 C22 6 30 12 31 20 C32 11 42 5 50 12 C60 21 52 38 28 51', ROSE, 3.4), { w: 60, h: 56, size: 70, finish: 'pen' });
add('arrows', 'star-pen', 'Pen star', pen('M31 5 L43 55 L5 23 L58 21 L17 56 L32 6', GOLD_2, 3), { w: 62, h: 60, size: 70, finish: 'pen' });
add('arrows', 'label-oval', 'Oval label', `${oval(44, 28, 41, 25, '#fffaf0')}<ellipse cx="44" cy="28" rx="37" ry="21" fill="none" stroke="${BROWN_2}" stroke-width="1.4"/><ellipse cx="44" cy="28" rx="34.5" ry="18.5" fill="none" stroke="${BROWN_2}" stroke-width=".7"/>`, { w: 88, h: 56, size: 130, finish: 'paper' });
add('arrows', 'label-ticket', 'Ticket',
  `<path d="M4 4 H92 V16 A8 8 0 0 0 92 32 V44 H4 V32 A8 8 0 0 0 4 16Z" fill="#ffd9a8"/><path d="M26 6 V42" stroke="#d99a55" stroke-width="1.4" stroke-dasharray="2.4 2.8"/><rect x="32" y="9.5" width="52" height="29" rx="2" fill="none" stroke="#d99a55" stroke-width="1.2"/>${tinyStar(15, 24, 0.24, '#d99a55')}`, { w: 96, h: 48, size: 130, finish: 'paper' });
add('arrows', 'label-tag', 'Label',
  `<path d="M14 4 H84 A4 4 0 0 1 88 8 V36 A4 4 0 0 1 84 40 H14 L3 22Z" fill="#fffaf0"/><path d="M16 8 H82 A2 2 0 0 1 84 10 V34 A2 2 0 0 1 82 36 H16 L8 22Z" fill="none" stroke="${RED}" stroke-width="1.5"/>${circ(15.5, 22, 2.6, '#e9dcc4')}`, { w: 92, h: 44, size: 130, finish: 'paper' });
add('arrows', 'label-plaque', 'Plaque',
  `<path d="M12 4 H84 A8 8 0 0 0 92 12 V32 A8 8 0 0 0 84 40 H12 A8 8 0 0 0 4 32 V12 A8 8 0 0 0 12 4Z" fill="#e7f1e4"/><path d="M15 8.5 H81 A8 8 0 0 0 87.5 15 V29 A8 8 0 0 0 81 35.5 H15 A8 8 0 0 0 8.5 29 V15 A8 8 0 0 0 15 8.5Z" fill="none" stroke="${GREEN_2}" stroke-width="1.3"/>`, { w: 96, h: 44, size: 130, finish: 'paper' });
add('arrows', 'bubble', 'Speech bubble', `<path d="M12 6 H64 C70 6 74 10 74 16 V34 C74 40 70 44 64 44 H34 L21 56 L23 44 H12 C6 44 2 40 2 34 V16 C2 10 6 6 12 6Z" fill="#fff" stroke="${INK}" stroke-width="2.6" stroke-linejoin="round"/>`, { w: 76, h: 60, size: 110, finish: 'pen' });
add('arrows', 'pennant', 'Pennant', pen('M8 4 V56', BROWN_2, 3) + `<path d="M9 7 L60 18 L9 33Z" fill="${GOLD}" stroke="${GOLD_2}" stroke-width="2" stroke-linejoin="round"/>`, { w: 64, h: 60, size: 84 });

// ── 7. task and mood icons ──
const badge = (fill: string, shade: string) => `${circ(32, 32, 26, fill)}<path d="M9 40 C14 54 50 54 55 40 C48 51 16 51 9 40Z" fill="${shade}" opacity=".55"/>`;
add('icons', 'done', 'Done', badge('#58b368', '#3d9a5f') + pen('M19 33 L28 42 L45 23', '#fff', 6), { size: 48 });
add('icons', 'gold-star', 'Gold star', `<path d="${STAR}" fill="${GOLD}" stroke="${GOLD}" stroke-width="5" stroke-linejoin="round"/><path d="M32 12 L37 25 L50 27 L32 31Z" fill="#fff3c4" opacity=".7"/><path d="M20 49 L32 42 L44 49 L41 37 L32 31Z" fill="${GOLD_2}" opacity=".45"/>`, { size: 48 });
add('icons', 'flag', 'Flag', pen('M16 8 V58', '#6d5a48', 4) + `<path d="M18 10 C28 5 36 15 50 9 V34 C36 40 28 30 18 35Z" fill="${RED}"/><path d="M18 10 C28 5 36 15 50 9 V15 C36 21 28 11 18 16Z" fill="#fff" opacity=".22"/>`, { size: 48 });
add('icons', 'love', 'Heart', `<path d="${HEART}" fill="#ef5d7c"/>` + pen('M19 24 C20 20 24 18 27 20', '#ffc2cf', 3), { size: 48 });
add('icons', 'important', 'Important', badge('#f6903b', '#d9702a') + `<path d="M28.5 15 H35.5 L34 37 H30Z" fill="#fff"/>${circ(32, 45.5, 3.8, '#fff')}`, { size: 48 });
add('icons', 'question', 'Question', badge(LILAC_2, '#6f5ea8') + pen('M24.5 25 C24.5 15 39.5 15 39.5 25 C39.5 31 32 31 32 38', '#fff', 5) + circ(32, 46.5, 3.4, '#fff'), { size: 48 });
add('icons', 'box', 'To do', `<rect x="10" y="10" width="44" height="44" rx="9" fill="#fff" stroke="${INK}" stroke-width="4"/>`, { size: 44 });
add('icons', 'box-done', 'Ticked', `<rect x="10" y="10" width="44" height="44" rx="9" fill="#fff" stroke="${INK}" stroke-width="4"/>` + pen('M19 31 L29 42 L52 12', '#3d9a5f', 6.5), { size: 44 });
add('icons', 'pin', 'Pin', pen('M32 40 V59', '#8d8aa3', 3) + `<path d="M22 8 H42 L39 23 C46 26 49 32 49 39 H15 C15 32 18 26 25 23Z" fill="${RED}"/><path d="M25 23 H39 L40.5 28 H23.5Z" fill="#c4483f"/><rect x="24" y="10" width="5" height="10" rx="2.5" fill="#fff" opacity=".4"/>`, { size: 48 });
add('icons', 'bell', 'Bell', `${circ(32, 54, 5, GOLD_2)}<path d="M32 9 C44 9 47 20 47 30 C47 40 52 43 54 48 H10 C12 43 17 40 17 30 C17 20 20 9 32 9Z" fill="${GOLD}"/>${circ(32, 8, 3.4, GOLD_2)}<path d="M10 48 H54 V50 A2 2 0 0 1 52 52 H12 A2 2 0 0 1 10 50Z" fill="${GOLD_2}"/><path d="M24 15 C21 19 21 26 21 31" stroke="#fff" stroke-width="3" fill="none" stroke-linecap="round" opacity=".6"/>`, { size: 48 });
add('icons', 'clock', 'Clock', `${circ(14, 12, 6, RED)}${circ(50, 12, 6, RED)}` + pen('M18 54 L14 59 M46 54 L50 59', INK, 3.4) + `${circ(32, 34, 24, BLUE_2)}${circ(32, 34, 18.5, '#fff')}` + pen('M32 22 V34 L40 39', INK, 3.2) + circ(32, 34, 2, INK), { size: 48 });
add('icons', 'idea', 'Idea', pen('M32 3 V8 M12 11 L16 15 M52 11 L48 15 M5 30 H10 M59 30 H54', GOLD_2, 3) + `<path d="M32 12 C43 12 50 20 50 30 C50 37 46 41 42 45 V50 H22 V45 C18 41 14 37 14 30 C14 20 21 12 32 12Z" fill="${GOLD}"/><rect x="23" y="50" width="18" height="9" rx="3" fill="#8d8aa3"/><path d="M23 54.5 H41" stroke="#6f6c85" stroke-width="1.6"/>` + pen('M27 44 V36 L32 31 L37 36 V44', GOLD_2, 2.2) + pen('M22 22 C24 18 28 16 31 16', '#fff', 3, ' opacity=".7"'), { size: 48 });
add('icons', 'target', 'Goal', `${circ(30, 34, 24, RED)}${circ(30, 34, 17, '#fff')}${circ(30, 34, 10.5, RED)}${circ(30, 34, 4, '#fff')}` + pen('M30 34 L52 12', INK, 3) + `<path d="M47 9 L55 9 L55 17 L60 12 L57 7 L52 4Z" fill="${GOLD}"/>`, { size: 48 });
add('icons', 'water', 'Drink water', `<path d="M32 5 C22 20 13 29 13 40 C13 51 21 59 32 59 C43 59 51 51 51 40 C51 29 42 20 32 5Z" fill="${BLUE}"/><path d="M21 40 C21 47 25 51 30 52" stroke="#fff" stroke-width="3.4" fill="none" stroke-linecap="round" opacity=".75"/>` + eyes(27, 39, 38, 2.2) + pen('M28.5 44.5 Q33 48.5 37.5 44.5', INK, 1.6), { size: 48 });
motif('icons', 'book', 'Read', ['#5a8fc9', '#3d6ea6', '#ffffff'], 'book', 48);
motif('icons', 'teacup', 'Tea break', [PINK, '#c9b8a4', '#ffffff'], 'teacup', 48);
motif('icons', 'quill', 'Write', ['#8e7cc3', '#8e7cc3', '#4d3f7a'], 'quill', 48);
motif('icons', 'key', 'Keys', ['#d9a441'], 'key', 48);
/** A round face for how the day feels: its colour, the eyes, the mouth, and anything more. */
const mood = (id: string, name: string, fill: string, shade: string, eyesD: string, mouth: string, more = '') => add('icons', id, name, `${circ(32, 32, 26, fill)}<path d="M9 40 C14 54 50 54 55 40 C48 51 16 51 9 40Z" fill="${shade}" opacity=".5"/>${eyesD}${mouth}${more}`, { size: 52 });
const dotEyes = oval(22.5, 28, 2.8, 3.6, INK) + oval(41.5, 28, 2.8, 3.6, INK);
const arcEyes = pen('M18 29.5 Q22.5 22.5 27 29.5 M37 29.5 Q41.5 22.5 46 29.5', INK, 2.8);
const shutEyes = pen('M18 27 Q22.5 32.5 27 27 M37 27 Q41.5 32.5 46 27', INK, 2.8);
mood('mood-great', 'Feeling great', '#8fd694', '#58b368', arcEyes, `<path d="M20 36 H44 C44 46 39 51 32 51 C25 51 20 46 20 36Z" fill="#5b2a3c"/><path d="M21 36 H43 C43 38.6 42.6 40.4 42 42 H22 C21.4 40.4 21 38.6 21 36Z" fill="#fff"/>`, blush(15.5, 48.5, 36, 3.4));
mood('mood-good', 'Feeling good', '#ffd84d', '#eeb01e', dotEyes, pen('M22 38 Q32 48 42 38', INK, 2.8), blush(16, 48, 36.5, 3.4));
mood('mood-calm', 'Calm', '#a8dcd0', '#6bbcab', shutEyes, pen('M25 40 Q32 45.5 39 40', INK, 2.8), blush(16, 48, 36, 3.2));
mood('mood-okay', 'So-so', '#ffe9a0', '#e9c75a', dotEyes, pen('M24 42 H40', INK, 2.8));
mood('mood-tired', 'Tired', '#cdbcf0', '#a48fd6', pen('M17.5 28 H27.5 M36.5 28 H46.5', INK, 2.8) + pen('M18.5 31.5 Q22.5 34.5 26.5 31.5 M37.5 31.5 Q41.5 34.5 45.5 31.5', '#8e7cc3', 1.8), oval(32, 43, 4, 5, '#5b2a3c'), pen('M46 8 H54 L46 17 H54', INK, 2.2));
mood('mood-sad', 'Sad', '#a9cdf2', '#6f9fd8', dotEyes + pen('M17 22.5 L26 20 M47 22.5 L38 20', INK, 2.4), pen('M23 45 Q32 37 41 45', INK, 2.8), `<path d="M44 33 c-3 4.4 -3 7.4 0 7.4 c3 0 3 -3 0 -7.4Z" fill="#4a86c0"/>`);
mood('mood-cross', 'Cross', '#f79a8b', '#e05a4f', dotEyes + pen('M16 20 L27 24.5 M48 20 L37 24.5', INK, 2.8), pen('M23 45 Q32 38.5 41 45', INK, 2.8));
mood('mood-loved', 'Loved', '#ffc2d4', ROSE, tinyHeart(22, 28, 0.26, '#e8324f') + tinyHeart(42, 28, 0.26, '#e8324f'), pen('M23 39 Q32 48 41 39', INK, 2.8));
mood('mood-excited', 'Excited', '#ffc078', '#f6903b', tinyStar(22, 27.5, 0.24, '#fff') + tinyStar(42, 27.5, 0.24, '#fff'), `<path d="M22 37 H42 C42 46 38 50 32 50 C26 50 22 46 22 37Z" fill="#5b2a3c"/>${oval(32, 46.5, 5, 2.6, '#ff7a90')}`);
mood('mood-unwell', 'Under the weather', '#cfe3b4', '#9cbf6e', pen('M18 26 L26 29.5 L18 32 M46 26 L38 29.5 L46 32', INK, 2.6), pen('M22 43 q3.3 -4 6.6 0 t6.6 0 t6.6 0', INK, 2.6));

// ── 8. scrapbook paper pieces ──
const PAPER = '#fffaf0';
/** A sheet `w` × `h` whose bottom edge is torn. */
function tornSheet(w: number, h: number, seed: number, top = 3): string {
  const r = dice(seed), n = Math.round(w / 7);
  const bottom = Array.from({ length: n + 1 }, (_, i) => `L${f(w - 3 - (i * (w - 6)) / n)} ${f(h - 3 - r() * 5)}`);
  return `M3 ${top} H${w - 3} ${bottom.join(' ')}Z`;
}
add('paper', 'note', 'Torn note', `<path d="${tornSheet(96, 80, 11)}" fill="${PAPER}"/>`, { w: 96, h: 80, size: 140, finish: 'paper' });
add('paper', 'grid-paper', 'Grid paper',
  `<defs>${pat(9, 9, `<path d="M9 0 V9 H0" stroke="#9cc4ea" stroke-width=".8" fill="none"/>`)}<clipPath id="sheet"><path d="${tornSheet(88, 88, 23)}"/></clipPath></defs><g clip-path="url(#sheet)"><rect width="88" height="88" fill="#fff"/><rect width="88" height="88" fill="url(#pat)"/></g>`, { w: 88, h: 88, size: 130, finish: 'paper' });
add('paper', 'lined-paper', 'Lined paper',
  `<defs><mask id="punch"><rect width="84" height="100" fill="#fff"/>${[14, 34, 54, 74].map(y => circ(9, y, 2.6, '#000')).join('')}</mask><clipPath id="sheet"><path d="${tornSheet(84, 100, 37)}"/></clipPath></defs><g clip-path="url(#sheet)" mask="url(#punch)"><rect width="84" height="100" fill="#fff"/><path d="${[18, 28, 38, 48, 58, 68, 78, 88].map(y => `M3 ${y} H81`).join(' ')}" stroke="#a9cdf2" stroke-width="1"/><path d="M17 3 V100" stroke="#f29aa9" stroke-width="1"/></g>`, { w: 84, h: 100, size: 140, finish: 'paper' });
add('paper', 'sticky', 'Sticky note', `<path d="M4 4 H68 V52 L52 68 H4Z" fill="#ffe873"/><path d="M68 52 L52 68 L54 54Z" fill="#e6c63a"/><rect x="4" y="4" width="64" height="9" fill="#f7da4e"/>`, { w: 72, h: 72, size: 110, finish: 'paper' });
add('paper', 'kraft-tag', 'Kraft tag',
  pen('M28 16 C22 8 30 2 36 4 C44 6 40 12 34 9', '#c94f4f', 1.6) + `<defs><mask id="eye"><rect width="56" height="88" fill="#fff"/>${circ(28, 17, 3.2, '#000')}</mask></defs><path d="M16 6 H40 L52 20 V80 A4 4 0 0 1 48 84 H8 A4 4 0 0 1 4 80 V20Z" fill="${KRAFT}" mask="url(#eye)"/><circle cx="28" cy="17" r="5.2" fill="none" stroke="${PAPER}" stroke-width="2.4"/>` + pen('M12 44 H44 M12 54 H44 M12 64 H34', KRAFT_2, 1.2, ' opacity=".7"'), { w: 56, h: 88, size: 110, finish: 'paper' });
add('paper', 'polaroid', 'Photo frame',
  `<path fill-rule="evenodd" d="M6 4 H74 A2 2 0 0 1 76 6 V90 A2 2 0 0 1 74 92 H6 A2 2 0 0 1 4 90 V6 A2 2 0 0 1 6 4Z M11 11 V69 H69 V11Z" fill="#fff"/><rect x="11" y="11" width="58" height="58" fill="none" stroke="#000" stroke-width="1" opacity=".13"/>`, { w: 80, h: 96, size: 150, finish: 'paper' });
add('paper', 'envelope', 'Envelope',
  `<rect x="4" y="6" width="80" height="52" rx="3" fill="#f6e2c6"/><path d="M4 58 L34 30 H54 L84 58Z" fill="#ecd2ad"/><path d="M4.5 8 L44 38 L83.5 8 V6 H4.5Z" fill="#fdf0dc"/><path d="M5 8.5 L44 38 L83 8.5" fill="none" stroke="#dfc199" stroke-width="1.2"/>${tinyHeart(44, 37, 0.3, '#e8546f')}`, { w: 88, h: 64, size: 120, finish: 'paper' });
add('paper', 'stamp', 'Stamp',
  `<defs><mask id="perf"><rect width="56" height="68" fill="#fff"/>${[...[9, 18.5, 28, 37.5, 47].flatMap(x => [circ(x, 3, 2.6, '#000'), circ(x, 65, 2.6, '#000')]), ...[11, 20.5, 30, 39.5, 49, 58.5].flatMap(y => [circ(3, y - 1, 2.6, '#000'), circ(53, y - 1, 2.6, '#000')])].join('')}</mask></defs><rect x="3" y="3" width="50" height="62" fill="${PAPER}" mask="url(#perf)"/><rect x="10" y="10" width="36" height="48" fill="#cfe6f7"/>`
  + `<path d="M10 46 C18 38 26 44 32 40 C38 36 42 40 46 37 V58 H10Z" fill="${MINT}"/>${circ(36, 22, 6, GOLD)}` + bloom(20, 48, 5, PINK, '#fff3c4'), { w: 56, h: 68, size: 90, finish: 'paper' });
add('paper', 'paper-heart', 'Paper heart', `<defs>${pat(11, 11, circ(3, 3, 1.5, '#fff') + circ(8.5, 8.5, 1.5, '#fff'))}</defs><path d="${HEART}" fill="#ef6f86" transform="translate(-2 -6) scale(1.06)"/><path d="${HEART}" fill="url(#pat)" transform="translate(-2 -6) scale(1.06)"/>`, { w: 64, h: 58, size: 90, finish: 'paper' });
add('paper', 'floral-scrap', 'Floral scrap',
  `<defs>${pat(26, 24, bloom(7, 7, 5.6, '#fff', GOLD) + bloom(20, 19, 5, '#ffd1dc', '#fff3c4') + circ(19, 5, 1.2, '#fff') + circ(6, 19, 1.2, '#fff'))}<clipPath id="pinked"><path d="M4 4 ${Array.from({ length: 14 }, (_, i) => `L${7 + i * 6} ${i % 2 ? 4 : 1.5}`).join(' ')} L88 4 V60 ${Array.from({ length: 14 }, (_, i) => `L${85 - i * 6} ${i % 2 ? 60 : 62.5}`).join(' ')} L4 60Z"/></clipPath></defs><g clip-path="url(#pinked)"><rect width="92" height="64" fill="#8cc9b4"/><rect width="92" height="64" fill="url(#pat)"/></g>`, { w: 92, h: 64, size: 130, finish: 'paper' });
add('paper', 'book-page', 'Book page',
  `<defs><clipPath id="sheet"><path d="${tornSheet(104, 52, 53, 2)}"/></clipPath></defs><g clip-path="url(#sheet)"><rect width="104" height="52" fill="#f4e6c8"/><path d="${[10, 17, 24, 31, 38].map((y, i) => `M9 ${y} H${[96, 92, 97, 88, 60][i]}`).join(' ')}" stroke="#8a7a5c" stroke-width="2.2" stroke-dasharray="7 2.4 12 2.4 5 2.4 9 2.4" opacity=".55"/></g>`, { w: 104, h: 52, size: 150, finish: 'paper' });
add('paper', 'index-card', 'Index card', `<rect x="3" y="3" width="94" height="62" rx="2.5" fill="#fff"/><path d="M3 17 H97" stroke="#ef8f9c" stroke-width="1.4"/><path d="M3 27 H97 M3 36 H97 M3 45 H97 M3 54 H97" stroke="#b9d6f2" stroke-width="1"/>`, { w: 100, h: 68, size: 140, finish: 'paper' });
add('paper', 'clip', 'Paper clip', pen('M19 20 V46 C19 53 9 53 9 46 V14 C9 4 25 4 25 14 V50 C25 62 5 62 5 50 V22', '#c9a23a', 2.6), { w: 30, h: 64, size: 60, finish: 'pen' });
motif('paper', 'fan', 'Paper fan', ['#ef6f86', GOLD, '#fff3c4'], 'fan', 72);

/** Every sticker in the library. */
export const LIBRARY: StickerArt[] = list;
const BY_ID = new Map(LIBRARY.map(s => [s.id, s]));
/** The sticker with this id; undefined when there is none (a drawing that was taken out of the library). */
export const artOf = (id: string): StickerArt | undefined => BY_ID.get(id);
/** A group's stickers, in the order they were drawn. */
export const inGroup = (group: GroupId): StickerArt[] => LIBRARY.filter(s => s.group === group);

const srcs = new Map<string, string>();
/** A sticker's drawing as something an <img> can show. */
export function srcOf(s: StickerArt): string {
  let u = srcs.get(s.id);
  if (!u) { u = `data:image/svg+xml,${encodeURIComponent(s.svg).replace(/'/g, '%27')}`; srcs.set(s.id, u); }
  return u;
}
