// src/planner/lib/ai.ts — calls to the planner-ai edge function (supabase/functions/planner-ai).
import { supabase } from '../../lib/supabase';
import { getPass, forgetPass, SignedOut } from './auth';
import { memoryContext } from './memory';
import { lifeContext } from './lifeContext';
import { isDemo } from './app';
import { demoInvoke } from '../demo/store';
import { planExercisesFrom } from '../features/workout/format';

// `sway` is set by the food feature's sway guide (features/food/sway), not by the food estimate itself.
export interface FoodItem { name: string; portion: string; grams?: number; kcal: number; protein: number; carbs: number; fat: number; confidence?: 'high' | 'medium' | 'low'; sway?: 'go' | 'ease' | 'neutral' }
export interface FoodEstimate { items: FoodItem[]; tips?: string }
export interface ChatMessage { role: 'user' | 'assistant'; content: string }

export async function invoke<T>(body: Record<string, unknown>, fn = 'planner-ai'): Promise<T> {
  const p = getPass();
  if (!p) throw new SignedOut();
  if (isDemo()) return (await demoInvoke(body)) as T;
  const { data, error } = await supabase.functions.invoke(fn, { body: { ...body, token: p.token } });
  if (error) {
    // supabase-js hides the body on non-2xx; try to read it for the real message
    const ctx = (error as { context?: Response }).context;
    let msg = error.message;
    try { const j = ctx ? await ctx.json() : null; if (j?.error) msg = j.error; } catch { /* keep */ }
    if (msg === 'signed_out') { forgetPass(); throw new SignedOut(); }
    throw new Error(msg);
  }
  if (data?.error) { if (data.error === 'signed_out') { forgetPass(); throw new SignedOut(); } throw new Error(data.error); }
  return data as T;
}

const clean = (r: FoodEstimate): FoodEstimate => ({
  items: (r.items || []).map(i => ({ name: String(i.name || 'Food'), portion: String(i.portion || ''), grams: num(i.grams), kcal: num(i.kcal) ?? 0, protein: num(i.protein) ?? 0, carbs: num(i.carbs) ?? 0, fat: num(i.fat) ?? 0, confidence: i.confidence })),
  tips: r.tips || '',
});
const num = (v: unknown) => (typeof v === 'number' && isFinite(v) ? Math.round(v) : undefined);

export async function estimateFoodPhoto(base64: string, mediaType: string, note?: string): Promise<FoodEstimate> {
  return clean(await invoke<FoodEstimate>({ action: 'food_photo', image: { media_type: mediaType, data: base64 }, note }));
}
/** Up to 4 photos of one meal (other angles, a close-up, the label or menu) plus a short note, in one estimate. */
export async function estimateFoodPhotos(photos: { base64: string; mediaType: string }[], note?: string): Promise<FoodEstimate> {
  return clean(await invoke<FoodEstimate>({ action: 'food_photo', images: photos.slice(0, 4).map(p => ({ media_type: p.mediaType, data: p.base64 })), note }));
}
export async function estimateFoodText(text: string): Promise<FoodEstimate> {
  return clean(await invoke<FoodEstimate>({ action: 'food_text', text }));
}
/** Arvy's memory notes ride along with every call (lib/memory.ts); `full` adds the whole planner (lib/lifeContext.ts). */
async function withMemory(context: unknown, full = false): Promise<unknown> {
  const base = context && typeof context === 'object' ? context as Record<string, unknown> : { context };
  if (full) { try { return { ...(await lifeContext(String(base.units || 'lb'))), ...base }; } catch { /* fall through */ } }
  const about_me = await memoryContext();
  return about_me.length ? { ...base, about_me_notes_oldest_first: about_me } : base;
}
/** Chat / one-off coaching. `full` = send the whole planner (the chat and the session review do; set-by-set tips stay light). */
export async function coach(messages: ChatMessage[], context: unknown, full = false): Promise<string> {
  return (await invoke<{ reply: string }>({ action: 'coach', messages, context: await withMemory(context, full) })).reply;
}
export async function reflect(context: unknown): Promise<string> {
  return (await invoke<{ reply: string }>({ action: 'reflect', context: await withMemory(context, true) })).reply;
}
/** The sway guide: which list each food name belongs to (for names the keyword match couldn't place). */
export async function swayTags(items: string[]): Promise<Record<string, 'go' | 'ease' | 'neutral'>> {
  return (await invoke<{ tags: Record<string, 'go' | 'ease' | 'neutral'> }>({ action: 'sway', items })).tags || {};
}
export async function categorize(merchants: string[], categories: string[]): Promise<Record<string, string>> {
  return (await invoke<{ categories: Record<string, string> }>({ action: 'categorize', merchants, categories })).categories || {};
}

export interface ReceiptRead {
  kind: 'receipt' | 'transaction' | 'other';
  merchant: string; date: string; time: string;
  total: number; subtotal: number; tax: number; tip: number;
  payment: 'card' | 'cash' | 'unknown'; cardLast4: string;
  items: { name: string; amount: number; category: string }[];
  category: string; confidence: 'high' | 'medium' | 'low'; confidenceNote: string;
}
const money2 = (v: unknown) => (typeof v === 'number' && isFinite(v) ? Math.round(Math.abs(v) * 100) / 100 : 0);
/** Up to 4 photos of one receipt (or one payment screenshot) → merchant, date, total, how it was paid and the lines, by category. */
export async function readReceipt(photos: { base64: string; mediaType: string }[], categories: string[], today: string, note?: string): Promise<ReceiptRead> {
  const r = await invoke<Record<string, unknown>>({ action: 'receipt', images: photos.slice(0, 4).map(p => ({ media_type: p.mediaType, data: p.base64 })), categories, today, note });
  const pick = (c: unknown) => (typeof c === 'string' && categories.includes(c) ? c : 'Other');
  const items = (Array.isArray(r.items) ? r.items : []).map(i => i as Record<string, unknown>)
    .map(i => ({ name: String(i.name || '').trim() || 'Item', amount: money2(i.amount), category: pick(i.category) })).filter(i => i.amount > 0);
  return {
    kind: r.kind === 'transaction' || r.kind === 'other' ? r.kind : 'receipt',
    merchant: String(r.merchant || '').trim(),
    date: typeof r.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(r.date) ? r.date : '',
    time: typeof r.time === 'string' && /^\d{1,2}:\d{2}$/.test(r.time) ? r.time.padStart(5, '0') : '',
    total: money2(r.total), subtotal: money2(r.subtotal), tax: money2(r.tax), tip: money2(r.tip),
    payment: r.payment === 'card' || r.payment === 'cash' ? r.payment : 'unknown',
    cardLast4: String(r.card_last4 || '').replace(/\D/g, '').slice(-4),
    items, category: pick(r.category),
    confidence: r.confidence === 'high' || r.confidence === 'low' ? r.confidence : 'medium',
    confidenceNote: String(r.confidence_note || '').trim(),
  };
}

/** The copy of a receipt photo that's kept: black and white, ≤ 1000 px, light JPEG (a receipt stays readable at ~60 KB). */
export async function keeperImage(file: File): Promise<string> {
  const bmp = await createImageBitmap(file);
  const scale = Math.min(1, 1000 / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas');
  c.width = Math.round(bmp.width * scale); c.height = Math.round(bmp.height * scale);
  const g = c.getContext('2d')!;
  g.filter = 'grayscale(1) contrast(1.15)';
  g.drawImage(bmp, 0, 0, c.width, c.height);
  return c.toDataURL('image/jpeg', 0.55);
}

/** Shrink a photo for upload (≤ `max` px on the long side) and return base64 JPEG. */
export async function shrinkImage(file: File, max = 1280, quality = 0.82): Promise<{ base64: string; mediaType: string; dataUrl: string }> {
  const bmp = await createImageBitmap(file);
  const scale = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas');
  c.width = Math.round(bmp.width * scale); c.height = Math.round(bmp.height * scale);
  c.getContext('2d')!.drawImage(bmp, 0, 0, c.width, c.height);
  const dataUrl = c.toDataURL('image/jpeg', quality);
  return { base64: dataUrl.split(',')[1], mediaType: 'image/jpeg', dataUrl };
}

export interface StatementRow { date: string; desc: string; amount: number; balance?: number }
export interface StatementResult { rows: StatementRow[]; period?: { from: string; to: string }; account_type?: string; opening_balance?: number }
/** The text of a bank-statement PDF (already masked) → transactions. */
export async function parseStatement(text: string, hint?: string): Promise<StatementResult> {
  const r = await invoke<StatementResult>({ action: 'statement', text, hint });
  return { rows: Array.isArray(r.rows) ? r.rows : [], period: r.period, account_type: r.account_type, opening_balance: typeof r.opening_balance === 'number' ? r.opening_balance : undefined };
}

/** One exercise of a planned session. The last line is its format (features/workout/format.ts): per side, no weight,
 *  a superset / circuit / EMOM / AMRAP block, a pyramid or countdown, and what a brand-new exercise is. */
export interface PlanExercise { name: string; exerciseId?: string; mode: 'reps' | 'time'; sets: number; reps?: string; seconds?: number; restSec: number; note?: string; weight?: number;
  perSide?: boolean; noWeight?: boolean; group?: string; groupKind?: 'superset' | 'circuit' | 'emom' | 'amrap'; groupMinutes?: number; repsBySet?: number[]; weightBySet?: number[]; style?: 'pyramid' | 'countdown' | 'ladder' | 'drop' | 'intervals'; muscle?: string; equipment?: string }
export interface PlanResult { name: string; exercises: PlanExercise[]; warmup_note?: string }
/** A coach's written plan → structured exercises (ids from the library when they match). */
export async function planFromText(text: string, library: { id: string; name: string }[], units: string): Promise<PlanResult> {
  const r = await invoke<PlanResult>({ action: 'plan', text, library: library.slice(0, 200), units });
  return { name: String(r.name || 'Coach plan'), exercises: Array.isArray(r.exercises) ? r.exercises : [], warmup_note: r.warmup_note };
}

export interface HabitPlan { name: string; identity: string; why: string; twoMinute: string; anchor: { block: string; when: 'before' | 'after' }; stack: string; cue: { time: string; place: string }; days?: number[]; auto?: string; coach_note?: string }
/** Design a habit (implementation intention + where it stacks in the routine) from a sentence. */
export async function planHabit(text: string, blocks: { id: string; label: string; at: string; until?: string }[], existing: string[]): Promise<HabitPlan> {
  return invoke<HabitPlan>({ action: 'habit', text, blocks, existing });
}

export interface DayPlanQuestion { id: string; text: string; choices: string[] }
export interface DayPlan { review: string; questions: DayPlanQuestion[]; tomorrow: PlanResult & { focus: string; minutes: number; why: string }; answers?: Record<string, string>; madeAt?: string }
/** After a session: Arvy's review, two questions, and tomorrow's session (with the whole planner as context). */
export async function dayPlan(library: { id: string; name: string }[], units: string, answers?: Record<string, string>): Promise<DayPlan> {
  const context = await lifeContext(units);
  // Arvy writes the session in its own exercise shape (supersets, pyramids, intervals…); here it becomes the planner's
  type Raw = { review?: string; questions?: DayPlanQuestion[]; tomorrow?: { name?: string; focus?: string; minutes?: number; why?: string; exercises?: unknown } | null };
  const r = await invoke<Raw>({ action: 'dayplan', context, library: library.slice(0, 220).map(l => l.name), units, answers }, 'planner-arvy');
  const t = r.tomorrow && typeof r.tomorrow === 'object' ? r.tomorrow : null;
  // the demo's canned plan is already in the planner's shape
  const exercises = Array.isArray(t?.exercises) && t.exercises.some(e => e && typeof e === 'object' && 'mode' in e) ? t.exercises as PlanExercise[] : planExercisesFrom(t?.exercises);
  return { review: String(r.review || ''), questions: Array.isArray(r.questions) ? r.questions.filter(q => q && q.id && Array.isArray(q.choices)) : [],
    tomorrow: { name: String(t?.name || ''), focus: String(t?.focus || ''), minutes: Number(t?.minutes) || 0, why: String(t?.why || ''), exercises }, answers, madeAt: new Date().toISOString() };
}

export interface BriefHints { words: string[]; priorities: string[]; aGame: string; stress: string; stressResponse: string; excited: string; noticed?: string; madeAt?: string }
/** Arvy's suggestions for each Brief question, from the whole planner. */
export async function briefHints(units: string): Promise<BriefHints> {
  const context = await lifeContext(units, { daysBack: 10, fullSessions: 2 });
  const r = await invoke<BriefHints>({ action: 'briefhints', context });
  const list = (v: unknown, n: number) => (Array.isArray(v) ? v.filter(x => typeof x === 'string' && x.trim()).slice(0, n) : []);
  return { words: list(r.words, 3), priorities: list(r.priorities, 3), aGame: r.aGame || '', stress: r.stress || '', stressResponse: r.stressResponse || '', excited: r.excited || '', noticed: r.noticed || '', madeAt: new Date().toISOString() };
}

export interface TodoSuggestion { text: string; time?: string; note?: string; priority?: number }
/** The Bed Brief's answers → today's to-do list (Arvy, with the planner for context). */
export async function todosFromBrief(brief: Record<string, string>, priorities: string[], frequent: string[] = [], units = 'lb'): Promise<TodoSuggestion[]> {
  const context = await lifeContext(units, { daysBack: 3, fullSessions: 1, workoutsDays: 7 });
  const r = await invoke<{ items: TodoSuggestion[] }>({ action: 'todos', brief, priorities, frequent, context });
  return (r.items || []).filter(i => i && typeof i.text === 'string' && i.text.trim()).slice(0, 14).map(i => ({ text: i.text.trim(), time: /^\d{2}:\d{2}$/.test(i.time || '') ? i.time : undefined, note: i.note?.trim() || undefined, priority: typeof i.priority === 'number' && i.priority >= 0 && i.priority <= 2 ? i.priority : undefined }));
}

export interface ExVideo { id: string; title: string; seconds?: number }
export interface ExPart { name: string; dose: string; cue: string; videos: ExVideo[] }
export interface ExerciseInfo { videos: ExVideo[]; description: string; setup: string[]; tip: string; mistakes: string[]; parts: ExPart[]; fetchedAt?: string }
/** How to do an exercise or stretch: the top YouTube videos plus Arvy's how-to and mind-muscle cue. A flow
 *  ("Mobility flow", "Stretching") comes back broken into its moves, each with its own videos. */
export async function exerciseInfo(name: string, kind: 'exercise' | 'stretch' | 'cardio' = 'exercise', note?: string): Promise<ExerciseInfo> {
  const r = await invoke<ExerciseInfo>({ action: 'exinfo', name, kind, note });
  const list = (v: unknown) => (Array.isArray(v) ? v.filter(x => typeof x === 'string' && x.trim()) : []);
  const vids = (v: unknown): ExVideo[] => (Array.isArray(v) ? v.filter(x => x && typeof x.id === 'string' && /^[\w-]{6,}$/.test(x.id)) : []);
  return { videos: vids(r.videos), description: r.description || '', setup: list(r.setup), tip: r.tip || '', mistakes: list(r.mistakes), parts: (Array.isArray(r.parts) ? r.parts : []).filter(p => p && p.name).map(p => ({ name: p.name, dose: p.dose || '', cue: p.cue || '', videos: vids(p.videos) })), fetchedAt: new Date().toISOString() };
}

export interface Deal {
  merchant: string; name: string; price: number | null; saleStory?: string; validTo?: string; validFrom?: string; image?: string; kind?: 'flyer' | 'regular'; wasPrice?: number;
  /** from Arvy: the kind ("Boneless skinless"), the size as said ("12 pack", "~1.5 kg"), the size as a number
   *  (g, ml or each) and what the price is for (the package, or by weight for meat and produce) */
  variant?: string; size?: string; amount?: number; unit?: 'g' | 'ml' | 'each'; per?: 'each' | 'lb' | 'kg' | '100g';
}
export interface DealsResult { items: { id: string; section: string; deals: Deal[]; suggestedStore?: string; reason?: string }[]; stores_seen?: string[] }
/** This week's flyer deals near the household for the shopping list (Flipp data, matched by Arvy), each item's
 *  store section, and — for the stores with no flyers — which one is likely best for it. */
export async function shoppingDeals(items: { id: string; text: string }[], postal: string, stores: string[], specialty: { name: string; note?: string }[] = []): Promise<DealsResult> {
  const r = await invoke<DealsResult>({ action: 'deals', items, postal, stores, specialty });
  return { items: Array.isArray(r.items) ? r.items : [], stores_seen: r.stores_seen };
}

// ───────── recipes (supabase/functions/planner-recipes) ─────────
export interface RecipeDraftIngredient { qty?: number; unit?: string; item: string; note?: string; section?: string; pantry?: boolean }
export interface RecipeDraft { name: string; servings: number; minutes?: number; ingredients: RecipeDraftIngredient[]; steps: string[]; perServing: { kcal: number; protein: number; carbs: number; fat: number }; source?: string }
/** A recipe from a link (read server-side), pasted text, or a photo of a cookbook page — with the numbers per serving. */
export async function importRecipe(from: { url?: string; text?: string; image?: { media_type: string; data: string } }): Promise<RecipeDraft> {
  return invoke<RecipeDraft>({ action: 'recipe', ...from }, 'planner-recipes');
}
/** A high-protein recipe idea from Arvy, about `protein` g a serving. */
export async function recipeIdea(protein: number, note?: string, avoid: string[] = []): Promise<RecipeDraft> {
  return invoke<RecipeDraft>({ action: 'recipe_idea', protein, note, avoid }, 'planner-recipes');
}
