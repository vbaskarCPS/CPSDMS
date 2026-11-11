// Arvy: what the server accepts, which tools each person gets, what it's told, and the chat history it sends.
import { describe, expect, it, vi } from 'vitest';
import { cleanMessages, speakable, system, toolsFor, voiceFor, SCREENS, TOOLS } from '../../../../supabase/functions/planner-arvy/tools';

vi.mock('../../lib/ai', () => ({ invoke: vi.fn() }));
vi.mock('./run', () => ({ runTool: vi.fn() }));
const { history, TOOL_LABEL, arvyIsHearing, arvyIsOpen, onArvyChange, onOpenArvy, openArvy, setArvyHearing, setArvyOpen } = await import('./arvy');

describe('Arvy tools', () => {
  it('gives the cycle tool only to the morning profile (Rosh)', () => {
    expect(toolsFor('night').map(t => t.name)).not.toContain('cycle');
    expect(toolsFor('morning').map(t => t.name)).toContain('cycle');
  });
  it('offers a phone on an older version of the app only the tools it can run', () => {
    expect(toolsFor('night').map(t => t.name)).toEqual(expect.arrayContaining(['adjust_day', 'change_routine']));
    expect(toolsFor('night', 1).map(t => t.name)).not.toContain('adjust_day');
    expect(toolsFor('night', 1).map(t => t.name)).not.toContain('change_routine');
    expect(toolsFor('night', 1).map(t => t.name)).toContain('plan_workout');
    expect(system({ name: 'Vijay' })).toContain('adjust_day');
    expect(system({ name: 'Vijay', v: 1 })).not.toContain('adjust_day');
    expect(system({ name: 'Vijay', v: 1 })).not.toContain('the shape of one day');
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
    expect(h.map(x => [x.role, (x.content as string).replace(/^\[[^\]]+\] /, '')])).toEqual([['user', 'b'], ['assistant', 'c']]);
  });
  it('says when each question was sent, and what became of each change, so an old "tomorrow" isn’t read as tomorrow from now', () => {
    const h = history([
      { role: 'user', text: 'plan tomorrow’s session', at: '2026-11-10T23:28:00' },
      { role: 'assistant', text: 'Tomorrow’s chest session is set up. Please tap Confirm.', at: '2026-11-10T23:28:20', changes: [{ id: 'c1', lines: ['Train tomorrow (Wed, Nov 11): “Chest” (5 exercises)'], state: 'done' }] },
      { role: 'user', text: 'and the day after?', at: '2026-11-11T05:14:00' },
      { role: 'assistant', text: 'Rest.', at: '2026-11-11T05:14:10', changes: [{ id: 'c2', lines: ['Today’s plan: no gym'], state: 'waiting' }, { id: 'c3', lines: ['To-do today: nap'], state: 'undone' }] },
    ]);
    expect(h[0].content).toBe('[Tue, Nov 10, 11:28 PM] plan tomorrow’s session');
    expect(h[1].content).toBe('Tomorrow’s chest session is set up. Please tap Confirm.\n[Change: MADE and saved (confirmed, if it needed Confirm). Train tomorrow (Wed, Nov 11): “Chest” (5 exercises)]');
    expect(h[2].content).toMatch(/^\[Wed, Nov 11, 5:14 AM\] /);
    expect(h[3].content).toContain('[Change: still waiting for their Confirm tap. Today’s plan: no gym]');
    expect(h[3].content).toContain('[Change: they undid it. To-do today: nap]');
    expect((h[3].content as string).startsWith('Rest.')).toBe(true);   // Arvy's own lines carry no stamp (it would start copying them)
  });
  it('reads out a short, plain version', () => {
    expect(speakable('**Today:**\n- Gym done\n- 3 todos left. Great work! Extra one. And more.')).toBe('Today: Gym done. 3 todos left. Great work!');
  });
});

describe('the RV button and the chat', () => {
  it('the bar is told when the chat opens or closes and when it starts or stops listening, once per change', () => {
    let told = 0;
    const off = onArvyChange(() => { told++; });
    setArvyOpen(true); setArvyOpen(true);
    expect(arvyIsOpen()).toBe(true);
    setArvyHearing(true); setArvyHearing(true);
    expect(arvyIsHearing()).toBe(true);
    setArvyHearing(false); setArvyOpen(false);
    expect([arvyIsOpen(), arvyIsHearing()]).toEqual([false, false]);
    expect(told).toBe(4);
    off();
    setArvyOpen(true); setArvyOpen(false);
    expect(told).toBe(4);
  });
  it('RV held down asks the chat to open listening; a screen’s own button doesn’t', () => {
    const asked: unknown[] = [];
    const off = onOpenArvy(o => asked.push(o));
    openArvy({ mic: true });
    openArvy({ ask: 'How’s my day looking?' });
    off();
    expect(asked).toEqual([{ mic: true }, { ask: 'How’s my day looking?' }]);
  });
});
