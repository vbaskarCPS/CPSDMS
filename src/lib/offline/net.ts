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

/** How many requests have failed for lack of signal (Supabase often answers "nothing" instead of an
 *  error when that happens, so a read can tell whether its answer is real). */
let failures = 0;
export const failureCount = () => failures;
export const isOffline = () => state === 'offline';
export function onNetChange(fn: (s: NetState) => void): () => void { listeners.add(fn); return () => listeners.delete(fn); }

/** Something reached the server (or failed to). */
export const markOnline = () => set('online');
export const markOffline = () => set('offline');

/** A failed fetch that means "no connection" rather than "the server said no". */
export const isNetworkError = (e: unknown) =>
  e instanceof TypeError || /failed to fetch|network ?error|load failed|networkerror|fetch failed|timed? ?out|ERR_INTERNET|ERR_NETWORK/i.test(String((e as Error)?.message ?? e));

// ── view only with no signal (route managers) ──
// A route manager with no signal sees their map and the latest data, but can't change anything
// (assign routes, move workers, mark houses…): two managers changing the same team, one of them
// from an old copy, would clash. So on a manager's day, a change is refused at once while there's no
// signal, and the screen says so (see ViewOnlyNotice). Reads still go out, so the first one that
// gets through turns changes back on. Workers' saves aren't affected (they go through the outbox).
let viewOnlyOffline = false;
export const setViewOnlyWhenOffline = (on: boolean) => { viewOnlyOffline = on; };
const blockedListeners = new Set<() => void>();
/** A change was refused (or failed) because there's no signal. */
export function onChangeBlocked(fn: () => void): () => void { blockedListeners.add(fn); return () => blockedListeners.delete(fn); }
const blocked = () => blockedListeners.forEach(f => { try { f(); } catch { /* ignore */ } });

const methodOf = (input: RequestInfo | URL, init?: RequestInit) =>
  (init?.method || (typeof Request !== 'undefined' && input instanceof Request ? input.method : 'GET')).toUpperCase();
const urlOf = (input: RequestInfo | URL) => (typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
/** A request that changes something on the server (not a read, not signing in). */
export const isChange = (input: RequestInfo | URL, init?: RequestInit) => {
  const m = methodOf(input, init);
  if (m === 'GET' || m === 'HEAD' || m === 'OPTIONS') return false;
  const u = urlOf(input);
  return /\/(rest|functions|storage)\/v1\//.test(u) && !/\/rest\/v1\/rpc\/(get_|fetch_|list_)/.test(u);
};

/** fetch, but noting whether the server answered. Any HTTP answer (even an error) means we're online. */
export function trackedFetch(base: typeof fetch = (...a) => fetch(...a)): typeof fetch {
  return async (input, init) => {
    const change = viewOnlyOffline && isChange(input, init);
    if (change && state === 'offline') { blocked(); throw new TypeError('Failed to fetch (no signal: view only)'); }
    try {
      const res = await base(input, init);
      markOnline();
      return res;
    } catch (e) {
      if (isNetworkError(e) && !(init?.signal?.aborted)) { failures++; markOffline(); if (change) blocked(); }
      throw e;
    }
  };
}

if (typeof window !== 'undefined') {
  window.addEventListener('online', () => set('online'));
  window.addEventListener('offline', () => set('offline'));
}
