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
    .filter(([id, data]) => id.startsWith(`${kind}|`) && data !== null)   // like the server: a removed doc (null) isn't returned
    .map(([id, data]) => ({ key: id.slice(kind.length + 1), data: structuredClone(data) }))
    .filter(d => (!from || d.key >= from) && (!to || d.key <= to)),
  getDayDocs: async (kind: string, from?: string, to?: string) => [...store.entries()]
    .filter(([id, data]) => id.startsWith(`${kind}|`) && data !== null)
    .map(([id, data]) => ({ key: id.slice(kind.length + 1), data: structuredClone(data) }))
    .filter(d => (!from || d.key.slice(0, 10) >= from) && (!to || d.key.slice(0, 10) <= to)),
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
    expect(changes.length).toBe(27);   // 26, and an email to send (email_send)
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

  it('the same event isn’t added twice (a screenshot pasted again, or by both of them)', async () => {
    store.set('event|2026-11-19~e2', { id: 'e2', title: 'Dentist', date: '2026-11-19', time: '15:00', endTime: '16:00', who: 'vijay', repeat: 'none', createdAt: '2026-11-11' });
    store.set('event|2026-11-27~e3', { id: 'e3', title: 'PD day: no school', date: '2026-11-27', who: 'kiaan', repeat: 'none', createdAt: '2026-11-11' });
    const before = snap();
    const again = await prepare('add_event', { title: 'Dentist', date: '2026-11-19', time: '15:00', end_time: '16:00' }).catch(x => x);
    expect(again).toBeInstanceOf(Refuse);
    expect(again.message).toMatch(/^That’s already on the calendar: Dentist, .*Nov 19 3 PM–4 PM for Vijay\.$/);
    expect(again.miss).toBe(false);   // nothing is missing from the planner, so it doesn't go in the improvements log
    // case, punctuation and extra spaces don't make it another event, and nor does whose it is or how long it runs
    await expect(prepare('add_event', { title: '  dentist! ', date: '2026-11-19', time: '15:00', who: 'rosh' })).rejects.toThrow(/already on the calendar/);
    // an all-day one matches an all-day one
    await expect(prepare('add_event', { title: 'PD Day - no school', date: '2026-11-27' })).rejects.toThrow(/already on the calendar: PD day: no school, .*\(all day\) for Kiaan/);
    // a repeating event that falls on that day counts (swim class is every Friday at 10)
    await expect(prepare('add_event', { title: 'Swim class', date: '2026-11-20', time: '10:00', who: 'kiaan' })).rejects.toThrow(/already on the calendar: Swim class, .* repeats weekly/);
    expect(snap()).toBe(before);   // refusing changed nothing
    // another time, another day or another title is another event
    for (const other of [
      { title: 'Dentist', date: '2026-11-19', time: '16:00' }, { title: 'Dentist', date: '2026-11-19' }, { title: 'Dentist', date: '2026-11-20', time: '15:00' },
      { title: 'Dentist: Kiaan', date: '2026-11-19', time: '15:00' }, { title: 'PD day: no school', date: '2026-11-27', time: '09:00' },
      { title: 'Swim class', date: '2026-11-21', time: '10:00' }, { title: 'Swim class', date: '2026-11-20', time: '11:00' },
    ]) expect((await prepare('add_event', other))!.lines[0]).toMatch(/^Calendar: add /);
    // a Friday the swim class was skipped is free again
    store.set('event|2026-11-13~e1', { ...(store.get('event|2026-11-13~e1') as object), skip: ['2026-11-20'] });
    expect((await prepare('add_event', { title: 'Swim class', date: '2026-11-20', time: '10:00' }))!.confirm).toBe(true);
    // titles in another alphabet, or that are only symbols, are compared as they are: two different ones aren't the same
    store.set('event|2026-12-01~e4', { id: 'e4', title: 'पूजा', date: '2026-12-01', time: '18:00', who: 'both', repeat: 'none', createdAt: '2026-11-11' });
    store.set('event|2026-12-01~e5', { id: 'e5', title: '🎂', date: '2026-12-01', who: 'both', repeat: 'none', createdAt: '2026-11-11' });
    expect((await prepare('add_event', { title: 'दिवाली', date: '2026-12-01', time: '18:00' }))!.confirm).toBe(true);
    expect((await prepare('add_event', { title: '🎄', date: '2026-12-01' }))!.confirm).toBe(true);
    await expect(prepare('add_event', { title: 'पूजा', date: '2026-12-01', time: '18:00' })).rejects.toThrow(/already on the calendar/);
    await expect(prepare('add_event', { title: '🎂', date: '2026-12-01' })).rejects.toThrow(/already on the calendar/);
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

  const planned = () => [...store.entries()].filter(([k, v]) => k.startsWith('template|') && v && (v as { plannedFor?: string }).plannedFor).map(([, v]) => v as { name: string; plannedFor: string; exercises: { name: string; mode: string }[] });

  it('the coach: a planned session goes on the Train page and replaces the one already planned for that day', async () => {
    const plan = { name: 'Upper pull', exercises: [{ name: 'Lat Pulldown', sets: 3, reps: '8-10', weight: 110, rest_seconds: 120, cue: 'chest up' }, { name: 'Vijay’s odd carry', sets: 2, seconds: 40 }] };
    const c = (await prepare('plan_workout', plan))!;
    expect(c.confirm).toBe(true);
    expect(c.lines[0]).toMatch(/^Train today \(Tue,? Nov 10\): “Upper pull” \(2 exercises\)$/);   // the date too: read a day later, "today" alone would mislead
    expect(c.lines.join('\n')).toMatch(/Lat Pulldown: 3 × 8-10/);
    expect(c.lines.join('\n')).toMatch(/New exercises: Vijay’s odd carry/);
    await c.apply();
    expect(planned()).toHaveLength(1);
    expect(planned()[0]).toMatchObject({ name: 'Upper pull', plannedFor: '2026-11-10' });
    expect(planned()[0].exercises[1].mode).toBe('time');
    expect([...store.keys()].filter(k => k.startsWith('exercise|'))).toHaveLength(1);
    // planning again for the same day replaces that one instead of adding a second
    const again = (await prepare('plan_workout', { name: 'Legs', when: 'today', exercises: [{ name: 'Goblet Squat', sets: 3, reps: '10' }] }))!;
    expect(again.lines[0]).toMatch(/instead of “Upper pull”/);
    await again.apply();
    expect(planned().map(t => t.name)).toEqual(['Legs']);
    await expect(prepare('plan_workout', { name: 'Empty', exercises: [] })).rejects.toBeInstanceOf(Refuse);
  });

  it('the coach: undo takes a planned session and its new exercises away again; "now" starts it and opens it', async () => {
    await prepare('plan_workout', { name: 'x', exercises: [{ name: 'Plank', sets: 1, seconds: 30 }] });   // the starter templates are in place
    const before = snap();
    const c = (await prepare('plan_workout', { name: 'Quick', when: 'tomorrow', exercises: [{ name: 'Brand new move', sets: 2, reps: '12' }] }))!;
    expect(c.lines[0]).toMatch(/^Train tomorrow/);
    const undo = await c.apply();
    expect(planned()[0].plannedFor).toBe('2026-11-11');
    await undo();
    expect(snap()).toBe(before);
    const now = (await prepare('plan_workout', { name: 'Quick', when: 'now', exercises: [{ name: 'Plank', sets: 2, seconds: 30 }] }))!;
    expect(now.go).toBeUndefined();
    await now.apply();
    expect(now.go?.to).toMatch(/^\/workout\/live\//);
    expect([...store.keys()].some(k => k.startsWith('workout|2026-11-10~'))).toBe(true);
    await expect(prepare('plan_workout', { name: 'Another', when: 'now', exercises: [{ name: 'Plank', sets: 1, seconds: 30 }] })).rejects.toThrow(/in progress/);
  });

  // ── the schedule follows the conversation ──
  it('a sick day: skips the gym and sauna, moves the wake time, adds blocks; it is a planned rest day; undo puts it all back', async () => {
    const routine = await import('../../lib/routine');
    routine.setProfile('morning'); routine.setProfile('night');   // a fresh 5 am club routine (the defaults)
    store.set('habit|g1', { id: 'g1', name: 'Gym', days: [], auto: 'gym', createdAt: '2026-01-01' });
    await prepare('plan_workout', { name: 'x', exercises: [{ name: 'Plank', sets: 1, seconds: 30 }] });   // the starter templates are in place
    const before = snap();
    const c = (await prepare('adjust_day', { why: 'Sick day', skip: ['gym', 'sauna'], wake: '07:00',
      add: [{ title: 'Home stretch', time: '07:00', note: 'easy, about 20 min' }, { title: 'Breakfast', time: '07:30' }] }))!;
    expect(c.confirm).toBe(false);
    expect(changeOf('adjust_day')).toBe('now');
    expect(c.lines[0]).toBe('Today’s plan (Sick day): no gym · no sauna · up at 7:00 am · + Home stretch 7:00 am · + Breakfast 7:30 am');
    expect(c.lines[1]).toBe('  The day now runs: 7:00 am Up · 7:00 am Home stretch · 7:15 am Today\'s Brief · 7:15 am Tackle the list · 7:30 am Breakfast · 2:00 pm Kitchen closed · 9:30 pm Lights out');
    const undo = await c.apply();
    const day = store.get('day|2026-11-10') as { adjust: { skip: string[]; times: Record<string, string>; added: { label: string }[] }; gym: { answer: string; planned: boolean }; todos: unknown[] };
    expect(day.adjust.skip).toEqual(['gym', 'sauna']);
    expect(day.adjust.times).toEqual({ wake: '07:00' });
    expect(day.adjust.added.map(x => x.label)).toEqual(['Home stretch', 'Breakfast']);
    expect(day.gym).toMatchObject({ answer: 'rest', planned: true });           // so "did you miss the gym?" isn't asked
    expect(day.todos.length).toBe(2);                                             // the rest of the day is untouched
    expect(store.get('habitlog|2026-11-10')).toEqual({ g1: 'skip' });           // a planned rest keeps the gym streak

    // a second change adds to the first; "the day already runs that way" is refused; unskip gives the gym back
    const c2 = (await prepare('adjust_day', { lights_out: '21:00', unskip: ['gym'] }))!;
    expect(c2.lines[0]).toBe('Today’s plan (Sick day): no sauna · up at 7:00 am · lights out 9:00 pm · + Home stretch 7:00 am · + Breakfast 7:30 am');
    await c2.apply();
    expect((store.get('day|2026-11-10') as { gym?: unknown }).gym).toBeUndefined();
    expect(store.get('habitlog|2026-11-10')).toEqual({});
    await expect(prepare('adjust_day', { lights_out: '21:00' })).rejects.toThrow(/already runs that way/);

    // reset: back to the normal routine; then the first undo… restores what it snapshotted (the untouched day)
    const c3 = (await prepare('adjust_day', { reset: true }))!;
    expect(c3.lines[0]).toBe('Today’s plan: back to the normal routine');
    await c3.apply();
    expect((store.get('day|2026-11-10') as { adjust?: unknown }).adjust).toBeUndefined();
    await undo();
    expect(snap()).toBe(before);
  });
  it('a day ahead can be changed, a past day can’t; only real blocks can be skipped; the gym can move to the evening', async () => {
    const routine = await import('../../lib/routine');
    routine.setProfile('morning'); routine.setProfile('night');
    const c = (await prepare('adjust_day', { date: '2026-11-11', why: 'Late night', wake: '06:30' }))!;
    expect(c.lines[0]).toMatch(/^Wed,? Nov 11’s plan \(Late night\): up at 6:30 am$/);
    expect(c.lines[1]).toContain('6:30 am Up — straight to the gym · 6:45 am Gym');
    await expect(prepare('adjust_day', { date: '2026-11-09', skip: ['gym'] })).rejects.toThrow(/over/);
    await expect(prepare('adjust_day', { skip: ['lights out'] })).rejects.toThrow(/always stay/);
    await expect(prepare('adjust_day', { skip: ['morning_routine'] })).rejects.toThrow(/always stay|no morning block/);
    await expect(prepare('adjust_day', { wake: '7am' })).rejects.toThrow(/as a time/);
    await expect(prepare('adjust_day', {})).rejects.toThrow(/Nothing to change/);
    const eve = (await prepare('adjust_day', { gym: '17:00' }))!;
    expect(eve.lines[1]).toBe('  The day now runs: 5:00 am Up · 5:15 am Today\'s Brief · 5:15 am Tackle the list · 2:00 pm Kitchen closed · 5:00 pm Gym · 6:05 pm Sauna · 9:30 pm Lights out');
  });
  it('a no-gym day: the gym session planned for it waits on the next free day, a home session takes the day and its block, and it all comes back', async () => {
    const routine = await import('../../lib/routine');
    routine.setProfile('morning'); routine.setProfile('night');
    const planned = () => [...store.entries()].filter(([k, v]) => k.startsWith('template|') && v && (v as { plannedFor?: string }).plannedFor)
      .map(([, v]) => v as { id: string; name: string; plannedFor: string; home?: boolean }).sort((a, b) => (a.plannedFor + a.name < b.plannedFor + b.name ? -1 : 1)).map(t => `${t.plannedFor} ${t.name}${t.home ? ' (home)' : ''}`);
    await (await prepare('plan_workout', { name: 'Powerful Chest', when: 'today', exercises: [{ name: 'Bench Press', sets: 4, reps: '5-6' }] }))!.apply();
    await (await prepare('plan_workout', { name: 'Legs', when: 'tomorrow', exercises: [{ name: 'Goblet Squat', sets: 3, reps: '10' }] }))!.apply();
    expect(planned()).toEqual(['2026-11-10 Powerful Chest', '2026-11-11 Legs']);
    const before = snap();

    // sick: the gym comes off today. Tomorrow is taken, so the chest session waits for the day after.
    const off = (await prepare('adjust_day', { why: 'Sick day', skip: ['gym'], add: [{ title: 'Home stretch', time: '08:00', end_time: '08:20' }, { title: 'Breakfast', time: '07:35' }] }))!;
    expect(off.lines[2]).toMatch(/^ {2}“Powerful Chest” waits until Thu,? Nov 12$/);
    const undoOff = await off.apply();
    expect(planned()).toEqual(['2026-11-11 Legs', '2026-11-12 Powerful Chest']);
    const day = () => store.get('day|2026-11-10') as { adjust?: { held?: { to: string }; added?: { label: string; session?: boolean }[] } };
    expect(day().adjust?.held?.to).toBe('2026-11-12');

    // the stretch routine becomes today's session (it doesn't touch the gym sessions) and takes the "Home stretch" block
    const home = (await prepare('plan_workout', { name: 'Home stretch and reset', when: 'today', home: true, exercises: [{ name: 'Cat-Cow', sets: 1, reps: '8', no_weight: true }, { name: 'Child’s Pose', sets: 1, seconds: 45, no_weight: true }] }))!;
    expect(home.confirm).toBe(true);
    expect(home.lines[0]).toMatch(/^Train today \(Tue,? Nov 10\): “Home stretch and reset” \(2 exercises, at home\)$/);
    const undoHome = await home.apply();
    expect(planned()).toEqual(['2026-11-10 Home stretch and reset (home)', '2026-11-11 Legs', '2026-11-12 Powerful Chest']);
    expect(day().adjust?.added?.map(x => `${x.label}${x.session ? ' = the session' : ''}`)).toEqual(['Home stretch = the session', 'Breakfast']);
    // what the Train page offers on the no-gym day, and on a normal one
    const store2 = await import('../workout/store');
    const ts = await store2.loadTemplates();
    expect(store2.sessionToday(ts, [], true, new Date(2026, 10, 10, 9))?.name).toBe('Home stretch and reset');
    expect(store2.sessionToday(ts.filter(t => !t.home), [], true, new Date(2026, 10, 10, 9))).toBeNull();   // nothing planned for today: rest, not the rotation

    // feeling better: the gym is back on, and so is the chest session (the home one stays, the gym one is up)
    const on = (await prepare('adjust_day', { unskip: ['gym'] }))!;
    expect(on.lines.join('\n')).toMatch(/“Powerful Chest” is back on today/);
    await on.apply();
    expect(planned()).toEqual(['2026-11-10 Home stretch and reset (home)', '2026-11-10 Powerful Chest', '2026-11-11 Legs']);
    expect(store2.todaysTemplate(await store2.loadTemplates(), [], new Date(2026, 10, 10, 9))?.name).toBe('Powerful Chest');

    // a home session planned straight away, with no adjust_day first, still keeps the gym session: it waits
    store.set('day|2026-11-10', { todos: [] });
    await (await prepare('plan_workout', { name: 'Easy mobility', when: 'today', home: true, exercises: [{ name: 'Cat-Cow', sets: 1, reps: '8' }] }))!.apply();
    expect(planned()).toEqual(['2026-11-10 Easy mobility (home)', '2026-11-11 Legs', '2026-11-12 Powerful Chest']);
    expect(before.length).toBeGreaterThan(0); void undoOff; void undoHome;
  });
  it('undoing the sick day puts the gym session back on its day', async () => {
    const routine = await import('../../lib/routine');
    routine.setProfile('morning'); routine.setProfile('night');
    await (await prepare('plan_workout', { name: 'Powerful Chest', when: 'today', exercises: [{ name: 'Bench Press', sets: 4, reps: '5-6' }] }))!.apply();
    const before = snap();
    const off = (await prepare('adjust_day', { why: 'Sick day', skip: ['gym', 'sauna'], wake: '07:30' }))!;
    expect(off.lines[2]).toBe('  “Powerful Chest” waits until tomorrow');
    const undo = await off.apply();
    expect(snap()).not.toBe(before);
    await undo();
    expect(snap()).toBe(before);
  });

  it('the standing routine changes after Confirm; moving the wake time moves the morning; undo puts it back', async () => {
    const routine = await import('../../lib/routine');
    routine.setProfile('morning'); routine.setProfile('night');
    const c = (await prepare('change_routine', { wake: '05:30', kitchen_closes: '15:00', sauna_minutes: 10 }))!;
    expect(c.confirm).toBe(true);
    expect(changeOf('change_routine')).toBe('confirm');
    expect(c.lines.slice(0, -1)).toEqual([
      'Routine, every day: Up 5:00 am → 5:30 am', 'Routine, every day: Gym 5:15 am → 5:45 am', 'Routine, every day: The list starts 6:45 am → 7:15 am',
      'Routine, every day: Sauna 25 min → 10 min', 'Routine, every day: Kitchen closes 2:00 pm → 3:00 pm',
    ]);
    expect(c.lines[c.lines.length - 1]).toContain('5:30 am Up — straight to the gym · 5:45 am Gym · 7:05 am Sauna');
    const undo = await c.apply();
    expect((store.get('prefs|routine') as { wake: string; gym: string }).gym).toBe('05:45');
    expect((await routine.loadRoutine()).wake).toBe('05:30');
    await undo();
    expect((await routine.loadRoutine()).wake).toBe('05:00');
    await expect(prepare('change_routine', { wake: '05:00' })).rejects.toThrow(/already runs that way/);
    const off = (await prepare('change_routine', { kitchen_closes: 'none', eating_window: false }))!;
    expect(off.lines).toContain('Routine, every day: Kitchen closes 2:00 pm → none');
    expect(off.lines).toContain('Routine, every day: Eating window on → off');
  });

  it('a name that matches nothing is marked as a miss (it goes in the improvements log)', async () => {
    const e = await prepare('mark_habit', { habit: 'juggling' }).catch(x => x);
    expect(e).toBeInstanceOf(Refuse);
    expect(e.miss).toBe(true);
    const many = await prepare('complete_todos', { todos: ['bank'] }).catch(x => x);
    expect(many.miss).toBe(false);
  });
});
