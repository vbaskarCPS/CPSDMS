// The first-open set-up (lib/setup.ts): who gets it, and what its screens turn her answers into.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Habit } from '../features/habits/types';
import type { PlannerUser } from './auth';

const store = new Map<string, unknown>();
let offline = false, slow = false;
vi.mock('./docs', () => ({
  dayKey: () => '2026-11-11',
  getDoc: async (kind: string, key: string) => { if (offline) throw new Error('Failed to fetch'); if (slow) await new Promise(r => setTimeout(r, 200)); return store.get(`${kind}|${key}`) ?? null; },
  putDoc: async (kind: string, key: string, data: unknown) => { if (offline) throw new Error('Failed to fetch'); store.set(`${kind}|${key}`, data); },
}));
const mem = () => { const m = new Map<string, string>(); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v); }, clear: () => m.clear() }; };
const local = mem(), session = mem();
vi.stubGlobal('localStorage', local);
vi.stubGlobal('sessionStorage', session);
vi.stubGlobal('location', { pathname: '/roshplanner/' });

const { answersFrom, answersProblem, applyAnswers, finishSetup, habitChoices, habitSaves, setupDue, setupLater, setupSkipped } = await import('./setup');
const { MORNING_ROUTINE, blocks } = await import('./routine');

const rosh: PlannerUser = { id: 'u-rosh', username: 'rosh', display_name: 'Rosh', settings: { app: 'roshplanner', profile: 'morning' } };
const vijay: PlannerUser = { id: 'u-vijay', username: 'vijay', display_name: 'Vijay', settings: { app: 'vijayplanner', profile: 'night' } };
// her routine as it was saved on 11 November: up at 8, the same time as Kiaan
const HERS = { ...MORNING_ROUTINE, wake: '08:00' };

beforeEach(() => { store.clear(); local.clear(); session.clear(); offline = false; slow = false; });

describe('who gets the set-up', () => {
  it('Rosh, until it’s done; never Vijay', async () => {
    expect(setupSkipped(vijay)).toBe(true);
    expect(await setupDue(vijay)).toBe(false);
    expect(setupSkipped(rosh)).toBe(false);
    expect(await setupDue(rosh)).toBe(true);
    await finishSetup(rosh);
    expect(store.get('prefs|setup')).toMatchObject({ done: true });
    expect(setupSkipped(rosh)).toBe(true);     // this phone knows without asking
    expect(await setupDue(rosh)).toBe(false);
  });
  it('done on one phone is done on her other one', async () => {
    store.set('prefs|setup', { done: true, at: '2026-11-11T19:00:00Z' });
    expect(setupSkipped(rosh)).toBe(false);    // this phone hasn't heard yet…
    expect(await setupDue(rosh)).toBe(false);  // …the account has
    expect(setupSkipped(rosh)).toBe(true);
  });
  it('“Not now” puts it off for this visit only', async () => {
    setupLater();
    expect(await setupDue(rosh)).toBe(false);
    session.clear();                            // the planner is opened again
    expect(await setupDue(rosh)).toBe(true);
  });
  it('can’t reach the server: the planner opens instead of waiting', async () => {
    offline = true;
    expect(await setupDue(rosh)).toBe(false);
    offline = false; slow = true;               // or it answers too slowly
    expect(await setupDue(rosh, 20)).toBe(false);
    expect(setupSkipped(rosh)).toBe(false);     // nothing remembered: it's asked again next time
    slow = false;
    expect(await setupDue(rosh)).toBe(true);
  });
});

describe('her day’s times', () => {
  it('starts with what she has now', () => {
    expect(answersFrom(HERS)).toEqual({ wake: '08:00', routine: true, stretchMin: 10, meditateMin: 10, workoutMin: 20, kiaanUp: '08:00', dinner: '18:00', bed: '21:00' });
    // no morning routine now: off, with the usual minutes ready if she turns it on
    expect(answersFrom({ ...HERS, stretchMin: 0, meditateMin: 0, workoutMin: 0 })).toMatchObject({ routine: false, stretchMin: 10, meditateMin: 10, workoutMin: 20 });
  });
  it('no morning routine: her day starts with the Brief, and nothing she wasn’t asked about changes', () => {
    const r = applyAnswers(HERS, { ...answersFrom(HERS), routine: false, kiaanUp: '07:45', dinner: '18:30', bed: '22:00' });
    expect(r).toMatchObject({ wake: '08:00', stretchMin: 0, meditateMin: 0, workoutMin: 0, kiaanUp: '07:45', eatOpen: '18:30', lightsOut: '22:00', windDown: '21:45', profile: 'morning', fast: false, wakeGrace: 30 });
    expect(blocks(r).map(b => `${b.at} ${b.label}`)).toEqual(['08:00 Up', '08:00 Morning Brief', '07:45 Kiaan up', '07:45 Tackle the list', '18:30 Dinner', '21:30 Evening review', '22:00 Bed with Kiaan']);
  });
  it('a morning routine keeps the minutes she gave, within reason', () => {
    const r = applyAnswers(HERS, { ...answersFrom(HERS), wake: '06:30', stretchMin: 5, meditateMin: 0, workoutMin: 400 });
    expect(r).toMatchObject({ wake: '06:30', stretchMin: 5, meditateMin: 0, workoutMin: 90 });
    expect(blocks(r).find(b => b.id === 'morning')).toMatchObject({ at: '06:30', until: '08:05', blurb: 'stretch 5 · move 90' });
  });
  it('says what’s missing before it can be saved', () => {
    expect(answersProblem(answersFrom(HERS))).toBeNull();
    expect(answersProblem({ ...answersFrom(HERS), bed: '' })).toBe('Fill in all four times.');
    expect(answersProblem({ ...answersFrom(HERS), stretchMin: 0, meditateMin: 0, workoutMin: 0 })).toMatch(/some minutes, or switch it off/);
    expect(answersProblem({ ...answersFrom(HERS), routine: false, stretchMin: 0, meditateMin: 0, workoutMin: 0 })).toBeNull();
  });
});

describe('her habits', () => {
  const mk = (id: string, order: number, h: Partial<Habit>): Habit => ({ id, order, name: '', identity: '', cue: { time: '', place: '' }, stack: '', twoMinute: '', why: '', days: [0, 1, 2, 3, 4, 5, 6], createdAt: '2026-10-31T00:10:17.717Z', ...h });
  // the four every planner starts with (features/habits/seed.ts), as they are in hers
  const seeded = [
    mk('h-brief', 0, { name: 'Bed Brief before getting up', identity: 'someone who decides the day before the day decides him', cue: { time: '05:30', place: 'in bed' }, stack: 'After I wake up with Kiaan', twoMinute: 'Write one word and one priority', auto: 'brief', anchor: { block: 'wake', when: 'after' } }),
    mk('h-fast', 1, { name: 'No food before 6', auto: 'fast', twoMinute: 'Drink a glass of water instead' }),
    mk('h-shake', 2, { name: 'Shake after gym', auto: 'shake' }),
    mk('h-lights', 3, { name: 'Lights out by 1', identity: 'someone who protects his mornings the night before', cue: { time: '21:00', place: 'bedroom' }, auto: 'lightsOut', anchor: { block: 'unwind', when: 'after' } }),
  ];
  let n = 0;
  const id = () => `new-${++n}`;
  beforeEach(() => { n = 0; });

  it('fits the starter habits to her day, and offers a few new ones', () => {
    const rows = habitChoices(seeded, { ...HERS, lightsOut: '21:30' }, id, '2026-11-11T19:00:00Z');
    expect(rows.map(r => `${r.on ? '✓' : '·'} ${r.title}${r.has ? '' : ' (new)'}`)).toEqual([
      '✓ Morning Brief', '· No food before 6', '· Shake after gym', '✓ In bed by 9:30 pm',
      '· Glass of water first thing (new)', '· 10-minute walk (new)', '· Read 10 pages (new)']);
    expect(rows[0].habit).toMatchObject({ id: 'h-brief', name: 'Morning Brief', auto: 'brief', identity: 'someone who decides her day before it starts', cue: { time: '08:40', place: 'somewhere quiet' }, stack: 'After my morning routine', createdAt: '2026-10-31T00:10:17.717Z' });
    expect(rows[0].note).toMatch(/“Bed Brief before getting up”/);
    expect(rows[3].habit).toMatchObject({ id: 'h-lights', name: 'In bed by 9:30 pm', auto: 'lightsOut', cue: { time: '21:30', place: 'bedroom' }, anchor: { block: 'evening', when: 'after' } });
    expect(rows[6].habit).toMatchObject({ id: 'new-3', order: 6, cue: { time: '21:00', place: 'in bed' } });
  });
  it('saves only what changed: the fitted ones, the paused ones as they were worded, and the new ones she ticked', () => {
    const rows = habitChoices(seeded, HERS, id, '2026-11-11T19:00:00Z');
    rows[3].on = false;   // she'd rather not have the bedtime one
    rows[4].on = true;    // water, yes
    expect(habitSaves(rows).map(d => `${d.key}: ${d.data.name}${d.data.archived ? ' (paused)' : ''}`)).toEqual([
      'h-brief: Morning Brief', 'h-fast: No food before 6 (paused)', 'h-shake: Shake after gym (paused)', 'h-lights: Lights out by 1 (paused)', 'new-1: Glass of water first thing']);
  });
  it('her own habits are kept as they are, an eating-window habit stays when she follows one, and nothing is offered twice', () => {
    const own = [mk('h-own', 0, { name: 'Call mom', twoMinute: 'Send a text.' }), mk('h-fast', 1, { name: 'No food before 6', auto: 'fast' }), mk('h-old', 2, { name: 'Journal', archived: true }), mk('h-read', 3, { name: 'read 10 pages' })];
    const rows = habitChoices(own, { ...HERS, fast: true }, id);
    expect(rows.map(r => `${r.on ? '✓' : '·'} ${r.title}`)).toEqual(['✓ Call mom', '✓ No food before 6', '✓ read 10 pages', '· Glass of water first thing', '· 10-minute walk']);
    expect(rows[0].note).toBe('Small version: Send a text.');
    expect(habitSaves(rows)).toEqual([]);   // left as they are: nothing to save
  });
});
