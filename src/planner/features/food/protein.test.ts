// The protein road: default slots before the kitchen closes, the nudge, and recipe → shopping lines.
import { describe, expect, it } from 'vitest';
import { NIGHT_ROUTINE } from '../../lib/routine';
import { afterKitchen, defaultSlots, nudge, planned, slotMeal } from './protein';
import { addQty, fmtQty, parseIngredient, recipeSlot, shopLines, type Recipe } from './recipes';

const plan = (ps: number[], kinds = ['shake', 'meal', 'shake', 'meal']) => ({ slots: ps.map((p, i) => ({ id: String(i), kind: kinds[i] as 'meal' | 'shake', label: `${kinds[i]} ${i}`, time: '09:00', what: p ? 'x' : '', protein: p })) });
const recipe = (over: Partial<Recipe> = {}): Recipe => ({ id: 'r', name: 'Tandoori chicken', servings: 4, perServing: { kcal: 600, protein: 48, carbs: 60, fat: 20 }, createdAt: '', steps: [],
  ingredients: [{ qty: 2, unit: 'lb', item: 'chicken thighs', section: 'Meat & Seafood' }, { qty: 1, unit: 'cup', item: 'Greek yogurt' }, { item: 'salt', pantry: true }], ...over });

describe('the protein road', () => {
  it('plans 2 shakes and 2 meals, all before the kitchen closes', () => {
    const s = defaultSlots(NIGHT_ROUTINE);
    expect(s.map(x => `${x.time} ${x.kind}`)).toEqual(['06:50 shake', '09:00 meal', '11:30 shake', '13:15 meal']);
    expect(s.some(x => afterKitchen(x.time, NIGHT_ROUTINE))).toBe(false);
    expect(afterKitchen('14:00', NIGHT_ROUTINE)).toBe(true);
    expect(afterKitchen('20:00', { ...NIGHT_ROUTINE, kitchenClose: '' })).toBe(false);
  });
  it('nudges until the plan reaches the goal', () => {
    expect(nudge(plan([50, 48, 50, 42]), 180)).toBeNull();
    expect(nudge(plan([50, 48, 0, 42]), 180)).toMatch(/^Fill shake 2/);
    expect(nudge(plan([25, 48, 25, 62]), 180)).toMatch(/scoop/);
    expect(planned(plan([25, 48, 25, 62]))).toBe(160);
  });
  it('logs a slot as a meal with its protein', () => {
    const m = slotMeal({ id: 'a', kind: 'meal', label: 'Meal 1', time: '09:00', ...recipeSlot(recipe(), 1.5) }, '2026-11-06', '09:05');
    expect(m.totals.protein).toBe(72);
    expect(m.name).toBe('Tandoori chicken × 1½');
  });
});

describe('recipes', () => {
  it('reads ingredient lines', () => {
    expect(parseIngredient('1½ cup basmati rice, rinsed')).toEqual({ qty: 1.5, unit: 'cup', item: 'basmati rice', note: 'rinsed' });
    expect(parseIngredient('2 lemons')).toEqual({ qty: 2, unit: undefined, item: 'lemons', note: undefined });
    expect(parseIngredient('salt to taste')!.qty).toBeUndefined();
    expect(fmtQty(0.75)).toBe('¾'); expect(fmtQty(2.5)).toBe('2½'); expect(fmtQty(250)).toBe('250');
  });
  it('scales to servings, merges the same item across recipes, leaves the pantry un-ticked', () => {
    const a = recipe(), b = recipe({ id: 'b', name: 'Yogurt bowl', servings: 1, ingredients: [{ qty: 0.5, unit: 'cup', item: 'Greek yogurt' }] });
    const lines = shopLines([{ recipe: a, servings: 2 }, { recipe: b, servings: 1 }]);
    expect(lines.find(l => l.text === 'chicken thighs')!.qty).toBe('1 lb');
    const y = lines.find(l => l.text === 'Greek yogurt')!;
    expect(y.qty).toBe('1 cup'); expect(y.recipe).toBe('Tandoori chicken, Yogurt bowl');
    expect(lines.find(l => l.text === 'salt')!.pantry).toBe(true);
    expect(addQty('1½ cup', '2 cup')).toBe('3½ cup');
    expect(addQty('1 lb', '200 g')).toBe('1 lb + 200 g');
  });
});
