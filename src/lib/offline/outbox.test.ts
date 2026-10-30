import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { _restart, beginDay, endDay } from './dayStore';
import { fieldRead, setReadMode } from './cache';
import { MAX_TRIES, _resetOutbox, _setSendWait, defineSave, flush, save, waitingCount } from './outbox';
import { markOffline, markOnline } from './net';

const NO_SIGNAL = () => Promise.reject(new TypeError('Failed to fetch'));
let server: { sent: unknown[][]; next: () => Promise<unknown> };

beforeEach(async () => {
  await _restart(); _resetOutbox();
  await new Promise(ok => { const r = indexedDB.deleteDatabase('cps-field'); r.onsuccess = r.onerror = r.onblocked = () => ok(null); });
  markOnline(); setReadMode('serverFirst');
  server = { sent: [], next: async () => 'ok' };
  defineSave<[string], string>('t.sale', {
    send: async (...a) => { const r = await server.next(); server.sent.push(a); return r as string; },
    optimistic: ([name]) => `saved on phone: ${name}`,
    overlay: (key, value, [name]) => (key.startsWith('sales:') && Array.isArray(value) && !value.includes(name) ? [...value, name] : value),
    sanitize: ([name]) => [name.replace(/\d{12}(\d{4})/, '••••$1')],
  });
});
const workerDay = async () => { await beginDay('2026-10-30', 'worker:w1'); setReadMode('phoneFirst'); };
const tick = (ms = 20) => new Promise(r => setTimeout(r, ms));

describe('saving in spotty service', () => {
  it('route managers and office desktops: straight to the server, never the outbox', async () => {
    server.next = NO_SIGNAL;
    await expect(save('t.sale', ['A'])).rejects.toThrow();
    await beginDay('2026-10-30', 'rm:r1'); setReadMode('serverFirst');
    await expect(save('t.sale', ['A'])).rejects.toThrow();
    expect(waitingCount()).toBe(0);
  });
  it('with signal, a worker’s save goes straight through', async () => {
    await workerDay();
    expect(await save('t.sale', ['A'])).toBe('ok');
    expect(waitingCount()).toBe(0);
  });
  it('no signal: kept on the phone, shown at once, sent when signal returns', async () => {
    await workerDay();
    server.next = NO_SIGNAL;
    expect(await save('t.sale', ['Jane'])).toBe('saved on phone: Jane');
    expect(waitingCount()).toBe(1);
    // the screens see it already
    expect(await fieldRead('sales:["s1"]', async () => ['Bob'])).toEqual(['Bob', 'Jane']);
    // signal back
    server.next = async () => 'ok'; markOnline();
    await flush();
    expect(server.sent).toEqual([['Jane']]);
    expect(waitingCount()).toBe(0);
  });
  it('keeps saves in order behind anything already waiting', async () => {
    await workerDay();
    server.next = NO_SIGNAL;
    await save('t.sale', ['first']);
    server.next = async () => 'ok';
    expect(await save('t.sale', ['second'])).toBe('saved on phone: second');   // waits in line even with signal
    await flush();
    expect(server.sent).toEqual([['first'], ['second']]);
  });
  it('a slow server: kept on the phone too, and told it may have landed already', async () => {
    await workerDay();
    _setSendWait(50);
    const retried = vi.fn();
    defineSave<[string], string>('t.slow', { send: () => new Promise(() => undefined), beforeRetry: retried, optimistic: () => 'later' });
    expect(await save('t.slow', ['X'])).toBe('later');
    expect(waitingCount()).toBe(1);
    defineSave<[string], string>('t.slow', { send: async () => 'ok', beforeRetry: retried });
    await flush();
    expect(retried).toHaveBeenCalled();          // e.g. no second receipt
    expect(waitingCount()).toBe(0);
  });
  it('the server saying no is still shown on the screen (not hidden in the outbox)', async () => {
    await workerDay();
    server.next = async () => { throw new Error('not allowed'); };
    await expect(save('t.sale', ['A'])).rejects.toThrow('not allowed');
    expect(waitingCount()).toBe(0);
  });
  it('a save the server keeps refusing is set aside after a few tries; the rest still go', async () => {
    await workerDay();
    server.next = NO_SIGNAL;
    await save('t.sale', ['bad']); await save('t.sale', ['good']);
    server.next = async () => { throw new Error('refused'); };
    for (let i = 0; i < MAX_TRIES; i++) await flush();
    server.next = async () => 'ok';
    await flush();
    expect(server.sent).toEqual([['good']]);
    expect(waitingCount()).toBe(1);               // the refused one is still on the phone (yellow)
  });
  it('never keeps a card number on the phone', async () => {
    await workerDay();
    server.next = NO_SIGNAL;
    await save('t.sale', ['card 4111111111111234']);
    await _restart(); _resetOutbox();             // read back what's stored
    const { outboxAll } = await import('./dayStore');
    const rows = await outboxAll<{ args: string[] }>();
    expect(rows[0].value.args[0]).toBe('card ••••1234');
  });
  it('work still waiting survives a wipe and a restart, and goes once signal returns', async () => {
    await workerDay();
    server.next = NO_SIGNAL;
    await save('t.sale', ['kept']);
    await endDay();                                // signed out with work still waiting
    await _restart(); _resetOutbox();
    server.next = async () => 'ok';
    await flush();
    expect(server.sent).toEqual([['kept']]);
    expect(waitingCount()).toBe(0);
    const key = await new Promise(ok => { const r = indexedDB.open('cps-field'); r.onsuccess = () => { const g = r.result.transaction('meta').objectStore('meta').get('key'); g.onsuccess = () => { ok(g.result); r.result.close(); }; }; });
    expect(key).toBeUndefined();                   // and then the key goes
  });
  it('a known dead zone doesn’t even try the server', async () => {
    await workerDay();
    const send = vi.fn(async () => 'ok');
    defineSave<[string], string>('t.x', { send, optimistic: () => 'phone' });
    markOffline();
    expect(await save('t.x', ['A'])).toBe('phone');
    expect(send).not.toHaveBeenCalled();
    await tick();
  });
});
