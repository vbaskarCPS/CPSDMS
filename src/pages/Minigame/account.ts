// src/pages/Minigame/account.ts — minigame players and saved progress (supabase minigame_* functions).
// The phone keeps only a pass token; the PIN is never stored on the phone.
import { supabase } from '../../lib/supabase';

export type Player = { id: string; name: string; has_pin?: boolean };
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
