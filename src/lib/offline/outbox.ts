// src/lib/offline/outbox.ts — a worker's saves in spotty service. On a worker's field day every save
// (a sale, a pending sale, a house outcome, a booking update) is tried straight away; if the server
// can't be reached (or doesn't answer within a few seconds) it goes into the outbox on the phone
// (encrypted), the screen shows it at once, and it's sent — in order — as soon as there's signal.
// The dot turns yellow while anything is waiting.
//
// Sending twice is safe: every kind of save is written so a repeat updates rather than duplicates
// (sales keep the ID they got on the phone; see sessionService). Card numbers never go in here.
// Route managers and office desktops don't use the outbox: their saves go straight to the server.
import { dayActive, outboxAll, outboxDelete, outboxPut } from './dayStore';
import { notifyFresh, readMode, setOverlay } from './cache';
import { failureCount, isNetworkError, isOffline, markOffline, onNetChange } from './net';

/** How long a save waits for the server before going into the outbox instead. */
export const SEND_WAIT_MS = 8000;
let sendWait = SEND_WAIT_MS;
/** For tests. */
export const _setSendWait = (ms: number) => { sendWait = ms; };
/** A save the server keeps refusing (not a signal problem) is tried this many times, then set aside. */
export const MAX_TRIES = 5;

export type SaveKind<A extends unknown[] = unknown[], R = unknown> = {
  /** Send it to the server (the original save). */
  send: (...args: A) => Promise<R>;
  /** What the screen gets back when it went into the outbox instead. */
  optimistic?: (args: A) => R;
  /** Make the arguments safe to keep on the phone (e.g. card numbers → last 4). */
  sanitize?: (args: A) => A;
  /** Show this waiting save in what the screens read (key = the phone's-copy key). */
  overlay?: (key: string, value: unknown, args: A) => unknown;
  /** Phone's-copy keys to redraw when this is saved or sent. */
  touches?: string[];
  /** Called before a repeat send, e.g. so a receipt isn't emailed twice. */
  beforeRetry?: (args: A) => void;
};

type Item = { id: string; kind: string; args: unknown[]; at: number; tries: number; maybeSent: boolean; stuck?: boolean; lastError?: string };

const kinds = new Map<string, SaveKind<any, any>>(); // eslint-disable-line @typescript-eslint/no-explicit-any
let items: Item[] = [];
let loaded: Promise<void> | null = null;
let seq = 0;
const countListeners = new Set<() => void>();

export function defineSave<A extends unknown[], R>(name: string, kind: SaveKind<A, R>): void { kinds.set(name, kind as SaveKind<any, any>); } // eslint-disable-line @typescript-eslint/no-explicit-any

/** How many saves are waiting on this phone (the yellow dot). */
export const waitingCount = () => items.length;
export function onWaitingChange(fn: () => void): () => void { countListeners.add(fn); return () => countListeners.delete(fn); }
const changed = (kind?: string) => {
  countListeners.forEach(f => { try { f(); } catch { /* ignore */ } });
  for (const k of (kind && kinds.get(kind)?.touches) || []) notifyFresh(k);
};

function load(): Promise<void> {
  loaded ??= outboxAll<Item>().then(async rows => {
    items = rows.map(r => r.value);
    if (items.length) await import('./fieldWrites').catch(() => undefined);   // what to do with each kind of save
    changed();
    if (items.length) scheduleFlush(0);
  }).catch(() => undefined);
  return loaded;
}

const newId = () => `${Date.now().toString().padStart(15, '0')}-${String(++seq).padStart(4, '0')}-${Math.random().toString(36).slice(2, 8)}`;

async function enqueue(kind: string, args: unknown[], maybeSent: boolean): Promise<void> {
  const k = kinds.get(kind)!;
  const item: Item = { id: newId(), kind, args: k.sanitize ? k.sanitize(args as never) : args, at: Date.now(), tries: 0, maybeSent };
  items.push(item);
  await outboxPut(item.id, item);
  changed(kind);
  scheduleFlush(1500);
}

/** Only a worker's field day uses the outbox. */
const usingOutbox = () => dayActive() && readMode() === 'phoneFirst';

const TIMEOUT = Symbol('timeout');

/** Run a send, noting whether any request failed for lack of signal meanwhile. Supabase often answers
 *  a dead zone with "nothing" instead of an error, so a save can look finished (or fail with something
 *  like "No active session") when really the signal dropped part-way. Such a send counts as not sent;
 *  sending it again is safe. */
class NoSignal extends Error { constructor() { super('Failed to fetch (no signal part-way)'); } }
async function sendWatched<R>(send: () => Promise<R>): Promise<R> {
  const f0 = failureCount();
  try {
    const r = await send();
    if (failureCount() !== f0) throw new NoSignal();
    return r;
  } catch (e) {
    if (failureCount() !== f0 && !(e instanceof NoSignal)) throw new NoSignal();
    throw e;
  }
}
const noSignal = (e: unknown) => e instanceof NoSignal || isNetworkError(e);

/** Save something: straight to the server when it answers; otherwise into the outbox. */
export async function save<R>(kind: string, args: unknown[]): Promise<R> {
  const k = kinds.get(kind);
  if (!k) throw new Error(`Unknown save: ${kind}`);
  if (!usingOutbox()) return k.send(...args);
  await load();
  const queued = () => (k.optimistic ? k.optimistic(args) : undefined) as R;
  // something already waiting, or a known dead zone: wait in line (keeps saves in order)
  if (items.some(i => !i.stuck) || isOffline()) { await enqueue(kind, args, false); return queued(); }
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const sent = sendWatched(() => k.send(...args));
    const r = await Promise.race([sent, new Promise<typeof TIMEOUT>(ok => { timer = setTimeout(() => ok(TIMEOUT), sendWait); })]);
    if (r !== TIMEOUT) return r as R;
    sent.catch(() => undefined);
    await enqueue(kind, args, true);                     // too slow: it may still land; a repeat is safe
    return queued();
  } catch (e) {
    if (noSignal(e)) { markOffline(); await enqueue(kind, args, e instanceof NoSignal); return queued(); }
    throw e;                                             // the server said no: tell the screen, as before
  } finally { if (timer) clearTimeout(timer); }
}

// ── sending what's waiting ──
let flushing = false;
let flushTimer: ReturnType<typeof setTimeout> | undefined;
let backoff = 0;

function scheduleFlush(ms: number) {
  if (flushTimer) clearTimeout(flushTimer);
  flushTimer = setTimeout(() => { void flush(); }, ms);
}

/** Send everything waiting, oldest first. Stops at the first sign of no signal. */
export async function flush(): Promise<void> {
  await load();
  if (flushing || !items.length) return;
  flushing = true;
  try {
    for (const it of [...items]) {
      if (it.stuck) continue;
      const k = kinds.get(it.kind);
      if (!k) continue;                                   // its screen hasn't loaded yet: next time
      try {
        if (it.maybeSent || it.tries > 0) k.beforeRetry?.(it.args as never);
        await sendWatched(() => k.send(...it.args));
        items = items.filter(x => x.id !== it.id);
        await outboxDelete(it.id);
        backoff = 0;
        changed(it.kind);
      } catch (e) {
        if (noSignal(e)) { if (e instanceof NoSignal) it.maybeSent = true; markOffline(); break; }  // no signal: try again when it's back
        it.tries++; it.lastError = String((e as Error)?.message ?? e);
        if (it.tries >= MAX_TRIES) { it.stuck = true; console.error('[outbox] the server keeps refusing this save; set aside', it.kind, it.lastError); }
        await outboxPut(it.id, it);
        backoff = Math.min(60_000, (backoff || 2000) * 2);
        break;                                            // keep order: later saves may depend on this one
      }
    }
  } finally {
    flushing = false;
    if (items.some(i => !i.stuck)) scheduleFlush(isOffline() ? 15_000 : backoff || 3000);
  }
}

// ── laying waiting saves over what the screens read ──
setOverlay((key, value) => {
  let v = value;
  for (const it of items) {
    const k = kinds.get(it.kind);
    if (k?.overlay) { try { v = k.overlay(key, v, it.args as never); } catch { /* ignore */ } }
  }
  return v;
});

// ── when to send ──
if (typeof window !== 'undefined') {
  onNetChange(s => { if (s === 'online') scheduleFlush(500); });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') scheduleFlush(500); });
  void load();
}

/** For tests. */
export function _resetOutbox() { items = []; loaded = null; flushing = false; backoff = 0; sendWait = SEND_WAIT_MS; if (flushTimer) clearTimeout(flushTimer); }
