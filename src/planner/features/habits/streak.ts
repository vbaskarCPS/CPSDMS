// src/planner/features/habits/streak.ts — streaks the Atomic Habits way: never miss twice.
// A day the habit isn't due doesn't touch the chain. One missed due day is a gap (the chain holds);
// the second consecutive missed due day resets it. Pure functions over day keys (YYYY-MM-DD, local).
import type { Habit, HabitLog, HabitMark } from './types';

export type Logs = Record<string, HabitLog>;   // dayKey → log
export type DayState = 'done' | 'mini' | 'missed' | 'off' | 'future';

export function keyOf(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
export function dateOf(key: string): Date {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d);
}
export function addDays(key: string, n: number): string {
  const d = dateOf(key); d.setDate(d.getDate() + n); return keyOf(d);
}
export function weekday(key: string): number { return dateOf(key).getDay(); }

export const isDue = (h: Pick<Habit, 'days'>, key: string) => (h.days?.length ? h.days : [0, 1, 2, 3, 4, 5, 6]).includes(weekday(key));
export const counts = (m: HabitMark | undefined) => m === 'done' || m === 'mini';

/** What a day looks like for one habit. `today` decides what's future; today itself is never 'missed'. */
export function dayState(h: Pick<Habit, 'days' | 'createdAt'>, logs: Logs, key: string, today: string): DayState {
  if (key > today) return 'future';
  const m = logs[key]?.[(h as Habit).id];
  if (m === 'done') return 'done';
  if (m === 'mini') return 'mini';
  if (!isDue(h, key)) return 'off';
  if (key === today) return 'off';          // still time today
  if (h.createdAt && key < h.createdAt.slice(0, 10)) return 'off';
  return 'missed';
}

/** Current streak as of `today` (counting due days done or mini). Today counts if done; otherwise it's
 *  neither a hit nor a miss yet. */
export function currentStreak(h: Habit, logs: Logs, today: string): number {
  let streak = 0, misses = 0;
  let key = today;
  const start = h.createdAt ? h.createdAt.slice(0, 10) : '1970-01-01';
  for (let i = 0; i < 3660 && key >= start; i++, key = addDays(key, -1)) {
    const m = logs[key]?.[h.id];
    if (counts(m)) { streak++; misses = 0; continue; }
    if (!isDue(h, key) || key === today) continue;
    misses++;
    if (misses >= 2) break;
  }
  return streak;
}

/** Best streak ever, same rules, walking forward from the habit's first day. */
export function bestStreak(h: Habit, logs: Logs, today: string): number {
  const start = h.createdAt ? h.createdAt.slice(0, 10) : Object.keys(logs).sort()[0];
  if (!start) return 0;
  let best = 0, run = 0, misses = 0;
  for (let key = start; key <= today; key = addDays(key, 1)) {
    const m = logs[key]?.[h.id];
    if (counts(m)) { run++; misses = 0; best = Math.max(best, run); continue; }
    if (!isDue(h, key) || key === today) continue;
    misses++;
    if (misses >= 2) { run = 0; misses = 0; }
  }
  return best;
}

/** Was yesterday (the most recent due day before today) missed? That's the "don't miss twice" moment. */
export function missedLastDue(h: Habit, logs: Logs, today: string): boolean {
  let key = addDays(today, -1);
  const start = h.createdAt ? h.createdAt.slice(0, 10) : '1970-01-01';
  for (let i = 0; i < 14 && key >= start; i++, key = addDays(key, -1)) {
    if (!isDue(h, key)) continue;
    return !counts(logs[key]?.[h.id]);
  }
  return false;
}

/** Completion over the last `n` days: due days done / due days (today included only if done). */
export function completion(h: Habit, logs: Logs, today: string, n = 30): { done: number; due: number; pct: number } {
  let done = 0, due = 0;
  const start = h.createdAt ? h.createdAt.slice(0, 10) : '1970-01-01';
  for (let i = 0; i < n; i++) {
    const key = addDays(today, -i);
    if (key < start) break;
    const hit = counts(logs[key]?.[h.id]);
    if (key === today) { if (hit) { done++; due++; } continue; }
    if (!isDue(h, key)) continue;
    due++; if (hit) done++;
  }
  return { done, due, pct: due ? Math.round((done / due) * 100) : 0 };
}

/** The last `n` day keys ending today, oldest first. */
export function lastDays(today: string, n: number): string[] {
  return Array.from({ length: n }, (_, i) => addDays(today, -(n - 1 - i)));
}
