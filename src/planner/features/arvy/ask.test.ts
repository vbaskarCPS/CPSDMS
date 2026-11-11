// One question to Arvy, start to finish (arvy.ts ask): answers that searched the web, buttons to pick from, and
// changes that wait for Confirm once the web (or the gym's timetable) has been read.
import { beforeEach, describe, expect, it, vi } from 'vitest';

const invoke = vi.fn();
const apply = vi.fn(async () => async () => undefined);
vi.mock('../../lib/ai', () => ({ invoke: (...a: unknown[]) => invoke(...a) }));
vi.mock('../../lib/app', () => ({ isDemo: () => false, profileOf: () => 'night' }));
vi.mock('../../lib/auth', () => ({ getPass: () => ({ user: { username: 'vijay', settings: { units: 'lb' } } }) }));
vi.mock('../../lib/docs', () => ({ dayKey: () => '2026-11-11', docsChanged: vi.fn() }));
vi.mock('../../lib/memory', () => ({ memoryContext: async () => [] }));
vi.mock('./log', () => ({ logArvy: vi.fn(async () => undefined) }));
const GYM = { title: 'GoodLife class schedule: Hamilton Queenston Place', url: 'https://www.goodlifefitness.com/class-schedule.html?club=201' };
vi.mock('./run', () => ({ runTool: vi.fn(async (name: string) => (name === 'gym_classes' ? { result: { clubs: [] }, sources: [GYM] } : { result: { shown: true } })) }));
vi.mock('./act', () => ({
  Refuse: class extends Error {},
  prepare: vi.fn(async (_name: string, input: { items?: { text: string }[] }) => ({ lines: [`Shopping list: add ${input.items?.map(i => i.text).join(', ')}`], kinds: ['shop'], apply })),
}));
const { ask, choicesFrom, NO_CONNECTION, RETRY_WAIT } = await import('./arvy');
RETRY_WAIT.ms = 0;

const SEARCH = { type: 'server_tool_use', id: 'srvtoolu_1', name: 'web_search', input: { query: 'banana bread recipe' } };
const RESULT = { type: 'web_search_tool_result', tool_use_id: 'srvtoolu_1', content: [{ type: 'web_search_result', url: 'https://bake.example/banana', title: 'Banana bread', encrypted_content: 'Eqg…' }] };
const WEB = { searches: ['banana bread recipe'], sources: [{ title: 'Banana bread', url: 'https://bake.example/banana' }, { title: 'bad', url: 'javascript:1' }] };
const add = (id: string) => ({ type: 'tool_use', id, name: 'add_shopping_items', input: { items: [{ text: 'Bananas' }] } });

beforeEach(() => { invoke.mockReset(); apply.mockClear(); });

describe('asking Arvy', () => {
  it('an answer from the web comes with its sources and the buttons to pick from, in one go', async () => {
    invoke.mockResolvedValueOnce({ stop_reason: 'tool_use', web: WEB, content: [
      { type: 'text', text: 'Two ways to go. Which one?' },
      { type: 'tool_use', id: 't1', name: 'offer_choices', input: { options: [{ label: '1. Gentle', send: 'Build option 1' }, { label: '2. Core' }] } }] });
    const t = await ask([], 'look up back stretches', '/health', false);
    expect(invoke).toHaveBeenCalledTimes(1);   // the reply came with its buttons: no second trip
    expect(t.reply).toBe('Two ways to go. Which one?');
    expect(t.sources).toEqual([{ title: 'Banana bread', url: 'https://bake.example/banana' }]);
    expect(t.choices).toEqual([{ label: '1. Gentle', send: 'Build option 1' }, { label: '2. Core' }]);
    expect(t.used).toEqual(['web_search']);
    expect(invoke.mock.calls[0][0].context.v).toBe(5);
  });
  it('a reply that cites nothing still shows the pages the search found; cited pages win when there are any', async () => {
    const FOUND = [1, 2, 3, 4, 5].map(i => ({ title: `Page ${i}`, url: `https://site${i}.example/` }));
    // two pages of one site are one link
    invoke.mockResolvedValueOnce({ stop_reason: 'end_turn', web: { searches: ['x'], sources: [], found: [{ title: 'A', url: 'https://www.spine.example/a' }, { title: 'B', url: 'https://spine.example/b' }, FOUND[0]] }, content: [{ type: 'text', text: 'Here.' }] });
    expect((await ask([], 'look it up', '/', false)).sources).toEqual([{ title: 'A', url: 'https://www.spine.example/a' }, FOUND[0]]);
    invoke.mockResolvedValueOnce({ stop_reason: 'end_turn', web: { searches: ['x'], sources: [], found: FOUND }, content: [{ type: 'text', text: 'Here you go.' }] });
    expect((await ask([], 'look it up', '/', false)).sources).toEqual(FOUND.slice(0, 4));
    invoke.mockResolvedValueOnce({ stop_reason: 'end_turn', web: { searches: ['x'], sources: [FOUND[4]], found: FOUND }, content: [{ type: 'text', text: 'Here you go.' }] });
    expect((await ask([], 'look it up', '/', false)).sources).toEqual([FOUND[4]]);
  });
  it('says it’s checking the web while a search asked for alongside a look-up runs', async () => {
    const steps: string[][] = [];
    invoke.mockResolvedValueOnce({ stop_reason: 'tool_use', web: { searches: ['x'], sources: [], found: [] }, raw: [SEARCH, { type: 'tool_use', id: 't0', name: 'shopping_list', input: {} }], content: [{ type: 'tool_use', id: 't0', name: 'shopping_list', input: {} }] })
      .mockResolvedValueOnce({ stop_reason: 'end_turn', web: { searches: [], sources: [WEB.sources[0]], found: [] }, content: [{ type: 'text', text: 'Found it.' }] });
    const t = await ask([], 'find a recipe', '/shop', false, s => steps.push(s));
    expect(steps).toEqual([['web_search', 'shopping_list']]);
    expect(t.used).toEqual(['web_search', 'shopping_list']);
    expect(t.sources).toEqual([WEB.sources[0]]);
  });
  it('buttons asked for before the reply was written: Arvy is asked to write it', async () => {
    invoke.mockResolvedValueOnce({ stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 't1', name: 'offer_choices', input: { options: [{ label: 'A' }, { label: 'B' }] } }] })
      .mockResolvedValueOnce({ stop_reason: 'end_turn', content: [{ type: 'text', text: 'A or B?' }] });
    const t = await ask([], 'which?', '/', false);
    expect(invoke).toHaveBeenCalledTimes(2);
    expect(t).toMatchObject({ reply: 'A or B?', choices: [{ label: 'A' }, { label: 'B' }] });
    expect(t.sources).toBeUndefined();
  });
  it('once the web has been searched, a change that would normally just happen waits for Confirm', async () => {
    const raw = [{ type: 'text', text: 'Found one.' }, SEARCH, RESULT, add('t1')];
    invoke.mockResolvedValueOnce({ stop_reason: 'tool_use', web: WEB, raw, content: [{ type: 'text', text: 'Found one.' }, add('t1')] })
      .mockResolvedValueOnce({ stop_reason: 'end_turn', content: [{ type: 'text', text: 'Tap Confirm to add them.' }] });
    const t = await ask([], 'find a banana bread recipe and add what I need', '/shop', false);
    expect(t.changes).toMatchObject([{ state: 'waiting', lines: ['Shopping list: add Bananas'] }]);
    expect(apply).not.toHaveBeenCalled();
    const sent = invoke.mock.calls[1][0].messages;
    expect(sent[sent.length - 2]).toEqual({ role: 'assistant', content: raw });   // the search goes back as it came
    expect(sent[sent.length - 1].content[0].content).toMatch(/waiting_for_confirm/);
    expect(t.sources).toHaveLength(1);
  });
  it('…and it stays that way for the rest of the question', async () => {
    invoke.mockResolvedValueOnce({ stop_reason: 'tool_use', web: WEB, raw: [SEARCH, RESULT, { type: 'tool_use', id: 't0', name: 'shopping_list', input: {} }], content: [{ type: 'tool_use', id: 't0', name: 'shopping_list', input: {} }] })
      .mockResolvedValueOnce({ stop_reason: 'tool_use', content: [add('t1')] })
      .mockResolvedValueOnce({ stop_reason: 'end_turn', content: [{ type: 'text', text: 'Tap Confirm.' }] });
    const t = await ask([], 'find a recipe, check my list, add what’s missing', '/shop', false);
    expect(t.changes[0].state).toBe('waiting');
    expect(apply).not.toHaveBeenCalled();
  });
  it('class times read from GoodLife: the timetable is linked under the reply, and a change set up after it waits for Confirm', async () => {
    const steps: string[][] = [];
    invoke.mockResolvedValueOnce({ stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 'g1', name: 'gym_classes', input: { search: 'yoga' } }] })
      .mockResolvedValueOnce({ stop_reason: 'tool_use', content: [{ type: 'text', text: 'Yoga is at 7:45.' }, add('t1')] })
      .mockResolvedValueOnce({ stop_reason: 'end_turn', content: [{ type: 'text', text: 'Tap Confirm.' }] });
    const t = await ask([], 'when is yoga at Queenston? add a mat to the list', '/health', false, s => steps.push(s));
    expect(steps).toEqual([['gym_classes'], ['add_shopping_items']]);
    expect(t.used).toEqual(['gym_classes', 'add_shopping_items']);
    expect(t.sources).toEqual([GYM]);
    expect(t.changes).toMatchObject([{ state: 'waiting' }]);
    expect(apply).not.toHaveBeenCalled();
    // what the timetable said went back to Arvy as that tool's answer
    const sent = (invoke.mock.calls[2][0].messages as { content: unknown }[]).flatMap(m => (Array.isArray(m.content) ? m.content : []));
    expect(sent).toContainEqual({ type: 'tool_result', tool_use_id: 'g1', content: '{"clubs":[]}' });
  });
  it('with no search, the same change is made straight away, as before', async () => {
    invoke.mockResolvedValueOnce({ stop_reason: 'tool_use', content: [add('t1')] })
      .mockResolvedValueOnce({ stop_reason: 'end_turn', content: [{ type: 'text', text: 'Added bananas!' }] });
    const t = await ask([], 'add bananas to the list', '/shop', false);
    expect(t.changes).toMatchObject([{ state: 'done' }]);
    expect(apply).toHaveBeenCalledTimes(1);
    expect(t.used).toEqual(['add_shopping_items']);
    expect(t.sources).toBeUndefined();
    expect(t.choices).toBeUndefined();
  });
});

describe('what’s new', () => {
  it('“what’s new?” takes the release notes along; any other question doesn’t', async () => {
    invoke.mockResolvedValue({ stop_reason: 'end_turn', content: [{ type: 'text', text: 'Here.' }] });
    await ask([], 'What’s new in the planner?', '/', false);
    const sent = invoke.mock.calls[0][0].messages.at(-1).content as string;
    expect(sent).toMatch(/^What’s new in the planner\?\n\n\[The planner’s release notes, newest first/);
    await ask([], 'what’s left today?', '/', false);
    expect(invoke.mock.calls[1][0].messages.at(-1).content).toBe('what’s left today?');
  });
});

describe('a dropped connection', () => {
  const lost = () => new Error('Failed to send a request to the Edge Function');
  it('is tried once more by itself, and the question is answered', async () => {
    invoke.mockRejectedValueOnce(lost()).mockResolvedValueOnce({ stop_reason: 'end_turn', content: [{ type: 'text', text: 'Here you go.' }] });
    const t = await ask([], 'how is my day?', '/', false);
    expect(t.reply).toBe('Here you go.');
    expect(invoke).toHaveBeenCalledTimes(2);
    expect(invoke.mock.calls[1][0]).toEqual(invoke.mock.calls[0][0]);   // the same step, asked again
  });
  it('still down on the second try: says to check the connection', async () => {
    invoke.mockRejectedValueOnce(lost()).mockRejectedValueOnce(new TypeError('Failed to fetch'));
    await expect(ask([], 'how is my day?', '/', false)).rejects.toThrow(NO_CONNECTION);
    expect(invoke).toHaveBeenCalledTimes(2);
  });
  it('anything else that goes wrong is not asked twice', async () => {
    invoke.mockRejectedValueOnce(new Error('Anthropic 529'));
    await expect(ask([], 'how is my day?', '/', false)).rejects.toThrow('Anthropic 529');
    expect(invoke).toHaveBeenCalledTimes(1);
  });
});

describe('the buttons Arvy can offer', () => {
  it('takes 2 to 4, trims them, and drops repeats and blanks', () => {
    expect(choicesFrom({ options: [{ label: '  1. Gentle   flow ' }, { label: '1. Gentle flow' }, { label: '' }, { label: '2. Core', send: '2. Core' }, { label: '3', send: 'Build three' }, { label: '4' }, { label: '5' }] }))
      .toEqual([{ label: '1. Gentle flow' }, { label: '2. Core' }, { label: '3', send: 'Build three' }, { label: '4' }]);
  });
  it('one option is not a choice', () => {
    expect(choicesFrom({ options: [{ label: 'Only' }] })).toEqual([]);
    expect(choicesFrom({})).toEqual([]);
    expect(choicesFrom(null)).toEqual([]);
  });
});
