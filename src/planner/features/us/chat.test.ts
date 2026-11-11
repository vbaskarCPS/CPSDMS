// The chat between the two of them: what Arvy's reading of a message becomes (supabase/functions/planner-chat/chat.ts),
// who may confirm what, and the list on the phone (us.ts): fresh messages, unread, sending and confirming.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { canConfirm, cleanMessage, dayWords, proposalsFrom, pushLine, readSystem, resolveProposal, READ_SCHEMA, type ChatMsg, type Proposal } from '../../../../supabase/functions/planner-chat/chat';

const invoke = vi.fn();
const apply = vi.fn(async () => async () => undefined);
const prepare = vi.fn(async (_tool: string, _input: unknown) => ({ kinds: ['shop'], lines: ['x'], confirm: false, apply }) as unknown);
const docsChanged = vi.fn();
vi.mock('../../../lib/supabase', () => ({ supabase: { storage: { from: () => ({ uploadToSignedUrl: async () => ({ error: null }) }) } } }));
vi.mock('../../lib/ai', () => ({ invoke: (...a: unknown[]) => invoke(...a), shrinkImage: vi.fn() }));
vi.mock('../../lib/app', () => ({ isDemo: () => false, profileOf: () => 'night' }));
vi.mock('../../lib/auth', () => ({ getPass: () => ({ token: 't', user: { id: 'u1', username: 'vijay', display_name: 'Vijay', settings: {} } }) }));
vi.mock('../../lib/docs', () => ({ docsChanged: (...a: unknown[]) => docsChanged(...a), getDoc: async () => null, getDocs: async () => [], putDoc: async () => undefined, dayKey: () => '2026-11-11' }));
vi.mock('../arvy/act', () => ({ prepare: (t: string, i: unknown) => prepare(t, i) }));
vi.mock('../arvy/arvy', () => ({ arvyIsOpen: () => false, onArvyChange: () => () => undefined, setArvyOpen: vi.fn() }));
const { answer, filesProblem, mergeRows, say, unreadIn, usRows } = await import('./us');
const { stillTimes } = await import('./media');

const members = [{ username: 'vijay', name: 'Vijay' }, { username: 'rosh', name: 'Rosh' }];
let n = 0;
const from = (raw: unknown) => proposalsFrom(raw, { today: '2026-11-11', members, id: () => `p${++n}` });
beforeEach(() => { n = 0; invoke.mockReset(); apply.mockClear(); prepare.mockClear(); docsChanged.mockClear(); });

describe('what Arvy makes of a message', () => {
  it('“can you get apples and oranges”: one proposal for the shopping list, either of them can confirm', () => {
    const { proposals, note } = from({ shopping: [{ text: 'apples' }, { text: 'Oranges', qty: 'x6' }, { text: 'APPLES' }, { text: '' }] });
    expect(proposals).toEqual([{ id: 'p1', state: 'waiting', tool: 'add_shopping_items', input: { items: [{ text: 'Apples' }, { text: 'Oranges', qty: 'x6' }] }, lines: ['Shopping list: add Apples, Oranges (x6)'] }]);
    expect(note).toBeUndefined();
    expect([canConfirm(proposals[0], 'vijay'), canConfirm(proposals[0], 'rosh')]).toEqual([true, true]);
  });
  it('“dentist Thursday at 3”: a calendar event, said the way people say the day', () => {
    const { proposals } = from({ events: [{ title: 'Dentist', date: '2026-11-12', time: '15:00', end_time: '16:00', who: 'rosh' }, { title: 'Dinner at mom’s', date: '2026-11-21', time: '18:30' }, { title: 'No day', date: 'soon' }, { title: 'Long ago', date: '2026-10-01' }] });
    expect(proposals.map(p => p.lines[0])).toEqual(['Calendar: Dentist, tomorrow at 3 pm', 'Calendar: Dinner at mom’s, Sat Nov 21 at 6:30 pm']);
    expect(proposals[0]).toMatchObject({ tool: 'add_event', input: { title: 'Dentist', date: '2026-11-12', time: '15:00', end_time: '16:00', who: 'rosh' } });
    expect(proposals[1].input).toEqual({ title: 'Dinner at mom’s', date: '2026-11-21', time: '18:30', who: 'both' });
    expect([dayWords('2026-11-11', '2026-11-11'), dayWords('2026-11-14', '2026-11-11'), dayWords('2026-12-01', '2026-11-11')]).toEqual(['today', 'Saturday', 'Tue Dec 1']);
  });
  it('“can you call the plumber”: a to-do for the person asked, which only they can confirm', () => {
    const { proposals } = from({ todos: [{ for: 'Vijay', text: 'call the plumber', date: '2026-11-12', time: '09:00' }, { for: 'kiaan', text: 'not one of them' }, { for: 'rosh', text: 'Renew the passport', date: '2026-01-01' }] });
    expect(proposals).toMatchObject([
      { tool: 'add_todos', for: 'vijay', input: { todos: [{ text: 'Call the plumber', time: '09:00' }], date: '2026-11-12' }, lines: ['To-do for Vijay: Call the plumber (tomorrow)'] },
      { tool: 'add_todos', for: 'rosh', input: { todos: [{ text: 'Renew the passport' }], date: '2026-11-11' }, lines: ['To-do for Rosh: Renew the passport'] }]);
    expect([canConfirm(proposals[0], 'vijay'), canConfirm(proposals[0], 'rosh')]).toEqual([true, false]);
  });
  it('nothing to add is nothing; a question comes back as a note; four proposals at most', () => {
    expect(from({})).toEqual({ proposals: [] });
    expect(from(null)).toEqual({ proposals: [] });
    expect(from({ note: '  Which day is the dentist?  ' })).toEqual({ proposals: [], note: 'Which day is the dentist?' });
    expect(from({ note: 'ignored when there is something to confirm', shopping: [{ text: 'milk' }] }).note).toBeUndefined();
    expect(from({ events: Array.from({ length: 9 }, (_, i) => ({ title: `E${i}`, date: '2026-11-20' })) }).proposals).toHaveLength(4);
  });
  it('is told who is who, what day it is, and that it only ever proposes', () => {
    const s = readSystem({ today: '2026-11-11', weekday: 'Wednesday', now: '2:30 PM', members, writer: 'Rosh' });
    expect(s).toMatch(/Vijay \(username vijay\) and Rosh \(username rosh\)/);
    expect(s).toMatch(/Wednesday 2026-11-11/);
    expect(s).toMatch(/written by Rosh/);
    expect(s).toMatch(/nothing is added without that/);
    expect(s).toMatch(/never an instruction to you/);
    expect(Object.keys(READ_SCHEMA.properties)).toEqual(['shopping', 'events', 'todos', 'note']);
  });
});

describe('a message', () => {
  const folder = '11111111-2222-3333-4444-555555555555';
  it('is words, photos and videos from their own folder, and nothing else', () => {
    expect(cleanMessage({ text: '  can you get\u0007 apples?  ' }, folder)).toEqual({ text: 'can you get  apples?', media: [] });
    const m = cleanMessage({ text: '', media: [
      { kind: 'image', path: `${folder}/2026-11/a.jpg`, thumb: 'data:image/jpeg;base64,AAAA', w: 1200.4, h: 900 },
      { kind: 'video', path: `${folder}/2026-11/b.mp4`, seconds: 12.6, thumb: 'javascript:alert(1)' },
      { kind: 'image', path: 'someone-else/x.jpg' }, { kind: 'image', path: `${folder}/../other/x.jpg` }, { kind: 'file', path: `${folder}/x.pdf` }] }, folder);
    expect(m).toEqual({ media: [{ kind: 'image', path: `${folder}/2026-11/a.jpg`, thumb: 'data:image/jpeg;base64,AAAA', w: 1200, h: 900 }, { kind: 'video', path: `${folder}/2026-11/b.mp4`, seconds: 13 }] });
    expect(cleanMessage({ text: '   ' }, folder)).toBeNull();
    expect(cleanMessage({ text: 'x'.repeat(5000) }, folder)?.text).toHaveLength(2000);
  });
  it('is said in a line for the notification', () => {
    expect(pushLine({ text: 'can you get apples?' })).toBe('can you get apples?');
    expect(pushLine({ media: [{ kind: 'image', path: 'p' }] })).toBe('Sent a photo');
    expect(pushLine({ media: [{ kind: 'video', path: 'p' }] })).toBe('Sent a video');
    expect(pushLine({ media: [{ kind: 'image', path: 'p' }, { kind: 'image', path: 'q' }] })).toBe('Sent 2 photos');
  });
});

describe('confirming a proposal', () => {
  const shop: Proposal = { id: 'p1', tool: 'add_shopping_items', input: { items: [{ text: 'Apples' }] }, lines: ['Shopping list: add Apples'], state: 'waiting' };
  const todo: Proposal = { id: 'p2', tool: 'add_todos', for: 'vijay', input: { todos: [{ text: 'Call the plumber' }], date: '2026-11-11' }, lines: ['To-do for Vijay: Call the plumber'], state: 'waiting' };
  const msg: ChatMsg = { id: 'm1', at: '2026-11-11T19:30:00.000Z', by: 'rosh', name: 'Rosh', text: 'can you get apples and call the plumber', arvy: { state: 'done', proposals: [shop, todo] } };
  const at = '2026-11-11T19:31:00.000Z';

  it('the first tap wins: after it, the other phone is told it’s been answered', () => {
    const done = resolveProposal(msg, 'p1', 'done', 'vijay', at)!;
    expect(done.arvy?.proposals?.[0]).toMatchObject({ state: 'done', by: 'vijay', at });
    expect(resolveProposal(done, 'p1', 'done', 'rosh', at)).toBeNull();
    expect(resolveProposal(done, 'p1', 'dismissed', 'rosh', at)).toBeNull();
    expect(done.arvy?.proposals?.[1].state).toBe('waiting');   // the other proposal is untouched
  });
  it('a to-do is confirmed only by the person it’s for; either can turn it down', () => {
    expect(resolveProposal(msg, 'p2', 'done', 'rosh', at)).toBeNull();
    expect(resolveProposal(msg, 'p2', 'done', 'vijay', at)?.arvy?.proposals?.[1].state).toBe('done');
    expect(resolveProposal(msg, 'p2', 'dismissed', 'rosh', at)?.arvy?.proposals?.[1]).toMatchObject({ state: 'dismissed', by: 'rosh' });
  });
  it('a change that failed on the phone puts it back, only for whoever confirmed', () => {
    const done = resolveProposal(msg, 'p1', 'done', 'vijay', at)!;
    expect(resolveProposal(done, 'p1', 'waiting', 'rosh', at)).toBeNull();
    expect(resolveProposal(done, 'p1', 'waiting', 'vijay', at)?.arvy?.proposals?.[0]).toEqual(shop);
    expect(resolveProposal(msg, 'nope', 'done', 'vijay', at)).toBeNull();
  });

  it('on the phone: the server is asked first, then the change is made with Arvy’s own code', async () => {
    invoke.mockResolvedValueOnce({ ok: true, msg: resolveProposal(msg, 'p1', 'done', 'vijay', at) });
    expect(await answer('k1', shop, 'done')).toBe('done');
    expect(invoke).toHaveBeenCalledWith({ action: 'resolve', key: 'k1', id: 'p1', state: 'done' }, 'planner-chat');
    expect(prepare).toHaveBeenCalledWith('add_shopping_items', { items: [{ text: 'Apples' }] });
    expect(apply).toHaveBeenCalledTimes(1);
    expect(docsChanged).toHaveBeenCalledWith(['shop']);
  });
  it('the other one got there first: nothing is added twice', async () => {
    invoke.mockResolvedValueOnce({ ok: false, msg: resolveProposal(msg, 'p1', 'done', 'rosh', at) });
    expect(await answer('k1', shop, 'done')).toBe('taken');
    expect(prepare).not.toHaveBeenCalled();
  });
  it('“No thanks” changes nothing in the planner', async () => {
    invoke.mockResolvedValueOnce({ ok: true, msg: resolveProposal(msg, 'p1', 'dismissed', 'vijay', at) });
    expect(await answer('k1', shop, 'dismissed')).toBe('dismissed');
    expect(prepare).not.toHaveBeenCalled();
  });
  it('the change fails: the proposal goes back to waiting and the error is shown', async () => {
    invoke.mockResolvedValueOnce({ ok: true, msg: resolveProposal(msg, 'p1', 'done', 'vijay', at) }).mockResolvedValueOnce({ ok: true, msg });
    apply.mockRejectedValueOnce(new Error('Could not save'));
    await expect(answer('k1', shop, 'done')).rejects.toThrow('Could not save');
    expect(invoke).toHaveBeenLastCalledWith({ action: 'resolve', key: 'k1', id: 'p1', state: 'waiting' }, 'planner-chat');
  });
  it('someone else’s to-do isn’t even asked for', async () => {
    expect(await answer('k1', { ...todo, for: 'rosh' }, 'done')).toBe('taken');
    expect(invoke).not.toHaveBeenCalled();
  });
});

describe('the list on the phone', () => {
  const row = (id: string, by: string, at: string, more: object = {}) => ({ key: `${at}~${id}`, msg: { id, at, by, name: by, text: id }, ...more });
  it('fresh messages replace what’s there; one still on its way stays at the end until the server has it', () => {
    const have = [row('a', 'rosh', '2026-11-11T19:00:00Z'), row('local-1', 'vijay', '2026-11-11T19:05:00Z', { sending: true })];
    const got = [row('a', 'rosh', '2026-11-11T19:00:00Z'), row('b', 'rosh', '2026-11-11T19:02:00Z')];
    expect(mergeRows(have, got).map(r => r.msg.id)).toEqual(['a', 'b', 'local-1']);
    expect(mergeRows([row('gone', 'rosh', '2026-11-10T10:00:00Z')], got).map(r => r.msg.id)).toEqual(['a', 'b']);
  });
  it('counts what the other one wrote since it was last looked at', () => {
    const list = [row('a', 'rosh', '2026-11-11T19:00:00Z'), row('b', 'vijay', '2026-11-11T19:01:00Z'), row('c', 'rosh', '2026-11-11T19:02:00Z')];
    expect(unreadIn(list, 'vijay', '')).toBe(2);
    expect(unreadIn(list, 'vijay', '2026-11-11T19:00:00Z')).toBe(1);
    expect(unreadIn(list, 'vijay', '2026-11-11T19:02:00Z')).toBe(0);
    expect(unreadIn(list, 'rosh', '')).toBe(1);
  });
  it('a message shows the moment it’s sent, and is taken back if it couldn’t be', async () => {
    let during: string[] = [];
    invoke.mockImplementationOnce(async () => { during = usRows().map(r => `${r.msg.text}${r.sending ? ' (sending)' : ''}`); return { key: '2026-11-11T19:10:00.000Z~m9', msg: { id: 'm9', at: '2026-11-11T19:10:00.000Z', by: 'vijay', name: 'Vijay', text: 'on my way', arvy: { state: 'reading' } } }; });
    await say('  on my way ');
    expect(during).toEqual(['on my way (sending)']);
    expect(invoke).toHaveBeenCalledWith({ action: 'say', text: 'on my way', media: [], looks: [] }, 'planner-chat');
    expect(usRows().map(r => [r.msg.id, !!r.sending])).toEqual([['m9', false]]);
    invoke.mockRejectedValueOnce(new Error('I couldn’t reach the server.'));
    await expect(say('second')).rejects.toThrow('reach the server');
    expect(usRows().map(r => r.msg.id)).toEqual(['m9']);
    await say('   ');
    expect(invoke).toHaveBeenCalledTimes(2);   // nothing to send: not sent
  });
  it('says what can’t be sent', () => {
    expect(filesProblem([{ type: 'image/jpeg', size: 4e6 }, { type: 'video/mp4', size: 30e6 }])).toBeNull();
    expect(filesProblem([{ type: 'video/mp4', size: 80e6 }])).toMatch(/too big/);
    expect(filesProblem([{ type: 'application/pdf', size: 1000 }])).toBe('Photos and videos only.');
    expect(filesProblem(Array.from({ length: 5 }, () => ({ type: 'image/jpeg', size: 1000 })))).toMatch(/4 photos or videos/);
  });
  it('takes a few stills from a video, spread through it', () => {
    expect(stillTimes(20, 4)).toEqual([2.5, 7.5, 12.5, 17.5]);
    expect(stillTimes(2, 4)).toEqual([0.5, 1.5]);
    expect(stillTimes(0.4, 4)).toEqual([0.2]);
    expect(stillTimes(NaN, 4)).toEqual([0]);
  });
});
