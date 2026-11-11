// Arvy's improvements log and Arvy as the coach: what an entry holds, where it stands, and what the server is told.
import { describe, expect, it, vi } from 'vitest';
vi.mock('../../lib/docs', () => ({ getDocs: vi.fn(async () => []), putDoc: vi.fn() }));
import { entryOf, stageOf, type LogEntry } from './log';
import { cleanMessages, COACHING, isCoaching, system, toolsFor, TOOLS, type Msg } from '../../../../supabase/functions/planner-arvy/tools';

describe('Arvy’s improvements log', () => {
  it('an entry is open, trimmed, and keeps only what was given', () => {
    const e = entryOf({ type: 'request', title: '  log sets in my workout  ', question: 'x'.repeat(2000), tools: ['a', 'a', 'b'], detail: '   ' }, new Date('2026-11-10T20:00:00Z'));
    expect(e).toMatchObject({ type: 'request', title: 'log sets in my workout', status: 'open', at: '2026-11-10T20:00:00.000Z', tools: ['a', 'b'] });
    expect(e.question).toHaveLength(600);
    expect('detail' in e).toBe(false);
    expect(e.id).toMatch(/^[a-z0-9]+$/);
  });

  it('says where an entry stands', () => {
    const base: LogEntry = { id: 'a', at: '2026-11-10T20:00:00Z', type: 'bug', title: 't', status: 'open' };
    expect(stageOf(base).label).toBe('New');
    expect(stageOf({ ...base, investigated_at: 'x' }).label).toBe('Looked at');
    expect(stageOf({ ...base, investigated_at: 'x', pr: 'https://github.com/o/r/pull/1' }).label).toBe('Fix ready for review');
    expect(stageOf({ ...base, status: 'done', pr: 'y' }).label).toBe('Done');
  });
});

describe('Arvy is the coach', () => {
  it('has the coaching tools, and no Coach chat screen to open', () => {
    const names = toolsFor('night').map(t => t.name);
    expect(names).toEqual(expect.arrayContaining(['coaching_context', 'plan_workout', 'log_feedback', 'cant_do_yet']));
    const screens = (TOOLS.find(t => t.name === 'open_screen')!.input_schema as { properties: { path: { enum: string[] } } }).properties.path.enum;
    expect(screens).not.toContain('/workout/coach');
    expect(screens).toContain('/settings/arvy-log');
    expect(JSON.stringify(TOOLS) + system({ name: 'Vijay' }, true)).not.toMatch(/Coach Claude/);
  });

  it('gets the coaching rules only once the coaching context is in the conversation, and their notes always', () => {
    const plain = system({ name: 'Vijay', about: ['2026-11-01: Left shoulder pinches on overhead press'] });
    expect(plain).not.toContain('HOW TO COACH');
    expect(plain).toContain('Left shoulder pinches');
    expect(plain).toMatch(/coaching_context first/);
    expect(system({ name: 'Vijay' }, true)).toContain(COACHING);
    const msgs: Msg[] = [{ role: 'user', content: 'plan my session' },
      { role: 'assistant', content: [{ type: 'tool_use', id: 't1', name: 'coaching_context', input: {} }] },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: 'x' }] }];
    expect(isCoaching(msgs)).toBe(true);
    expect(isCoaching([{ role: 'user', content: 'what’s on the list?' }])).toBe(false);
  });

  it('the coaching context may be long; other tool answers are still trimmed', () => {
    const long = 'x'.repeat(50000);
    const out = cleanMessages([{ role: 'user', content: 'q' },
      { role: 'assistant', content: [{ type: 'tool_use', id: 'c', name: 'coaching_context', input: {} }, { type: 'tool_use', id: 'm', name: 'money', input: {} }] },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'c', content: long }, { type: 'tool_result', tool_use_id: 'm', content: long }] }])!;
    const results = out[2].content as { content: string }[];
    expect(results[0].content.length).toBe(37000);
    expect(results[1].content.length).toBe(14000);
  });
});
