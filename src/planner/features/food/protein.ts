// src/planner/features/food/protein.ts — the protein road (5 am club): planned in the sauna, eaten before the kitchen
// closes. Two meals and a couple of shakes add up to the goal (the food targets' protein, 180 g to start). Pure helpers
// plus turning a slot into a logged meal.
import { routineMin, type Routine } from '../../lib/routine';
import { uid } from '../../ui/primitives';
import type { ProteinPlan, ProteinSlot } from '../plan/types';
import { round, sum, type FoodItem, type Meal } from './model';

export const DEFAULT_GOAL = 180;
export const SCOOP = 25;   // one scoop of whey, g protein

/** HH:MM plus minutes, clamped inside the day. */
const plus = (t: string, m: number) => { const [h, mm] = t.split(':').map(Number); const x = Math.max(0, Math.min(1439, h * 60 + mm + m)); return `${String(Math.floor(x / 60)).padStart(2, '0')}:${String(x % 60).padStart(2, '0')}`; };
/** Is a time at or after the kitchen closing (on the planner's 4 am clock)? */
export const afterKitchen = (time: string, r: Routine): boolean => !!r.kitchenClose && !!time && routineMin(time) >= routineMin(r.kitchenClose);

/** Shake out of the sauna, a meal mid-morning, a shake late morning, the last meal before the kitchen closes. */
export function defaultSlots(r: Routine): ProteinSlot[] {
  const close = r.kitchenClose || '14:00';
  const mk = (kind: ProteinSlot['kind'], label: string, time: string): ProteinSlot => ({ id: uid(), kind, label, time, what: '', protein: 0 });
  return [
    mk('shake', 'Shake 1', plus(r.review || '06:45', 5)),
    mk('meal', 'Meal 1', '09:00'),
    mk('shake', 'Shake 2', '11:30'),
    mk('meal', 'Meal 2', plus(close, -45)),
  ];
}

/** Yesterday's slots as today's starting point: same times and food, nothing eaten yet. */
export const copyPlan = (p: ProteinPlan): ProteinPlan => ({ slots: p.slots.map(s => ({ ...s, id: uid(), eaten: undefined })) });

export const sortSlots = (s: ProteinSlot[]) => [...s].sort((a, b) => routineMin(a.time) - routineMin(b.time));
export const planned = (p?: ProteinPlan) => Math.round((p?.slots || []).reduce((t, s) => t + (s.protein || 0), 0));
export const eatenFromPlan = (p?: ProteinPlan) => Math.round((p?.slots || []).filter(s => s.eaten).reduce((t, s) => t + (s.protein || 0), 0));

/** The next label for a new slot of a kind: "Shake 3", "Meal 3". */
export function nextLabel(slots: ProteinSlot[], kind: ProteinSlot['kind']): string {
  const base = kind === 'shake' ? 'Shake' : 'Meal';
  const n = slots.filter(s => s.kind === kind).length + 1;
  return `${base} ${n}`;
}

/** One line on closing the gap, or null when the plan reaches the goal. */
export function nudge(p: ProteinPlan | undefined, goal: number): string | null {
  const slots = p?.slots || [];
  const gap = goal - planned(p);
  if (gap <= 0) return null;
  const empty = slots.find(s => !s.protein);
  if (empty) return `Fill ${empty.label} — about ${Math.min(gap, empty.kind === 'shake' ? 50 : gap)} g would ${gap <= 50 || empty.kind !== 'shake' ? 'get you there' : 'help'}.`;
  const shake = slots.find(s => s.kind === 'shake' && !s.eaten);
  if (gap <= SCOOP + 5 && shake) return `Add a scoop to ${shake.label} (+${SCOOP} g).`;
  if (gap <= 2 * SCOOP + 5 && shake) return `Double up ${shake.label} — two more scoops (+${2 * SCOOP} g).`;
  return `Still ${gap} g short — add a shake (+${SCOOP} g) or bump a meal's servings.`;
}

/** The items a slot logs as: its own items, or one line with its protein (and calories when known). */
export function slotItems(s: ProteinSlot): FoodItem[] {
  if (s.items?.length) return s.items.map(i => ({ ...i }));
  return [{ name: s.what || s.label, portion: s.kind === 'shake' ? 'shake' : 'meal', kcal: s.kcal || 0, protein: s.protein || 0, carbs: 0, fat: 0, confidence: 'medium' }];
}
export function slotMeal(s: ProteinSlot, date: string, time: string): Meal {
  const items = slotItems(s);
  return { id: uid(), date, time, name: s.what || s.label, items, totals: round(sum(items)), source: 'favourite', note: `Protein road · ${s.label}` };
}
