// src/planner/features/food/model.ts — meals, targets and favourites: the shapes and the arithmetic.
import type { FoodItem } from '../../lib/ai';
import { dayKey, getDocs, putDoc, type Doc } from '../../lib/docs';
import { uid } from '../../ui/primitives';

export type { FoodItem };
export interface Totals { kcal: number; protein: number; carbs: number; fat: number }
export type MealSource = 'photo' | 'text' | 'favourite' | 'manual';
export interface Meal {
  id: string; date: string; time: string; name: string; items: FoodItem[]; totals: Totals;
  thumb?: string; note?: string; source: MealSource;
}
export interface Targets { kcal: number; protein: number; carbs?: number; fat?: number }
export interface FavMeal { id: string; name: string; items: FoodItem[]; totals: Totals; thumb?: string; uses: number; lastUsed: string }

export const DEFAULT_TARGETS: Targets = { kcal: 2200, protein: 160 };
export const ZERO: Totals = { kcal: 0, protein: 0, carbs: 0, fat: 0 };

export const mealKey = (m: { date: string; time: string; id: string }) => `${m.date}~${m.time}~${m.id}`;
export const nowTime = () => { const d = new Date(); return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };

export function sum(items: FoodItem[]): Totals {
  return items.reduce((t, i) => ({ kcal: t.kcal + (i.kcal || 0), protein: t.protein + (i.protein || 0), carbs: t.carbs + (i.carbs || 0), fat: t.fat + (i.fat || 0) }), { ...ZERO });
}
export const addTotals = (a: Totals, b: Totals): Totals => ({ kcal: a.kcal + b.kcal, protein: a.protein + b.protein, carbs: a.carbs + b.carbs, fat: a.fat + b.fat });
export const round = (t: Totals): Totals => ({ kcal: Math.round(t.kcal), protein: Math.round(t.protein), carbs: Math.round(t.carbs), fat: Math.round(t.fat) });

/** Scale one item's numbers (portion stepper). */
export function scaleItem(i: FoodItem, f: number): FoodItem {
  return { ...i, grams: i.grams ? Math.round(i.grams * f) : i.grams, kcal: Math.round(i.kcal * f), protein: Math.round(i.protein * f), carbs: Math.round(i.carbs * f), fat: Math.round(i.fat * f) };
}

/** Hidden extras the photo can't see. */
export const EXTRAS: FoodItem[] = [
  { name: 'Cooking oil', portion: '1 tbsp', grams: 14, kcal: 120, protein: 0, carbs: 0, fat: 14, confidence: 'high' },
  { name: 'Butter', portion: '1 tsp', grams: 5, kcal: 35, protein: 0, carbs: 0, fat: 4, confidence: 'high' },
  { name: 'Dressing', portion: '2 tbsp', grams: 30, kcal: 120, protein: 0, carbs: 2, fat: 12, confidence: 'high' },
  { name: 'Sugar', portion: '1 tsp', grams: 4, kcal: 16, protein: 0, carbs: 4, fat: 0, confidence: 'high' },
  { name: 'Ketchup', portion: '1 tbsp', grams: 17, kcal: 15, protein: 0, carbs: 4, fat: 0, confidence: 'high' },
  { name: 'Cheese', portion: '30 g', grams: 30, kcal: 110, protein: 7, carbs: 0, fat: 9, confidence: 'high' },
  { name: 'Rice', portion: '+½ cup', grams: 80, kcal: 100, protein: 2, carbs: 22, fat: 0, confidence: 'high' },
  { name: 'Roti', portion: '+1', grams: 40, kcal: 100, protein: 3, carbs: 18, fat: 2, confidence: 'high' },
];

export const addDays = (key: string, n: number) => { const [y, m, d] = key.split('-').map(Number); const dt = new Date(y, m - 1, d + n); return dayKey(dt); };
export function prettyDay(key: string): string {
  const today = dayKey();
  if (key === today) return 'Today';
  if (key === addDays(today, -1)) return 'Yesterday';
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
}

export async function mealsForDay(day: string): Promise<Doc<Meal>[]> {
  return getDocs<Meal>('meal', `${day}~`, `${day}~￿`);
}
export async function mealsBetween(from: string, to: string): Promise<Doc<Meal>[]> {
  return getDocs<Meal>('meal', `${from}~`, `${to}~￿`);
}
export async function loadTargets(): Promise<Targets | null> {
  const d = await getDocs<Targets>('foodprefs', 'targets', 'targets');
  return d[0]?.data ?? null;
}
export async function saveMeal(m: Meal): Promise<void> { await putDoc('meal', mealKey(m), m); }
export async function removeMeal(m: Meal): Promise<void> { await putDoc('meal', mealKey(m), null); }
export async function saveFavourite(name: string, items: FoodItem[], thumb?: string, existing?: FavMeal): Promise<FavMeal> {
  const f: FavMeal = existing
    ? { ...existing, name, items, totals: round(sum(items)), thumb: thumb ?? existing.thumb, uses: existing.uses + 1, lastUsed: new Date().toISOString() }
    : { id: uid(), name, items, totals: round(sum(items)), thumb, uses: 1, lastUsed: new Date().toISOString() };
  await putDoc('favmeal', f.id, f);
  return f;
}

export const kcalPerLb = { lose: 14, maintain: 15, gain: 17 } as const;
export type Goal = keyof typeof kcalPerLb;
export function suggestTargets(weight: number, units: 'lb' | 'kg', goal: Goal): Targets {
  const lb = units === 'kg' ? weight * 2.2046 : weight;
  const kcal = Math.round((lb * kcalPerLb[goal]) / 50) * 50;
  const protein = Math.round(lb * 0.8 / 5) * 5;
  const fat = Math.round((kcal * 0.27) / 9 / 5) * 5;
  const carbs = Math.max(0, Math.round((kcal - protein * 4 - fat * 9) / 4 / 5) * 5);
  return { kcal, protein, carbs, fat };
}
