// Settings › Sounds: the sounds themselves (sounds.ts) and which one goes with which notification (choice.ts).
import { describe, expect, it } from 'vitest';
import { DEFAULT_SOUNDS, GAP_MS, KINDS, cleanSounds, freshArrivals, kindOfMessage, kindOfPush, makeGate } from './choice';
import { NO_SOUND, SOUNDS, soundLength, soundOf } from './sounds';

describe('the sounds', () => {
  it('six to eight of them, each with its own id and a name', () => {
    expect(SOUNDS.length).toBeGreaterThanOrEqual(6);
    expect(SOUNDS.length).toBeLessThanOrEqual(8);
    expect(new Set(SOUNDS.map(s => s.id)).size).toBe(SOUNDS.length);
    expect(new Set(SOUNDS.map(s => s.name)).size).toBe(SOUNDS.length);
    expect(SOUNDS.some(s => s.id === NO_SOUND)).toBe(false);
  });
  it('each one is short: over in under 1.2 seconds', () => {
    for (const s of SOUNDS) { expect(soundLength(s.id)).toBeGreaterThan(0.1); expect(soundLength(s.id)).toBeLessThan(1.2); }
    expect(soundLength(NO_SOUND)).toBe(0);
  });
  it('gentle: no note louder than a fifth of full volume, all within hearing', () => {
    for (const s of SOUNDS) for (const n of s.notes) {
      expect(n.gain).toBeGreaterThan(0); expect(n.gain).toBeLessThanOrEqual(0.2);
      expect(n.hz).toBeGreaterThan(100); expect(n.hz).toBeLessThan(5000);
    }
  });
  it('no two sound alike: each has its own notes', () => {
    const shapes = SOUNDS.map(s => JSON.stringify(s.notes.map(n => [n.at, n.hz, n.to ?? 0, n.wave ?? 'sine'])));
    expect(new Set(shapes).size).toBe(SOUNDS.length);
  });
});

describe('which kind a notification is', () => {
  it('a chat message from the other one is the chat; Arvy’s answer in the chat (same tag, titled Arvy) is Arvy', () => {
    expect(kindOfPush('chat', 'Rosh')).toBe('chat');
    expect(kindOfPush('chat', 'Vijay')).toBe('chat');
    expect(kindOfPush('chat', 'Arvy')).toBe('arvy');
  });
  it('Arvy’s “tap to confirm” ones are Arvy', () => {
    expect(kindOfPush('arvy-p1a2b3', 'Arvy')).toBe('arvy');
    expect(kindOfPush('arvy-x')).toBe('arvy');
  });
  it('reminders, what’s new, email to-dos, the check: everything else', () => {
    for (const tag of ['wake', 'evening', 'bed', 'sauna', 'gym', 'kitchen', 'window', 'lightsOut', 'x:k1', 'news', 'test', 'check-here', '', undefined]) expect(kindOfPush(tag, 'Planner')).toBe('other');
    expect(kindOfPush('mail', 'Arvy')).toBe('other');   // titled Arvy, but it is about email
  });
  it('a message in the chat list: Arvy’s own, or the other one’s', () => {
    expect(kindOfMessage('arvy')).toBe('arvy');
    expect(kindOfMessage('rosh')).toBe('chat');
  });
});

describe('the choice', () => {
  it('to start with: the chat, Arvy and the rest each a different sound, and the phone’s sound on when closed', () => {
    const p = cleanSounds(undefined);
    expect(p).toEqual(DEFAULT_SOUNDS);
    expect(new Set(KINDS.map(k => p[k].sound)).size).toBe(3);
    for (const k of KINDS) { expect(soundOf(p[k].sound)).toBeTruthy(); expect(p[k].closed).toBe(true); }
  });
  it('a choice saved half-way, or by an older copy, keeps what makes sense and fills in the rest', () => {
    expect(cleanSounds({ chat: { sound: 'pop' }, arvy: { closed: false }, other: 'bell' })).toEqual({
      chat: { sound: 'pop', closed: true }, arvy: { sound: 'sparkle', closed: false }, other: DEFAULT_SOUNDS.other,
    });
    expect(cleanSounds({ chat: { sound: 'gone-sound', closed: 'no' } }).chat).toEqual(DEFAULT_SOUNDS.chat);
    expect(cleanSounds({ other: { sound: 'none', closed: false } }).other).toEqual({ sound: 'none', closed: false });
    expect(cleanSounds('rubbish')).toEqual(DEFAULT_SOUNDS);
  });
});

describe('not too often', () => {
  it('once every 3 seconds for each kind, whatever else sounds', () => {
    const ok = makeGate();
    expect(ok('chat', 1000)).toBe(true);
    expect(ok('chat', 1000 + GAP_MS - 1)).toBe(false);
    expect(ok('arvy', 1500)).toBe(true);    // another kind isn't held back
    expect(ok('chat', 1000 + GAP_MS)).toBe(true);
    expect(ok('chat', 1000 + GAP_MS + 10)).toBe(false);
  });
});

describe('which chat messages sound', () => {
  const at = (ms: number) => new Date(ms).toISOString();
  const row = (id: string, by: string, ms: number, sending = false) => ({ msg: { id, at: at(ms), by }, sending });
  it('nothing in the list the planner opens with', () => {
    const seen = new Set<string>();
    expect(freshArrivals([row('a', 'rosh', 1e12), row('b', 'arvy', 1e12)], seen, 'vijay', 1e12, true)).toEqual([]);
    expect(freshArrivals([row('a', 'rosh', 1e12), row('b', 'arvy', 1e12)], seen, 'vijay', 1e12, false)).toEqual([]);   // …and not later either
  });
  it('a new one from the other one, and Arvy’s answer: each once', () => {
    const seen = new Set<string>(), t = 1e12;
    freshArrivals([], seen, 'vijay', t, true);
    expect(freshArrivals([row('a', 'rosh', t + 10)], seen, 'vijay', t, false)).toEqual(['chat']);
    expect(freshArrivals([row('a', 'rosh', t + 10), row('b', 'arvy', t + 20)], seen, 'vijay', t, false)).toEqual(['arvy']);
    expect(freshArrivals([row('a', 'rosh', t + 10), row('b', 'arvy', t + 20)], seen, 'vijay', t, false)).toEqual([]);
  });
  it('never their own message: not while it is on its way, not once it is saved', () => {
    const seen = new Set<string>(), t = 1e12;
    expect(freshArrivals([row('local-1', 'vijay', t + 5, true)], seen, 'vijay', t, false)).toEqual([]);
    expect(freshArrivals([row('m1', 'vijay', t + 5)], seen, 'vijay', t, false)).toEqual([]);
  });
  it('not the ones that came while the page was hidden: the phone’s notification had those', () => {
    const seen = new Set<string>(), t = 1e12;
    expect(freshArrivals([row('a', 'rosh', t - 60_000), row('b', 'rosh', t + 1000)], seen, 'vijay', t, false)).toEqual(['chat']);
  });
});
