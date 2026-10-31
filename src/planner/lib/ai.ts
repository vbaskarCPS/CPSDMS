// src/planner/lib/ai.ts — calls to the planner-ai edge function (supabase/functions/planner-ai).
import { supabase } from '../../lib/supabase';
import { getPass, forgetPass, SignedOut } from './auth';
import { memoryContext } from './memory';
import { lifeContext } from './lifeContext';

// `sway` is set by the food feature's sway guide (features/food/sway), not by the food estimate itself.
export interface FoodItem { name: string; portion: string; grams?: number; kcal: number; protein: number; carbs: number; fat: number; confidence?: 'high' | 'medium' | 'low'; sway?: 'go' | 'ease' | 'neutral' }
export interface FoodEstimate { items: FoodItem[]; tips?: string }
export interface ChatMessage { role: 'user' | 'assistant'; content: string }

async function invoke<T>(body: Record<string, unknown>): Promise<T> {
  const p = getPass();
  if (!p) throw new SignedOut();
  const { data, error } = await supabase.functions.invoke('planner-ai', { body: { ...body, token: p.token } });
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
export async function estimateFoodText(text: string): Promise<FoodEstimate> {
  return clean(await invoke<FoodEstimate>({ action: 'food_text', text }));
}
/** Coach Claude's memory notes ride along with every call (lib/memory.ts); `full` adds the whole planner (lib/lifeContext.ts). */
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

export interface PlanExercise { name: string; exerciseId?: string; mode: 'reps' | 'time'; sets: number; reps?: string; seconds?: number; restSec: number; note?: string; weight?: number }
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
/** After a session: Coach Claude's review, two questions, and tomorrow's session (with the whole planner as context). */
export async function dayPlan(library: { id: string; name: string }[], units: string, answers?: Record<string, string>): Promise<DayPlan> {
  const context = await lifeContext(units);
  const r = await invoke<DayPlan>({ action: 'dayplan', context, library: library.slice(0, 200), units, answers });
  return { review: String(r.review || ''), questions: Array.isArray(r.questions) ? r.questions.filter(q => q && q.id && Array.isArray(q.choices)) : [], tomorrow: { ...r.tomorrow, exercises: Array.isArray(r.tomorrow?.exercises) ? r.tomorrow.exercises : [] }, answers, madeAt: new Date().toISOString() };
}

export interface BriefHints { words: string[]; priorities: string[]; aGame: string; stress: string; stressResponse: string; excited: string; noticed?: string; madeAt?: string }
/** Coach Claude's suggestions for each Brief question, from the whole planner. */
export async function briefHints(units: string): Promise<BriefHints> {
  const context = await lifeContext(units, { daysBack: 10, fullSessions: 2 });
  const r = await invoke<BriefHints>({ action: 'briefhints', context });
  const list = (v: unknown, n: number) => (Array.isArray(v) ? v.filter(x => typeof x === 'string' && x.trim()).slice(0, n) : []);
  return { words: list(r.words, 3), priorities: list(r.priorities, 3), aGame: r.aGame || '', stress: r.stress || '', stressResponse: r.stressResponse || '', excited: r.excited || '', noticed: r.noticed || '', madeAt: new Date().toISOString() };
}

export interface TodoSuggestion { text: string; time?: string; note?: string; priority?: number }
/** The Bed Brief's answers → today's to-do list (Coach Claude, with the planner for context). */
export async function todosFromBrief(brief: Record<string, string>, priorities: string[], frequent: string[] = [], units = 'lb'): Promise<TodoSuggestion[]> {
  const context = await lifeContext(units, { daysBack: 3, fullSessions: 1, workoutsDays: 7 });
  const r = await invoke<{ items: TodoSuggestion[] }>({ action: 'todos', brief, priorities, frequent, context });
  return (r.items || []).filter(i => i && typeof i.text === 'string' && i.text.trim()).slice(0, 14).map(i => ({ text: i.text.trim(), time: /^\d{2}:\d{2}$/.test(i.time || '') ? i.time : undefined, note: i.note?.trim() || undefined, priority: typeof i.priority === 'number' && i.priority >= 0 && i.priority <= 2 ? i.priority : undefined }));
}
