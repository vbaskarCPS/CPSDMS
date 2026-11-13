// src/v2/lib/bennyDraft.ts — the live crew draft: managers pick their crews in turns on their own phones, coin toss
// first, then snake order. The database keeps the draft and says whose turn it is (benny_draft_*); everyone in it
// sees it update every few seconds, and the team whose turn it is gets a notification.
import { db, must } from './client';

export interface DraftWorker { hire_id: string; cn: string; name: string; days: number; avg: number | null }
export interface DraftTeam { key: string; managers: { id: string; name: string }[]; picks: string[] }
export interface Draft {
  id: string; center_id: string; day: string; state: 'open' | 'done' | 'cancelled'; rules: string | null; first_team: string;
  owner: string; is_owner: boolean; mine: string | null; turn: string | null; can_pick: boolean;
  teams: DraftTeam[]; pool: DraftWorker[]; picks: { team: string; hire_id: string; at: string }[]; updated_at: string;
}

export const draftStart = async (center: string, day: string, teams: string[][], rules?: string) =>
  must(await db.rpc('benny_draft_start', { p_center: center, p_day: day, p_teams: teams, p_rules: rules || null })) as Draft;
export const draftView = async (id: string) => must(await db.rpc('benny_draft_view', { p_id: id })) as Draft;
export const draftPick = async (id: string, hire: string) => must(await db.rpc('benny_draft_pick', { p_id: id, p_hire: hire })) as Draft;
export const draftUndo = async (id: string) => must(await db.rpc('benny_draft_undo', { p_id: id })) as Draft;
export const draftCancel = async (id: string) => must(await db.rpc('benny_draft_cancel', { p_id: id })) as Draft;

/** Whose turn after k picks: from the coin toss's winner, snaking back and forth (A B B A A B…). Same as the database. */
export function turnOf(keys: string[], first: string, k: number): string | null {
  const n = keys.length; if (!n) return null;
  const f = Math.max(0, keys.indexOf(first));
  const ord = [...keys.slice(f), ...keys.slice(0, f)];
  const r = Math.floor(k / n); const pos = k % n;
  return ord[r % 2 === 0 ? pos : n - 1 - pos];
}

export const teamName = (t: DraftTeam) => t.managers.map(m => m.name).join(' + ');
export const teamFirst = (t: DraftTeam) => t.managers.map(m => m.name.split(' ')[0]).join(' + ');
/** Each team's crew as names, in the order they were picked. */
export function draftCrews(d: Draft): string[][] {
  const byId = new Map(d.pool.map(w => [w.hire_id, w.name]));
  return d.teams.map(t => t.picks.map(id => byId.get(id) || '?'));
}
/** The workers not picked yet, best average first (the database keeps that order). */
export const leftToPick = (d: Draft) => { const taken = new Set(d.picks.map(p => p.hire_id)); return d.pool.filter(w => !taken.has(w.hire_id)); };
