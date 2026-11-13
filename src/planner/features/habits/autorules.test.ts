// Habits that tick themselves, held to their rules (auto.ts + rules.ts): I'm up "by 5:05" from each place that sets
// Up, Start workout within 30 minutes of Up as it always was, and un-ticking that ignores the rules.
import { beforeEach, describe, expect, it, vi } from 'vitest';

const store = new Map<string, unknown>();
const k = (kind: string, key: string) => `${kind}|${key}`;
const list = (kind: string) => [...store.entries()].filter(([id, d]) => id.startsWith(`${kind}|`) && d !== null).map(([id, data]) => ({ key: id.slice(kind.length + 1), data: structuredClone(data), updated_at: '' }));
vi.mock('../../lib/docs', () => ({
  DAY_START_HOUR: 4,
  dayKey: (d = new Date()) => { const s = new Date(d.getTime() - 4 * 3600_000); const p = (n: number) => String(n).padStart(2, '0'); return `${s.getFullYear()}-${p(s.getMonth() + 1)}-${p(s.getDate())}`; },
  getDoc: async (kind: string, key: string) => structuredClone(store.get(k(kind, key)) ?? null),
  getDocs: async (kind: string) => list(kind),
  putDoc: async (kind: string, key: string, data: unknown) => { store.set(k(kind, key), data); },
  putDocs: async (docs: { kind: string; key: string; data: unknown }[]) => { for (const d of docs) store.set(k(d.kind, d.key), d.data); },
}));
const { autoMark, markGymStart, markWake } = await import('./auto');
const { fillUp } = await import('../plan/types');

const D = '2026-11-12';
const t = (hm: string) => { const [h, m] = hm.split(':').map(Number); return new Date(2026, 10, 12, h, m); };
const mark = (id: string) => (store.get(k('habitlog', D)) as Record<string, string> | undefined)?.[id];
const habit = (id: string, more: Record<string, unknown>) => store.set(k('habit', id), { id, name: id, days: [0, 1, 2, 3, 4, 5, 6], createdAt: '', order: 0, ...more });

beforeEach(() => { store.clear(); habit('up', { auto: 'wake', by: '05:05' }); });

describe('Up at 5, by 5:05', () => {
  it('ticked at 5:04: done; at 5:06: not', async () => {
    await markWake(t('05:04').getTime(), D);
    expect(mark('up')).toBe('done');
    store.delete(k('habitlog', D));
    await markWake(t('05:06').getTime(), D);
    expect(mark('up')).toBeUndefined();
  });
  it('Up undone unticks it, whatever the time', async () => {
    await markWake(t('05:01').getTime(), D);
    await autoMark('wake', false, D);
    expect(mark('up')).toBeUndefined();
  });
  it('a habit with no rule still ticks at any time', async () => {
    habit('plain', { auto: 'wake' });
    await markWake(t('07:30').getTime(), D);
    expect(mark('plain')).toBe('done');
    expect(mark('up')).toBeUndefined();
  });
  it('a trigger called with no moment never ticks a habit with a rule', async () => {
    await autoMark('wake', true, D);
    expect(mark('up')).toBeUndefined();
  });
});

describe('the three places that set Up the first time fill it the same way', () => {
  // Today's tick, the Miracle Morning's Start and the Brief's first open all use fillUp, then markWake with its moment
  const empty = { ticks: {} as { up?: string; upAt?: string } };
  it('Today, the Miracle Morning, the Brief: Up and its exact moment, and the habit by that moment', async () => {
    for (const hm of ['05:04', '05:06']) {
      store.delete(k('habitlog', D));
      const now = t(hm), d = fillUp(empty, now);
      expect(d.ticks.up).toBe(hm);
      expect(d.ticks.upAt).toBe(now.toISOString());
      await markWake(Date.parse(d.ticks.upAt!), D);
      expect(mark('up')).toBe(hm === '05:04' ? 'done' : undefined);
    }
  });
  it('a day already up is left as it is', () => {
    const d = { ticks: { up: '05:02', upAt: t('05:02').toISOString() } };
    expect(fillUp(d, t('06:00'))).toBe(d);
  });
});

describe('Start workout within 30 minutes of Up, through the same rules', () => {
  beforeEach(() => { habit('gym', { auto: 'gymStart' }); store.set(k('day', D), { ticks: { up: '05:20', upAt: t('05:20').toISOString() } }); });
  it('29 minutes after Up: done; 31: not; at home: not', async () => {
    await markGymStart({ date: D, startedAt: t('05:49').toISOString() });
    expect(mark('gym')).toBe('done');
    store.delete(k('habitlog', D));
    await markGymStart({ date: D, startedAt: t('05:51').toISOString() });
    expect(mark('gym')).toBeUndefined();
    await markGymStart({ date: D, startedAt: t('05:30').toISOString(), kind: 'home' });
    expect(mark('gym')).toBeUndefined();
  });
  it('no Up that day: not ticked', async () => {
    store.delete(k('day', D));
    await markGymStart({ date: D, startedAt: t('05:30').toISOString() });
    expect(mark('gym')).toBeUndefined();
  });
  it('its own minutes replace the 30', async () => {
    habit('gym', { auto: 'gymStart', withinUpMin: 45 });
    await markGymStart({ date: D, startedAt: t('06:00').toISOString() });
    expect(mark('gym')).toBe('done');
  });
});

describe('a rest day is not held to a time', () => {
  it('a skip still goes on a habit with a rule', async () => {
    habit('g', { auto: 'gym', by: '07:00' });
    await autoMark('gym', true, D, 'skip');
    expect(mark('g')).toBe('skip');
  });
});
