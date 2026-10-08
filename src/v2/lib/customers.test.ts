import { describe, expect, it } from 'vitest';
import { countByCat, fmtDay, jobsByYear, money, moneySummary, parseArea, timeline, type CustomerFull, type Job } from './customers';

describe('parseArea', () => {
  it('reads the map points and totals, and drops points without a position', () => {
    const a = parseArea({
      points: [['id1', 43.3, -79.7, 'CT01', 'done', '10 Elm Rd', 'Ann Lee', '209.05'], [null, 43.31, -79.71, 'CT02', 'no', '15 Birch Ave', null, 0],
        ['id3', null as unknown as number, -79.7, 'CT01', 'past', '9 Birch', null, 0], ['id4', 43.32, -79.72, 'CT01', 'weird' as never, '1 X St', null, 0]],
      totals: { customers: 5, done: 3, paid: 412.45 }, routes: 2, year: 2026, said_no: 2,
    });
    expect(a.points.map(p => [p.id, p.cat, p.paid])).toEqual([['id1', 'done', 209.05], [null, 'no', 0], ['id4', 'none', 0]]);
    expect(a.totals).toMatchObject({ customers: 5, done: 3, paid: 412.45, owed: 0, owed_amount: 0 });
    expect(countByCat(a.points)).toMatchObject({ done: 1, no: 1, none: 1, past: 0 });
  });
});

describe('money', () => {
  it('reads prices written many ways', () => {
    expect(money('$1,209.50')).toBe(1209.5);
    expect(money(199)).toBe(199);
    expect(money('')).toBe(0);
    expect(money(null)).toBe(0);
  });
  it('splits paid from owed, all time and this season', () => {
    const jobs: Job[] = [
      { year: 2026, price: '209.05', paid: 'paid' }, { year: 2026, price: '339', paid: 'owed' }, { year: '2026', price: '100', paid: 'to_confirm' },
      { year: 2025, price: '199' }, { year: 2024, price: '$180' },
    ];
    expect(moneySummary(jobs, 2026)).toEqual({ lifetime: 588.05, season: 209.05, owed: 439, jobs: 5, years: 3 });
  });
});

describe('jobsByYear', () => {
  it('puts the newest year first, newest date first, and undated years last', () => {
    const out = jobsByYear([{ year: 2024, service: 'A' }, { year: 2026, service: 'B', date: '2026-10-01' }, { year: null, service: 'C' }, { year: 2026, service: 'D', date: '2026-10-06' }]);
    expect(out.map(y => y.year)).toEqual(['2026', '2024', '—']);
    expect(out[0].jobs.map(j => j.service)).toEqual(['D', 'B']);
  });
});

describe('timeline', () => {
  const c = {
    client: { history: [{ year: 2026, service: 'SS', price: '209.05', date: '2026-10-06', source: 'Door sale', paid: 'paid', crew: [{ name: 'Sam Abara' }] }, { year: 2025, service: 'SS', price: '199' }] },
    area: 'CRM TOWN',
    visits: [{ day: '2026-09-20', at: '2026-09-20T15:00:00Z', status: 'no', note: 'Did it himself', first_name: 'Cy', worker_id: 'I1013', worker: 'Sam Abara' },
      { day: '2026-09-18', at: '2026-09-18T15:00:00Z', status: 'not_home', worker_id: 'Q9' }],
    texts: [{ at: '2026-09-25T13:00:00Z' }],
  } as unknown as CustomerFull;
  it('merges dated jobs, knocks and texts, newest first', () => {
    const t = timeline(c);
    expect(t.map(x => x.kind)).toEqual(['job', 'text', 'visit', 'visit']);
    expect(t[0].title).toBe('Job done — SS · $209.05');
    expect(t[0].detail).toBe('Door sale · crew: Sam Abara · Paid');
    expect(t[2]).toMatchObject({ title: 'Knock — Said no', tone: 'r', detail: 'Sam Abara · spoke to Cy · “Did it himself”' });
    expect(t[3].detail).toBe('Q9');
  });
});

describe('fmtDay', () => {
  it('keeps a bare date on its own day', () => {
    expect(fmtDay('2026-10-06')).toMatch(/Oct\.? 6, 2026/);
    expect(fmtDay('not a date')).toBe('not a date');
  });
});
