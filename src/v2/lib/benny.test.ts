import { describe, expect, it } from 'vitest';
import { demoDue, speakable } from './benny';

describe('speakable', () => {
  it('reads the first sentences without markdown or list marks', () => {
    expect(speakable('**9 open prebooks** in Surrey, on 7 routes.\n- NSR64: 1\n- SES07: 2\nOpen Master Bookings for the list.'))
      .toBe('9 open prebooks in Surrey, on 7 routes. NSR64: 1. SES07: 2.');
  });
  it('keeps a short answer whole', () => {
    expect(speakable("Chris Hinch's cell is 780 202 8951.")).toBe("Chris Hinch's cell is 780 202 8951.");
  });
});

describe('the Benny’s voice', () => {
  it('is Google’s, from the server: the phone’s own voice is never used', async () => {
    const { readFileSync } = await import('node:fs');
    const lib = readFileSync(new URL('./benny.ts', import.meta.url), 'utf8');
    const panel = readFileSync(new URL('../features/benny/BennyPanel.tsx', import.meta.url), 'utf8');
    expect(lib + panel).not.toMatch(/speechSynthesis|SpeechSynthesisUtterance/);
    expect(lib).toContain("functions.invoke('benny-voice'");
    const fn = readFileSync(new URL('../../../supabase/functions/benny-voice/index.ts', import.meta.url), 'utf8');
    expect(fn).toContain('texttospeech.googleapis.com');
    expect(fn).toMatch(/BENNY_VOICE'\) \|\| 'Charon'/);   // a man's voice by default
  });
});

describe('the first-time demo', () => {
  it('comes up until it’s finished or skipped, three times at most', () => {
    expect(demoDue({ opens: 0, done: false })).toBe(true);
    expect(demoDue({ opens: 2, done: false })).toBe(true);
    expect(demoDue({ opens: 3, done: false })).toBe(false);
    expect(demoDue({ opens: 1, done: true })).toBe(false);
  });
});
