// src/planner/lib/ai.ts — calls to the planner-ai edge function (supabase/functions/planner-ai).
import { supabase } from '../../lib/supabase';
import { getPass, forgetPass, SignedOut } from './auth';

export interface FoodItem { name: string; portion: string; grams?: number; kcal: number; protein: number; carbs: number; fat: number; confidence?: 'high' | 'medium' | 'low' }
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
export async function coach(messages: ChatMessage[], context: unknown): Promise<string> {
  return (await invoke<{ reply: string }>({ action: 'coach', messages, context })).reply;
}
export async function reflect(context: unknown): Promise<string> {
  return (await invoke<{ reply: string }>({ action: 'reflect', context })).reply;
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
export interface StatementResult { rows: StatementRow[]; period?: { from: string; to: string }; account_type?: string }
/** The text of a bank-statement PDF (already masked) → transactions. */
export async function parseStatement(text: string, hint?: string): Promise<StatementResult> {
  const r = await invoke<StatementResult>({ action: 'statement', text, hint });
  return { rows: Array.isArray(r.rows) ? r.rows : [], period: r.period, account_type: r.account_type };
}
