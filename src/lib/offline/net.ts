// src/lib/offline/net.ts — is the phone reaching the server right now? Every Supabase request goes
// through `trackedFetch`, so the app learns about a dead zone from the requests it's already making
// (plus the browser's online/offline events) instead of pinging. Screens use `isOffline()` to read
// the phone's copy straight away rather than waiting on a request that won't come back.
//
// Nothing here aborts requests: an office import that takes 30 s still finishes. Field reads race
// the network against the phone's copy instead (see cache.ts).

export type NetState = 'online' | 'offline';

let state: NetState = typeof navigator !== 'undefined' && navigator.onLine === false ? 'offline' : 'online';
const listeners = new Set<(s: NetState) => void>();

function set(next: NetState) {
  if (next === state) return;
  state = next;
  listeners.forEach(fn => { try { fn(next); } catch { /* ignore */ } });
}

export const netState = () => state;
export const isOffline = () => state === 'offline';
export function onNetChange(fn: (s: NetState) => void): () => void { listeners.add(fn); return () => listeners.delete(fn); }

/** Something reached the server (or failed to). */
export const markOnline = () => set('online');
export const markOffline = () => set('offline');

/** A failed fetch that means "no connection" rather than "the server said no". */
export const isNetworkError = (e: unknown) =>
  e instanceof TypeError || /failed to fetch|network ?error|load failed|networkerror|fetch failed|timed? ?out|ERR_INTERNET|ERR_NETWORK/i.test(String((e as Error)?.message ?? e));

/** fetch, but noting whether the server answered. Any HTTP answer (even an error) means we're online. */
export function trackedFetch(base: typeof fetch = (...a) => fetch(...a)): typeof fetch {
  return async (input, init) => {
    try {
      const res = await base(input, init);
      markOnline();
      return res;
    } catch (e) {
      if (isNetworkError(e) && !(init?.signal?.aborted)) markOffline();
      throw e;
    }
  };
}

if (typeof window !== 'undefined') {
  window.addEventListener('online', () => set('online'));
  window.addEventListener('offline', () => set('offline'));
}
