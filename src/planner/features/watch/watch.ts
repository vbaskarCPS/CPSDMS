// src/planner/features/watch/watch.ts — the watch's side of the phone: pairing a watch and signing one out.
// The watch app (watch/ in the repo, Wear OS) shows a 4-digit code; Settings › Watch sends it here with this planner's
// pass (planner_watch_claim), and the watch then collects a pass of its own (supabase/migrations/20261251900000_planner_watch.sql).
// From then on the watch reads and writes the same docs as the phone. No React here.
import { call } from '../../lib/auth';

export interface WatchSession { id: string; since: string; last_seen: string }
export type ClaimResult = 'ok' | 'wrong' | 'wait';

/** A code as the person types it: digits only, at most 4. */
export function cleanCode(raw: string): string {
  return raw.replace(/\D/g, '').slice(0, 4);
}

/** Pair the watch that is showing this code with this planner. */
export async function claimWatch(code: string): Promise<ClaimResult> {
  const d = await call<{ ok: boolean; reason?: string }>('planner_watch_claim', { p_code: cleanCode(code) });
  if (d.ok) return 'ok';
  return d.reason === 'wait' ? 'wait' : 'wrong';
}

/** The watches signed in to this planner. */
export async function watches(): Promise<WatchSession[]> {
  const d = await call<{ ok: boolean; watches?: WatchSession[] }>('planner_watch_list');
  return d.ok && d.watches ? d.watches : [];
}

/** Sign one watch out (or every watch, with no id). */
export async function forgetWatch(id?: string): Promise<void> {
  await call<{ ok: boolean }>('planner_watch_forget', { p_id: id ?? null });
}

/** "today", "yesterday" or "12 Nov", for when a watch was last heard from. */
export function seenWhen(iso: string, now = new Date()): string {
  const d = new Date(iso);
  const day = (x: Date) => `${x.getFullYear()}-${x.getMonth()}-${x.getDate()}`;
  if (day(d) === day(now)) return 'today';
  const y = new Date(now); y.setDate(now.getDate() - 1);
  if (day(d) === day(y)) return 'yesterday';
  return d.toLocaleDateString('en-CA', { day: 'numeric', month: 'short' });
}
