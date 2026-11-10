// Arvy's changes, run against an in-memory copy of the planner's documents: each is worked out, made, and undone
// back to exactly what was there; bigger ones wait for Confirm; unclear requests are refused with the options.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { changeOf, toolsFor, system, TOOLS } from '../../../../supabase/functions/planner-arvy/tools';

const store = new Map<string, unknown>();
const k = (kind: string, key: string) => `${kind}|${key}`;
vi.mock('../../lib/docs', () => ({
  dayKey: () => '2026-11-10',
  calendarKey: () => '2026-11-10',
  docsChanged: vi.fn(),
  getDoc: async (kind: string, key: string) => structuredClone(store.get(k(kind, key)) ?? null),
  getDocs: async (kind: string, from?: string, to?: string) => [...store.entries()]
    .filter(([id]) => id.startsWith(`${kind}|`)).map(([id, data]) => ({ key: id.slice(kind.length + 1), data: structuredClone(data) }))
    .filter(d => (!from || d.key >= from) && (!to || d.key <= to)),
  putDoc: async (kind: string, key: string, data: unknown) => { store.set(k(kind, key), data); },
  putDocs: async (docs: { kind: string; key: string; data: unknown }[]) => { for (const d of docs) store.set(k(d.kind, d.key), d.data); },
}));
vi.mock('../../lib/auth', () => ({ getPass: () => ({ user: { username: 'rosh', settings: { units: 'lb' } } }) }));
vi.mock('../../lib/ai', () => ({
  invoke: vi.fn(),
  estimateFoodText: async () => ({ items: [{ name: 'Eggs', qty: '2', kcal: 140, protein: 12, carbs: 1, fat: 10 }, { name: 'Toast', qty: '1 slice', kcal: 80, protein: 3, carbs: 15, fat: 1 }] }),
}));
const { prepare, pick, Refuse } = await import('./act');

const snap = () => JSON.stringify([...store.entries()].filter(([, v]) => v !== null).sort());
beforeEach(() => {
  store.clear();
  store.set('day|2026-11-10', { todos: [{ id: 't1', text: 'Call the bank', done: false, from: 'me' }, { id: 't2', text: 'Email the bank about the mortgage', done: false, from: 'me' }] });
  store.set('shop|s1', { id: 's1', text: 'Milk', done: false, addedAt: '2026-11-01', by: 'vijay' });
  store.set('habit|h1', { id: 'h1', name: 'Read 10 pages', days: [], createdAt: '2026-01-01' });
  store.set('favmeal|f1', { id: 'f1', name: 'Protein shake', items: [], totals: { kcal: 250, protein: 40, carbs: 10, fat: 4 }, uses: 3, lastUsed: '2026-11-01' });
  store.set('budget|current', { Groceries: 650 });
  store.set('period|2026-10-15', { start: '2026-10-15', end: '2026-10-19', source: 'app' });
  store.set('event|2026-11-13~e1', { id: 'e1', title: 'Swim class', date: '2026-11-13', time: '10:00', endTime: '11:00', who: 'kiaan', repeat: 'weekly', createdAt: '2026-01-01' });
});

describe('Arvy changes', () => {
  it('every change tool can be worked out, and is marked now or confirm', async () => {
    const changes = TOOLS.filter(t => t.change);
    expect(changes.length).toBe(23);
    for (const t of changes) expect(['now', 'confirm']).toContain(changeOf(t.name));
    expect(changeOf('calendar')).toBeUndefined();
    expect(toolsFor('night').map(t => t.name)).toContain('add_event');
    expect(system({ name: 'Rosh' })).toMatch(/Confirm/);
  });

  it('adds to-dos with Undo, and undo puts the day back exactly', async () => {
    const before = snap();
    const c = (await prepare('add_todos', { todos: [{ text: 'Pick up Kiaan', time: '15:30', must: true }] }))!;
    expect(c.confirm).toBe(false);
    expect(c.lines[0]).toMatch(/3:30 PM Pick up Kiaan \(a must\)/);
    const undo = await c.apply();
    const day = store.get('day|2026-11-10') as { todos: { text: string; from: string }[] };
    expect(day.todos.map(t => t.text)).toContain('Pick up Kiaan');
    await undo();
    expect(snap()).toBe(before);
  });

  it('asks which one when a name matches more than one thing', async () => {
    await expect(prepare('complete_todos', { todos: ['bank'] })).rejects.toThrow(/more than one/);
    const c = (await prepare('complete_todos', { todos: ['call the bank'] }))!;
    await c.apply();
    expect((store.get('day|2026-11-10') as { todos: { id: string; done: boolean }[] }).todos.find(t => t.id === 't1')!.done).toBe(true);
    expect(pick(['Milk', 'Oat milk'], x => x, 'milk')).toBe('Milk');   // an exact name wins
  });

  it('adds shopping items, and undo removes only what it added', async () => {
    const before = snap();
    const c = (await prepare('add_shopping_items', { items: [{ text: 'Eggs', qty: '12' }, 'Bread'] }))!;
    const undo = await c.apply();
    expect([...store.keys()].filter(x => x.startsWith('shop|')).length).toBe(3);
    await undo();
    expect(snap()).toBe(before);
  });

  it('logs a meal from a description, and marks a habit', async () => {
    const meal = (await prepare('log_meal', { description: '2 eggs and toast', name: 'Breakfast', time: '08:15' }))!;
    expect(meal.lines[0]).toMatch(/Breakfast — 220 kcal, 15 g protein/);
    const undoMeal = await meal.apply();
    expect([...store.keys()].some(x => x.startsWith('meal|'))).toBe(true);
    await undoMeal();
    expect([...store.entries()].filter(([x, v]) => x.startsWith('meal|') && v)).toEqual([]);
    const h = (await prepare('mark_habit', { habit: 'reading', mark: 'done' }));
    expect(h).toBeTruthy();
  });

  it('calendar changes wait for Confirm; who defaults to the person talking', async () => {
    const c = (await prepare('add_event', { title: 'Dentist', date: '2026-11-14', time: '15:00' }))!;
    expect(c.confirm).toBe(true);
    expect(c.lines[0]).toMatch(/Dentist, .* 3 PM for Rosh/);
  });

  it('skips one day of a repeating event, or deletes the whole series, and undo brings it back', async () => {
    const before = snap();
    const one = (await prepare('delete_event', { date: '2026-11-20', title: 'swim', scope: 'this' }))!;
    expect(one.lines[0]).toMatch(/only/);
    const undo = await one.apply();
    expect((store.get('event|2026-11-13~e1') as { skip: string[] }).skip).toEqual(['2026-11-20']);
    await undo();
    expect(snap()).toBe(before);
    const all = (await prepare('delete_event', { date: '2026-11-20', scope: 'all' }))!;
    await all.apply();
    expect(store.get('event|2026-11-13~e1')).toBeNull();
  });

  it('moves a time and keeps the length; won’t move a repeating event to another day', async () => {
    const c = (await prepare('change_event', { date: '2026-11-13', new_time: '09:30' }))!;
    expect(c.lines[1]).toMatch(/9:30 AM–10:30 AM/);
    await expect(prepare('change_event', { date: '2026-11-13', new_date: '2026-11-14' })).rejects.toBeInstanceOf(Refuse);
  });

  it('refuses a made-up money category', async () => {
    await expect(prepare('add_cash_expense', { amount: 20, what: 'Market', category: 'Snacks' })).rejects.toThrow(/isn’t a category/);
  });

  it('phase 3: favourites, must-dos, habits, budget, targets', async () => {
    const before = snap();
    const fav = (await prepare('log_favourite_meal', { favourite: 'shake', time: '07:00' }))!;
    expect(fav.lines[0]).toMatch(/Protein shake — 250 kcal, 40 g protein/);
    const undo = await fav.apply();
    expect((store.get('favmeal|f1') as { uses: number }).uses).toBe(4);
    await undo();
    expect(snap()).toBe(before);
    const must = (await prepare('set_must', { todos: ['call the bank'] }))!;
    await must.apply();
    expect((store.get('day|2026-11-10') as { priorities: { text: string }[] }).priorities[0].text).toBe('Call the bank');
    const h = (await prepare('create_habit', { name: 'Stretch', days: ['mon', 'wed', 'Friday'], two_minute: 'one stretch' }))!;
    expect(h.confirm).toBe(true);
    expect(h.lines[0]).toBe('New habit: Stretch, Mon, Wed, Fri (mini: one stretch)');
    await expect(prepare('create_habit', { name: 'read 10 pages' })).rejects.toThrow(/already/);
    const p = (await prepare('pause_habit', { habit: 'reading' }))!;
    await p.apply();
    expect((store.get('habit|h1') as { archived: boolean }).archived).toBe(true);
    expect((await prepare('set_budget', { category: 'groceries', amount: 700 }))!.lines[0]).toBe('Budget: Groceries $650 → $700 a month');
    await expect(prepare('set_budget', { category: 'Income', amount: 10 })).rejects.toThrow(/spending/);
    expect((await prepare('set_food_targets', { protein: 170 }))!.lines[1]).toMatch(/2200 kcal, 170 g protein/);
  });

  it('phase 3: the cycle log and periods', async () => {
    const d = (await prepare('log_cycle_day', { symptoms: ['Cramps', 'unicorns'], mood: ['tired', 'calm'] }))!;
    expect(d.lines[0]).toBe('Cycle today: cramps; mood calm');
    await d.apply();
    await expect(prepare('log_cycle_day', { symptoms: ['unicorns'] })).rejects.toThrow(/Nothing I can log/);
    const start = (await prepare('log_period', { action: 'started' }))!;
    const undo = await start.apply();
    expect(store.get('period|2026-11-10')).toEqual({ start: '2026-11-10', end: '2026-11-14', source: 'app' });
    const end = (await prepare('log_period', { action: 'ended', date: '2026-11-12' }))!;
    await end.apply();
    expect((store.get('period|2026-11-10') as { end: string }).end).toBe('2026-11-12');
    await undo();
    expect(store.get('period|2026-11-10')).toBeNull();
  });
});
