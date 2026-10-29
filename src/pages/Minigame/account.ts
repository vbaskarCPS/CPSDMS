// src/pages/Minigame/account.ts — minigame players and saved progress (supabase minigame_* functions).
// The phone keeps only a pass token; the PIN is never stored on the phone.
import { supabase } from '../../lib/supabase';
import type { Match } from '../../lib/pour/pvp';
import type { MemHistory, MemMatch } from '../../lib/memory/match';
import type { Battle, BattleHistory } from '../../lib/battle/fleet';

export type Player = { id: string; name: string; has_pin?: boolean; kind?: 'adult' | 'kid' };
export type Progress = Record<string, Record<string, unknown>>;

const TOKEN = 'minigame.pass';
export function readToken(): string | null { try { return localStorage.getItem(TOKEN); } catch { return null; } }
function writeToken(t: string | null) { try { if (t) localStorage.setItem(TOKEN, t); else localStorage.removeItem(TOKEN); } catch { /* ignore */ } }

async function rpc<T>(fn: string, args?: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.rpc(fn, args);
  if (error) throw new Error(error.message);
  return data as T;
}

export const listPlayers = () => rpc<Player[]>('minigame_players_list');

export type SignIn = { ok: true; token: string; id: string; name: string; new_pin: boolean }
  | { ok: false; reason: 'pin_format' | 'not_found' | 'locked' | 'wrong'; tries_left?: number; until?: string };

export async function signIn(player: string, pin: string): Promise<SignIn> {
  const r = await rpc<SignIn>('minigame_sign_in', { p_player: player, p_pin: pin });
  if (r.ok) writeToken(r.token);
  return r;
}

/** Who this phone is signed in as, or null. */
export async function me(): Promise<Player | null> {
  const t = readToken();
  if (!t) return null;
  const p = await rpc<Player | null>('minigame_me', { p_token: t });
  if (!p) writeToken(null);
  return p;
}

export async function signOut() {
  const t = readToken();
  writeToken(null);
  if (t) await rpc('minigame_sign_out', { p_token: t }).catch(() => undefined);
}

export const loadProgress = () => rpc<Progress>('minigame_progress_all', { p_token: readToken() });

export const saveProgress = (game: string, data: Record<string, unknown>) =>
  rpc<string>('minigame_save', { p_token: readToken(), p_game: game, p_data: data });

// ── Little Lessons: a grown-up sees the kids' lessons and sets their mix ──
export type Kid = { id: string; name: string; lessons: Record<string, unknown> | null; chess: Record<string, unknown> | null; settings: Record<string, unknown> | null; updated_at: string | null };
export const listKids = () => rpc<Kid[]>('minigame_kids', { p_token: readToken() });
export const saveKidSettings = (kid: string, data: Record<string, unknown>) =>
  rpc<string>('minigame_kid_settings_save', { p_token: readToken(), p_kid: kid, p_data: data });

// ── head-to-head matches (minigame_match_* functions; see src/lib/pour/pvp.ts) ──
const tok = () => readToken();
export const matchCreate = (game = 'pour') => rpc<Match>('minigame_match_create', { p_token: tok(), p_game: game });
export const matchJoin = (code: string) =>
  rpc<{ ok: true; match: Match } | { ok: false; reason: 'no_match' | 'own_match' }>('minigame_match_join', { p_token: tok(), p_code: code });
export const matchState = (id: string) => rpc<Match>('minigame_match_state', { p_token: tok(), p_match: id });
export const matchReport = (id: string, r: { round: number; sorted: number; total: number; moves: number; penalty: number; finished: boolean; gaveUp: boolean }) =>
  rpc<Match>('minigame_match_report', {
    p_token: tok(), p_match: id, p_round: r.round, p_sorted: r.sorted, p_total: r.total, p_moves: r.moves,
    p_penalty_ms: r.penalty, p_finished: r.finished, p_gave_up: r.gaveUp,
  });
export const matchLeave = (id: string) => rpc<null>('minigame_match_leave', { p_token: tok(), p_match: id });
export const matchRematch = (id: string) =>
  rpc<{ ok: true; match: Match } | { ok: false; reason: string }>('minigame_match_rematch', { p_token: tok(), p_match: id });
export const matchHistory = (game = 'pour') => rpc<Match[]>('minigame_match_history', { p_token: tok(), p_game: game });

// ── Match (memory cards, turn by turn; minigame_memory_* functions; see src/lib/memory/match.ts) ──
export const memCreate = () => rpc<MemMatch>('minigame_memory_create', { p_token: tok() });
export const memJoin = (code: string) =>
  rpc<{ ok: true; match: MemMatch } | { ok: false; reason: 'no_match' | 'own_match' }>('minigame_memory_join', { p_token: tok(), p_code: code });
export const memState = (id: string) => rpc<MemMatch>('minigame_memory_state', { p_token: tok(), p_match: id });
export const memFlip = (id: string, card: number) => rpc<MemMatch>('minigame_memory_flip', { p_token: tok(), p_match: id, p_card: card });
export const memLeave = (id: string) => rpc<null>('minigame_memory_leave', { p_token: tok(), p_match: id });
export const memRematch = (id: string) =>
  rpc<{ ok: true; match: MemMatch } | { ok: false; reason: string }>('minigame_memory_rematch', { p_token: tok(), p_match: id });
export const memHistory = () => rpc<MemHistory>('minigame_memory_history', { p_token: tok() });

// ── Battleship (minigame_battle_* functions; see src/lib/battle/fleet.ts) ──
export const batCreate = () => rpc<Battle>('minigame_battle_create', { p_token: tok() });
export const batJoin = (code: string) =>
  rpc<{ ok: true; match: Battle } | { ok: false; reason: 'no_match' | 'own_match' }>('minigame_battle_join', { p_token: tok(), p_code: code });
export const batState = (id: string) => rpc<Battle>('minigame_battle_state', { p_token: tok(), p_match: id });
export const batPlace = (id: string, ships: number[][]) =>
  rpc<{ ok: boolean; reason?: string; match: Battle }>('minigame_battle_place', { p_token: tok(), p_match: id, p_ships: ships });
export const batFire = (id: string, cell: number) => rpc<Battle>('minigame_battle_fire', { p_token: tok(), p_match: id, p_cell: cell });
export const batLeave = (id: string) => rpc<null>('minigame_battle_leave', { p_token: tok(), p_match: id });
export const batRematch = (id: string) =>
  rpc<{ ok: true; match: Battle } | { ok: false; reason: string }>('minigame_battle_rematch', { p_token: tok(), p_match: id });
export const batHistory = () => rpc<BattleHistory>('minigame_battle_history', { p_token: tok() });
