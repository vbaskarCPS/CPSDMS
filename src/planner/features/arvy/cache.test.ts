// Arvy's requests are cached: the fixed instructions (and the tools before them) and the conversation so far
// (supabase/functions/planner-arvy/tools.ts: system, cachedSystem, cachedMessages).
import { describe, expect, it } from 'vitest';
import { cachedMessages, cachedSystem, NOW_MARK, system } from '../../../../supabase/functions/planner-arvy/tools';

describe('cachedSystem', () => {
  it('the time, screen and notes come after the fixed part, which is cached and the same minute to minute', () => {
    const a = cachedSystem(system({ name: 'Vijay', username: 'vijay', today: '2026-11-13', weekday: 'Friday', now: '07:10', path: '/' } as never));
    const b = cachedSystem(system({ name: 'Vijay', username: 'vijay', today: '2026-11-13', weekday: 'Friday', now: '07:11', path: '/food' } as never));
    expect(a[0].cache_control).toEqual({ type: 'ephemeral' });
    expect(a[0].text).toBe(b[0].text);
    expect(a[0].text).not.toContain('07:10');
    expect(a[1].text).toContain('07:10');
    expect(a[1].cache_control).toBeUndefined();
    expect(a.map(x => x.text).join('')).not.toContain(NOW_MARK);
  });
  it('no mark: the whole text, cached', () => {
    expect(cachedSystem('plain')).toEqual([{ type: 'text', text: 'plain', cache_control: { type: 'ephemeral' } }]);
  });
});

describe('cachedMessages', () => {
  it('marks the last block of the last message, a string becoming a text block, without changing the input', () => {
    const msgs = [{ role: 'user', content: 'hi' }, { role: 'assistant', content: [{ type: 'text', text: 'yo' }] }, { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't', content: 'ok' }] }];
    const out = cachedMessages(msgs) as { content: Record<string, unknown>[] }[];
    expect(out[2].content[0].cache_control).toEqual({ type: 'ephemeral' });
    expect((msgs[2].content as Record<string, unknown>[])[0].cache_control).toBeUndefined();
    expect((cachedMessages([{ role: 'user', content: 'hello' }]) as { content: unknown }[])[0].content).toEqual([{ type: 'text', text: 'hello', cache_control: { type: 'ephemeral' } }]);
  });
  it('leaves empty text and thinking blocks alone', () => {
    const m = [{ role: 'user', content: '' }];
    expect(cachedMessages(m)).toBe(m);
  });
});
