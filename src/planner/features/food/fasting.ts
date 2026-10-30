// src/planner/features/food/fasting.ts — the daily fast: nothing until dinner (routine.eatOpen), the
// shake at routine.eatClose closes the window. Streak = days where every meal fell inside the window.
import { dayKey, getDocs, putDoc } from '../../lib/docs';
import { routineMin, type Routine } from '../../lib/routine';
import { uid } from '../../ui/primitives';
import { round, sum, type FavMeal, type FoodItem, type Meal } from './model';

/** Is a meal time (HH:MM) inside the eating window? Times are compared on the planner's 4 am clock. */
export function inWindow(time: string, r: Routine): boolean {
  const t = routineMin(time);
  return t >= routineMin(r.eatOpen) && t < routineMin(r.eatClose) + 1;
}
export const breaksFast = (time: string, r: Routine): boolean => routineMin(time) < routineMin(r.eatOpen);

export function fmtDuration(mins: number): string {
  const h = Math.floor(mins / 60), m = mins % 60;
  return h ? `${h}h ${String(m).padStart(2, '0')}m` : `${m}m`;
}

/** Current and best "fast kept" streaks over the meals given (grouped by day). A day with no meals
 *  logged is neutral (skipped); a day with any meal before the window breaks the chain. */
export function fastStreak(meals: Meal[], r: Routine, today = dayKey()): { current: number; best: number; keptToday: boolean | null } {
  const byDay = new Map<string, Meal[]>();
  for (const m of meals) (byDay.get(m.date) || byDay.set(m.date, []).get(m.date)!).push(m);
  const days = [...byDay.keys()].sort();
  const kept = (d: string) => byDay.get(d)!.every(m => !breaksFast(m.time, r));
  let best = 0, run = 0;
  for (const d of days) { if (kept(d)) { run++; best = Math.max(best, run); } else run = 0; }
  // current: walk back from the latest day
  let current = 0;
  for (let i = days.length - 1; i >= 0; i--) { if (kept(days[i])) current++; else break; }
  const keptToday = byDay.has(today) ? kept(today) : null;
  return { current, best, keptToday };
}

export const SHAKE_ITEMS: FoodItem[] = [
  { name: 'Whey protein', portion: '1 scoop', grams: 33, kcal: 130, protein: 25, carbs: 3, fat: 1.5, confidence: 'high' },
  { name: 'Water', portion: '1 cup', grams: 250, kcal: 0, protein: 0, carbs: 0, fat: 0, confidence: 'high' },
];
export const SHAKE_NAME = 'Protein shake';

/** The one-tap shake favourite: seeded once, found by name afterwards. */
export async function ensureShakeFavourite(favs?: FavMeal[]): Promise<FavMeal> {
  const list = favs ?? (await getDocs<FavMeal>('favmeal')).map(d => d.data);
  const found = list.find(f => f.name.trim().toLowerCase() === SHAKE_NAME.toLowerCase());
  if (found) return found;
  const f: FavMeal & { seeded: true } = { id: uid(), name: SHAKE_NAME, items: SHAKE_ITEMS, totals: round(sum(SHAKE_ITEMS)), uses: 0, lastUsed: new Date().toISOString(), seeded: true };
  await putDoc('favmeal', f.id, f);
  return f;
}
