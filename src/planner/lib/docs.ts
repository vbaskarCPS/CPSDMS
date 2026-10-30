// src/planner/lib/docs.ts — the planner's documents: JSON under (kind, key). A day page is
// ('day', '2026-10-30'); a habit is ('habit', <id>). See planner_get / planner_put in the migration.
import { call } from './auth';

export interface Doc<T = unknown> { key: string; data: T; updated_at: string }

export async function getDocs<T = unknown>(kind: string, from?: string, to?: string): Promise<Doc<T>[]> {
  const d = await call<{ ok: boolean; docs?: Doc<T>[] }>('planner_get', { p_kind: kind, p_from: from ?? null, p_to: to ?? null });
  return d.ok && d.docs ? d.docs : [];
}

export async function getDoc<T = unknown>(kind: string, key: string): Promise<T | null> {
  const docs = await getDocs<T>(kind, key, key);
  return docs[0]?.data ?? null;
}

/** Write one doc; `null` deletes it. */
export async function putDoc(kind: string, key: string, data: unknown | null): Promise<void> {
  const d = await call<{ ok: boolean; reason?: string }>('planner_put', { p_kind: kind, p_key: key, p_data: data });
  if (!d.ok) throw new Error(d.reason || 'Could not save');
}

export async function putDocs(docs: { kind: string; key: string; data: unknown | null }[]): Promise<void> {
  if (!docs.length) return;
  const d = await call<{ ok: boolean }>('planner_put_many', { p_docs: docs });
  if (!d.ok) throw new Error('Could not save');
}

/** Today's key (YYYY-MM-DD) in the phone's time zone. The planner's day starts at 4 am: a 1 am
 *  lights-out, a late shake or a midnight set still belong to the day that's ending. */
export const DAY_START_HOUR = 4;
export function dayKey(d = new Date()): string {
  const s = new Date(d.getTime() - DAY_START_HOUR * 3600_000);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${s.getFullYear()}-${p(s.getMonth() + 1)}-${p(s.getDate())}`;
}
/** The calendar date, with no 4 am shift (for things like bank transactions). */
export function calendarKey(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
