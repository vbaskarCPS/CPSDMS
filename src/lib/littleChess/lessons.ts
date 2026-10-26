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
  | { kind: 'board'; piece: Piece; mode: 'star' | 'apple'; start: Sq; targets: Sq[]; glow: boolean }
  // guessing games: only a shadow shows (WHO IS HIDING?) or the top peeks over a wall (WHO IS PEEKING?);
  // he answers by tapping the matching piece or its word, then the piece pops out
  | { kind: 'shadow' | 'peek'; piece: Piece; options: Piece[]; answer: 'piece' | 'word' };

export type Layer = 'names' | 'moves' | 'eat' | 'review' | 'guess';
/** `icon` stands in for a piece on the lesson path when a lesson mixes pieces. */
export type Lesson = { id: string; layer: Layer; piece?: Piece; title: string; icon?: string; rounds: Round[] };

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
  // guessing games, two of each (the second a little harder): six rounds, every piece once, mixed up
  const guess = (id: string, title: string, icon: string, seed: number, make: (piece: Piece, rand: () => number) => Round) => {
    const rand = rng(seed);
    out.push({ id, layer: 'guess', title, icon, rounds: shuffle(rand, NAME_ORDER).map(piece => make(piece, rand)) });
  };
  const pick = (piece: Piece, n: number, rand: () => number) => shuffle(rand, [piece, ...others(piece, n - 1, NAME_ORDER, rand)]);
  guess('mix-find-1', 'MIX', '🎲', 5001, (piece, r) => ({ kind: 'find', piece, options: pick(piece, 3, r) }));
  guess('mix-find-2', 'MIX', '🎲', 5002, (piece, r) => ({ kind: 'find', piece, options: pick(piece, 4, r) }));
  guess('mix-word-1', 'WORDS', '🔤', 5003, (piece, r) => ({ kind: 'word', piece, options: pick(piece, 2, r) }));
  guess('mix-word-2', 'WORDS', '🔤', 5004, (piece, r) => ({ kind: 'word', piece, options: pick(piece, 3, r) }));
  guess('shadow-1', 'SHADOW', '👤', 5005, (piece, r) => ({ kind: 'shadow', piece, options: pick(piece, 3, r), answer: 'piece' }));
  guess('shadow-2', 'SHADOW', '👤', 5006, (piece, r) => ({ kind: 'shadow', piece, options: pick(piece, 3, r), answer: 'word' }));
  guess('peek-1', 'PEEKABOO', '🙈', 5007, (piece, r) => ({ kind: 'peek', piece, options: pick(piece, 3, r), answer: 'piece' }));
  guess('peek-2', 'PEEKABOO', '🙈', 5008, (piece, r) => ({ kind: 'peek', piece, options: pick(piece, 3, r), answer: 'word' }));
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
export type ChessProgress = { done: string[]; stickers: string[]; voice: boolean; unlockAll: boolean; voiceName: string | null; recorded: boolean };
export const freshProgress = (): ChessProgress => ({ done: [], stickers: [], voice: true, unlockAll: false, voiceName: null, recorded: true });

export function readProgress(p: Partial<ChessProgress> | null): ChessProgress {
  const f = freshProgress();
  return {
    done: Array.isArray(p?.done) ? p!.done.filter(id => LESSONS.some(l => l.id === id)) : f.done,
    stickers: Array.isArray(p?.stickers) ? p!.stickers.filter(s => typeof s === 'string') : f.stickers,
    voice: typeof p?.voice === 'boolean' ? p.voice : f.voice,
    unlockAll: !!p?.unlockAll,
    voiceName: typeof p?.voiceName === 'string' && p.voiceName ? p.voiceName : null,   // a voice a grown-up picked on this tablet
    recorded: typeof p?.recorded === 'boolean' ? p.recorded : f.recorded,              // use the recorded clips when there are some
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

// ── what gets said out loud, and by whom (for the recorded voice clips) ──

/** Who says a line: the narrator reads instructions; each character says its own hello and cheers. */
export type Speaker = 'narrator' | Piece;
export const SPEAKERS: Speaker[] = ['narrator', ...NAME_ORDER];

/** The sentence shown (and read) for a round. */
export function sentenceFor(r: Round): string {
  if (r.kind === 'hello') return `THIS IS ${WORD[r.piece]}.`;
  if (r.kind === 'find') return `FIND THE ${WORD[r.piece]}.`;
  if (r.kind === 'word') return 'WHICH WORD?';
  if (r.kind === 'show') return HOW[r.piece];
  if (r.kind !== 'board') return r.kind === 'shadow' ? 'WHO IS HIDING?' : 'WHO IS PEEKING?';
  const many = r.targets.length > 1;
  return r.mode === 'star' ? (many ? 'GET THE STARS.' : 'GET THE STAR.') : (many ? 'EAT THE APPLES.' : 'EAT THE APPLE.');
}

/** Who reads a round's sentence: the piece introduces itself; the narrator reads the rest. */
export const speakerFor = (r: Round): Speaker => (r.kind === 'hello' ? r.piece : 'narrator');

export const cheers = (name: string) => ['YES!', 'GREAT JOB!', `${name.toUpperCase()} DID IT!`, 'WOW!', 'SUPER!'];
export const stickerLine = (name: string) => `${name.toUpperCase()} GOT A STICKER!`;

/** The file name for a recorded line, e.g. "king--this-is-king". */
export const clipId = (speaker: Speaker, text: string) =>
  `${speaker}--${text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')}`;

// What's actually said out loud: a full, friendly sentence for each short sight-word sentence on screen.
// (The screen keeps the short words for Kiaan to read; the voice says it the way a grown-up would.)
const HELLO: Record<Piece, string> = {
  rook: "Hi there! I'm the Rook. I look like a castle tower!",
  knight: "Neigh! I'm the Knight. I look like a horse!",
  king: "Hello! I'm the King. My crown has a little cross on top!",
  queen: "Hello! I'm the Queen. My crown has lots of points!",
  bishop: "Hi! I'm the Bishop. I wear a tall pointy hat!",
  pawn: "Hi! I'm the Pawn. I'm the littlest one!",
};
const HOW_SAID: Record<Piece, string> = {
  rook: 'The Rook goes straight: up, down, left or right, as far as it likes. Tap a glowing square to try it!',
  bishop: 'The Bishop climbs the stairs, corner to corner, and always stays on its own colour. Tap a glowing square to try it!',
  queen: 'The Queen goes everywhere! Straight like the Rook, and up the stairs like the Bishop. Tap a glowing square to try it!',
  king: 'The King steps once. Just one little step, any way he likes. Tap a glowing square to try it!',
  knight: 'The Knight jumps in an L shape: two steps, then a turn. He can even hop over things! Tap a glowing square to try it!',
  pawn: 'The Pawn steps up, one little step forward at a time. Tap the glowing square to try it!',
};
const CHEER_SAID: Record<string, string> = {
  'YES!': 'Yes! You got it!', 'GREAT JOB!': "Great job! You're so clever!", 'WOW!': 'Wow! That was amazing!', 'SUPER!': 'Super! Give me a high five!',
};

/** The full sentence the voice says for a line shown on screen. */
export function spokenFor(_speaker: Speaker, text: string, name = 'Kiaan'): string {
  const piece = NAME_ORDER.find(p => text === `THIS IS ${WORD[p]}.`);
  if (piece) return HELLO[piece];
  const found = NAME_ORDER.find(p => text === `FIND THE ${WORD[p]}.`);
  if (found) return `Can you find the ${cap(found)}? Tap the ${cap(found)}!`;
  const how = NAME_ORDER.find(p => text === HOW[p]);
  if (how) return HOW_SAID[how];
  const N = name.toUpperCase();
  const fixed: Record<string, string> = {
    'WHICH WORD?': 'Which word is this piece? Tap the right word!',
    'WHO IS HIDING?': 'Someone is hiding in the shadow! Who is it? Can you guess?',
    'WHO IS PEEKING?': 'Peekaboo! Someone is peeking over the wall. Who is it?',
    'GET THE STAR.': "Let's get the star! Tap where the piece can go.",
    'GET THE STARS.': "Let's get all the stars, one at a time!",
    'EAT THE APPLE.': 'Snack time! Can you eat the apple? Move onto it to gobble it up!',
    'EAT THE APPLES.': 'Snack time! Eat all the apples, one at a time!',
    [`${N} DID IT!`]: `${name} did it! Hooray!`,
    [`${N} GOT A STICKER!`]: `Hooray! ${name} got a sticker! Great job!`,
  };
  return fixed[text] || CHEER_SAID[text] || text.charAt(0) + text.slice(1).toLowerCase();
}
const cap = (p: Piece) => p.charAt(0).toUpperCase() + p.slice(1);

/** Every line the game can say, for these players' names (no duplicates): who says it, the screen
 *  text (which names the clip) and the full sentence that's spoken. */
export function voiceLines(names: string[]): { speaker: Speaker; text: string; id: string; spoken: string }[] {
  const out = new Map<string, { speaker: Speaker; text: string; id: string; spoken: string }>();
  let who = names[0] || 'Kiaan';
  const add = (speaker: Speaker, text: string) => { const id = clipId(speaker, text); out.set(id, { speaker, text, id, spoken: spokenFor(speaker, text, who) }); };
  for (const l of LESSONS) for (const r of l.rounds) add(speakerFor(r), sentenceFor(r));
  for (const name of names) {
    who = name;
    add('narrator', stickerLine(name));
    for (const p of NAME_ORDER) for (const c of cheers(name)) add(p, c);
  }
  return [...out.values()];
}
