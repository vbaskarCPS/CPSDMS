// Listening waits for a real pause (PAUSE_MS) before it counts as finished: the phone's recogniser stops sooner, and is
// started again with what it hears added on (arvy.ts, listen).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const g = globalThis as unknown as Record<string, unknown>;   // no browser here: the page's window is the global, with quiet listeners
g.addEventListener ??= () => undefined; g.removeEventListener ??= () => undefined; g.window ??= globalThis;
vi.mock('../../lib/ai', () => ({ invoke: vi.fn() }));
vi.mock('./run', () => ({ runTool: vi.fn() }));
const { FIRST_WORD_MS, keepListening, listen, PAUSE_MS } = await import('./arvy');

describe('keepListening', () => {
  it('goes on through a pause shorter than 2.5 s, and stops after one that long', () => {
    expect(PAUSE_MS).toBe(2500);
    expect(keepListening(true, 0, 1000, 1000 + 2400)).toBe(true);
    expect(keepListening(true, 0, 1000, 1000 + 2500)).toBe(false);
  });
  it('before any words, waits longer for the first one', () => {
    expect(keepListening(false, 0, 0, FIRST_WORD_MS - 1)).toBe(true);
    expect(keepListening(false, 0, 0, FIRST_WORD_MS)).toBe(false);
  });
});

// a stand-in for the phone's recogniser: each one hears what the test says, and stops by itself when told
type Fake = { onresult: ((e: unknown) => void) | null; onend: (() => void) | null; onerror: ((e: unknown) => void) | null; start(): void; stop(): void; abort(): void; lang: string; interimResults: boolean; continuous: boolean };
let made: Fake[] = [];
beforeEach(() => {
  vi.useFakeTimers();
  made = [];
  class Rec implements Fake {
    onresult: Fake['onresult'] = null; onend: Fake['onend'] = null; onerror: Fake['onerror'] = null;
    lang = ''; interimResults = false; continuous = false;
    constructor() { made.push(this); }
    start() { /* listening */ }
    stop() { setTimeout(() => this.onend?.(), 0); }
    abort() { setTimeout(() => this.onend?.(), 0); }
  }
  (window as unknown as { SpeechRecognition: unknown }).SpeechRecognition = Rec;
});
afterEach(() => { vi.useRealTimers(); delete (window as unknown as { SpeechRecognition?: unknown }).SpeechRecognition; });
const hear = (r: Fake, words: string) => r.onresult?.({ results: [[{ transcript: words }]] });

describe('listen', () => {
  it('a short pause that stops the recogniser: it starts again and adds on; a long pause ends it', async () => {
    const seen: string[] = [];
    const l = listen(t => seen.push(t));
    hear(made[0], 'book the dentist');
    vi.advanceTimersByTime(800);
    made[0].onend?.();                 // the phone gave up after a short pause
    expect(made.length).toBe(2);       // …and was started again
    vi.advanceTimersByTime(900);
    hear(made[1], 'for Thursday');
    expect(seen[seen.length - 1]).toBe('book the dentist for Thursday');
    vi.advanceTimersByTime(PAUSE_MS + 300);   // a real pause: it stops
    const said = await l.done;
    expect(said).toBe('book the dentist for Thursday');
    expect(made.length).toBe(2);
  });
  it('stop() ends it with what was heard; cancel() with nothing', async () => {
    const a = listen(() => undefined); hear(made[0], 'hello'); a.stop(); vi.advanceTimersByTime(10);
    expect(await a.done).toBe('hello');
    const b = listen(() => undefined); hear(made[1], 'never mind'); b.cancel(); vi.advanceTimersByTime(10);
    expect(await b.done).toBe('');
  });
});
