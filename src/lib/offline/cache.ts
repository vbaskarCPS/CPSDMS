// src/lib/offline/cache.ts — read through the phone's copy. While a field day is open on this phone,
// every field read is saved (encrypted) on the phone, and when the server is slow or out of reach the
// screen gets the saved copy straight away; the real answer still lands in the background and is
// saved for next time. Off a field day (office desktops) it's a plain pass-through: nothing is kept.
import { cacheGet, cachePut, dayActive, ready } from './dayStore';
import { isNetworkError, isOffline } from './net';

/** How long a screen waits for the server before showing the phone's copy instead. */
export const WAIT_MS = 5000;

export async function fieldRead<T>(key: string, fetcher: () => Promise<T>, waitMs = WAIT_MS): Promise<T> {
  await ready().catch(() => undefined);
  if (!dayActive()) return fetcher();
  const saved = await cacheGet<T>(key);
  const live = fetcher().then(v => { cachePut(key, v); return v; });

  if (saved === undefined) return live;              // nothing on the phone yet: wait for the server
  live.catch(() => undefined);                       // (answered later, or never: either way don't complain)
  if (isOffline()) return saved.value;               // known dead zone: the phone's copy, now

  // otherwise the server gets a few seconds; then the phone's copy
  let timer: ReturnType<typeof setTimeout> | undefined;
  const fallback = new Promise<T>(ok => { timer = setTimeout(() => ok(saved.value), waitMs); });
  try {
    return await Promise.race([live, fallback]);
  } catch (e) {
    // the server failed: a connection problem → the phone's copy; a real error → say so
    if (isNetworkError(e) || isOffline()) return saved.value;
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
