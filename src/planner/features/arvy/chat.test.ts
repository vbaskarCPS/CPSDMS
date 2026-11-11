// Arvy's chat is kept between visits, and the first load brings the old Coach chat over (once, leaving it untouched).
import { beforeEach, describe, expect, it, vi } from 'vitest';

const store = new Map<string, unknown>();
vi.mock('../../lib/docs', () => ({
  getDoc: async (kind: string, key: string) => structuredClone(store.get(`${kind}|${key}`) ?? null),
  putDoc: async (kind: string, key: string, data: unknown) => { store.set(`${kind}|${key}`, structuredClone(data)); },
}));
const { fromCoach, lean, loadChat, newer, saveChat, flushChat, KEEP, KEEP_THUMBS } = await import('./chat');

const coach = { messages: [
  { role: 'user', content: 'Plan my next session', at: '2026-11-09T22:00:00.000Z' },
  { role: 'assistant', content: 'Upper pull:\nLat pulldown: 3 x 8-10', at: '2026-11-09T22:00:20.000Z' },
  { role: 'system', content: 'ignored' }, { role: 'user', content: '   ' }, null,
] };
beforeEach(() => { store.clear(); });

describe('Arvy’s chat history', () => {
  it('turns Coach messages into chat lines, skipping anything that isn’t one', () => {
    const lines = fromCoach(coach.messages);
    expect(lines).toEqual([
      { role: 'user', text: 'Plan my next session', at: '2026-11-09T22:00:00.000Z', old: true },
      { role: 'assistant', text: 'Upper pull:\nLat pulldown: 3 x 8-10', at: '2026-11-09T22:00:20.000Z', old: true },
    ]);
    expect(fromCoach(undefined)).toEqual([]);
    expect(fromCoach(Array.from({ length: 90 }, (_, i) => ({ role: 'user', content: `m${i}` })))).toHaveLength(KEEP);
  });

  it('carries the Coach chat over on the first load only, and leaves the old chat as it was', async () => {
    store.set('coachchat|current', coach);
    const first = await loadChat();
    expect(first.carried).toBe(true);
    expect(first.lines.map(l => l.text)).toEqual(['Plan my next session', 'Upper pull:\nLat pulldown: 3 x 8-10']);
    expect(store.get('coachchat|current')).toEqual(coach);
    expect((store.get('arvychat|current') as { from_coach: number }).from_coach).toBe(2);
    // "Start over" saves an empty chat: the old one doesn't come back
    saveChat([]); await flushChat();
    const again = await loadChat();
    expect(again).toEqual({ lines: [], carried: false });
  });

  it('with no Coach chat, starts empty and remembers what’s said', async () => {
    expect(await loadChat()).toEqual({ lines: [], carried: false });
    const said = [{ role: 'user' as const, text: 'hi', at: '2026-11-10T20:00:00.000Z' }, { role: 'assistant' as const, text: 'Hi Vijay!', at: '2026-11-10T20:00:02.000Z', used: ['today_overview'] }];
    saveChat(said); await flushChat();
    expect((await loadChat()).lines).toEqual(said);
  });

  it('between this tab’s copy and the saved one, keeps the one talked in last', () => {
    const a = [{ role: 'user' as const, text: 'a', at: '2026-11-10T20:00:00.000Z' }];
    const b = [{ role: 'user' as const, text: 'b', at: '2026-11-10T21:00:00.000Z' }];
    expect(newer(a, b)).toBe(b);
    expect(newer(b, a)).toBe(b);
    expect(newer([], a)).toBe(a);
    expect(newer(a, [])).toBe(a);
  });
});

describe('pictures in the saved chat', () => {
  const line = (i: number, thumbs?: string[]) => ({ role: 'user' as const, text: `q${i}`, at: `2026-11-11T20:${String(i).padStart(2, '0')}:00.000Z`, ...(thumbs ? { pics: { n: thumbs.length, thumbs } } : {}) });
  it('keeps the small previews for the latest few questions with pictures; older ones keep only the count', () => {
    const lines = Array.from({ length: 10 }, (_, i) => line(i, i % 2 ? undefined : ['data:image/jpeg;base64,AA', 'data:image/jpeg;base64,BB']));
    const out = lean(lines, 3);
    expect(out.map(l => (l.pics ? (l.pics.thumbs ? 'thumbs' : `count ${l.pics.n}`) : '-'))).toEqual(['count 2', '-', 'count 2', '-', 'thumbs', '-', 'thumbs', '-', 'thumbs', '-']);
    expect(lines[0].pics?.thumbs).toHaveLength(2);   // the chat on screen isn't touched
    expect(KEEP_THUMBS).toBeGreaterThan(0);
  });
  it('is what gets saved', async () => {
    store.set('arvychat|current', { lines: [], updatedAt: 'x' });
    saveChat(Array.from({ length: KEEP_THUMBS + 2 }, (_, i) => line(i, ['data:image/jpeg;base64,AA'])));
    await flushChat();
    const saved = (store.get('arvychat|current') as { lines: { pics?: { n: number; thumbs?: string[] } }[] }).lines;
    expect(saved.filter(l => l.pics?.thumbs).length).toBe(KEEP_THUMBS);
    expect(saved.slice(0, 2).map(l => l.pics)).toEqual([{ n: 1 }, { n: 1 }]);
  });
});
