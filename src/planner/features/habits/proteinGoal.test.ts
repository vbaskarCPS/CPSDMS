// The 'protein' trigger (proteinGoal.ts): when the day's logged protein first reaches the goal, and the habit ticking
// (or taking its tick back) as meals are logged, changed and removed, against an in-memory copy of the documents.
import { beforeEach, describe, expect, it, vi } from 'vitest';

const store = new Map<string, unknown>();
const k = (kind: string, key: string) => `${kind}|${key}`;
const list = (kind: string) => [...store.entries()].filter(([id, d]) => id.startsWith(`${kind}|`) && d !== null).map(([id, data]) => ({ key: id.slice(kind.length + 1), data: structuredClone(data), updated_at: '' }));
vi.mock('../../lib/docs', () => ({
  DAY_START_HOUR: 4,
  dayKey: () => '2026-11-12',
  getDoc: async (kind: string, key: string) => structuredClone(store.get(k(kind, key)) ?? null),
  getDocs: async (kind: string) => list(kind),
  getDayDocs: async (kind: string, from: string, to: string) => list(kind).filter(d => d.key.slice(0, 10) >= from && d.key.slice(0, 10) <= to),
  putDoc: async (kind: string, key: string, data: unknown) => { store.set(k(kind, key), data); },
  putDocs: async (docs: { kind: string; key: string; data: unknown }[]) => { for (const d of docs) store.set(k(d.kind, d.key), d.data); },
}));
const { proteinReachedAt, checkProteinGoal } = await import('./proteinGoal');

const D = '2026-11-12';
const at = (hm: string) => { const [h, m] = hm.split(':').map(Number); return new Date(2026, 10, 12, h, m).getTime(); };
const meal = (id: string, time: string, protein: number) => ({ id, date: D, time, name: id, items: [], totals: { kcal: 0, protein, carbs: 0, fat: 0 }, source: 'manual' });
const log = (m: ReturnType<typeof meal>) => store.set(k('meal', `${D}~${m.time}~${m.id}`), m);
const drop = (m: ReturnType<typeof meal>) => store.set(k('meal', `${D}~${m.time}~${m.id}`), null);
const ticked = () => (store.get(k('habitlog', D)) as Record<string, string> | undefined)?.p;
const habit = (more = {}) => store.set(k('habit', 'p'), { id: 'p', name: 'Log protein shake-plus-meal total before 3pm', auto: 'protein', days: [0, 1, 2, 3, 4, 5, 6], createdAt: '', order: 0, ...more });

describe('when the protein goal was reached', () => {
  it('one meal over the goal: that meal\'s time', () => {
    expect(proteinReachedAt([meal('a', '12:30', 190)], D, 180)).toBe(at('12:30'));
  });
  it('several: the one that took the total over, in the order of their times', () => {
    const ms = [meal('c', '14:40', 60), meal('a', '06:50', 50), meal('b', '09:00', 75), meal('d', '18:00', 40)];
    expect(proteinReachedAt(ms, D, 180)).toBe(at('14:40'));
    expect(proteinReachedAt(ms, D, 100)).toBe(at('09:00'));
  });
  it('not reached, no goal, or another day\'s meal: null', () => {
    expect(proteinReachedAt([meal('a', '09:00', 100)], D, 180)).toBeNull();
    expect(proteinReachedAt([meal('a', '09:00', 300)], D, undefined)).toBeNull();
    expect(proteinReachedAt([meal('a', '09:00', 300)], D, 0)).toBeNull();
    expect(proteinReachedAt([{ ...meal('a', '09:00', 300), date: '2026-11-11' }], D, 180)).toBeNull();
  });
  it('rounded the way Food shows it: 179.6 g reads as 180', () => {
    expect(proteinReachedAt([meal('a', '09:00', 100.3), meal('b', '10:00', 79.3)], D, 180)).toBe(at('10:00'));
  });
});

describe('the habit "the day\'s protein goal is logged", by 3 pm', () => {
  beforeEach(() => { store.clear(); store.set(k('foodprefs', 'targets'), { kcal: 2200, protein: 180 }); habit({ by: '15:00' }); });

  it('reached before 3 pm: ticked', async () => {
    log(meal('a', '07:00', 50)); await checkProteinGoal(D); expect(ticked()).toBeUndefined();
    log(meal('b', '11:30', 70)); await checkProteinGoal(D); expect(ticked()).toBeUndefined();
    log(meal('c', '14:20', 65)); await checkProteinGoal(D); expect(ticked()).toBe('done');
  });
  it('reached only after 3 pm: not ticked', async () => {
    log(meal('a', '09:00', 100)); log(meal('b', '15:10', 100));
    await checkProteinGoal(D);
    expect(ticked()).toBeUndefined();
  });
  it('a meal edited up to the goal ticks it; edited back down takes the tick back', async () => {
    const m = meal('a', '12:00', 150); log(m); await checkProteinGoal(D); expect(ticked()).toBeUndefined();
    log({ ...m, totals: { ...m.totals, protein: 185 } }); await checkProteinGoal(D); expect(ticked()).toBe('done');
    log({ ...m, totals: { ...m.totals, protein: 120 } }); await checkProteinGoal(D); expect(ticked()).toBeUndefined();
  });
  it('a meal removed under the goal takes the tick back, but never a tick made by hand', async () => {
    const a = meal('a', '09:00', 100), b = meal('b', '12:00', 100);
    log(a); log(b); await checkProteinGoal(D); expect(ticked()).toBe('done');
    drop(b); await checkProteinGoal(D); expect(ticked()).toBeUndefined();
    // ticked by hand, then a meal goes: the hand tick stays
    store.set(k('habitlog', D), { p: 'done' });
    await checkProteinGoal(D);
    expect(ticked()).toBe('done');
  });
  it('no goal set in Food: nothing changes', async () => {
    store.delete(k('foodprefs', 'targets'));
    log(meal('a', '09:00', 400)); await checkProteinGoal(D);
    expect(ticked()).toBeUndefined();
  });
  it('without a time rule, reached at any time ticks it', async () => {
    habit();
    log(meal('a', '20:00', 200)); await checkProteinGoal(D);
    expect(ticked()).toBe('done');
  });
});
