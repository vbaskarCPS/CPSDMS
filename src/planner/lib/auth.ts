// src/planner/lib/auth.ts — the planner's pass: username + PIN → a year-long token kept on this device.
// Same shape as the worker pass (src/lib/workerPass.ts); the server keeps only the token's hash
// (supabase/migrations/20261203100000_planner.sql).
import { supabase } from '../../lib/supabase';
import { appId } from './app';

// one pass per app, so /vijayplanner and /roshplanner keep separate sign-ins on the same phone
const KEY = appId() === 'vijayplanner' ? 'vijay-planner-pass' : `${appId()}-pass`;

export interface PlannerSettings { units?: 'lb' | 'kg'; wake_time?: string; [k: string]: unknown }
export interface PlannerUser { id: string; username: string; display_name: string; settings: PlannerSettings }
export interface PlannerPass { token: string; expires_at: string; user: PlannerUser }
export type SignInResult = { ok: true; pass: PlannerPass } | { ok: false; reason: 'wrong' | 'locked' | 'unavailable'; until?: string };

type Listener = (p: PlannerPass | null) => void;
const listeners = new Set<Listener>();
function notify(p: PlannerPass | null) { listeners.forEach(fn => { try { fn(p); } catch { /* ignore */ } }); }
export function onPassChange(fn: Listener): () => void { listeners.add(fn); return () => listeners.delete(fn); }

export function getPass(): PlannerPass | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const p = JSON.parse(raw) as PlannerPass;
    if (!p?.token || !p.user || new Date(p.expires_at).getTime() < Date.now()) { localStorage.removeItem(KEY); return null; }
    return p;
  } catch { return null; }
}
export function savePass(p: PlannerPass): void {
  try { localStorage.setItem(KEY, JSON.stringify(p)); } catch { /* private mode */ }
  notify(p);
}
export function forgetPass(): void {
  try { localStorage.removeItem(KEY); } catch { /* nothing kept */ }
  notify(null);
}

export async function signIn(username: string, pin: string): Promise<SignInResult> {
  const { data, error } = await supabase.rpc('planner_sign_in', { p_username: username.trim(), p_pin: pin });
  if (error || !data) return { ok: false, reason: 'unavailable' };
  const d = data as { ok: boolean; reason?: string; until?: string; token?: string; expires_at?: string; user?: PlannerUser };
  if (!d.ok || !d.token || !d.user) {
    return { ok: false, reason: d.reason === 'locked' ? 'locked' : 'wrong', until: d.until ?? undefined };
  }
  const pass: PlannerPass = { token: d.token, expires_at: d.expires_at || new Date(Date.now() + 365 * 864e5).toISOString(), user: d.user };
  savePass(pass);
  return { ok: true, pass };
}

export async function signOut(): Promise<void> {
  const p = getPass();
  forgetPass();
  if (p) { try { await supabase.rpc('planner_sign_out', { p_token: p.token }); } catch { /* it expires anyway */ } }
}

export class SignedOut extends Error { constructor() { super('Please sign in again.'); } }

/** Call a planner function with the pass. A pass the server no longer knows is forgotten (SignedOut). */
export async function call<T extends { ok: boolean; reason?: string }>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
  const p = getPass();
  if (!p) throw new SignedOut();
  const { data, error } = await supabase.rpc(fn, { p_token: p.token, ...args });
  if (error) throw new Error(error.message);
  const d = data as T;
  if (d && !d.ok && d.reason === 'signed_out') { forgetPass(); throw new SignedOut(); }
  return d;
}

/** Re-check the pass with the server and refresh the profile kept on this device. */
export async function refreshMe(): Promise<PlannerUser | null> {
  const p = getPass();
  if (!p) return null;
  try {
    const d = await call<{ ok: boolean; user?: PlannerUser }>('planner_me');
    if (d.ok && d.user) { savePass({ ...p, user: d.user }); return d.user; }
  } catch (e) { if (e instanceof SignedOut) return null; }
  return p.user;
}

export async function saveSettings(settings: PlannerSettings): Promise<PlannerUser> {
  const d = await call<{ ok: boolean; user?: PlannerUser }>('planner_save_settings', { p_settings: settings });
  if (!d.ok || !d.user) throw new Error('Could not save settings');
  const p = getPass();
  if (p) savePass({ ...p, user: d.user });
  return d.user;
}

export async function changePin(oldPin: string, newPin: string): Promise<'ok' | 'wrong' | 'short'> {
  const d = await call<{ ok: boolean; reason?: string }>('planner_change_pin', { p_old_pin: oldPin, p_new_pin: newPin });
  if (d.ok) return 'ok';
  return d.reason === 'short' ? 'short' : 'wrong';
}
