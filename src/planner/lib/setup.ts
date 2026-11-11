// src/planner/lib/setup.ts — the first-open set-up (screens/SetUp.tsx): who gets it, and what its steps turn into.
// It is for the morning profile (Rosh's planner): a few screens that set her day's times, her habits, her last
// period and reminders, then Arvy opens. Shown once: prefs/setup remembers it for the account, so it doesn't come
// back on her other phone, and Settings can run it again. No React here (tested in setup.test.ts).
import { getDoc, putDoc } from './docs';
import { isDemo, profileOf } from './app';
import type { PlannerUser } from './auth';
import { clock, hhmm, minutesOf, type Routine } from './routine';
import type { Habit } from '../features/habits/types';

// ── who gets it ──
const doneKey = (u: PlannerUser) => `planner-setup-done:${u.id}`;
const LATER_KEY = 'planner-setup-later';
const read = (s: 'local' | 'session', k: string): string | null => { try { return (s === 'local' ? localStorage : sessionStorage).getItem(k); } catch { return null; } };
const write = (s: 'local' | 'session', k: string, v: string) => { try { (s === 'local' ? localStorage : sessionStorage).setItem(k, v); } catch { /* private mode: it asks the server next time */ } };

/** No need to ask the server: not her kind of planner, already done on this phone, or "Not now" for this visit. */
export function setupSkipped(u: PlannerUser): boolean {
  return isDemo() || profileOf(u.settings) !== 'morning' || read('local', doneKey(u)) === '1' || read('session', LATER_KEY) === '1';
}
/** Is the set-up still to do? A look-up that fails, or takes more than a few seconds, counts as no: the planner opens
 *  rather than waits (the question is asked again the next time it's opened). */
export async function setupDue(u: PlannerUser, patienceMs = 4000): Promise<boolean> {
  if (setupSkipped(u)) return false;
  try {
    const flag = await Promise.race([getDoc<{ done?: boolean }>('prefs', 'setup'), new Promise<never>((_, no) => setTimeout(() => no(new Error('slow')), patienceMs))]);
    if (flag?.done) { write('local', doneKey(u), '1'); return false; }
    return true;
  } catch { return false; }
}
/** Finished: remembered for the account (and on this phone straight away). */
export async function finishSetup(u: PlannerUser): Promise<void> {
  write('local', doneKey(u), '1');
  await putDoc('prefs', 'setup', { done: true, at: new Date().toISOString() });
}
/** "Not now": it's offered again the next time the planner is opened. */
export const setupLater = (): void => write('session', LATER_KEY, '1');

/** What the last screen sends Arvy on her behalf, so the chat opens with Arvy looking at her day. */
export const SETUP_ASK = 'I’ve just finished setting up my day. Have a quick look at it and ask me if anything else about my day should change.';

// ── her day's times ──
export interface DayAnswers { wake: string; routine: boolean; stretchMin: number; meditateMin: number; workoutMin: number; kiaanUp: string; dinner: string; bed: string }
const mins = (n: unknown, max: number) => Math.max(0, Math.min(max, Math.round(Number(n)) || 0));
/** The answers a routine starts the screen with. A routine with no minutes = no morning routine (10/10/20 is offered if she turns it on). */
export function answersFrom(r: Routine): DayAnswers {
  const has = r.stretchMin + r.meditateMin + r.workoutMin > 0;
  return { wake: r.wake, routine: has, stretchMin: has ? r.stretchMin : 10, meditateMin: has ? r.meditateMin : 10, workoutMin: has ? r.workoutMin : 20, kiaanUp: r.kiaanUp, dinner: r.eatOpen, bed: r.lightsOut };
}
const isTime = (t: string) => /^([01]\d|2[0-3]):[0-5]\d$/.test(t);
/** What's wrong with the answers, in words for the screen; null when they can be saved. */
export function answersProblem(a: DayAnswers): string | null {
  if (![a.wake, a.kiaanUp, a.dinner, a.bed].every(isTime)) return 'Fill in all four times.';
  if (a.routine && !(mins(a.stretchMin, 60) + mins(a.meditateMin, 60) + mins(a.workoutMin, 90) > 0)) return 'Give the morning routine some minutes, or switch it off.';
  return null;
}
/** Her routine with the answers in it. Everything the screen doesn't ask about stays as it was; the evening's
 *  "start getting ready" time keeps its distance from bedtime. */
export function applyAnswers(r: Routine, a: DayAnswers): Routine {
  const gap = Math.max(5, Math.min(60, (minutesOf(r.lightsOut) - minutesOf(r.windDown) + 1440) % 1440 || 15));
  return { ...r, wake: a.wake, kiaanUp: a.kiaanUp, eatOpen: a.dinner, lightsOut: a.bed, windDown: hhmm(minutesOf(a.bed) - gap),
    stretchMin: a.routine ? mins(a.stretchMin, 60) : 0, meditateMin: a.routine ? mins(a.meditateMin, 60) : 0, workoutMin: a.routine ? mins(a.workoutMin, 90) : 0 };
}

// ── her habits ──
/** One row of the habits screen: a habit she has (kept as it is, kept with its wording fitted to her day, or
 *  paused) or one she could add. `habit` is what's saved when the row is on. */
export interface HabitChoice { key: string; title: string; note: string; on: boolean; habit: Habit; has: boolean; /** a habit she has, reworded to fit her day: as it was */ was?: Habit }
// the four habits every planner starts with (features/habits/seed.ts) were written for the night routine
const SEEDED_BRIEF = 'Bed Brief before getting up', SEEDED_LIGHTS = 'Lights out by 1';

/** The habits screen's rows for her habits and her routine. `id` makes the ids of habits she adds. */
export function habitChoices(habits: Habit[], r: Routine, id: () => string, now = new Date().toISOString()): HabitChoice[] {
  const active = habits.filter(h => h && !h.archived).sort((a, b) => a.order - b.order);
  const routineMins = r.stretchMin + r.meditateMin + r.workoutMin;
  const have: HabitChoice[] = active.map(h => {
    if (h.name === SEEDED_BRIEF) {
      return { key: h.id, has: true, was: h, on: true, title: 'Morning Brief', note: `Yours now says “${h.name}”. Ticks itself when you finish the Brief.`,
        habit: { ...h, name: 'Morning Brief', identity: 'someone who decides her day before it starts', cue: { time: hhmm(minutesOf(r.wake) + routineMins), place: 'somewhere quiet' },
          stack: routineMins ? 'After my morning routine' : 'After I get up', why: 'Ten quiet minutes beat a day on autopilot.' } };
    }
    if (h.name === SEEDED_LIGHTS) {
      return { key: h.id, has: true, was: h, on: true, title: `In bed by ${clock(r.lightsOut)}`, note: `Yours now says “${h.name}”. Ticks itself when you tick bed on Today.`,
        habit: { ...h, name: `In bed by ${clock(r.lightsOut)}`, identity: 'someone who protects her mornings the night before', cue: { time: r.lightsOut, place: 'bedroom' },
          why: 'Tomorrow starts tonight.', anchor: { block: 'evening', when: 'after' } } };
    }
    if (h.auto === 'fast' && !r.fast) return { key: h.id, has: true, on: false, title: h.name, note: 'For an eating window, which your day doesn’t follow.', habit: h };
    if (h.auto === 'shake' || h.auto === 'sauna') return { key: h.id, has: true, on: false, title: h.name, note: 'Written for a gym morning. Keep it and you tick it by hand.', habit: h };
    return { key: h.id, has: true, on: true, title: h.name, note: h.twoMinute ? `Small version: ${h.twoMinute.replace(/[.!]+$/, '')}.` : '', habit: h };
  });
  const order = active.reduce((m, h) => Math.max(m, h.order), -1) + 1;
  const mk = (n: number, h: Pick<Habit, 'name' | 'identity' | 'cue' | 'stack' | 'twoMinute' | 'why'> & Partial<Habit>): Habit => ({ id: id(), createdAt: now, order: order + n, days: [0, 1, 2, 3, 4, 5, 6], ...h });
  const ideas: { note: string; habit: Habit }[] = [
    { note: 'An easy first win.', habit: mk(0, { name: 'Glass of water first thing', identity: 'someone who looks after herself first', cue: { time: r.wake, place: 'kitchen' }, stack: 'After I get up', twoMinute: 'Fill the glass', why: 'An easy first win of the day.', anchor: { block: 'wake', when: 'after' } }) },
    { note: 'Fresh air, any time of day.', habit: mk(1, { name: '10-minute walk', identity: 'someone who moves every day', cue: { time: '', place: 'outside' }, stack: '', twoMinute: 'Shoes on, to the end of the street', why: 'Fresh air resets the day.' }) },
    { note: 'A calmer end to the day than a screen.', habit: mk(2, { name: 'Read 10 pages', identity: 'a reader', cue: { time: hhmm(minutesOf(r.lightsOut) - 30), place: 'in bed' }, stack: 'After the evening review', twoMinute: 'Read one page', why: 'A calmer way to end the day than a screen.', anchor: { block: 'evening', when: 'after' } }) },
  ];
  const taken = new Set(habits.filter(Boolean).map(h => h.name.trim().toLowerCase()));
  return [...have, ...ideas.filter(x => !taken.has(x.habit.name.toLowerCase())).map(x => ({ key: x.habit.id, has: false, on: false, title: x.habit.name, note: x.note, habit: x.habit }))];
}
/** The documents to save for the rows as she left them: reworded ones, paused ones (history kept) and new ones.
 *  A habit she has and keeps as it is isn't touched. */
export function habitSaves(rows: HabitChoice[]): { kind: 'habit'; key: string; data: Habit }[] {
  const out: { kind: 'habit'; key: string; data: Habit }[] = [];
  for (const row of rows) {
    if (row.has && !row.on) out.push({ kind: 'habit', key: row.habit.id, data: { ...(row.was || row.habit), archived: true } });   // paused as it was worded
    else if (row.on && (row.was || !row.has)) out.push({ kind: 'habit', key: row.habit.id, data: row.habit });
  }
  return out;
}
