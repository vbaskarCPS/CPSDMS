// src/lib/pour/engine.ts — the rules, level generator and solver for the /minigame water-sort puzzle.
// A bottle is a list of colour numbers, bottom → top, holding at most CAP layers. Pure functions only:
// the page keeps the state, this file decides what's legal and whether a level can be solved.

export const CAP = 4;
export const MAX_COLOURS = 12;

export type Bottle = number[];
export type Move = { from: number; to: number };

const top = (b: Bottle) => b[b.length - 1];

/** How many layers of the top colour sit together at the top of a bottle. */
export function topRun(b: Bottle): number {
  if (!b.length) return 0;
  const c = top(b);
  let n = 0;
  for (let i = b.length - 1; i >= 0 && b[i] === c; i--) n++;
  return n;
}

/** The longest stretch of one colour anywhere in a bottle. */
export function longestRun(b: Bottle): number {
  let best = 0, n = 0;
  b.forEach((c, i) => { n = i && b[i - 1] === c ? n + 1 : 1; best = Math.max(best, n); });
  return best;
}

export function canPour(bottles: Bottle[], from: number, to: number): boolean {
  if (from === to) return false;
  const a = bottles[from], b = bottles[to];
  if (!a || !b || !a.length || b.length >= CAP) return false;
  return !b.length || top(b) === top(a);
}

/** Pour as much of the top colour as fits. Returns a new array; the input is untouched. */
export function pour(bottles: Bottle[], from: number, to: number): Bottle[] {
  if (!canPour(bottles, from, to)) return bottles;
  const n = Math.min(topRun(bottles[from]), CAP - bottles[to].length);
  const next = bottles.map(b => b.slice());
  const moved = next[from].splice(next[from].length - n, n);
  next[to].push(...moved);
  return next;
}

/** Full and one colour — the bottle gets its cork. */
export const isDone = (b: Bottle) => b.length === CAP && topRun(b) === CAP;

export const isWon = (bottles: Bottle[]) => bottles.every(b => !b.length || isDone(b));

/** How hard a level is: colours climb one every three levels, always two empty bottles. */
export function levelSize(level: number): { colours: number; empties: number } {
  return { colours: Math.min(MAX_COLOURS, 3 + Math.floor((Math.max(1, level) - 1) / 3)), empties: 2 };
}

/** Small seeded random number generator, so level N is the same puzzle on every phone. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const key = (bottles: Bottle[]) => bottles.map(b => b.join('.')).sort().join('|');

/** Moves worth trying, best first. Skips moves that can't help (an empty-to-empty shuffle, or
 *  pouring a bottle that is already one colour into an empty one). */
function movesOf(bottles: Bottle[]): Move[] {
  const out: { m: Move; score: number }[] = [];
  for (let from = 0; from < bottles.length; from++) {
    const a = bottles[from];
    if (!a.length || isDone(a)) continue;
    const run = topRun(a);
    let triedEmpty = false;
    for (let to = 0; to < bottles.length; to++) {
      if (!canPour(bottles, from, to)) continue;
      const b = bottles[to];
      if (!b.length) {
        if (run === a.length) continue;          // whole bottle is one colour: moving it changes nothing
        if (triedEmpty) continue;                 // every empty bottle is the same; try only one
        triedEmpty = true;
        out.push({ m: { from, to }, score: 0 });
        continue;
      }
      const fits = Math.min(run, CAP - b.length);
      const completes = b.length + fits === CAP && topRun(b) === b.length && fits === run;
      out.push({ m: { from, to }, score: (fits === run ? 2 : 1) + (completes ? 3 : 0) });
    }
  }
  return out.sort((x, y) => y.score - x.score).map(o => o.m);
}

/** Depth-first search for a way to finish. Returns the moves, or null if there is none (or the
 *  search gives up after `limit` positions — treated as "not solvable" by the generator). */
export function solve(start: Bottle[], limit = 200_000): Move[] | null {
  if (isWon(start)) return [];
  const seen = new Set<string>([key(start)]);
  const path: Move[] = [];
  let visited = 0;
  const dfs = (bottles: Bottle[]): boolean => {
    if (++visited > limit) return false;
    for (const m of movesOf(bottles)) {
      const next = pour(bottles, m.from, m.to);
      const k = key(next);
      if (seen.has(k)) continue;
      seen.add(k);
      path.push(m);
      if (isWon(next) || dfs(next)) return true;
      path.pop();
      if (visited > limit) return false;
    }
    return false;
  };
  return dfs(start) ? path.slice() : null;
}

/** One good next move from here, or null if the position can't be finished. */
export function hint(bottles: Bottle[]): Move | null {
  const s = solve(bottles);
  return s && s.length ? s[0] : null;
}

/** Build level N: shuffle CAP layers of each colour into full bottles, add the empties, and keep
 *  the first deal that isn't already partly sorted and that the solver can finish. */
export function makeLevel(level: number): Bottle[] {
  return makeDeal(level, level * 7919 + 17);
}

/** A puzzle the size of level N, dealt from `seed` (head-to-head rounds use a fresh seed, so both
 *  players get the same puzzle but not one they've seen in their own game). */
export function makeDeal(level: number, seed: number): Bottle[] {
  const { colours, empties } = levelSize(level);
  for (let attempt = 0; attempt < 500; attempt++) {
    const rand = rng(seed + attempt * 104729);
    const layers: number[] = [];
    for (let c = 0; c < colours; c++) for (let i = 0; i < CAP; i++) layers.push(c);
    for (let i = layers.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [layers[i], layers[j]] = [layers[j], layers[i]];
    }
    const bottles: Bottle[] = [];
    for (let c = 0; c < colours; c++) bottles.push(layers.slice(c * CAP, c * CAP + CAP));
    if (bottles.some(b => longestRun(b) >= 3)) continue;   // too easy a start
    for (let e = 0; e < empties; e++) bottles.push([]);
    if (solve(bottles)) return bottles;
  }
  throw new Error(`Could not build level ${level} (deal ${seed})`);
}
