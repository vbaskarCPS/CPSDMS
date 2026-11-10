// src/planner/features/food/guess.ts — a day with no meals logged: ask what you roughly ate and log an estimate, so the
// week's numbers stay honest instead of showing a zero. Pure, so the rules are tested.
//
// Who gets asked: someone who tracks (meals on at least 3 of the 14 days before yesterday), so a person who doesn't use
// Food is never nagged. Which day: today, once it's late (90 minutes before lights out, or an hour after the kitchen
// closes, whichever comes first) and nothing's logged; otherwise yesterday, if it has nothing. Each day is asked once.
import { routineMin, routineMinutes, type Routine } from '../../lib/routine';

export const TRACKER_MIN_DAYS = 3;

export function guessDay(o: {
  now: Date; today: string; yesterday: string; routine: Routine;
  mealsOn: (day: string) => number; trackedDays: number; asked: (day: string) => boolean;
}): string | null {
  if (o.trackedDays < TRACKER_MIN_DAYS) return null;
  const late = Math.min(routineMin(o.routine.lightsOut) - 90, o.routine.kitchenClose ? routineMin(o.routine.kitchenClose) + 60 : Infinity);
  if (routineMinutes(o.now) >= late && o.mealsOn(o.today) === 0 && !o.asked(o.today)) return o.today;
  if (o.mealsOn(o.yesterday) === 0 && !o.asked(o.yesterday)) return o.yesterday;
  return null;
}

/** When the guessed day's food is filed: inside the eating window for a faster (so it doesn't read as a broken fast), else midday. */
export const guessTime = (r: Routine) => (r.fast ? r.eatOpen : '12:00');

/** Days (YYYY-MM-DD) in [from, to] with at least one meal, from meal keys (`${day}~${time}~${id}`). */
export function daysWithMeals(keys: string[], from: string, to: string): Set<string> {
  const out = new Set<string>();
  for (const k of keys) { const d = k.split('~')[0]; if (d >= from && d <= to) out.add(d); }
  return out;
}
