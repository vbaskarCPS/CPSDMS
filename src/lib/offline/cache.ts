// src/lib/offline/cache.ts — read through the phone's copy. While a field day is open on this phone,
// every field read is saved (encrypted) on the phone, and when the server is slow or out of reach the
// screen gets the saved copy straight away; the real answer still lands in the background and is
// saved for next time. Off a field day (office desktops) it's a plain pass-through: nothing is kept.
import { cacheGet, cachePut, dayActive, pack, ready } from './dayStore';
import { failureCount, isNetworkError, isOffline } from './net';

/** How long a screen waits for the server before showing the phone's copy instead (server-first). */
export const WAIT_MS = 5000;

/**
 * Workers' screens are phone-first: they show the phone's copy at once and the server's answer
 * lands a moment later (screens listen with onFieldFresh and redraw). Route managers stay
 * server-first, so after moving a route they see the result, not an old copy.
 */
export type ReadMode = 'phoneFirst' | 'serverFirst';
let mode: ReadMode = 'serverFirst';
export const setReadMode = (m: ReadMode) => { mode = m; };
export const readMode = () => mode;

const freshListeners = new Set<(key: string) => void>();
/** Something on the phone was just replaced by a newer answer from the server. */
export function onFieldFresh(fn: (key: string) => void): () => void { freshListeners.add(fn); return () => freshListeners.delete(fn); }
const announceFresh = (key: string) => freshListeners.forEach(f => { try { f(key); } catch { /* ignore */ } });
/** Tell the screens a part of the day changed on the phone (e.g. a sale saved to the outbox). */
export const notifyFresh = (key: string) => announceFresh(key);

/** Work saved on the phone but not yet sent is laid over what the server said (src/lib/offline/outbox). */
type Overlay = (key: string, value: unknown) => unknown;
let overlay: Overlay | null = null;
export const setOverlay = (fn: Overlay | null) => { overlay = fn; };
const withOverlay = <T,>(key: string, v: T): T => (overlay ? (overlay(key, v) as T) : v);

export async function fieldRead<T>(key: string, fetcher: () => Promise<T>, waitMs = WAIT_MS): Promise<T> {
  await ready().catch(() => undefined);
  if (!dayActive()) return fetcher();
  const saved = await cacheGet<T>(key);
  const before = saved === undefined ? null : pack(saved.value);
  // Supabase often answers "nothing" (rather than an error) when there's no signal: an answer is only
  // trusted — saved, or shown over the phone's copy — if no request failed for lack of signal meanwhile.
  const f0 = failureCount();
  const live = fetcher().then(async v => {
    const real = failureCount() === f0;
    if (real) {
      await cachePut(key, v);
      if (before !== null && pack(v) !== before) announceFresh(key);   // the screen showed an older copy: redraw
    }
    return { v, real };
  });

  if (saved === undefined) return withOverlay(key, (await live).v);   // nothing on the phone yet: wait for the server
  live.catch(() => undefined);                       // (answered later, or never: either way don't complain)
  if (isOffline() || mode === 'phoneFirst') return withOverlay(key, saved.value);   // the phone's copy, now

  // otherwise the server gets a few seconds; then the phone's copy
  let timer: ReturnType<typeof setTimeout> | undefined;
  const fallback = new Promise<T>(ok => { timer = setTimeout(() => ok(saved.value), waitMs); });
  try {
    return withOverlay(key, await Promise.race([live.then(r => (r.real ? r.v : saved.value)), fallback]));
  } catch (e) {
    // the server failed: a connection problem → the phone's copy; a real error → say so
    if (isNetworkError(e) || isOffline()) return withOverlay(key, saved.value);
    throw e;
  } finally { if (timer) clearTimeout(timer); }
}

/** A stable cache key for a function and its arguments. */
export const readKey = (name: string, args: unknown[]) => `${name}:${JSON.stringify(args)}`;

/** Make an object's read methods go through the phone's copy (e.g. sessionService's getters). */
export function cacheMethods<T extends object>(obj: T, prefix: string, names: (keyof T & string)[]): void {
  for (const n of names) {
    const orig = obj[n] as unknown;
    if (typeof orig !== 'function') continue;
    const bound = (orig as (...a: unknown[]) => Promise<unknown>).bind(obj);
    (obj as Record<string, unknown>)[n] = (...args: unknown[]) => fieldRead(readKey(`${prefix}.${n}`, args), () => bound(...args));
  }
}
