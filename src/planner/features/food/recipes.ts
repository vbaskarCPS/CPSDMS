// src/planner/features/food/recipes.ts — recipes (doc kind 'recipe', one per recipe): ingredients with amounts, steps,
// and the numbers per serving (protein first). Import from a link, text or a photo (planner-ai 'recipe'), ask Arvy
// for a high-protein idea ('recipe_idea'), or build one from a logged meal. Pure helpers for scaling and the shopping list.
import { getDocs, putDoc } from '../../lib/docs';
import type { RecipeDraft } from '../../lib/ai';
import { uid } from '../../ui/primitives';
import type { ProteinSlot } from '../plan/types';
import type { Meal, Totals } from './model';

export interface Ingredient { qty?: number; unit?: string; item: string; note?: string; section?: string; pantry?: boolean }
export interface Recipe {
  id: string; name: string; servings: number; minutes?: number;
  ingredients: Ingredient[]; steps: string[];
  perServing: Totals;          // kcal, protein, carbs, fat — one serving
  source?: string;             // the link it came from
  thumb?: string;
  createdAt: string; updatedAt?: string;
}

export async function loadRecipes(): Promise<Recipe[]> {
  const d = await getDocs<Recipe>('recipe');
  return d.map(x => x.data).filter(r => r && r.id && r.name).sort((a, b) => (b.perServing?.protein || 0) - (a.perServing?.protein || 0) || a.name.localeCompare(b.name));
}
export const saveRecipe = (r: Recipe) => putDoc('recipe', r.id, { ...r, updatedAt: new Date().toISOString() });
/** Soft-remove: a JSON null, never a DELETE. */
export const removeRecipe = (r: Recipe) => putDoc('recipe', r.id, null);

const n0 = (v: unknown) => (typeof v === 'number' && isFinite(v) && v >= 0 ? v : 0);
export function fromDraft(d: RecipeDraft, extra: Partial<Recipe> = {}): Recipe {
  return {
    id: uid(), name: (d.name || 'Recipe').trim(), servings: Math.max(1, Math.round(n0(d.servings)) || 1), minutes: d.minutes || undefined,
    ingredients: (d.ingredients || []).filter(i => i && i.item).map(i => ({ qty: typeof i.qty === 'number' && i.qty > 0 ? i.qty : undefined, unit: i.unit?.trim() || undefined, item: i.item.trim(), note: i.note?.trim() || undefined, section: i.section || undefined, pantry: !!i.pantry })),
    steps: (d.steps || []).map(s => String(s).trim()).filter(Boolean),
    perServing: { kcal: Math.round(n0(d.perServing?.kcal)), protein: Math.round(n0(d.perServing?.protein)), carbs: Math.round(n0(d.perServing?.carbs)), fat: Math.round(n0(d.perServing?.fat)) },
    source: d.source || undefined, createdAt: new Date().toISOString(), ...extra,
  };
}

/** A logged meal as a one-serving recipe (its items become the ingredients). */
export function recipeFromMeal(m: Meal): Recipe {
  return {
    id: uid(), name: m.name || 'Meal', servings: 1,
    ingredients: m.items.map(i => ({ item: i.name, unit: i.portion || undefined })),
    steps: [], perServing: { ...m.totals }, thumb: m.thumb, createdAt: new Date().toISOString(),
  };
}

// ───────── amounts ─────────
const FRACTIONS: [number, string][] = [[0.125, '⅛'], [0.25, '¼'], [1 / 3, '⅓'], [0.5, '½'], [2 / 3, '⅔'], [0.75, '¾']];
/** 1.5 → "1½", 0.333 → "⅓", 2.4 → "2.4", 250 → "250". */
export function fmtQty(q: number): string {
  if (q >= 20) return String(Math.round(q));
  const whole = Math.floor(q), frac = q - whole;
  if (frac < 0.04) return String(whole);
  if (frac > 0.96) return String(whole + 1);
  const f = FRACTIONS.find(([v]) => Math.abs(frac - v) < 0.04);
  if (f) return `${whole || ''}${f[1]}`;
  return String(Math.round(q * 10) / 10);
}
const UNICODE: Record<string, number> = { '½': 0.5, '¼': 0.25, '¾': 0.75, '⅓': 1 / 3, '⅔': 2 / 3, '⅛': 0.125 };
/** "1 1/2", "1½", "0.5", "2-3" (→ 2.5) → a number. */
export function parseQty(s: string): number | undefined {
  const t = s.trim(); if (!t) return undefined;
  const range = t.match(/^(\d+(?:\.\d+)?)\s*[-–]\s*(\d+(?:\.\d+)?)$/); if (range) return (Number(range[1]) + Number(range[2])) / 2;
  let total = 0, any = false;
  for (const part of t.split(/\s+/)) {
    const m = part.match(/^(\d+)?([½¼¾⅓⅔⅛])$/);
    if (m) { total += (m[1] ? Number(m[1]) : 0) + UNICODE[m[2]]; any = true; continue; }
    const f = part.match(/^(\d+)\/(\d+)$/);
    if (f) { total += Number(f[1]) / Number(f[2]); any = true; continue; }
    if (/^\d+(\.\d+)?$/.test(part)) { total += Number(part); any = true; continue; }
    return undefined;
  }
  return any ? total : undefined;
}
const UNITS = ['cups', 'cup', 'tbsp', 'tsp', 'tablespoons', 'tablespoon', 'teaspoons', 'teaspoon', 'kg', 'g', 'grams', 'lb', 'lbs', 'oz', 'ml', 'l', 'litre', 'liter', 'cloves', 'clove', 'cans', 'can', 'pinch', 'bunch', 'pack', 'packs', 'slices', 'slice', 'scoops', 'scoop', 'large', 'medium', 'small', 'pieces', 'piece'];
/** "1½ cup basmati rice, rinsed" → { qty 1.5, unit 'cup', item 'basmati rice', note 'rinsed' }. */
export function parseIngredient(line: string): Ingredient | null {
  const raw = line.replace(/^[-•*]\s*/, '').trim(); if (!raw) return null;
  const m = raw.match(/^((?:\d+\s+)?\d*[½¼¾⅓⅔⅛]|\d+\s+\d+\/\d+|\d+\/\d+|\d+(?:\.\d+)?(?:\s*[-–]\s*\d+(?:\.\d+)?)?)\s*(.*)$/);
  let qty: number | undefined, rest = raw;
  if (m) { qty = parseQty(m[1]); rest = m[2]; }
  let unit: string | undefined;
  const u = rest.match(/^([a-zA-Z]+)\.?\s+(.*)$/);
  if (qty !== undefined && u && UNITS.includes(u[1].toLowerCase())) { unit = u[1].toLowerCase(); rest = u[2]; }
  const [item, ...note] = rest.split(',');
  if (!item.trim()) return null;
  return { qty, unit, item: item.trim(), note: note.join(',').trim() || undefined };
}
export const ingredientLine = (i: Ingredient, f = 1): string =>
  [i.qty !== undefined ? fmtQty(i.qty * f) : '', i.unit || '', i.item].filter(Boolean).join(' ') + (i.note ? `, ${i.note}` : '');
/** For editing: one ingredient per line, at the recipe's own servings. */
export const ingredientsText = (r: Recipe) => r.ingredients.map(i => ingredientLine(i)).join('\n');

/** Fill a protein-road slot with a recipe at some servings. */
export function recipeSlot(r: Recipe, servings: number): Pick<ProteinSlot, 'what' | 'protein' | 'kcal' | 'items' | 'recipeId' | 'servings'> {
  const p = r.perServing, k = servings;
  return {
    what: k === 1 ? r.name : `${r.name} × ${fmtQty(k)}`, protein: Math.round(p.protein * k), kcal: Math.round(p.kcal * k), recipeId: r.id, servings: k,
    items: [{ name: r.name, portion: `${fmtQty(k)} serving${k === 1 ? '' : 's'}`, kcal: Math.round(p.kcal * k), protein: Math.round(p.protein * k), carbs: Math.round(p.carbs * k), fat: Math.round(p.fat * k) }],
  };
}

// ───────── recipe → shopping list ─────────
export interface ShopLine { key: string; text: string; qty?: string; section?: string; recipe: string; pantry: boolean }
/** The shopping lines for some recipes at some servings: one line per ingredient, scaled; the same item in two recipes
 *  becomes one line (amounts added when the units match). Pantry basics (salt, oil, spices) come back un-ticked. */
export function shopLines(sources: { recipe: Recipe; servings: number }[]): ShopLine[] {
  const out = new Map<string, ShopLine & { n?: number; u?: string; mixed?: string[] }>();
  for (const { recipe, servings } of sources) {
    const f = servings / (recipe.servings || 1);
    for (const i of recipe.ingredients) {
      const key = i.item.trim().toLowerCase().replace(/s$/, '');
      const q = i.qty !== undefined ? i.qty * f : undefined;
      const was = out.get(key);
      if (!was) { out.set(key, { key, text: i.item.trim(), n: q, u: i.unit, qty: q !== undefined ? [fmtQty(q), i.unit].filter(Boolean).join(' ') : i.unit, section: i.section, recipe: recipe.name, pantry: !!i.pantry }); continue; }
      if (!was.recipe.split(', ').includes(recipe.name)) was.recipe = `${was.recipe}, ${recipe.name}`;
      was.pantry = was.pantry && !!i.pantry;
      if (q !== undefined && was.n !== undefined && (was.u || '') === (i.unit || '')) { was.n += q; was.qty = [fmtQty(was.n), was.u].filter(Boolean).join(' '); }
      else if (q !== undefined || i.unit) { was.n = undefined; was.qty = [was.qty, [q !== undefined ? fmtQty(q) : '', i.unit].filter(Boolean).join(' ')].filter(Boolean).join(' + '); }
    }
  }
  return [...out.values()].map(({ n: _n, u: _u, mixed: _m, ...l }) => l);
}

/** "1½ cup" + "2 cup" → "3½ cup"; different units → "1½ cup + 200 g". */
export function addQty(a: string | undefined, b: string | undefined): string | undefined {
  if (!a) return b; if (!b) return a;
  const pa = a.match(/^(\S+)\s*(.*)$/), pb = b.match(/^(\S+)\s*(.*)$/);
  const na = pa ? parseQty(pa[1]) : undefined, nb = pb ? parseQty(pb[1]) : undefined;
  if (na !== undefined && nb !== undefined && (pa![2] || '') === (pb![2] || '')) return [fmtQty(na + nb), pa![2]].filter(Boolean).join(' ');
  return `${a} + ${b}`;
}
