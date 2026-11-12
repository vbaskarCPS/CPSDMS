// Sounds while the planner is open (store.ts): one sound for each arrival, from one path only; none for their own
// message, none while hidden, none before the first tap; and the copy of the choice the notification worker reads.
import { beforeEach, describe, expect, it, vi } from 'vitest';

// ── a pretend phone ──
type Fn = (e?: unknown) => void;
const on = (box: Record<string, Fn[]>) => ({
  addEventListener: (t: string, fn: Fn) => { (box[t] ||= []).push(fn); },
  removeEventListener: (t: string, fn: Fn) => { box[t] = (box[t] || []).filter(f => f !== fn); },
});
const winL: Record<string, Fn[]> = {}, docL: Record<string, Fn[]> = {}, swL: Record<string, Fn[]> = {};
const fire = (box: Record<string, Fn[]>, t: string, e?: unknown) => { for (const f of [...(box[t] || [])]) f(e); };
const played: string[] = [];   // the sounds played, in order
const contexts: { state: string }[] = [];
class FakeAudio {
  state = 'suspended'; currentTime = 0; destination = {};
  constructor() { contexts.push(this); }
  resume() { this.state = 'running'; return Promise.resolve(); }
  createOscillator() { return { type: '', frequency: { setValueAtTime: () => undefined, exponentialRampToValueAtTime: () => undefined }, connect: () => undefined, start: () => undefined, stop: () => undefined }; }
  createGain() { return { gain: { setValueAtTime: () => undefined, exponentialRampToValueAtTime: () => undefined }, connect: () => undefined }; }
}
const store = new Map<string, string>();
const cached = new Map<string, string>();
vi.stubGlobal('window', { ...on(winL), AudioContext: FakeAudio });
vi.stubGlobal('document', { visibilityState: 'visible', ...on(docL) });
vi.stubGlobal('navigator', { serviceWorker: on(swL) });
vi.stubGlobal('location', { origin: 'https://example.test', pathname: '/vijayplanner/' });
vi.stubGlobal('localStorage', { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => { store.set(k, v); } });
vi.stubGlobal('caches', { open: async () => ({ put: async (url: string, r: Response) => { cached.set(url, await r.text()); } }) });

// ── the chat, as us.ts keeps it ──
let rows: { key: string; msg: { id: string; at: string; by: string; name: string }; sending?: boolean }[] = [];
let loaded = false;
const usWatchers = new Set<() => void>();
const tellUs = () => { for (const f of usWatchers) f(); };
const refreshUs = vi.fn(async () => undefined);
const putDoc = vi.fn(async (..._a: unknown[]) => undefined);
vi.mock('../../lib/auth', () => ({ getPass: () => ({ token: 't', user: { id: 'u1', username: 'vijay', display_name: 'Vijay', settings: {} } }) }));
vi.mock('../../lib/app', () => ({ isDemo: () => false }));
vi.mock('../../lib/docs', () => ({ getDoc: async () => null, putDoc: (...a: unknown[]) => putDoc(...a) }));
vi.mock('../../lib/push', () => ({ pushScope: () => '/vijayplanner/push/' }));
vi.mock('./sounds', async real => {
  const m = await real<typeof import('./sounds')>();
  return { ...m, playOn: (ctx: AudioContext, id: string) => { m.playOn(ctx, id); played.push(id); } };   // the real one, on the pretend clock
});
vi.mock('../us/us', () => ({ onUs: (f: () => void) => { usWatchers.add(f); return () => usWatchers.delete(f); }, refreshUs: () => refreshUs(), usLoaded: () => loaded, usRows: () => rows }));
const { hear, playSound, setChoice, soundPrefs, startSounds } = await import('./store');

const msg = (id: string, by: string, ms = Date.now()) => ({ key: `${new Date(ms).toISOString()}~${id}`, msg: { id, at: new Date(ms).toISOString(), by, name: by } });
let stop: () => void = () => undefined;
let clock = Date.parse('2026-11-11T12:00:00Z');   // each test a minute later: the 3-second limit doesn't carry over
beforeEach(() => {
  stop(); played.length = 0; rows = []; loaded = false; refreshUs.mockClear();
  (document as { visibilityState: string }).visibilityState = 'visible';
  vi.useFakeTimers(); clock += 60_000; vi.setSystemTime(clock);
  stop = startSounds();
});

describe('before the first tap', () => {
  it('nothing plays and nothing goes wrong; the first tap anywhere wakes the sound, once', () => {
    loaded = true; tellUs();
    rows = [msg('a', 'rosh')]; tellUs();
    expect(played).toEqual([]);
    fire(winL, 'pointerdown');
    expect(contexts.at(-1)?.state).toBe('running');
    expect(winL.pointerdown?.length ?? 0).toBe(0);
  });
});

describe('sounds while the planner is open', () => {
  const ready = () => { fire(winL, 'pointerdown'); loaded = true; tellUs(); vi.advanceTimersByTime(4000); };
  it('a message from Rosh: the chat’s sound, once, however often the list is drawn', () => {
    ready();
    rows = [msg('a', 'rosh')]; tellUs(); tellUs();
    vi.advanceTimersByTime(4000); tellUs();
    expect(played).toEqual([soundPrefs().chat.sound]);
  });
  it('Arvy’s answer in the chat: Arvy’s sound', () => {
    ready();
    rows = [msg('b', 'arvy')]; tellUs();
    expect(played).toEqual([soundPrefs().arvy.sound]);
  });
  it('their own message: no sound', () => {
    ready();
    rows = [{ ...msg('local-1', 'vijay'), sending: true }]; tellUs();
    rows = [msg('m1', 'vijay')]; tellUs();
    expect(played).toEqual([]);
  });
  it('a chat push only makes the list look again: the sound comes with the message, so it sounds once', () => {
    ready();
    fire(swL, 'message', { data: { type: 'push-arrived', tag: 'chat' } });
    expect(refreshUs).toHaveBeenCalledTimes(1);
    expect(played).toEqual([]);
    rows = [msg('c', 'rosh')]; tellUs();
    expect(played).toHaveLength(1);
  });
  it('a reminder or Arvy’s “tap to confirm” sounds when the worker says it arrived', () => {
    ready();
    fire(swL, 'message', { data: { type: 'push-arrived', tag: 'bed' } });
    fire(swL, 'message', { data: { type: 'push-arrived', tag: 'arvy-p1' } });
    expect(played).toEqual([soundPrefs().other.sound, soundPrefs().arvy.sound]);
  });
  it('three messages in a row: one sound; another one 3 seconds on: another', () => {
    ready();
    rows = [msg('a', 'rosh')]; tellUs();
    rows = [...rows, msg('b', 'rosh')]; tellUs();
    vi.advanceTimersByTime(1000);
    rows = [...rows, msg('c', 'rosh')]; tellUs();
    expect(played).toHaveLength(1);
    vi.advanceTimersByTime(3000);
    rows = [...rows, msg('d', 'rosh')]; tellUs();
    expect(played).toHaveLength(2);
  });
  it('not while the page is hidden (the phone’s notification covers it), nor for the ones that came then', () => {
    ready();
    (document as { visibilityState: string }).visibilityState = 'hidden';
    expect(hear('other')).toBe(false);
    rows = [msg('a', 'rosh')];
    vi.advanceTimersByTime(60_000);
    (document as { visibilityState: string }).visibilityState = 'visible'; fire(docL, 'visibilitychange');
    tellUs();
    expect(played).toEqual([]);
  });
  it('“None” plays nothing', async () => {
    ready();
    await setChoice('chat', { sound: 'none' });
    rows = [msg('a', 'rosh')]; tellUs();
    expect(played).toEqual([]);
    await setChoice('chat', { sound: 'chime' });
  });
  it('a play button plays the sound it is next to', () => {
    playSound('drop');
    expect(played).toEqual(['drop']);
  });
});

describe('the copy the notification worker reads', () => {
  it('written under the worker’s own address when the planner starts and whenever the choice changes, and saved in their docs', async () => {
    await vi.waitFor(() => expect(cached.has('https://example.test/vijayplanner/push/sounds.json')).toBe(true));
    await setChoice('arvy', { closed: false });
    expect(JSON.parse(cached.get('https://example.test/vijayplanner/push/sounds.json')!).arvy).toEqual({ sound: 'sparkle', closed: false });
    expect(putDoc).toHaveBeenLastCalledWith('prefs', 'sounds', expect.objectContaining({ arvy: { sound: 'sparkle', closed: false } }));
    await setChoice('arvy', { closed: true });
  });
});
