// src/lib/littleChess/lessons.ts — Little Chess (minigame hub, /minigame/chess): the lessons for a
// toddler who reads sight words. Three layers, one short lesson per piece in each:
//   NAMES — meet the piece, find it, read its word        (Rook, Knight, King, Queen, Bishop, Pawn: easy shapes first)
//   MOVES — a board where the piece's squares glow; get the stars   (teachers' order: Rook, Bishop, Queen, King, Knight, Pawn)
//   EAT   — the same, but the piece eats apples (capturing; the pawn's sideways bite waits for a later layer)
// Pure data and move rules; the page draws it. Every board is generated from a fixed seed, so a lesson is
// the same each time, and the tests check every star and apple can be reached.

export type Piece = 'rook' | 'knight' | 'king' | 'queen' | 'bishop' | 'pawn';
export type Sq = [number, number];            // [row, col], row 0 at the top; the pawn steps up (row − 1)

export const NAME_ORDER: Piece[] = ['rook', 'knight', 'king', 'queen', 'bishop', 'pawn'];
export const MOVE_ORDER: Piece[] = ['rook', 'bishop', 'queen', 'king', 'knight', 'pawn'];
export const EAT_ORDER: Piece[] = ['rook', 'bishop', 'queen', 'king', 'knight'];

export const WORD: Record<Piece, string> = { rook: 'ROOK', knight: 'KNIGHT', king: 'KING', queen: 'QUEEN', bishop: 'BISHOP', pawn: 'PAWN' };

/** The one sentence for how each piece moves — always the same, so it sticks. */
export const HOW: Record<Piece, string> = {
  rook: 'ROOK GOES STRAIGHT.', bishop: 'BISHOP CLIMBS STAIRS.', queen: 'QUEEN GOES EVERYWHERE.',
  king: 'KING STEPS ONCE.', knight: 'KNIGHT JUMPS L.', pawn: 'PAWN STEPS UP.',
};

export const BOARD = 4;   // every board in this first version is 4 × 4

export type Round =
  | { kind: 'hello'; piece: Piece }                                    // THIS IS ROOK.
  | { kind: 'find'; piece: Piece; options: Piece[] }                   // FIND THE ROOK.
  | { kind: 'word'; piece: Piece; options: Piece[] }                   // WHICH WORD?
  | { kind: 'show'; piece: Piece; start: Sq; taps: number }            // ROOK GOES STRAIGHT. (tap the glowing squares)
  | { kind: 'board'; piece: Piece; mode: 'star' | 'apple'; start: Sq; targets: Sq[]; glow: boolean };

export type Layer = 'names' | 'moves' | 'eat' | 'review';
export type Lesson = { id: string; layer: Layer; piece?: Piece; title: string; rounds: Round[] };

const inside = (r: number, c: number, n: number) => r >= 0 && c >= 0 && r < n && c < n;
const same = (a: Sq, b: Sq) => a[0] === b[0] && a[1] === b[1];

/** Squares a piece can reach in one move on an empty board. */
export function movesFrom(piece: Piece, [r, c]: Sq, n = BOARD): Sq[] {
  const out: Sq[] = [];
  const slide = (dirs: number[][]) => dirs.forEach(([dr, dc]) => {
    for (let k = 1; inside(r + dr * k, c + dc * k, n); k++) out.push([r + dr * k, c + dc * k]);
  });
  const step = (dirs: number[][]) => dirs.forEach(([dr, dc]) => { if (inside(r + dr, c + dc, n)) out.push([r + dr, c + dc]); });
  const straight = [[1, 0], [-1, 0], [0, 1], [0, -1]], stairs = [[1, 1], [1, -1], [-1, 1], [-1, -1]];
  if (piece === 'rook') slide(straight);
  if (piece === 'bishop') slide(stairs);
  if (piece === 'queen') slide([...straight, ...stairs]);
  if (piece === 'king') step([...straight, ...stairs]);
  if (piece === 'knight') step([[1, 2], [2, 1], [-1, 2], [-2, 1], [1, -2], [2, -1], [-1, -2], [-2, -1]]);
  if (piece === 'pawn') step([[-1, 0]]);
  return out;
}

export const canMove = (piece: Piece, from: Sq, to: Sq, n = BOARD) => movesFrom(piece, from, n).some(s => same(s, to));

function rng(seed: number) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const pick = <T,>(rand: () => number, xs: T[]): T => xs[Math.floor(rand() * xs.length)];
function shuffle<T>(rand: () => number, xs: T[]): T[] { const a = xs.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }

/** A start square and `count` targets that can be collected one move at a time, in order. */
export function makeBoard(piece: Piece, count: number, rand: () => number, n = BOARD): { start: Sq; targets: Sq[] } {
  for (let tries = 0; tries < 200; tries++) {
    const start: Sq = piece === 'pawn' ? [n - 1, Math.floor(rand() * n)] : [Math.floor(rand() * n), Math.floor(rand() * n)];
    const targets: Sq[] = [];
    let at = start;
    for (let k = 0; k < count; k++) {
      const next = movesFrom(piece, at, n).filter(s => !same(s, start) && !targets.some(t => same(t, s)));
      if (!next.length) break;
      at = pick(rand, next);
      targets.push(at);
    }
    if (targets.length === count) return { start, targets };
  }
  throw new Error(`no board for ${piece}`);
}

/** Wrong answers for a "find" or "word" round: other pieces, ones already met first. */
function others(piece: Piece, count: number, met: Piece[], rand: () => number): Piece[] {
  const known = shuffle(rand, met.filter(p => p !== piece));
  const rest = shuffle(rand, NAME_ORDER.filter(p => p !== piece && !known.includes(p)));
  return [...known, ...rest].slice(0, count);
}

/** Every lesson, in the order Kiaan plays them. */
export function allLessons(): Lesson[] {
  const out: Lesson[] = [];
  NAME_ORDER.forEach((piece, i) => {
    const rand = rng(1000 + i), met = NAME_ORDER.slice(0, i);
    out.push({
      id: `names-${piece}`, layer: 'names', piece, title: WORD[piece], rounds: [
        { kind: 'hello', piece },
        { kind: 'find', piece, options: shuffle(rand, [piece, ...others(piece, 1, met, rand)]) },
        { kind: 'find', piece, options: shuffle(rand, [piece, ...others(piece, 2, met, rand)]) },
        { kind: 'word', piece, options: shuffle(rand, [piece, ...others(piece, 1, met, rand)]) },
        { kind: 'word', piece, options: shuffle(rand, [piece, ...others(piece, 2, met, rand)]) },
      ],
    });
  });
  const rr = rng(2000);
  out.push({
    id: 'names-review', layer: 'review', title: 'ALL SIX', rounds: shuffle(rr, NAME_ORDER).slice(0, 5).map((piece, k) =>
      k % 2 ? { kind: 'word', piece, options: shuffle(rr, [piece, ...others(piece, 2, NAME_ORDER, rr)]) }
        : { kind: 'find', piece, options: shuffle(rr, [piece, ...others(piece, 3, NAME_ORDER, rr)]) }),
  });
  MOVE_ORDER.forEach((piece, i) => {
    const rand = rng(3000 + i);
    const board = (count: number, glow: boolean): Round => ({ kind: 'board', piece, mode: 'star', glow, ...makeBoard(piece, count, rand) });
    out.push({
      id: `moves-${piece}`, layer: 'moves', piece, title: WORD[piece], rounds: [
        { kind: 'show', piece, start: makeBoard(piece, 1, rand).start, taps: 2 },
        board(1, true), board(1, true), board(2, true), board(1, false), board(2, false),
      ],
    });
  });
  EAT_ORDER.forEach((piece, i) => {
    const rand = rng(4000 + i);
    out.push({
      id: `eat-${piece}`, layer: 'eat', piece, title: WORD[piece], rounds: [1, 1, 2, 2].map((count, k) =>
        ({ kind: 'board', piece, mode: 'apple', glow: k < 2, ...makeBoard(piece, count, rand) })),
    });
  });
  return out;
}

export const LESSONS = allLessons();

/** Saved in the player's account under "chess". */
export type ChessProgress = { done: string[]; stickers: string[]; voice: boolean; unlockAll: boolean; voiceName: string | null };
export const freshProgress = (): ChessProgress => ({ done: [], stickers: [], voice: true, unlockAll: false, voiceName: null });

export function readProgress(p: Partial<ChessProgress> | null): ChessProgress {
  const f = freshProgress();
  return {
    done: Array.isArray(p?.done) ? p!.done.filter(id => LESSONS.some(l => l.id === id)) : f.done,
    stickers: Array.isArray(p?.stickers) ? p!.stickers.filter(s => typeof s === 'string') : f.stickers,
    voice: typeof p?.voice === 'boolean' ? p.voice : f.voice,
    unlockAll: !!p?.unlockAll,
    voiceName: typeof p?.voiceName === 'string' && p.voiceName ? p.voiceName : null,   // a voice a grown-up picked on this tablet
  };
}

/** The next lesson to play: the first one not done (or null when everything is done). */
export const nextLesson = (p: ChessProgress) => LESSONS.find(l => !p.done.includes(l.id)) || null;

/** Open to play: everything done, the next one, or all of them once a grown-up unlocks them. */
export function isOpen(p: ChessProgress, id: string): boolean {
  if (p.unlockAll || p.done.includes(id)) return true;
  return nextLesson(p)?.id === id;
}

export const STICKERS = ['🦁', '🐘', '🦒', '🐢', '🦊', '🐼', '🐸', '🦄', '🐙', '🦖', '🐳', '🦋', '🐝', '🦉', '🐧', '🐨', '🚒', '🚀', '🚂', '🚜', '🌈', '🍓', '🍉', '⚽', '🎈', '🌻', '🐬', '🦕', '🐯', '🐰'];

/** The sticker for finishing a lesson: the next one in the book (the book loops when full). */
export const stickerFor = (p: ChessProgress) => STICKERS[p.stickers.length % STICKERS.length];
