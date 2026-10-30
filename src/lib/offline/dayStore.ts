// src/lib/offline/dayStore.ts — the phone's copy of a field user's day, so the app keeps working in
// spotty service. What the field screens read from the server is kept here (the "morning pack") and
// shown when the server can't be reached.
//
// Privacy: everything is encrypted (AES-GCM) with a key the browser won't hand out (non-extractable),
// and the whole day is wiped — key and all — when the day is closed, the person signs out, the next
// day's pack starts, someone else opens the app on this phone, or 18 hours pass. Work that hasn't
// reached the server yet (the outbox, later) is never wiped; only once it's sent.
// Card numbers are never stored here (or anywhere).

export const MAX_AGE_MS = 18 * 3600_000;
const DB_NAME = 'cps-field', DB_VERSION = 1;

export type DayTag = { day: string; who: string; at: number };

// ── a tiny IndexedDB wrapper ──
/** Browsers without storage (some private modes, tests): nothing is kept, nothing to wipe. */
const hasStorage = () => typeof indexedDB !== 'undefined' && typeof crypto !== 'undefined' && !!crypto.subtle;
let dbp: Promise<IDBDatabase> | null = null;
function db(): Promise<IDBDatabase> {
  if (dbp) return dbp;
  dbp = new Promise((ok, no) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const d = req.result;
      for (const s of ['meta', 'cache', 'outbox']) if (!d.objectStoreNames.contains(s)) d.createObjectStore(s);
    };
    req.onsuccess = () => ok(req.result);
    req.onerror = () => no(req.error);
  });
  dbp.catch(() => { dbp = null; });
  return dbp;
}
async function tx<T>(store: string, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T> | void): Promise<T | undefined> {
  const d = await db();
  return new Promise((ok, no) => {
    const t = d.transaction(store, mode);
    const s = t.objectStore(store);
    const r = fn(s);
    let out: T | undefined;
    if (r) r.onsuccess = () => { out = r.result; };
    t.oncomplete = () => ok(out);
    t.onerror = () => no(t.error);
    t.onabort = () => no(t.error);
  });
}
const metaGet = <T,>(k: string) => tx<T>('meta', 'readonly', s => s.get(k) as IDBRequest<T>);
const metaPut = (k: string, v: unknown) => tx('meta', 'readwrite', s => { s.put(v, k); });
const count = (store: string) => tx<number>(store, 'readonly', s => s.count()).then(n => n || 0);

// ── (de)serialising: Maps, Sets and Dates survive the round trip ──
export function pack(v: unknown): string {
  return JSON.stringify(v, function (k, val) {
    const raw = (this as Record<string, unknown>)[k];
    if (raw instanceof Map) return { __t: 'Map', v: [...raw.entries()] };
    if (raw instanceof Set) return { __t: 'Set', v: [...raw.values()] };
    if (raw instanceof Date) return { __t: 'Date', v: raw.toISOString() };
    return val;
  });
}
export function unpack<T>(s: string): T {
  return JSON.parse(s, (_k, val) => {
    if (val && typeof val === 'object' && typeof val.__t === 'string' && 'v' in val) {
      if (val.__t === 'Map') return new Map(val.v);
      if (val.__t === 'Set') return new Set(val.v);
      if (val.__t === 'Date') return new Date(val.v);
    }
    return val;
  }) as T;
}

// ── the key: made once per day, can't be read out, destroyed at wipe time ──
let keyP: Promise<CryptoKey> | null = null;
async function key(): Promise<CryptoKey> {
  if (keyP) return keyP;
  keyP = (async () => {
    const have = await metaGet<CryptoKey>('key');
    if (have) return have;
    const k = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
    await metaPut('key', k);
    return k;
  })();
  keyP.catch(() => { keyP = null; });
  return keyP;
}
async function seal(v: unknown): Promise<{ iv: Uint8Array; data: ArrayBuffer }> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await key(), new TextEncoder().encode(pack(v)));
  return { iv, data };
}
async function open<T>(box: { iv: Uint8Array; data: ArrayBuffer }): Promise<T> {
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: new Uint8Array(box.iv) as Uint8Array<ArrayBuffer> }, await key(), box.data);
  return unpack<T>(new TextDecoder().decode(plain));
}

// ── the day ──
let current: DayTag | null = null;

/** Should a stored day be wiped, given today and who's opening the app? */
export function isStale(tag: DayTag | null | undefined, want: { day: string; who: string } | null, now = Date.now()): boolean {
  if (!tag) return false;
  if (now - tag.at > MAX_AGE_MS) return true;
  if (want && (tag.day !== want.day || tag.who !== want.who)) return true;
  return false;
}

/** The app has checked (once, at start) whether the stored day is still good. Everything waits for it. */
let readyP: Promise<unknown> | null = null;
export const ready = () => (readyP ??= wipeIfExpired());

/** Start (or carry on) a field day on this phone. A different day or person wipes the old one first. */
export async function beginDay(day: string, who: string): Promise<void> {
  await ready();
  if (!hasStorage()) return;
  try {
    const tag = await metaGet<DayTag>('day');
    if (isStale(tag, { day, who })) await wipe();
    else if (tag) { current = tag; return; }
    current = { day, who, at: Date.now() };
    await metaPut('day', current);
  } catch (e) { console.warn('[dayStore] could not start the day on this phone', e); current = null; }
}

/** The day is over (closed, signed out): wipe it. */
export async function endDay(): Promise<void> { if (!hasStorage()) return; try { await wipe(); } catch (e) { console.warn('[dayStore] wipe failed', e); } }

/** At app start: wipe a day that's past its 18 hours. */
export async function wipeIfExpired(now = Date.now()): Promise<boolean> {
  if (!hasStorage()) return false;
  try {
    const tag = await metaGet<DayTag>('day');
    if (isStale(tag, null, now)) { await wipe(); return true; }
    current = tag || null;
  } catch { /* no storage on this browser */ }
  return false;
}

/** Remove the day's copy. Work still waiting to be sent (the outbox) is kept, with its key, until it's sent. */
export async function wipe(): Promise<void> {
  current = null;
  await tx('cache', 'readwrite', s => { s.clear(); });
  await tx('meta', 'readwrite', s => { s.delete('day'); });
  if ((await count('outbox')) === 0) {
    await tx('meta', 'readwrite', s => { s.delete('key'); });
    keyP = null;
  }
}

export const dayActive = () => current !== null;
export const currentDay = () => current;

// ── the copy of what the screens read ──
export type Cached<T> = { value: T; at: number };

export async function cacheGet<T>(k: string): Promise<Cached<T> | undefined> {
  if (!current) return undefined;
  try {
    const box = await tx<{ iv: Uint8Array; data: ArrayBuffer; at: number }>('cache', 'readonly', s => s.get(k));
    if (!box) return undefined;
    return { value: await open<T>(box), at: box.at };
  } catch { return undefined; }
}

export async function cachePut(k: string, v: unknown): Promise<void> {
  if (!current) return;
  try {
    const box = await seal(v);
    await tx('cache', 'readwrite', s => { s.put({ ...box, at: Date.now() }, k); });
  } catch (e) { console.warn('[dayStore] could not save', k, e); }
}

/** For tests: forget the in-memory state (as if the app had restarted). */
export async function _restart() { current = null; keyP = null; readyP = null; const p = dbp; dbp = null; if (p) await p.then(d => d.close()).catch(() => undefined); }
