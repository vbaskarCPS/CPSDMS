// src/planner/features/plan/dates.ts — day / ISO-week / month keys and the wake streak.
import { dayKey } from '../../lib/docs';
import { routineFor, routineMin, routineNow, type Routine } from '../../lib/routine';
import type { Day } from './types';

export const parseDay = (key: string): Date => { const [y, m, d] = key.split('-').map(Number); return new Date(y, m - 1, d); };
// noon, so the 4 am day shift in dayKey never lands it on the day before
export const addDays = (key: string, n: number): string => { const d = parseDay(key); d.setHours(12); d.setDate(d.getDate() + n); return dayKey(d); };
export const isValidDay = (k: string | undefined): k is string => !!k && /^\d{4}-\d{2}-\d{2}$/.test(k) && !isNaN(parseDay(k).getTime());

export function weekKey(d = new Date()): string {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const y = t.getUTCFullYear();
  const w = Math.ceil(((t.getTime() - Date.UTC(y, 0, 1)) / 864e5 + 1) / 7);
  return `${y}-W${String(w).padStart(2, '0')}`;
}
/** Monday..Sunday day keys of the ISO week that contains `d`. */
export function weekDays(d = new Date()): string[] {
  const m = new Date(d); const day = m.getDay() || 7; m.setDate(m.getDate() - day + 1);
  return Array.from({ length: 7 }, (_, i) => { const x = new Date(m); x.setDate(m.getDate() + i); return dayKey(x); });
}
export const shiftWeek = (d: Date, n: number): Date => { const x = new Date(d); x.setDate(x.getDate() + 7 * n); return x; };

export const monthKey = (d = new Date()): string => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
export const monthRange = (d = new Date()): [string, string] => [`${monthKey(d)}-01`, `${monthKey(d)}-31`];
export const shiftMonth = (d: Date, n: number): Date => new Date(d.getFullYear(), d.getMonth() + n, 1);

/** The sauna timer has run out and the sauna isn't ticked: the time it ended ('HH:MM', the phone's clock), so it can
 *  be ticked for you (Vijay, 12 Nov: "I keep forgetting to check off the sauna"). Null while it's still on, when it's
 *  already ticked, never started, or the sauna is off today. */
export function saunaDue(start: string | undefined, ticked: string | undefined, saunaMin: number, now: number): string | null {
  if (!start || ticked || !(saunaMin > 0)) return null;
  const s = Date.parse(start);
  if (!Number.isFinite(s)) return null;
  const end = s + saunaMin * 60_000;
  if (now < end) return null;
  const e = new Date(end);
  return `${String(e.getHours()).padStart(2, '0')}:${String(e.getMinutes()).padStart(2, '0')}`;
}
export const nowHM = (d = new Date()): string => { return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };

/** Up by the wake target plus the grace? (ticks.up is the time the "Up" block was ticked.) A day whose plan was
 *  changed ahead (sick: up at 7) is judged against that day's time. */
export const wokeOnTime = (day: Day | undefined, r: Routine): boolean =>
  !!day?.ticks.up && routineMin(day.ticks.up) <= routineMin(routineFor(r, day.adjust).wake) + r.wakeGrace;
/** Lights out by the target (that day's, if it was moved)? 1:00 am sorts after 11 pm on the routine scale (day starts at 4 am). */
export const lightsOutOnTime = (day: Day | undefined, r: Routine): boolean =>
  !!day?.ticks.lightsOut && routineMin(day.ticks.lightsOut) <= routineMin(routineFor(r, day.adjust).lightsOut);

/** Consecutive days that pass `ok`, ending today (or yesterday when today isn't logged yet). */
export function streakOf(days: Record<string, Day>, ok: (d: Day | undefined) => boolean, logged: (d: Day | undefined) => boolean): number {
  let key = dayKey();
  if (!logged(days[key])) key = addDays(key, -1);
  let n = 0;
  while (days[key] && ok(days[key])) { n++; key = addDays(key, -1); }
  return n;
}
export const wakeStreak = (days: Record<string, Day>, r: Routine = routineNow()): number => streakOf(days, d => wokeOnTime(d, r), d => !!d?.ticks.up);
export const lightsOutStreak = (days: Record<string, Day>, r: Routine = routineNow()): number => streakOf(days, d => lightsOutOnTime(d, r), d => !!d?.ticks.lightsOut);

/** Minutes between lights out and the wake target, as "7h 30m". */
export function sleepEstimate(lightsOut: string, wake: string): string {
  const mins = (routineMin(wake) - routineMin(lightsOut) + 1440) % 1440;
  return `${Math.floor(mins / 60)}h ${String(mins % 60).padStart(2, '0')}m`;
}

export const fmtDate = (key: string, opts: Intl.DateTimeFormatOptions = { weekday: 'long', month: 'long', day: 'numeric' }) => parseDay(key).toLocaleDateString([], opts);
