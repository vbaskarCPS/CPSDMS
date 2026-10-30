// src/planner/features/plan/dates.ts — day / ISO-week / month keys and the wake streak.
import { dayKey } from '../../lib/docs';
import type { Day } from './types';

export const parseDay = (key: string): Date => { const [y, m, d] = key.split('-').map(Number); return new Date(y, m - 1, d); };
export const addDays = (key: string, n: number): string => { const d = parseDay(key); d.setDate(d.getDate() + n); return dayKey(d); };
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

export const nowHM = (): string => { const d = new Date(); return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };
const mins = (hm: string): number => { const [h, m] = hm.split(':').map(Number); return (h || 0) * 60 + (m || 0); };

/** Did this day's wake beat the target (15 min grace)? */
export const wokeOnTime = (day: Day | undefined, target: string): boolean => !!day?.victory.wokeAt && mins(day.victory.wokeAt) <= mins(target) + 15;

/** Consecutive on-time wakes ending today (or yesterday, if today isn't logged yet). */
export function wakeStreak(days: Record<string, Day>, target: string): number {
  let key = dayKey();
  if (!days[key]?.victory.wokeAt) key = addDays(key, -1);
  let n = 0;
  while (wokeOnTime(days[key], target)) { n++; key = addDays(key, -1); }
  return n;
}

export const fmtDate = (key: string, opts: Intl.DateTimeFormatOptions = { weekday: 'long', month: 'long', day: 'numeric' }) => parseDay(key).toLocaleDateString([], opts);
