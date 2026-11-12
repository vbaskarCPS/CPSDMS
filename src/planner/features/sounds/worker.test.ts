// The notification worker (public/planner-push-sw.js) and Settings › Sounds: the real worker file, run here with a
// pretend phone around it, decides whether each push comes with the phone's sound. It must agree with the app
// (choice.ts) on every kind, fail towards a sound, and otherwise show notifications exactly as before.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';
import { cleanSounds, kindOfPush } from './choice';

const SRC = readFileSync(resolve(__dirname, '../../../../public/planner-push-sw.js'), 'utf8');
const SCOPE = 'https://example.test/vijayplanner/push/';

type Shown = { title: string; opts: Record<string, unknown> };
/** The worker, loaded fresh, with `stored` as what the app put in Cache Storage (undefined = nothing there,
 *  'broken' = there but unreadable, 'no-caches' = this phone has no Cache Storage). */
function worker(stored?: unknown) {
  const listeners: Record<string, (e: unknown) => void> = {};
  const shown: Shown[] = [];
  const posted: unknown[] = [];
  const caches = stored === 'no-caches' ? undefined : {
    open: async (name: string) => ({
      match: async (url: string) => {
        if (name !== 'planner-sounds' || url !== `${SCOPE}sounds.json` || stored === undefined) return undefined;
        return { json: async () => { if (stored === 'broken') throw new Error('bad json'); return stored; } };
      },
    }),
  };
  const self: Record<string, unknown> = {
    addEventListener: (t: string, fn: (e: unknown) => void) => { listeners[t] = fn; },
    skipWaiting: () => undefined,
    location: { origin: 'https://example.test' },
    registration: {
      scope: SCOPE,
      getNotifications: async () => [],
      showNotification: async (title: string, opts: Record<string, unknown>) => { shown.push({ title, opts }); },
    },
    clients: { matchAll: async () => [{ postMessage: (m: unknown) => posted.push(m) }] },
  };
  runInNewContext(SRC, { self, caches, URL, Date, Promise, console });
  const push = async (d: Record<string, unknown>) => {
    let wait: Promise<unknown> = Promise.resolve();
    listeners.push({ data: { json: () => d, text: () => '' }, waitUntil: (p: Promise<unknown>) => { wait = p; } });
    await wait;
    return shown[shown.length - 1];
  };
  return { push, shown, posted, sound: self.plannerSound as { soundKind: (d: unknown) => string } };
}

const choice = (closed: Partial<Record<'chat' | 'arvy' | 'other', boolean>>) =>
  cleanSounds(Object.fromEntries(Object.entries(closed).map(([k, v]) => [k, { closed: v }])));

describe('the worker and the app agree on the kind', () => {
  it('for every push the planner sends', () => {
    const w = worker();
    const pushes: [string, string][] = [['chat', 'Rosh'], ['chat', 'Vijay'], ['chat', 'Arvy'], ['arvy-p1', 'Arvy'], ['mail', 'Arvy'], ['news', 'Planner'],
      ['test', 'Planner'], ['wake', 'Planner'], ['evening', 'Planner'], ['bed', 'Planner'], ['sauna', 'Planner'], ['gym', 'Planner'], ['kitchen', 'Planner'],
      ['window', 'Planner'], ['lightsOut', 'Planner'], ['x:k1', 'Planner'], ['', 'Planner']];
    for (const [tag, title] of pushes) expect(w.sound.soundKind({ tag, title })).toBe(kindOfPush(tag, title));
  });
});

describe('silent or not, when the planner is closed', () => {
  it('switched off for the chat: Rosh’s message shows silently, without a buzz; a reminder still sounds', async () => {
    const w = worker(choice({ chat: false }));
    const m = await w.push({ title: 'Rosh', body: 'home soon', tag: 'chat' });
    expect(m.opts.silent).toBe(true);
    expect(m.opts.vibrate).toBeUndefined();
    expect(m.opts.tag).toBe('chat');
    expect(m.opts.renotify).toBe(true);
    const r = await w.push({ title: 'Planner', body: 'Lights out.', tag: 'bed' });
    expect(r.opts.silent).toBeUndefined();
    expect(r.opts.vibrate).toEqual([70, 50, 70]);
  });
  it('switched off for Arvy: its answer in the chat and its “tap to confirm” are silent; Rosh’s message is not', async () => {
    const w = worker(choice({ arvy: false }));
    expect((await w.push({ title: 'Arvy', body: 'Booked.', tag: 'chat' })).opts.silent).toBe(true);
    expect((await w.push({ title: 'Arvy', body: 'Add milk? Tap to confirm.', tag: 'arvy-p9' })).opts.silent).toBe(true);
    expect((await w.push({ title: 'Rosh', body: 'hi', tag: 'chat' })).opts.silent).toBeUndefined();
  });
  it('everything else switched off: reminders, news and email to-dos are silent', async () => {
    const w = worker(choice({ other: false }));
    for (const tag of ['wake', 'news', 'mail', 'x:k1']) expect((await w.push({ title: 'Planner', body: 'b', tag })).opts.silent).toBe(true);
    expect((await w.push({ title: 'Rosh', body: 'hi', tag: 'chat' })).opts.silent).toBeUndefined();
  });
  it('all on (as to start with): nothing silent, shown exactly as before', async () => {
    const w = worker(cleanSounds(null));
    const m = await w.push({ title: 'Planner', body: 'Up.', tag: 'wake', url: '/vijayplanner/' });
    expect(m).toEqual({ title: 'Planner', opts: expect.objectContaining({ body: 'Up.', tag: 'wake', renotify: true, vibrate: [70, 50, 70], data: { url: '/vijayplanner/' } }) });
    expect('silent' in m.opts).toBe(false);
  });
  it('when the choice can’t be read, the phone makes its sound', async () => {
    for (const stored of [undefined, 'broken', 'no-caches', null, { chat: 'off' }]) {
      const w = worker(stored);
      expect((await w.push({ title: 'Rosh', body: 'hi', tag: 'chat' })).opts.silent).toBeUndefined();
    }
  });
  it('open pages still hear that a push arrived', async () => {
    const w = worker(choice({ chat: false }));
    await w.push({ title: 'Rosh', body: 'hi', tag: 'chat' });
    expect(w.posted).toEqual([{ type: 'push-arrived', tag: 'chat' }]);
  });
});
