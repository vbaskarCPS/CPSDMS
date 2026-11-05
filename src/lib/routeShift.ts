// src/lib/routeShift.ts — deleting a route number in the Map Builder and moving the later routes
// of the prefix down one (across every map with that prefix, with everything filed under them).
// The database does the work in one step (app_route_delete_shift, RUN_25); this reads what it says.
import { db } from '../v2/lib/client';

export interface ShiftMap { area: string; start: number; first: string; last: string; first_to: string; last_to: string; count: number }
export interface ShiftData { routes_drawn?: number; clients?: number; houses?: number; knocks?: number; visits?: number; bookings?: number; sales?: number }
export interface ShiftAnswer {
  ok: boolean; preview?: boolean; reason?: 'bad_input' | 'no_prefix' | 'not_on_a_map' | 'in_use' | 'live_today';
  code?: string; area?: string; maps?: ShiftMap[]; data?: ShiftData;
  in_use?: Record<string, number>; live?: string[];
}

export async function previewDeleteShift(prefix: string, number: number): Promise<ShiftAnswer> {
  const { data, error } = await db.rpc('app_route_shift_preview', { p_prefix: prefix, p_number: number });
  if (error) throw new Error(error.message);
  return data as ShiftAnswer;
}

export async function deleteAndShift(prefix: string, number: number): Promise<ShiftAnswer> {
  const { data, error } = await db.rpc('app_route_delete_shift', { p_prefix: prefix, p_number: number });
  if (error) throw new Error(error.message);
  return data as ShiftAnswer;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString('en-CA')} ${n === 1 ? one : many}`;
const range = (a: string, b: string) => (a === b ? a : `${a}–${b}`);

const IN_USE_WORDS: Record<string, [string, string?]> = {
  clients: ['client'], knocks: ['knock'], visits: ['door visit'], bookings: ['booking'], pending_sales: ['pending sale'],
  sales: ['sale'], job_history: ['past job'], hand_added_houses: ['hand-added house'], day_plans: ['day plan'],
};

/** Plain words for the confirmation: what moves, what goes with it, or why it can't be done. */
export function describeShift(a: ShiftAnswer, code: string): { blocked: string | null; moves: string[]; carried: string | null } {
  const moves = (a.maps || []).map(m => `${m.area}: ${range(m.first, m.last)} → ${range(m.first_to, m.last_to)}`);
  const d = a.data || {};
  const parts = [
    d.routes_drawn ? plural(d.routes_drawn, 'drawn route') : '', d.clients ? plural(d.clients, 'client') : '',
    d.houses ? plural(d.houses, 'house') : '', d.knocks ? plural(d.knocks, 'knock') : '', d.visits ? plural(d.visits, 'door visit') : '',
    d.bookings ? plural(d.bookings, 'booking') : '', d.sales ? plural(d.sales, 'sale') : '',
  ].filter(Boolean);
  const carried = parts.length ? `Moving with them: ${parts.join(', ')}.` : null;
  let blocked: string | null = null;
  if (!a.ok) {
    if (a.reason === 'in_use') {
      const what = Object.entries(a.in_use || {}).filter(([, n]) => n > 0)
        .map(([k, n]) => plural(n, IN_USE_WORDS[k]?.[0] || k.replace(/_/g, ' '), IN_USE_WORDS[k]?.[1]));
      blocked = `${code} can't be deleted: it has ${what.join(', ')}. Those can't move anywhere, so move them to another route first.`;
    } else if (a.reason === 'live_today') {
      blocked = `${(a.live || []).join(', ')} ${(a.live || []).length === 1 ? 'is' : 'are'} on today's live day. Delete after the day is closed.`;
    } else if (a.reason === 'not_on_a_map') {
      blocked = `${code} isn't on any map.`;
    } else {
      blocked = `${code} can't be deleted (${a.reason || 'unknown reason'}).`;
    }
  }
  return { blocked, moves, carried };
}

// ───────────── moving a route to another number ─────────────
// The route keeps its streets and everything filed under it; the routes in between move one number
// up (or down), across every map with the prefix (app_route_move). The number has to be within the
// route's own map's numbers, or one past its last.
export interface MoveAnswer {
  ok: boolean; preview?: boolean; reason?: 'bad_input' | 'same_number' | 'not_drawn' | 'outside_map' | 'live_today';
  code?: string; to?: string; area?: string; first?: string; last?: string; live?: string[];
  moves?: ShiftMap[]; data?: ShiftData;
}
export async function previewMove(prefix: string, from: number, to: number): Promise<MoveAnswer> {
  const { data, error } = await db.rpc('app_route_move_preview', { p_prefix: prefix, p_from: from, p_to: to });
  if (error) throw new Error(error.message);
  return data as MoveAnswer;
}
export async function moveRoute(prefix: string, from: number, to: number): Promise<MoveAnswer> {
  const { data, error } = await db.rpc('app_route_move', { p_prefix: prefix, p_from: from, p_to: to });
  if (error) throw new Error(error.message);
  return data as MoveAnswer;
}
/** Plain words for the move: what shifts, what goes with it, or why it can't be done. */
export function describeMove(a: MoveAnswer, code: string): { blocked: string | null; moves: string[]; carried: string | null } {
  const base = describeShift({ ok: true, maps: a.moves, data: a.data }, code);
  let blocked: string | null = null;
  if (!a.ok) {
    if (a.reason === 'outside_map') blocked = `${code} stays on ${a.area}, so pick a number from ${a.first} to ${a.last}.`;
    else if (a.reason === 'live_today') blocked = `${(a.live || []).join(', ')} ${(a.live || []).length === 1 ? 'is' : 'are'} on today's live day. Move after the day is closed.`;
    else if (a.reason === 'not_drawn') blocked = `${code} isn't saved yet. Save the map first, then move it.`;
    else if (a.reason === 'same_number') blocked = `${code} already has that number.`;
    else blocked = `${code} can't be moved (${a.reason || 'unknown reason'}).`;
  }
  return { blocked, moves: base.moves, carried: base.carried };
}
