// Arvy: what the server accepts, which tools each person gets, what it's told, and the chat history it sends.
import { describe, expect, it, vi } from 'vitest';
import { cleanMessages, speakable, system, toolsFor, voiceFor, SCREENS, TOOLS } from '../../../../supabase/functions/planner-arvy/tools';

vi.mock('../../lib/ai', () => ({ invoke: vi.fn() }));
vi.mock('./run', () => ({ runTool: vi.fn() }));
const { history, TOOL_LABEL } = await import('./arvy');

describe('Arvy tools', () => {
  it('gives the cycle tool only to the morning profile (Rosh)', () => {
    expect(toolsFor('night').map(t => t.name)).not.toContain('cycle');
    expect(toolsFor('morning').map(t => t.name)).toContain('cycle');
  });
  it('has a label for every tool, and open_screen only offers real screens', () => {
    for (const t of TOOLS) expect(TOOL_LABEL[t.name]).toBeTruthy();
    const open = TOOLS.find(t => t.name === 'open_screen')!;
    expect((open.input_schema as { properties: { path: { enum: string[] } } }).properties.path.enum).toEqual(Object.keys(SCREENS));
  });
  it('picks a woman’s voice for Rosh and a man’s for Vijay, overridable', () => {
    expect(voiceFor('morning')).toBe('Aoede');
    expect(voiceFor('night')).toBe('Puck');
    expect(voiceFor('morning', { morning: 'Kore' })).toBe('Kore');
  });
});

describe('what Arvy is told', () => {
  it('names the person, the household and the day, and says it can’t change things yet', () => {
    const s = system({ name: 'Rosh', username: 'rosh', today: '2026-11-10', weekday: 'Tuesday', now: '4:05 PM', path: '/money' });
    expect(s).toContain('Arvy');
    expect(s).toContain('talking with Rosh');
    expect(s).toContain('Vijay');
    expect(s).toContain('Tuesday 2026-11-10');
    expect(s).toContain('cant_do_yet');
    expect(s).not.toContain('was spoken');
    expect(system({ name: 'Vijay', spoken: true })).toContain('was spoken');
  });
});

describe('what the server accepts', () => {
  it('keeps text, known tool calls and their results, and ends on the person’s side', () => {
    const m = cleanMessages([
      { role: 'user', content: 'how’s my day?' },
      { role: 'assistant', content: [{ type: 'text', text: 'Let me look.' }, { type: 'tool_use', id: 't1', name: 'today_overview', input: {} }, { type: 'tool_use', id: 't2', name: 'drop_tables', input: {} }] },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: '{"todos":[]}' }] },
    ], 'night')!;
    expect(m).toHaveLength(3);
    expect((m[1].content as { name?: string }[]).filter(b => b.name).map(b => b.name)).toEqual(['today_overview']);
    expect(cleanMessages([{ role: 'user', content: 'hi' }, { role: 'assistant', content: 'hello' }], 'night')).toBeNull();
    expect(cleanMessages('nope', 'night')).toBeNull();
  });
  it('refuses the cycle tool for Vijay, and never starts mid tool call', () => {
    const m = cleanMessages([
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'x', content: 'old' }] },
      { role: 'user', content: 'and now?' },
    ], 'night')!;
    expect(m[0].content).toBe('and now?');
    const c = cleanMessages([{ role: 'user', content: 'q' }, { role: 'assistant', content: [{ type: 'tool_use', id: 'c', name: 'cycle', input: {} }] }, { role: 'user', content: 'q2' }], 'night')!;
    expect(c.map(x => x.role)).toEqual(['user', 'user']);
  });
  it('caps sizes', () => {
    const m = cleanMessages([{ role: 'user', content: 'x'.repeat(9000) }], 'night')!;
    expect((m[0].content as string).length).toBe(4000);
  });
});

describe('the chat history the app sends', () => {
  it('sends the last lines as text, starting with a question, with no two in a row from one side', () => {
    const at = '2026-11-10T00:00:00Z';
    const h = history([
      { role: 'assistant', text: 'hi', at }, { role: 'user', text: 'a', at }, { role: 'user', text: 'b', at }, { role: 'assistant', text: 'c', at },
    ]);
    expect(h.map(x => [x.role, x.content])).toEqual([['user', 'b'], ['assistant', 'c']]);
  });
  it('reads out a short, plain version', () => {
    expect(speakable('**Today:**\n- Gym done\n- 3 todos left. Great work! Extra one. And more.')).toBe('Today: Gym done. 3 todos left. Great work!');
  });
});
