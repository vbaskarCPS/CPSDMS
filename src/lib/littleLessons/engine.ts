// src/lib/littleLessons/engine.ts — how Little Lessons picks what's next and moves Kiaan along.
//
// He plays lessons: a short run of 3–5 questions of one game from one level. Each level is a skill with a
// deck of games; the next lesson's game is one he hasn't just played, leaning toward the ones he's played
// least, so it keeps changing.
//   Each subject has a position on its ladder of levels, e.g. 4.3 = level 4, with 30% of the lessons
// already from level 5. Getting a question right first try nudges the position up (one level per
// `perLevel` right answers, times the level's size: the chess levels are big); a miss nudges it back half
// as much, so the next level is mixed in gradually while he's doing well and the one he's moving off is
// phased out. He never slips below a level he has fully reached, and about one lesson in ten reviews an
// older level. Right answers on a level can only carry him part way into the next one (CARRY): to go
// further he has to get some of the new level's questions right too.
//   Inside a level, how many questions he's got right there (`right`) opens up harder games and, in chess,
// brings in the next piece (who says hello first).
// The subject for each lesson comes from the grown-ups' mix (e.g. 30% chess, 40% words, 30% math).
import { LEVELS, SUBJECTS, gamesAt, makeQuestion, rng, type Intro, type Question, type Subject } from './levels';
import { LESSONS } from '../littleChess/lessons';

/** Set by a grown-up on the Kiaan's lessons page; saved in his account as "lessons_settings". */
export type LessonSettings = {
  mix: Record<Subject, number>;                     // percentages, adding up to 100
  perLevel: number;                                 // right answers to move up one level
  session: number;                                  // questions before a sticker
  review: number;                                   // share of questions from older levels (0–0.5)
  /** a grown-up moved a subject to a level: applied once, when the game next sees it */
  set: Partial<Record<Subject, { pos: number; at: string }>>;
};
export const DEFAULT_SETTINGS: LessonSettings = { mix: { chess: 30, words: 40, math: 30 }, perLevel: 10, session: 10, review: 0.1, set: {} };

/** Saved in his account as "lessons". */
export type LessonProgress = {
  pos: Record<Subject, number>;
  best: Record<Subject, number>;                    // the furthest whole level reached (never slips below)
  asked: Record<string, number>;                    // questions asked per level
  right: Record<string, number>;                    // questions right first try per level (how far into it he is)
  played: Record<string, number>;                   // lessons played per "level/game"
  last: Record<string, string>;                     // the game last played per level (not again straight away)
  v: number;                                        // 2: three chess levels (was one per Little Chess lesson)
  told: string[];                                   // levels whose story he's heard
  applied: Partial<Record<Subject, string>>;        // the grown-up moves already applied
  days: Record<string, Partial<Record<Subject, [number, number]>>>;   // right / missed per day, last 30 days
  stickers: string[];
  voice: boolean; voiceName: string | null; recorded: boolean;
};

const CARRY = 0.6;
const num = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
export const maxPos = (s: Subject) => LEVELS[s].length - 1;
const clampPos = (s: Subject, p: number) => Math.max(0, Math.min(maxPos(s), p));

export function readSettings(x: Partial<LessonSettings> | null | undefined): LessonSettings {
  const d = DEFAULT_SETTINGS;
  const mix = { ...d.mix };
  if (x?.mix && typeof x.mix === 'object') for (const s of SUBJECTS) mix[s] = Math.max(0, num((x.mix as Record<string, unknown>)[s], d.mix[s]));
  if (!SUBJECTS.some(s => mix[s] > 0)) Object.assign(mix, d.mix);
  const set: LessonSettings['set'] = {};
  if (x?.set && typeof x.set === 'object') for (const s of SUBJECTS) {
    const v = (x.set as Record<string, { pos?: unknown; at?: unknown }>)[s];
    if (v && typeof v.at === 'string') set[s] = { pos: clampPos(s, num(v.pos, 0)), at: v.at };
  }
  return {
    mix, set,
    perLevel: Math.round(Math.max(3, Math.min(30, num(x?.perLevel, d.perLevel)))),
    session: Math.round(Math.max(3, Math.min(30, num(x?.session, d.session)))),
    review: Math.max(0, Math.min(0.5, num(x?.review, d.review))),
  };
}

/** Where the old Little Chess progress got to: the first lesson not done. */
function chessFrom(done: unknown): number {
  if (!Array.isArray(done)) return 0;
  const i = LESSONS.findIndex(l => !done.includes(l.id));
  return i < 0 ? LESSONS.length - 1 : i;
}
/** An old chess position (one level per Little Chess lesson: 7 naming, 8 guessing, 6 moves, 4 eating)
 *  as the new chess level and how far into it he was. */
export function fromOldChess(i: number): { pos: number; right: number } {
  if (i <= 6) return { pos: 0, right: i * 3 };
  if (i <= 14) return { pos: 0, right: Math.min(30, 18 + (i - 7) * 2) };
  if (i <= 20) return { pos: 1, right: (i - 15) * 4 };
  return { pos: 2, right: Math.min(20, (i - 21) * 3) };
}
const CHESS_IDS = ['chess:naming', 'chess:moves', 'chess:eating'];

/** His saved progress, filled in (and, the first time, carried over from Little Chess). */
export function readProgress(x: Partial<LessonProgress> | null | undefined, oldChess?: Record<string, unknown> | null): LessonProgress {
  const pos = { chess: 0, words: 0, math: 0 } as Record<Subject, number>, best = { ...pos };
  const told: string[] = Array.isArray(x?.told) ? x!.told.filter(t => typeof t === 'string') : [];
  const obj = <T,>(v: unknown): Record<string, T> => (v && typeof v === 'object' ? { ...(v as Record<string, T>) } : {});
  const right = obj<number>(x?.right);
  const old = !!x && x.v !== 2;          // saved before the chess levels became three
  for (const s of SUBJECTS) {
    if (s === 'chess' && old) continue;
    pos[s] = clampPos(s, num(x?.pos?.[s], 0));
    best[s] = clampPos(s, Math.max(Math.floor(pos[s]), num(x?.best?.[s], 0)));
  }
  let stickers: string[] = Array.isArray(x?.stickers) ? x!.stickers.filter(s => typeof s === 'string') : [];
  const carry = (i: number) => {
    const c = fromOldChess(i);
    pos.chess = best.chess = c.pos;
    right[CHESS_IDS[c.pos]] = Math.max(right[CHESS_IDS[c.pos]] || 0, c.right);
    for (let k = 0; k < c.pos; k++) right[CHESS_IDS[k]] = Math.max(right[CHESS_IDS[k]] || 0, 30);
  };
  if (old) carry(Math.max(0, Math.round(num(x?.best?.chess, num(x?.pos?.chess, 0)))));
  if (!x && oldChess) {
    // first time: pick up where Little Chess left off (its piece hellos counted as heard)
    carry(chessFrom(oldChess.done));
    for (const l of LESSONS.slice(0, chessFrom(oldChess.done) + 1)) told.push(`chess:${l.id}`);
    if (Array.isArray(oldChess.stickers)) stickers = oldChess.stickers.filter((s): s is string => typeof s === 'string');
  }
  return {
    pos, best, told, stickers, right, v: 2,
    asked: obj<number>(x?.asked), played: obj<number>(x?.played), last: obj<string>(x?.last),
    applied: obj<string>(x?.applied) as LessonProgress['applied'],
    days: obj(x?.days) as LessonProgress['days'],
    voice: typeof x?.voice === 'boolean' ? x.voice : typeof oldChess?.voice === 'boolean' ? oldChess.voice as boolean : true,
    voiceName: typeof x?.voiceName === 'string' && x.voiceName ? x.voiceName : null,
    recorded: typeof x?.recorded === 'boolean' ? x.recorded : true,
  };
}

/** A grown-up's level changes that the game hasn't applied yet. */
export function applySettings(p: LessonProgress, s: LessonSettings): LessonProgress {
  let out = p;
  for (const subj of SUBJECTS) {
    const v = s.set[subj];
    if (!v || p.applied[subj] === v.at) continue;
    const pos = clampPos(subj, v.pos);
    out = { ...out, pos: { ...out.pos, [subj]: pos }, best: { ...out.best, [subj]: Math.floor(pos) }, applied: { ...out.applied, [subj]: v.at } };
  }
  return out;
}

/** Which subject next, by the mix. */
export function pickSubject(s: LessonSettings, rand: () => number): Subject {
  const total = SUBJECTS.reduce((t, x) => t + s.mix[x], 0);
  let r = rand() * total;
  for (const x of SUBJECTS) { r -= s.mix[x]; if (r < 0 && s.mix[x] > 0) return x; }
  return SUBJECTS.find(x => s.mix[x] > 0) || 'words';
}

/** Which level of a subject: the current one, the next one by how far he is into it, or now and then an older one. */
export function pickLevel(p: LessonProgress, s: LessonSettings, subj: Subject, rand: () => number): number {
  const pos = p.pos[subj], at = Math.floor(pos), into = pos - at;
  if (at > 0 && rand() < s.review) return Math.floor(rand() * at);
  if (at < maxPos(subj) && rand() < into) return at + 1;
  return at;
}

/** A lesson: one game of one level, a few questions long, and the story cards to show first. */
export type LessonPlan = { subject: Subject; index: number; level: string; game: string; length: number; intros: Intro[];
  /** how far into the level he was when it started (a new chess piece waits for the next lesson, after its hello) */
  depth: number };

/** How many questions the next lesson has, with `left` to go before the sticker: 3–5, ending right on it. */
export function lessonLength(left: number, rand: () => number): number {
  if (left <= 5) return left;
  if (left <= 8) return 3;
  return 3 + Math.floor(rand() * 3);
}

/** Which game of a level next: not the one he just played there (if there's another), more likely the
 *  ones he's played least. */
export function pickGame(p: LessonProgress, levelId: string, games: string[], rand: () => number): string {
  const pool = games.length > 1 ? games.filter(g => g !== p.last[levelId]) : games;
  const w = pool.map(g => 1 / (1 + (p.played[`${levelId}/${g}`] || 0)));
  let r = rand() * w.reduce((a, b) => a + b, 0);
  for (let i = 0; i < pool.length; i++) { r -= w[i]; if (r < 0) return pool[i]; }
  return pool[pool.length - 1];
}

/** The story cards before a lesson: the level's story the first time, then any chess piece he's about to meet. */
export function introsFor(p: LessonProgress, subj: Subject, index: number): Intro[] {
  const l = LEVELS[subj][index];
  return [l, ...(l.intros?.(p.right[l.id] || 0) || [])].filter(x => !p.told.includes(x.id));
}

/** The next lesson. */
export function nextLesson(p: LessonProgress, s: LessonSettings, left: number, rand: () => number = Math.random): LessonPlan {
  const subject = pickSubject(s, rand);
  const index = pickLevel(p, s, subject, rand);
  const l = LEVELS[subject][index];
  const depth = p.right[l.id] || 0;
  const game = pickGame(p, l.id, gamesAt(l, depth).map(g => g.id), rand);
  return { subject, index, level: l.id, game, depth, length: lessonLength(left, rand), intros: introsFor(p, subject, index) };
}

/** A question for a lesson (made fresh each time, as hard as he's got to in the level). */
export function lessonQuestion(plan: LessonPlan, rand: () => number = Math.random): Question {
  return makeQuestion(LEVELS[plan.subject][plan.index], plan.game, rng(Math.floor(rand() * 2 ** 31)), plan.depth);
}

/** A lesson started: count it, and remember its game so the next one is different. */
export const lessonStarted = (p: LessonProgress, plan: LessonPlan): LessonProgress => ({
  ...p, last: { ...p.last, [plan.level]: plan.game }, played: { ...p.played, [`${plan.level}/${plan.game}`]: (p.played[`${plan.level}/${plan.game}`] || 0) + 1 },
});

export const today = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** After a question: right first try moves him along, a miss moves him back a little. */
export function recordAnswer(p: LessonProgress, s: LessonSettings, subj: Subject, index: number, right: boolean, levelId: string, now = new Date()): LessonProgress {
  const pos = p.pos[subj], at = Math.floor(pos);
  const step = 1 / (s.perLevel * (LEVELS[subj][at]?.size || 1));
  let next = pos;
  if (index >= at) {   // only the level he's on, or the one coming in, moves him (older reviews don't)
    if (right) next = Math.max(pos, Math.min(pos + step, index + CARRY));
    else next = pos - step / 2;
  }
  next = Math.max(p.best[subj], clampPos(subj, Math.round(next * 1000) / 1000));
  const day = today(now);
  const was = p.days[day]?.[subj] || [0, 0];
  const days = { ...p.days, [day]: { ...(p.days[day] || {}), [subj]: [was[0] + (right ? 1 : 0), was[1] + (right ? 0 : 1)] as [number, number] } };
  for (const k of Object.keys(days).sort().slice(0, -30)) delete days[k];
  return {
    ...p, days,
    pos: { ...p.pos, [subj]: next },
    best: { ...p.best, [subj]: Math.max(p.best[subj], Math.floor(next)) },
    asked: { ...p.asked, [levelId]: (p.asked[levelId] || 0) + 1 },
    right: right ? { ...p.right, [levelId]: (p.right[levelId] || 0) + 1 } : p.right,
  };
}

/** How he's done in the last `n` days, per subject: [right, missed]. */
export function lastDays(p: LessonProgress, n = 7, now = new Date()): Record<Subject, [number, number]> {
  const out = { chess: [0, 0], words: [0, 0], math: [0, 0] } as Record<Subject, [number, number]>;
  for (let i = 0; i < n; i++) {
    const d = new Date(now); d.setDate(d.getDate() - i);
    const day = p.days[today(d)];
    if (day) for (const s of SUBJECTS) { const v = day[s]; if (v) { out[s][0] += v[0]; out[s][1] += v[1]; } }
  }
  return out;
}

export const STICKERS = ['🦁', '🐘', '🦒', '🐢', '🦊', '🐼', '🐸', '🦄', '🐙', '🦖', '🐳', '🦋', '🐝', '🦉', '🐧', '🐨', '🚒', '🚀', '🚂', '🚜', '🌈', '🍓', '🍉', '⚽', '🎈', '🌻', '🐬', '🦕', '🐯', '🐰'];
export const stickerFor = (p: LessonProgress) => STICKERS[p.stickers.length % STICKERS.length];
