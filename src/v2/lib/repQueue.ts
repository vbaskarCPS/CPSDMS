// src/v2/lib/repQueue.ts — the rep app keeps working without signal. Visits (with their photos) and
// "sent info" logs that can't reach us wait on the phone (IndexedDB) and go when the signal's back.
// Each visit carries an id made on the phone and the time it happened, so one sent twice is kept once.
// The home map is kept on the phone too, so it opens with no signal.
import { db } from './client';
import { isOffline } from './repField';

export const PHOTO_BUCKET = 'ms-visit-photos';

export interface QPhoto { name: string; blob: Blob; type: string }
export interface QItem {
  id: string;
  rpc: 'ms_rep_log_visit' | 'ms_rep_log_send';
  args: Record<string, unknown>;
  photos?: QPhoto[];
  label: string;           // "Joe’s Plumbing: Interested"
  queued_at: number;
  error?: string;          // the server said no: shown to the rep, who can drop it
}

// ───────────── a tiny IndexedDB store (memory when there's none) ─────────────
const DB = 'mainstreet-rep';
const STORES = ['queue', 'cache'] as const;
type Store = typeof STORES[number];
const mem: Record<Store, Map<string, unknown>> = { queue: new Map(), cache: new Map() };
let opening: Promise<IDBDatabase | null> | null = null;
function open(): Promise<IDBDatabase | null> {
  if (opening) return opening;
  opening = new Promise(resolve => {
    try {
      if (typeof indexedDB === 'undefined') { resolve(null); return; }
      const r = indexedDB.open(DB, 1);
      r.onupgradeneeded = () => { for (const s of STORES) if (!r.result.objectStoreNames.contains(s)) r.result.createObjectStore(s); };
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => resolve(null);
      r.onblocked = () => resolve(null);
    } catch { resolve(null); }
  });
  return opening;
}
async function tx<T>(store: Store, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T | undefined> {
  const d = await open();
  if (!d) return undefined;
  return new Promise(resolve => {
    try {
      const req = fn(d.transaction(store, mode).objectStore(store));
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(undefined);
    } catch { resolve(undefined); }
  });
}
async function put(store: Store, key: string, v: unknown) { mem[store].set(key, v); await tx(store, 'readwrite', s => s.put(v, key)); }
async function del(store: Store, key: string) { mem[store].delete(key); await tx(store, 'readwrite', s => s.delete(key)); }
async function get<T>(store: Store, key: string): Promise<T | undefined> {
  const v = await tx<T>(store, 'readonly', s => s.get(key) as IDBRequest<T>);
  return v ?? (mem[store].get(key) as T | undefined);
}
async function all<T>(store: Store): Promise<T[]> {
  const v = await tx<T[]>(store, 'readonly', s => s.getAll() as IDBRequest<T[]>);
  return v ?? ([...mem[store].values()] as T[]);
}

// ───────────── the map, kept ─────────────
export async function cacheSet<T>(key: string, data: T): Promise<void> { await put('cache', key, { at: Date.now(), data }); }
export async function cacheGet<T>(key: string): Promise<{ at: number; data: T } | null> { return (await get<{ at: number; data: T }>('cache', key)) || null; }

// ───────────── the queue ─────────────
type Listener = (items: QItem[]) => void;
const listeners = new Set<Listener>();
export function onQueue(fn: Listener): () => void { listeners.add(fn); queued().then(fn); return () => { listeners.delete(fn); }; }
async function notify() { const q = await queued(); listeners.forEach(f => f(q)); }
export async function queued(): Promise<QItem[]> { return (await all<QItem>('queue')).sort((a, b) => a.queued_at - b.queued_at); }
export async function enqueue(item: QItem): Promise<void> { await put('queue', item.id, item); await notify(); }
export async function drop(id: string): Promise<void> { await del('queue', id); await notify(); }

async function uploadPhotos(photos: QPhoto[] | undefined): Promise<void> {
  for (const p of photos || []) {
    const { error } = await db.storage.from(PHOTO_BUCKET).upload(p.name, p.blob, { contentType: p.type, upsert: false });
    if (error && !/exists|duplicate/i.test(error.message)) throw error;
  }
}
/** Sends one now. Throws when it can't (offline or the server said no). */
export async function sendNow(item: QItem): Promise<unknown> {
  await uploadPhotos(item.photos);
  const { data, error } = await db.rpc(item.rpc, item.args);
  if (error) throw error;
  return data;
}

/** Send now, or keep it for later when there's no signal. */
export async function sendOrQueue(item: QItem): Promise<{ sent: boolean; data?: unknown }> {
  try { return { sent: true, data: await sendNow(item) }; }
  catch (e) {
    if (!isOffline(e)) throw e;
    await enqueue(item);
    return { sent: false };
  }
}

let flushing = false;
/** Tries everything waiting. Stops at the first sign there's still no signal. */
export async function flush(): Promise<{ sent: number; left: number }> {
  if (flushing) return { sent: 0, left: (await queued()).length };
  flushing = true;
  let sent = 0;
  try {
    for (const item of await queued()) {
      if (item.error) continue;
      try { await sendNow(item); await del('queue', item.id); sent++; }
      catch (e) {
        if (isOffline(e)) break;
        await put('queue', item.id, { ...item, error: e instanceof Error ? e.message : String((e as { message?: string })?.message || e) });
      }
    }
  } finally { flushing = false; await notify(); }
  return { sent, left: (await queued()).length };
}
