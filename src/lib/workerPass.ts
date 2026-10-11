// src/lib/workerPass.ts — a worker's pass for the worker dashboard (training, payslips, account).
//
// Workers have no Supabase account. Signing in with CN # + PIN (or first name until they make a
// PIN) against this year's contractor list gives the phone a pass: a long random code the
// database only keeps the hash of. It lasts 30 days and stops working the moment the contractor
// is marked Quit or Fired. Every dashboard call sends it (app_worker_* functions). Shared by the
// old app (map logsheet, training) and the new app (/app/worker).
import { supabase } from './supabase';

const KEY = 'cps-worker-pass';

export interface WorkerProfile {
  hire_id: string; cn: string; year: number; status: string; first_name: string; last_name: string;
  center_id: string; center_name: string; region: string | null; services: string[]; has_pin: boolean;
}
export interface WorkerPass { token: string; expires_at: string; worker: WorkerProfile }
export type SignInResult = { ok: true; pass: WorkerPass } | { ok: false; reason: 'not_found' | 'wrong' | 'locked' | 'left' | 'unavailable'; until?: string };

export function getPass(): WorkerPass | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const p = JSON.parse(raw) as WorkerPass;
    if (!p?.token || !p.worker || new Date(p.expires_at).getTime() < Date.now()) { localStorage.removeItem(KEY); return null; }
    return p;
  } catch { return null; }
}
export function savePass(p: WorkerPass): void {
  try { localStorage.setItem(KEY, JSON.stringify(p)); } catch { /* private mode: the pass lasts this page only */ }
}
export function forgetPass(): void {
  try { localStorage.removeItem(KEY); } catch { /* nothing kept */ }
}

/** Sign in against this year's contractor list. 'unavailable' when the dashboard isn't set up on the server yet. */
export async function workerSignIn(cn: string, secret: string): Promise<SignInResult> {
  const { data, error } = await supabase.rpc('app_worker_sign_in', { p_cn: cn.trim(), p_secret: secret });
  if (error || !data) return { ok: false, reason: 'unavailable' };
  const d = data as { ok: boolean; reason?: string; until?: string; token?: string; expires_at?: string; worker?: WorkerProfile };
  if (!d.ok || !d.token || !d.worker) {
    const reason = (['not_found', 'wrong', 'locked', 'left'] as const).find(x => x === d.reason) || 'not_found';
    return { ok: false, reason, until: d.until };
  }
  const pass = { token: d.token, expires_at: d.expires_at || new Date(Date.now() + 30 * 864e5).toISOString(), worker: d.worker };
  savePass(pass);
  return { ok: true, pass };
}

/** Sign the pass out on the server too (best effort) and forget it here. */
export async function workerSignOut(): Promise<void> {
  const p = getPass();
  forgetPass();
  if (p) { try { await supabase.rpc('app_worker_sign_out', { p_token: p.token }); } catch { /* it expires anyway */ } }
}

export class SignedOut extends Error { constructor() { super('Please sign in again.'); } }

/** Call a dashboard function with the pass. A pass that no longer works is forgotten (SignedOut). */
export async function withPass<T>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
  const p = getPass();
  if (!p) throw new SignedOut();
  const { data, error } = await supabase.rpc(fn, { p_token: p.token, ...args });
  if (error) throw new Error(error.message);
  const d = data as { ok?: boolean; reason?: string } | null;
  if (d && d.ok === false && d.reason === 'signed_out') { forgetPass(); throw new SignedOut(); }
  return data as T;
}

/** Plain words for a failed sign-in. */
export function signInProblem(r: Exclude<SignInResult, { ok: true }>): string {
  if (r.reason === 'locked') return `Too many wrong tries. Try again${r.until ? ` after ${new Date(r.until).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}` : ' in 15 minutes'}.`;
  if (r.reason === 'wrong') return 'That PIN (or first name) isn’t right for that CN #.';
  if (r.reason === 'left') return 'You’re not on this year’s contractor list any more. Talk to your manager.';
  if (r.reason === 'unavailable') return 'The worker dashboard isn’t available right now. Try again in a minute.';
  return 'That CN # isn’t on this year’s contractor list.';
}
