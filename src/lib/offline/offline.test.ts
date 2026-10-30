import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MAX_AGE_MS, _restart, beginDay, cacheGet, cachePut, dayActive, endDay, isStale, pack, unpack, wipe, wipeIfExpired } from './dayStore';
import { cacheMethods, fieldRead } from './cache';
import { isNetworkError, markOffline, markOnline, trackedFetch, netState } from './net';

// a fresh database for every test
beforeEach(async () => {
  await _restart();
  await new Promise(ok => { const r = indexedDB.deleteDatabase('cps-field'); r.onsuccess = r.onerror = r.onblocked = () => ok(null); });
  markOnline();
});

describe('saving on the phone', () => {
  it('keeps Maps, Sets and Dates through the round trip', () => {
    const v = { m: new Map([['a', [1, 2]]]), s: new Set(['x']), d: new Date('2026-10-30T12:00:00Z'), n: null, list: [{ k: 1 }] };
    expect(unpack(pack(v))).toEqual(v);
  });
  it('saves only while a field day is open, and encrypts what it saves', async () => {
    await cachePut('k', { name: 'Jane Customer', phone: '905-555-0100' });
    expect(await cacheGet('k')).toBeUndefined();          // no day open: nothing kept (office desktops)
    await beginDay('2026-10-30', 'w1');
    await cachePut('k', { name: 'Jane Customer', phone: '905-555-0100' });
    expect((await cacheGet<{ name: string }>('k'))?.value.name).toBe('Jane Customer');
    // what's actually in storage is unreadable
    const raw = await new Promise<unknown>(ok => {
      const r = indexedDB.open('cps-field'); r.onsuccess = () => { const g = r.result.transaction('cache').objectStore('cache').get('k'); g.onsuccess = () => { ok(g.result); r.result.close(); }; };
    });
    expect(JSON.stringify(raw)).not.toContain('Jane');
    expect(new TextDecoder().decode((raw as { data: ArrayBuffer }).data)).not.toContain('Jane');
  });
});

describe('wiping the day', () => {
  it('knows when a stored day is stale', () => {
    const tag = { day: '2026-10-30', who: 'w1', at: 1_000_000 };
    expect(isStale(tag, { day: '2026-10-30', who: 'w1' }, 1_000_000 + 3600_000)).toBe(false);
    expect(isStale(tag, { day: '2026-10-31', who: 'w1' }, 1_000_000)).toBe(true);     // the next day
    expect(isStale(tag, { day: '2026-10-30', who: 'w2' }, 1_000_000)).toBe(true);     // someone else on this phone
    expect(isStale(tag, null, 1_000_000 + MAX_AGE_MS + 1)).toBe(true);                // 18 hours
    expect(isStale(null, { day: 'x', who: 'y' })).toBe(false);
  });
  it('wipes for a new day, a new person, sign-out, or after 18 hours', async () => {
    await beginDay('2026-10-30', 'w1'); await cachePut('k', 1);
    await beginDay('2026-10-30', 'w1');
    expect((await cacheGet('k'))?.value).toBe(1);                 // same day, same person: kept
    await beginDay('2026-10-31', 'w1');
    expect(await cacheGet('k')).toBeUndefined();                  // next day: gone
    await cachePut('k', 2); await beginDay('2026-10-31', 'w2');
    expect(await cacheGet('k')).toBeUndefined();                  // another person: gone
    await cachePut('k', 3); await endDay();
    expect(dayActive()).toBe(false);
    await beginDay('2026-10-31', 'w2');
    expect(await cacheGet('k')).toBeUndefined();                  // signed out: gone
    await cachePut('k', 4);
    await _restart();
    expect(await wipeIfExpired(Date.now() + MAX_AGE_MS + 60_000)).toBe(true);
    await beginDay('2026-10-31', 'w2');
    expect(await cacheGet('k')).toBeUndefined();                  // 18 hours: gone
  });
  it('survives an app restart within the day', async () => {
    await beginDay('2026-10-30', 'w1'); await cachePut('k', 'kept');
    await _restart();
    expect(await wipeIfExpired()).toBe(false);
    expect(dayActive()).toBe(true);
    expect((await cacheGet('k'))?.value).toBe('kept');
  });
  it('a wipe destroys the key, so nothing old can be read again', async () => {
    await beginDay('2026-10-30', 'w1'); await cachePut('k', 'secret');
    await wipe();
    const key = await new Promise(ok => { const r = indexedDB.open('cps-field'); r.onsuccess = () => { const g = r.result.transaction('meta').objectStore('meta').get('key'); g.onsuccess = () => { ok(g.result); r.result.close(); }; }; });
    expect(key).toBeUndefined();
  });
});

describe('reading through the phone', () => {
  it('passes straight through when no day is open', async () => {
    const f = vi.fn(async () => 7);
    expect(await fieldRead('a', f)).toBe(7);
    expect(await cacheGet('a')).toBeUndefined();
  });
  it('saves what the server says, and falls back to it when the server fails or is slow', async () => {
    await beginDay('2026-10-30', 'w1');
    expect(await fieldRead('a', async () => 'fresh')).toBe('fresh');
    await new Promise(r => setTimeout(r, 20));                     // (saved in the background)
    expect(await fieldRead('a', async () => { throw new TypeError('Failed to fetch'); })).toBe('fresh');
    const t0 = Date.now();
    expect(await fieldRead('a', () => new Promise(() => undefined), 50)).toBe('fresh');   // server hangs → copy after the wait
    expect(Date.now() - t0).toBeLessThan(1000);
  });
  it('uses the copy straight away in a known dead zone, and still updates it in the background', async () => {
    await beginDay('2026-10-30', 'w1');
    await fieldRead('a', async () => 'v1'); await new Promise(r => setTimeout(r, 20));
    markOffline();
    let late: (v: string) => void = () => undefined;
    expect(await fieldRead('a', () => new Promise<string>(ok => { late = ok; }))).toBe('v1');
    late('v2'); await new Promise(r => setTimeout(r, 20));
    markOnline();
    expect(await fieldRead('a', () => new Promise(() => undefined), 10)).toBe('v2');
  });
  it('still reports real server errors', async () => {
    await beginDay('2026-10-30', 'w1');
    await fieldRead('a', async () => 1); await new Promise(r => setTimeout(r, 20));
    await expect(fieldRead('a', async () => { throw new Error('permission denied'); })).rejects.toThrow('permission denied');
  });
  it('with nothing saved yet, waits for the server like before', async () => {
    await beginDay('2026-10-30', 'w1');
    await expect(fieldRead('b', async () => { throw new TypeError('Failed to fetch'); })).rejects.toThrow();
  });
  it('wraps a service’s getters, keyed by their arguments', async () => {
    await beginDay('2026-10-30', 'w1');
    const svc = { n: 0, async get(id: string) { this.n++; return `row ${id}`; }, async other() { return 1; } };
    cacheMethods(svc, 'svc', ['get']);
    expect(await svc.get('x')).toBe('row x'); expect(await svc.get('y')).toBe('row y');
    await new Promise(r => setTimeout(r, 20));
    markOffline();
    expect(await svc.get('x')).toBe('row x');
    expect(svc.n).toBe(3);   // it still tried the server in the background
  });
});

describe('noticing a dead zone', () => {
  it('goes offline on a failed fetch, online on any answer', async () => {
    const bad = trackedFetch(async () => { throw new TypeError('Failed to fetch'); });
    await expect(bad('x')).rejects.toThrow(); expect(netState()).toBe('offline');
    const ok = trackedFetch(async () => new Response('no', { status: 500 }));
    await ok('x'); expect(netState()).toBe('online');
    expect(isNetworkError(new Error('permission denied'))).toBe(false);
  });
});

describe('phone-first (workers)', () => {
  it('shows the phone’s copy at once, then says when a newer answer has arrived', async () => {
    const { setReadMode, onFieldFresh } = await import('./cache');
    await beginDay('2026-10-30', 'w1');
    setReadMode('phoneFirst');
    const fresh: string[] = []; const off = onFieldFresh(k => fresh.push(k));
    expect(await fieldRead('sales', async () => ['A'])).toEqual(['A']);           // first time: from the server
    await new Promise(r => setTimeout(r, 20));
    let answer: (v: string[]) => void = () => undefined;
    const t0 = Date.now();
    expect(await fieldRead('sales', () => new Promise<string[]>(ok => { answer = ok; }))).toEqual(['A']);   // instantly, the copy
    expect(Date.now() - t0).toBeLessThan(200);
    answer(['A', 'B']); await new Promise(r => setTimeout(r, 30));
    expect(fresh).toEqual(['sales']);                                               // the screen is told to redraw
    expect(await fieldRead('sales', async () => ['A', 'B'])).toEqual(['A', 'B']);   // and the copy is now the new one
    await new Promise(r => setTimeout(r, 30));
    expect(fresh).toEqual(['sales']);                                               // same answer again: no redraw
    off(); setReadMode('serverFirst');
  });
});

describe('"nothing" from Supabase in a dead zone', () => {
  it('is not saved over the phone’s copy, and not shown instead of it', async () => {
    const { setReadMode, onFieldFresh } = await import('./cache');
    await beginDay('2026-10-30', 'w1');
    expect(await fieldRead('sales', async () => ['A', 'B'])).toEqual(['A', 'B']);
    await new Promise(r => setTimeout(r, 20));
    // no signal: the request fails underneath, and the service quietly returns [] instead of an error
    const quietlyEmpty = async () => { await trackedFetch(async () => { throw new TypeError('Failed to fetch'); })('x').catch(() => undefined); return []; };
    markOnline();
    expect(await fieldRead('sales', quietlyEmpty)).toEqual(['A', 'B']);                 // server-first: the copy
    setReadMode('phoneFirst');
    const fresh: string[] = []; const off = onFieldFresh(k => fresh.push(k));
    expect(await fieldRead('sales', quietlyEmpty)).toEqual(['A', 'B']);                 // phone-first: the copy
    await new Promise(r => setTimeout(r, 30));
    expect(fresh).toEqual([]);                                                        // and no redraw to empty
    expect((await cacheGet('sales'))?.value).toEqual(['A', 'B']);                     // the copy is untouched
    off(); setReadMode('serverFirst'); markOnline();
  });
});
