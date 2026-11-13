// Recurring (recurring.ts): a regular beat and a steady amount, and nothing else.
import { describe, expect, it } from 'vitest';
import { findRecurring, merchantKey, monthlyCost } from './recurring';
import type { Txn } from './types';

let n = 0;
const tx = (date: string, merchant: string, amount: number, category = 'Subscriptions', accountId = 'chq'): Txn =>
  ({ id: `t${n++}`, date, desc: merchant, merchant, amount: -amount, accountId, category, source: 'builtin' });
const byMonth = (txns: Txn[]) => {
  const out: Record<string, Txn[]> = {};
  for (const t of txns) (out[t.date.slice(0, 7)] ??= []).push(t);
  return out;
};
const monthly = (merchant: string, amount: number, day: number, from: [number, number], count: number, category?: string) =>
  Array.from({ length: count }, (_, i) => {
    const m0 = from[1] - 1 + i, y = from[0] + Math.floor(m0 / 12), m = (m0 % 12) + 1;
    const dd = Math.min(day, new Date(y, m, 0).getDate());
    return tx(`${y}-${String(m).padStart(2, '0')}-${String(dd).padStart(2, '0')}`, merchant, amount, category);
  });
const every = (merchant: string, amount: number, start: string, days: number, count: number, category?: string) =>
  Array.from({ length: count }, (_, i) => { const d = new Date(`${start}T12:00:00`); d.setDate(d.getDate() + i * days); return tx(d.toISOString().slice(0, 10), merchant, amount, category); });
const TODAY = '2026-11-13';
const find = (txns: Txn[], ignore: string[] = []) => findRecurring(byMonth(txns), '2026-11', ignore, TODAY);
const names = (txns: Txn[]) => find(txns).map(r => r.merchant);

describe('what counts as recurring', () => {
  it('a monthly subscription, with its next date on its usual day', () => {
    const [r] = find(monthly('NETFLIX', 9.03, 27, [2026, 5], 6));
    expect(r).toMatchObject({ merchant: 'NETFLIX', cadence: 'monthly', avg: 9.03, last: '2026-10-27', next: '2026-11-27', active: true });
    expect(monthlyCost(r)).toBe(9.03);
  });
  it('everyday spending at the same place has no beat and stays out, however often', () => {
    const coffee = Array.from({ length: 40 }, (_, i) => tx(`2026-${String(6 + (i % 5)).padStart(2, '0')}-${String(1 + ((i * 7) % 27)).padStart(2, '0')}`, 'TIM HORTONS', 2.43, 'Coffee'));
    const rides = Array.from({ length: 60 }, (_, i) => tx(`2026-${String(6 + (i % 5)).padStart(2, '0')}-${String(1 + ((i * 11) % 27)).padStart(2, '0')}`, 'UBER', 40 + (i % 9), 'Transport'));
    const gas = [3, 9, 20, 24, 38, 50, 61, 66, 80].map(d => { const x = new Date(2026, 6, d); return tx(x.toISOString().slice(0, 10), 'PETRO-CANADA', 25, 'Gas'); });
    expect(names([...coffee, ...rides, ...gas])).toEqual([]);
  });
  it('every 2 weeks, under two names and imported twice, counted once a fortnight', () => {
    const a = every('GOODLIFE', 48.58, '2026-03-27', 14, 17, 'Fitness');
    const dupes = a.filter(t => t.date >= '2026-06-01' && t.date <= '2026-08-31').map(t => ({ ...t, id: `${t.id}v`, merchant: 'GOODLIFE CLUBS MSP', accountId: 'visa' }));
    const rs = find([...a, ...dupes]);
    expect(rs).toHaveLength(1);
    expect(rs[0]).toMatchObject({ merchant: 'GOODLIFE', cadence: 'biweekly', count: 17 });
    expect(rs[0].names).toEqual(['GOODLIFE', 'GOODLIFE CLUBS MSP']);
    expect(monthlyCost(rs[0])).toBeCloseTo(48.58 * 26 / 12, 1);
  });
  it('two policies from one insurer are two lines', () => {
    const rs = find([...monthly('SGI CANADA', 230.03, 12, [2026, 3], 8, 'Insurance'), ...monthly('SGI CANADA', 51.79, 21, [2026, 3], 8, 'Insurance')]);
    expect(rs.map(r => r.avg).sort((a, b) => a - b)).toEqual([51.79, 230.03]);
  });
  it('Prime inside all the Amazon shopping is found on its own', () => {
    const shopping = Array.from({ length: 30 }, (_, i) => tx(`2026-${String(5 + (i % 6)).padStart(2, '0')}-${String(2 + ((i * 5) % 25)).padStart(2, '0')}`, 'AMAZON', 10 + i * 3.7, 'Shopping'));
    const rs = find([...shopping, ...monthly('AMAZON - PRIME', 11.29, 28, [2026, 5], 6, 'Shopping')]);
    expect(rs).toHaveLength(1);
    expect(rs[0]).toMatchObject({ merchant: 'AMAZON - PRIME', avg: 11.29 });
  });
  it('a phone bill that varies is still a bill: the average of the last three, marked as varying', () => {
    const amts = [115.49, 127.07, 131.2, 119.9, 127.07, 140.11];
    const rs = find(amts.map((a, i) => tx(`2026-${String(5 + i).padStart(2, '0')}-05`, 'FIDO PMT', a, 'Phone & Internet')));
    expect(rs[0]).toMatchObject({ cadence: 'monthly', varies: true, avg: 129.03 });
  });
  it('yearly, seen twice a year apart', () => {
    const rs = find([tx('2025-10-16', 'DISNEY', 222), tx('2026-10-16', 'DISNEY', 222), ...monthly('DISNEY', 19.2, 16, [2026, 5], 6)]);
    const yearly = rs.find(r => r.cadence === 'yearly')!;
    expect(yearly).toMatchObject({ avg: 222, next: '2027-10-16', active: true });
    expect(monthlyCost(yearly)).toBe(18.5);
    expect(rs.find(r => r.cadence === 'monthly')?.avg).toBe(19.2);
  });
  it('a skipped month is forgiven; one that stopped goes apart and isn’t active', () => {
    const skip = monthly('MICROSOFT', 13, 17, [2026, 3], 8).filter(t => !t.date.startsWith('2026-06'));
    const adobe = monthly('ADOBE', 44.06, 20, [2025, 5], 8);
    const rs = find([...skip, ...adobe]);
    expect(rs.map(r => [r.merchant, r.active])).toEqual([['MICROSOFT', true], ['ADOBE', false]]);
  });
  it('a price change shows what it was before', () => {
    const [r] = find([...monthly('SPOTIFY', 14.34, 29, [2026, 3], 5), ...monthly('SPOTIFY', 15.81, 29, [2026, 8], 3)]);
    expect(r).toMatchObject({ avg: 15.81, lastAmount: 15.81, prevAmount: 14.34 });
  });
  it('a month-end fee is due on the last day of the month', () => {
    const fee = ['2026-06-30', '2026-07-31', '2026-08-29', '2026-09-30', '2026-10-30'].map(d => tx(d, 'MONTHLY ACCOUNT FEE', 17.95, 'Fees & interest'));
    expect(find(fee)[0]).toMatchObject({ cadence: 'monthly', next: '2026-11-30' });
  });
  it('“Not recurring” hides it under any of its names', () => {
    const t = [...monthly('MICROSOFT', 13, 17, [2026, 5], 3), ...monthly('MICROSOFT _V', 13, 17, [2026, 8], 3)];
    expect(find(t)).toHaveLength(1);
    expect(find(t, ['MICROSOFT _V'])).toHaveLength(0);
  });
  it('transfers, card payments, money in and anything after today are left out', () => {
    const t = [...monthly('RENT TFR', 1500, 1, [2026, 5], 6, 'Transfers'), ...monthly('VISA PMT', 300, 3, [2026, 5], 6, 'Credit card payment')];
    expect(find(t)).toEqual([]);
  });
});

describe('merchant names', () => {
  it('the bits that change between imports are dropped', () => {
    expect(merchantKey('MICROSOFT _V')).toBe('MICROSOFT');
    expect(merchantKey('LINE2 9.99_V')).toBe(merchantKey('LINE2'));
    expect(merchantKey('SQSP INV1 .72_V')).toBe('SQSP');
    expect(merchantKey('ZEHRS LISTOWEL _F')).toBe('ZEHRS LISTOWEL');
  });
});

describe('what the real data taught it', () => {
  it('an insurance payment that drops 18% is still the same policy, at its new price', () => {
    const t = [...monthly('SGI CANADA', 51.79, 29, [2026, 3], 6, 'Insurance'), tx('2026-09-29', 'SGI CANADA', 42.53, 'Insurance'), tx('2026-10-29', 'SGI CANADA', 42.35, 'Insurance')];
    const [r] = find(t);
    expect(r).toMatchObject({ active: true, last: '2026-10-29', count: 8, avg: 42.35, prevAmount: 51.79 });
  });
  it('a subscription that moved to another name carries on', () => {
    const t = [...monthly('YOUTUBE', 25.98, 21, [2026, 1], 8), tx('2026-09-21', 'GOOGLE', 25.98, 'Shopping'), tx('2026-10-20', 'GOOGLE', 25.98, 'Shopping')];
    const rs = find(t);
    expect(rs).toHaveLength(1);
    expect(rs[0]).toMatchObject({ merchant: 'YOUTUBE', active: true, last: '2026-10-20' });
    expect(rs[0].names).toEqual(['YOUTUBE', 'GOOGLE']);
  });
  it('pennies of interest aren’t a bill; a few cents of currency wobble isn’t a price change', () => {
    const pennies = monthly('OVERDRAFT INTEREST', 0.12, 30, [2026, 3], 8, 'Fees & interest');
    const fx = [7.11, 7.02, 7.2, 7.11, 7.33].map((a, i) => tx(`2026-${String(6 + i).padStart(2, '0')}-13`, 'NINJATECH AI', a, 'Other'));
    const rs = find([...pennies, ...fx]);
    expect(rs.map(r => r.merchant)).toEqual(['NINJATECH AI']);
    expect(rs[0].prevAmount).toBeUndefined();
  });
  it('a month with a second charge a few days later keeps the beat', () => {
    const t = [...monthly('TEKSAVVY', 37.12, 5, [2026, 3], 8, 'Phone & Internet'), tx('2026-07-08', 'TEKSAVVY', 36.46, 'Phone & Internet')];
    expect(find(t)[0]).toMatchObject({ cadence: 'monthly', active: true });
  });
  it('a slow start doesn’t hide a monthly charge; its next date follows where it lands now', () => {
    const t = ['2025-10-20', '2025-12-02', '2025-12-18', '2026-01-19', '2026-02-19', '2026-03-19', '2026-04-19', '2026-05-19', '2026-06-19', '2026-07-24', '2026-08-18', '2026-09-19', '2026-10-19']
      .map(d => tx(d, 'EQUIFAX', 28.19, 'Other'));
    expect(find(t)[0]).toMatchObject({ cadence: 'monthly', active: true, next: '2026-11-19' });
    const drift = [12, 12, 12, 20, 21, 20].map((d, i) => tx(`2026-${String(5 + i).padStart(2, '0')}-${d}`, 'YOUTUBE', 25.98));
    expect(find(drift)[0].next).toBe('2026-11-20');
  });
  it('the same price moving to a new name the next month is one line, not a stopped one and a new one', () => {
    const t = [...monthly('MOKA TAM BUS', 11.3, 2, [2025, 10], 6, 'Transport'), ...monthly('INTELL MEMBER BUS', 11.3, 30, [2026, 3], 8, 'Transport')];
    const rs = find(t);
    expect(rs).toHaveLength(1);
    expect(rs[0]).toMatchObject({ merchant: 'INTELL MEMBER BUS', active: true });
    expect(rs[0].names).toEqual(['INTELL MEMBER BUS', 'MOKA TAM BUS']);
  });
});
