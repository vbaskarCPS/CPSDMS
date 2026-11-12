// supabase/functions/planner-mail/secure.ts — the two things about a connected mailbox that have to be exactly right:
// the sign-in "state" (the value that goes to Google with a person and comes back with them), and how the key to a
// mailbox (its refresh token) is locked before it is stored.
// Nothing but WebCrypto here: no Deno, no network, no database (tested from src/planner/features/mail/secure.test.ts).
//
// The state: 32 random bytes. Only its SHA-256 is kept (planner_mail_states), with who started the sign-in, which
// planner they came from, and when it runs out (10 minutes). Coming back, the row is found by the hash and marked
// used in the same step (handle.ts claims it), so a value works once, for the person who started it, and not late.
//
// The key: AES-256-GCM with the PLANNER_MAIL_KEY secret, a fresh 12-byte IV for every value, and the mailbox it
// belongs to mixed in (so a locked token copied onto another row doesn't open). What is stored reads
// "v1.<iv>.<locked>"; a single changed character and it refuses to open. Nothing here ever puts a key, a token or a
// state value in an error message.

const enc = new TextEncoder();
const dec = new TextDecoder();

/** Bytes → base64 as web addresses carry it (no +, /, or = padding). */
export const b64u = (b: Uint8Array): string => {
  let s = '';
  for (const x of b) s += String.fromCharCode(x);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};
/** Base64 → bytes: the usual alphabet or the web one, with or without its = padding. null = not base64. */
export function unb64(s: string): Uint8Array<ArrayBuffer> | null {
  const t = s.trim().replace(/-/g, '+').replace(/_/g, '/').replace(/=+$/, '');
  if (!t || !/^[A-Za-z0-9+/]+$/.test(t) || t.length % 4 === 1) return null;
  try {
    const bin = atob(t + '==='.slice((t.length + 3) % 4));
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  } catch { return null; }
}
const hex = (b: ArrayBuffer): string => Array.from(new Uint8Array(b), x => x.toString(16).padStart(2, '0')).join('');

// ── the sign-in state ──
export const STATE_MINUTES = 10;
export type AppId = 'vijayplanner' | 'roshplanner';
/** One sign-in that has been started, as it is kept. The value itself is not in it: only its hash. */
export interface StateRow { state_hash: string; user_id: string; app: AppId; provider: string; expires_at: string; used_at: string | null }

/** A new state value: 32 random bytes, as text. */
export const newState = (): string => b64u(crypto.getRandomValues(new Uint8Array(32)));
/** What is kept of a state value, and what a returning one is looked up by. */
export const stateHash = async (value: string): Promise<string> => hex(await crypto.subtle.digest('SHA-256', enc.encode(value)));
/** Does a value look like one of ours at all? (43 characters of web base64.) Anything else isn't looked up. */
export const looksLikeState = (v: unknown): v is string => typeof v === 'string' && /^[A-Za-z0-9_-]{43}$/.test(v);
/** The row to keep for a sign-in started now. */
export async function stateRow(value: string, who: { userId: string; app: AppId; provider: string }, nowMs: number): Promise<StateRow> {
  return { state_hash: await stateHash(value), user_id: who.userId, app: who.app, provider: who.provider, expires_at: new Date(nowMs + STATE_MINUTES * 60_000).toISOString(), used_at: null };
}
/** Has a sign-in run out of time? (It was claimed first: a late one is used up too.) */
export const stateExpired = (row: Pick<StateRow, 'expires_at'>, nowMs: number): boolean => !(Date.parse(row.expires_at) > nowMs);

// ── locking a token ──
/** The key isn't there, or isn't 32 bytes: email isn't set up. The message never holds what was given. */
export class NoKey extends Error { constructor() { super('PLANNER_MAIL_KEY is missing or is not 32 bytes of base64'); } }
/** What was stored doesn't open: changed, cut short, locked with another key, or moved from another mailbox. */
export class WontOpen extends Error { constructor() { super('the stored token would not open'); } }

/** The PLANNER_MAIL_KEY secret (32 random bytes, base64, with or without padding) as a key. */
export async function mailKey(secret: string | undefined | null): Promise<CryptoKey> {
  const raw = unb64(secret || '');
  if (!raw || raw.length !== 32) throw new NoKey();
  return crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}
/** Which mailbox a locked token belongs to: mixed into the lock, so it only opens for that one. */
export const tokenOwner = (m: { user_id: string; provider: string; address: string }): string => `${m.user_id}|${m.provider}|${m.address.toLowerCase()}`;

/** Lock a value for storing. A fresh IV every time: locking the same value twice gives two different results. */
export async function seal(key: CryptoKey, plain: string, owner: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const locked = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: enc.encode(owner) }, key, enc.encode(plain));
  return `v1.${b64u(iv)}.${b64u(new Uint8Array(locked))}`;
}
/** Open a stored value. Throws WontOpen for anything that isn't exactly what seal() made for this owner. */
export async function open(key: CryptoKey, stored: string, owner: string): Promise<string> {
  const parts = typeof stored === 'string' ? stored.split('.') : [];
  const iv = parts.length === 3 && parts[0] === 'v1' ? unb64(parts[1]) : null, locked = iv ? unb64(parts[2]) : null;
  if (!iv || iv.length !== 12 || !locked || locked.length < 17) throw new WontOpen();
  try { return dec.decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv, additionalData: enc.encode(owner) }, key, locked)); }
  catch { throw new WontOpen(); }
}

/** Are two secret strings the same? Takes as long whether they differ at the first character or the last. */
export function sameSecret(a: string, b: string): boolean {
  if (!a || !b || a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}
