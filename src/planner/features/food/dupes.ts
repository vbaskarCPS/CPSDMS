// src/planner/features/food/dupes.ts — keeping the meal log free of doubles. The protein road's "Ate it" and the Food
// screen's Add can both log the same food; these helpers find the meal that's probably already there, so the app asks
// "is this the same?" instead of logging it twice.
import { minutesOf } from '../../lib/routine';
import type { ProteinSlot } from '../plan/types';
import { mealKey, type Meal } from './model';

export const ROAD_NOTE = 'Protein road · ';
const SHAKE = /shake|protein drink|whey|smoothie|protein milk|fairlife|premier protein|core power|isolate/i;
const WINDOW = 180;   // minutes: a meal logged up to 3 hours before counts as "already logged"
const SAME_NAME = 90; // minutes: the same name twice this close is almost always a double tap

const norm = (s: string) => s.toLowerCase().replace(/\(.*?\)/g, '').replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
export const isShakeName = (name: string) => SHAKE.test(name);
/** Minutes between two HH:MM on the planner's day (after midnight still counts as the evening before). */
const gap = (a: string, b: string) => { const x = (minutesOf(a) - 240 + 1440) % 1440, y = (minutesOf(b) - 240 + 1440) % 1440; return y - x; };
export const fromRoad = (m: Meal) => !!m.note?.startsWith(ROAD_NOTE);

/** Before ticking a slot: a meal already logged today that is probably this slot, newest first.
 *  Not one another slot already counts, logged in the 3 hours before `now`, and the right kind (shake vs meal). */
export function alreadyLoggedFor(slot: ProteinSlot, meals: Meal[], slots: ProteinSlot[], now: string): Meal[] {
  const claimed = new Set(slots.map(s => s.eaten).filter(Boolean) as string[]);
  const want = norm(slot.what || '');
  return meals
    .filter(m => !claimed.has(mealKey(m)) && !fromRoad(m))
    .filter(m => { const g = gap(m.time, now); return g >= -15 && g <= WINDOW; })
    .filter(m => (want && norm(m.name) === want) || (slot.kind === 'shake') === isShakeName(m.name) || m.items.some(i => (slot.kind === 'shake') === isShakeName(i.name)))
    .sort((a, b) => gap(a.time, b.time));   // newest first
}

/** Before adding a meal from Food: what's probably the same food already in the log.
 *  The same name close by (a double tap), or a protein-road tick of the same kind in the 3 hours around it. */
export function likelySame(draft: { name: string; time: string; items: { name: string }[] }, meals: Meal[]): Meal | null {
  const name = norm(draft.name);
  const shake = isShakeName(draft.name) || draft.items.some(i => isShakeName(i.name));
  const near = (m: Meal, w: number) => Math.abs(gap(m.time, draft.time)) <= w;
  return meals.find(m => norm(m.name) === name && near(m, SAME_NAME))
    || meals.find(m => fromRoad(m) && near(m, WINDOW) && (isShakeName(m.name) || m.items.some(i => isShakeName(i.name))) === shake)
    || null;
}
