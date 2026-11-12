// To-dos offered from email (todos.ts), against an in-memory copy of the planner's documents and Arvy's real
// add_todos code: which ones are offered, the day one goes on, and what Add and Not needed leave behind.
import { beforeEach, describe, expect, it, vi } from 'vitest';

const store = new Map<string, unknown>();
const k = (kind: string, key: string) => `${kind}|${key}`;
const changed = vi.fn();
let failPut = 0;   // how many of the next saves of an offer fail
vi.mock('../../lib/docs', () => ({
  dayKey: () => '2026-11-11',
  calendarKey: () => '2026-11-11',
  docsChanged: (kinds: string[]) => changed(kinds),
  getDoc: async (kind: string, key: string) => structuredClone(store.get(k(kind, key)) ?? null),
  getDocs: async (kind: string, from?: string, to?: string) => [...store.entries()].filter(([id, data]) => id.startsWith(`${kind}|`) && data !== null)
    .map(([id, data]) => ({ key: id.slice(kind.length + 1), data: structuredClone(data) })).filter(d => (!from || d.key >= from) && (!to || d.key <= to)),
  putDoc: async (kind: string, key: string, data: unknown) => { if (kind === 'mailtodo' && failPut > 0) { failPut--; throw new Error('offline'); } store.set(k(kind, key), data); },
  putDocs: async (docs: { kind: string; key: string; data: unknown }[]) => { for (const d of docs) store.set(k(d.kind, d.key), d.data); },
}));
vi.mock('../../lib/auth', () => ({ getPass: () => ({ user: { username: 'vijay', settings: { units: 'lb' } } }) }));
vi.mock('../../lib/ai', () => ({ invoke: vi.fn(), estimateFoodText: vi.fn() }));
const { addOffered, dayFor, dayWords, dismissOffered, loadOffered, OFFER_DAYS, waitingOf } = await import('./todos');

const NOW = Date.parse('2026-11-11T19:40:00Z');
const offer = (o: Record<string, unknown> = {}) => ({ what: 'Call Dr. Shah’s office to confirm Thursday', from: 'Maple Leaf Dental', subject: 'Your appointment on Thursday', mailbox: { id: 'mb-1', address: 'vijay@example.com' },
  messageId: '19a3f0c2b7d41e55', arrived: '2026-11-11T19:14:00.000Z', found: '2026-11-11T19:38:00.000Z', state: 'waiting', ...o });
const KEY = '2026-11-11T19:14:00.000Z~19a3f0c2b7d41e55~0';
type Day = { todos: { text: string; time?: string; done: boolean; from?: string; must?: boolean }[]; priorities: unknown[] };
const day = (key: string) => store.get(k('day', key)) as Day | undefined;

beforeEach(() => {
  store.clear(); changed.mockClear(); failPut = 0;
  vi.useFakeTimers({ now: NOW, toFake: ['Date'] });
  store.set('day|2026-11-11', { todos: [{ id: 't1', text: 'Finish the release notes', done: false, from: 'me', must: true }] });
});

describe('which ones are offered', () => {
  it('the ones still waiting, the oldest email first; added, turned down or unreadable ones are not', () => {
    const docs = [
      { key: '2026-11-11T19:16:00.000Z~b~0', data: offer({ what: 'Send the photo form back' }) },
      { key: KEY, data: offer() },
      { key: '2026-11-10T10:00:00.000Z~c~0', data: offer({ state: 'added' }) },
      { key: '2026-11-10T11:00:00.000Z~d~0', data: offer({ state: 'dismissed' }) },
      { key: '2026-11-10T12:00:00.000Z~e~0', data: { nothing: 'here' } },
      { key: '2026-11-10T13:00:00.000Z~f~0', data: offer({ what: 'Enter verification code 482913' }) },   // never shown, even if one got saved
      { key: '2026-11-10T14:00:00.000Z~g~0', data: null },
    ];
    expect(waitingOf(docs, NOW).map(o => o.todo.what)).toEqual(['Call Dr. Shah’s office to confirm Thursday', 'Send the photo form back']);
  });
  it('one that has waited two weeks quietly stops being offered', () => {
    const old = new Date(NOW - (OFFER_DAYS + 1) * 864e5).toISOString(), recent = new Date(NOW - (OFFER_DAYS - 1) * 864e5).toISOString();
    expect(waitingOf([{ key: `${old}~a~0`, data: offer({ found: old, arrived: old }) }, { key: `${recent}~b~0`, data: offer({ found: recent, arrived: recent, what: 'Still here' }) }], NOW).map(o => o.todo.what)).toEqual(['Still here']);
  });
  it('loads them from the person’s own docs', async () => {
    store.set(k('mailtodo', KEY), offer());
    store.set(k('mailtodo', '2026-11-11T19:16:00.000Z~b~0'), offer({ state: 'dismissed' }));
    expect(await loadOffered()).toEqual([{ key: KEY, todo: offer() }]);
  });
});

describe('the day one goes on', () => {
  it('the day the email named when that’s today or ahead, else today', () => {
    expect(dayFor({ date: '2026-11-12' }, '2026-11-11')).toBe('2026-11-12');
    expect(dayFor({ date: '2026-11-11' }, '2026-11-11')).toBe('2026-11-11');
    expect(dayFor({ date: '2026-11-09' }, '2026-11-11')).toBe('2026-11-11');   // the day went by while it waited
    expect(dayFor({}, '2026-11-11')).toBe('2026-11-11');
  });
  it('is said in a few words', () => {
    expect(dayWords('2026-11-11', '2026-11-11')).toBe('today');
    expect(dayWords('2026-11-12', '2026-11-11')).toBe('tomorrow');
    expect(dayWords('2026-12-01', '2026-11-30')).toBe('tomorrow');
    expect(dayWords('2026-11-17', '2026-11-11')).toMatch(/^Tue\.?, Nov\.? 17$/);
  });
});

describe('Add and Not needed', () => {
  it('Add puts it on today’s list the way Arvy’s add_todos does, and the offer is marked added', async () => {
    store.set(k('mailtodo', KEY), offer());
    expect(await addOffered({ key: KEY, todo: offer() as never }, '2026-11-11')).toBe('2026-11-11');
    const d = day('2026-11-11')!;
    expect(d.todos.map(t => [t.text, t.done, t.from])).toEqual([['Finish the release notes', false, 'me'], ['Call Dr. Shah’s office to confirm Thursday', false, 'me']]);
    expect(d.priorities).toHaveLength(3);   // the day was saved through the same code as every other to-do (its must-dos kept in step)
    expect(store.get(k('mailtodo', KEY))).toMatchObject({ state: 'added', addedTo: '2026-11-11', doneAt: new Date(NOW).toISOString(), what: 'Call Dr. Shah’s office to confirm Thursday' });
    expect(changed.mock.calls).toEqual([[['day']], [['mailtodo']]]);   // Today's list and the card both reload
    expect(await loadOffered()).toEqual([]);
  });
  it('one the email gave a day and a time for goes on that day, at that time', async () => {
    const o = offer({ date: '2026-11-12', time: '15:00' });
    expect(await addOffered({ key: KEY, todo: o as never }, '2026-11-11')).toBe('2026-11-12');
    expect(day('2026-11-12')!.todos.map(t => [t.text, t.time])).toEqual([['Call Dr. Shah’s office to confirm Thursday', '15:00']]);
    expect(day('2026-11-11')!.todos).toHaveLength(1);
    expect(store.get(k('mailtodo', KEY))).toMatchObject({ state: 'added', addedTo: '2026-11-12' });
  });
  it('a day that has gone by: it goes on today, without the old time', async () => {
    await addOffered({ key: KEY, todo: offer({ date: '2026-11-09', time: '15:00' }) as never }, '2026-11-11');
    expect(day('2026-11-11')!.todos[1]).toMatchObject({ text: 'Call Dr. Shah’s office to confirm Thursday' });
    expect(day('2026-11-11')!.todos[1]).not.toHaveProperty('time');
  });
  it('Not needed puts it aside: nothing goes on any list, and it isn’t offered again', async () => {
    store.set(k('mailtodo', KEY), offer());
    await dismissOffered({ key: KEY, todo: offer() as never });
    expect(day('2026-11-11')!.todos).toHaveLength(1);
    expect(store.get(k('mailtodo', KEY))).toMatchObject({ state: 'dismissed', doneAt: new Date(NOW).toISOString() });
    expect(await loadOffered()).toEqual([]);
    expect(changed.mock.calls).toEqual([[['mailtodo']]]);
  });
  it('if marking the offer fails once, it’s tried again; the to-do is on the list either way, once', async () => {
    store.set(k('mailtodo', KEY), offer());
    failPut = 1;
    await addOffered({ key: KEY, todo: offer() as never }, '2026-11-11');
    expect(store.get(k('mailtodo', KEY))).toMatchObject({ state: 'added' });
    failPut = 5;
    await expect(dismissOffered({ key: KEY, todo: offer() as never })).rejects.toThrow();   // Not needed that didn't save says so
    expect(day('2026-11-11')!.todos).toHaveLength(2);
  });
});
