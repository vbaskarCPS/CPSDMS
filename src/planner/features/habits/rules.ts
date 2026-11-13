// src/planner/features/habits/rules.ts — the rules a habit that ticks itself can carry: "only counts if done by 5:05",
// "only counts within 30 minutes of I'm up". One plain function decides whether a thing that happened at a moment
// counts for a habit; every trigger in auto.ts goes through it, so a new habit gets the same rules for free.
// What counts is when the thing itself happened (the minute "I'm up" was tapped, the moment Start workout was pressed,
// the time on the meal that reached the protein goal), never when the app got round to noticing it.
import { momentOf } from '../widgets/race';
import type { AutoTrigger, Habit } from './types';

export interface HabitRules {
  /** 'HH:MM': only counts at or before this time that planner day (which starts at 4 am, so 01:00 is after 23:00) */
  by?: string;
  /** only counts this many minutes after I'm up, or sooner (no I'm up that day: doesn't count) */
  withinUpMin?: number;
}

/** A trigger's own rule when the habit doesn't set one. Start workout always had to be within 30 minutes of Up
 *  (Vijay, 12 Nov: "I didn't get into the gym within 30 mins so it isn't a successful habit"). */
export const TRIGGER_RULES: Partial<Record<AutoTrigger, HabitRules>> = { gymStart: { withinUpMin: 30 } };
/** Triggers that happen in the morning, where "within n minutes of I'm up" means something. */
export const MORNING_TRIGGERS: AutoTrigger[] = ['brief', 'gymStart', 'gym', 'sauna', 'shake', 'protein'];

const HM = /^([01]\d|2[0-3]):([0-5]\d)$/;
const okBy = (v: unknown): v is string => typeof v === 'string' && HM.test(v);
const okMin = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v > 0;

/** The rules that apply to a habit: its own, else its trigger's. Anything malformed is left out. */
export function rulesOf(h: Pick<Habit, 'auto' | 'by' | 'withinUpMin'>): HabitRules {
  const d = (h.auto && TRIGGER_RULES[h.auto]) || {};
  const by = okBy(h.by) ? h.by : d.by;
  const within = okMin(h.withinUpMin) ? h.withinUpMin : d.withinUpMin;
  return { ...(by ? { by } : {}), ...(within ? { withinUpMin: within } : {}) };
}
export const hasRules = (r: HabitRules) => !!(r.by || r.withinUpMin);

/** Does something that happened at `at` (ms) on planner day `day` count for these rules? `up` = the moment I'm up was
 *  ticked that day (ms), or null when it wasn't. No rules: always. A rule but no moment to check it by: no. */
export function countsFor(r: HabitRules, day: string, at: number | null | undefined, up?: number | null): boolean {
  if (!hasRules(r)) return true;
  if (at === null || at === undefined || !Number.isFinite(at)) return false;
  if (r.by) {
    const end = momentOf(day, r.by);
    if (end === null || at >= end + 60_000) return false;   // "by 5:05" still takes 5:05 and 40 seconds
  }
  if (r.withinUpMin) {
    if (up === null || up === undefined) return false;
    if (at < up || at - up > r.withinUpMin * 60_000) return false;
  }
  return true;
}

const clock = (hm: string) => { const [h, m] = hm.split(':').map(Number); return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h < 12 ? 'am' : 'pm'}`; };
/** The short line on the habit's card: "by 5:05 am", "within 30 min of I'm up", or both. Empty without rules. */
export function rulesLine(r: HabitRules): string {
  return [r.by ? `by ${clock(r.by)}` : '', r.withinUpMin ? `within ${r.withinUpMin} min of I'm up` : ''].filter(Boolean).join(' · ');
}
