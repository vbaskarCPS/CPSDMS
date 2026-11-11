// src/planner/lib/memory.ts — Arvy's memory: dated notes about you that every AI call sees (every Arvy answer,
// set-by-set coaching, the session review, the day's reflection). Kept in doc kind 'memo', key 'coach' (the name
// from when the coach was a separate chat). You add notes in Settings → "Tell Arvy" or by asking Arvy to remember
// something; the app adds milestones itself.
import { dayKey, getDoc, putDoc } from './docs';

export interface MemoryNote { date: string; text: string; by?: 'you' | 'app' }
interface MemoryDoc { notes: MemoryNote[] }

let cache: MemoryNote[] | null = null;

export async function loadMemory(): Promise<MemoryNote[]> {
  if (cache) return cache;
  const d = await getDoc<MemoryDoc>('memo', 'coach').catch(() => null);
  cache = Array.isArray(d?.notes) ? d!.notes.filter(n => n && n.text) : [];
  return cache;
}
export async function saveMemory(notes: MemoryNote[]): Promise<void> {
  cache = notes;
  await putDoc('memo', 'coach', { notes });
}
export async function addMemory(text: string, by: MemoryNote['by'] = 'you', date = dayKey()): Promise<MemoryNote[]> {
  const notes = [...(await loadMemory()), { date, text: text.trim(), by }];
  await saveMemory(notes);
  return notes;
}
/** What the AI gets: the last `n` notes, oldest first. */
export async function memoryContext(n = 40): Promise<{ date: string; note: string }[]> {
  try { return (await loadMemory()).slice(-n).map(x => ({ date: x.date, note: x.text })); } catch { return []; }
}
