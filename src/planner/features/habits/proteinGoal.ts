// src/planner/features/habits/proteinGoal.ts — the 'protein' trigger: a habit ticks itself when the day's logged
// protein first reaches the goal (the food targets' protein, the number Food shows as the day's target). The moment that
// counts for the habit's rules ("by 3 pm") is the time on the meal that took the total over: the meal's own `time`
// ('HH:MM' on its planner day), the time it was logged for, which is what Food shows on it.
// Checked whenever a meal is saved, changed or removed (food/model saveMeal and removeMeal, Today's "Ate it", Arvy
// logging a meal) and when Today opens, so a goal reached on the other phone ticks it here too. If the total falls back
// under the goal, the tick goes, but only a tick this trigger made that day; one made by hand stays.
import { getDayDocs, getDoc } from '../../lib/docs';
import { momentOf } from '../widgets/race';
import type { Meal, Targets } from '../food/model';
import { autoMark } from './auto';

type MealLike = Pick<Meal, 'date' | 'time'> & { totals?: { protein?: number } };

/** When the day's protein first reached the goal: the moment (ms) of the meal that took it over, or null when it
 *  hasn't (or there is no goal). Meals are counted in the order of their times on the planner day (01:00 after 23:00);
 *  the total is rounded the way Food rounds it. */
export function proteinReachedAt(meals: MealLike[], day: string, goal: number | null | undefined): number | null {
  if (!goal || !(goal > 0)) return null;
  const timed = meals
    .filter(m => m && m.date === day)
    .map(m => ({ at: momentOf(day, m.time), p: Number(m.totals?.protein) || 0 }))
    .filter((m): m is { at: number; p: number } => m.at !== null)
    .sort((a, b) => a.at - b.at);
  let total = 0;
  for (const m of timed) { total += m.p; if (Math.round(total) >= goal) return m.at; }
  return null;
}

/** Look at one planner day's meals and tick (or take back) the habits set to "the day's protein goal is logged".
 *  No goal set in Food: nothing changes either way. Quiet on failure. */
export async function checkProteinGoal(day: string): Promise<void> {
  try {
    const [docs, targets] = await Promise.all([getDayDocs<Meal>('meal', day, day), getDoc<Targets>('foodprefs', 'targets')]);
    const goal = targets?.protein;
    if (!goal) return;
    const at = proteinReachedAt(docs.map(d => d.data).filter(Boolean), day, goal);
    if (at !== null) await autoMark('protein', true, day, 'done', { at });
    else await autoMark('protein', false, day, 'done', { onlyIfMine: true });
  } catch { /* the habit can still be ticked by hand */ }
}
