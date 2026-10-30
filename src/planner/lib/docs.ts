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

/** Today's key, in the phone's own time zone (YYYY-MM-DD). */
export function dayKey(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
