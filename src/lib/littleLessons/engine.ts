// src/lib/littleLessons/engine.ts — how Little Lessons picks the next question and moves Kiaan along.
//
// Each subject has a position on its ladder of levels, e.g. 4.3 = level 4, with 30% of the questions
// already from level 5. Getting a question right first try nudges the position up (one level per
// `perLevel` right answers, 10 by default); a miss nudges it back half as much, so the next level is
// mixed in gradually while he's doing well and the one he's moving off is phased out. He never slips
// below a level he has fully reached, and about one question in ten reviews an older level.
//   Right answers on a level can only carry him part way into the next one (CARRY): to go further he has
//   to get some of the new level's questions right too.
// The subject for each question comes from the grown-ups' mix (e.g. 30% chess, 40% words, 30% math).
import { LEVELS, SUBJECTS, rng, type Question, type Subject } from './levels';
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
  asked: Record<string, number>;                    // questions asked per level (to take turns through a lesson)
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

/** Where the old Little Chess progress got to: the first lesson not done becomes chess's level. */
function chessFrom(done: unknown): number {
  if (!Array.isArray(done)) return 0;
  const i = LESSONS.findIndex(l => !done.includes(l.id));
  return i < 0 ? LESSONS.length - 1 : i;
}

/** His saved progress, filled in (and, the first time, carried over from Little Chess). */
export function readProgress(x: Partial<LessonProgress> | null | undefined, oldChess?: Record<string, unknown> | null): LessonProgress {
  const pos = { chess: 0, words: 0, math: 0 } as Record<Subject, number>, best = { ...pos };
  const told: string[] = Array.isArray(x?.told) ? x!.told.filter(t => typeof t === 'string') : [];
  for (const s of SUBJECTS) {
    pos[s] = clampPos(s, num(x?.pos?.[s], 0));
    best[s] = clampPos(s, Math.max(Math.floor(pos[s]), num(x?.best?.[s], 0)));
  }
  let stickers: string[] = Array.isArray(x?.stickers) ? x!.stickers.filter(s => typeof s === 'string') : [];
  if (!x && oldChess) {
    // first time: pick up where Little Chess left off (its stories counted as told)
    pos.chess = best.chess = chessFrom(oldChess.done);
    for (let i = 0; i <= pos.chess; i++) told.push(LEVELS.chess[i].id);
    if (Array.isArray(oldChess.stickers)) stickers = oldChess.stickers.filter((s): s is string => typeof s === 'string');
  }
  return {
    pos, best, told, stickers,
    asked: x?.asked && typeof x.asked === 'object' ? { ...x.asked } : {},
    applied: x?.applied && typeof x.applied === 'object' ? { ...x.applied } : {},
    days: x?.days && typeof x.days === 'object' ? { ...x.days } : {},
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

/** The next question (and its level's index). */
export function nextQuestion(p: LessonProgress, s: LessonSettings, rand: () => number = Math.random): { q: Question; index: number } {
  const subj = pickSubject(s, rand);
  const index = pickLevel(p, s, subj, rand);
  const level = LEVELS[subj][index];
  const q = level.make(rng(Math.floor(rand() * 2 ** 31)), p.asked[level.id] || 0);
  return { q, index };
}

export const today = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** After a question: right first try moves him along, a miss moves him back a little. */
export function recordAnswer(p: LessonProgress, s: LessonSettings, subj: Subject, index: number, right: boolean, levelId: string, now = new Date()): LessonProgress {
  const step = 1 / s.perLevel;
  const pos = p.pos[subj], at = Math.floor(pos);
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
