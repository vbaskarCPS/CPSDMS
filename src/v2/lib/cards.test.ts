import { describe, expect, it } from 'vitest';
import { cardTotals, groupCharges, type Charge } from './cards';

const c = (key: string, at: string, status: Charge['status'], amount: string, client: string, last4?: string): Charge =>
  ({ key, at: `2026-10-31T${at}:00Z`, day: '2026-10-31', status, amount, client, last4: last4 ?? null, card_type: last4 ? 'VI' : null, transaction_id: status === 'approved' ? `t${key}` : null });

describe('card charges', () => {
  it('groups the tries for one sale and flags a double charge', () => {
    const g = groupCharges([
      c('1', '19:39', 'declined', '262.50', 'Sharlene  Quayle'),
      c('2', '19:40', 'approved', '262.50', 'sharlene quayle', '6213'),
      c('3', '19:41', 'approved', '262.50', 'Sharlene Quayle', '6213'),
      c('4', '18:00', 'approved', '420.00', 'Christine Farncombe', '0938'),
    ]);
    expect(g).toHaveLength(2);
    const q = g.find(x => x.client?.startsWith('Sharlene'))!;
    expect(q.tries).toHaveLength(3);
    expect(q.flag).toBe('double');
    expect(q.card).toBe('VI ••6213');
    expect(g.find(x => x.client === 'Christine Farncombe')!.flag).toBe('ok');
    const t = cardTotals(g);
    expect(t).toMatchObject({ approvedCount: 3, declinedCount: 1, doubles: 1, doubleAmount: 262.5, charged: 945 });
  });
  it('a decline then an approval is one sale, fine; only declines is declined; processing alone is stuck', () => {
    const g = groupCharges([
      c('1', '10:00', 'declined', '100.00', 'A B'), c('2', '10:01', 'approved', '100.00', 'A B', '1111'),
      c('3', '11:00', 'declined', '200.00', 'C D'),
      c('4', '12:00', 'processing', '300.00', 'E F'),
    ]);
    expect(g.map(x => x.flag).sort()).toEqual(['declined', 'ok', 'stuck']);
  });
  it('the same card for a different amount that day is a note, not a double', () => {
    const g = groupCharges([c('1', '10:00', 'approved', '210.00', 'Brian F', '1817'), c('2', '10:05', 'approved', '367.00', 'Brian F', '1817')]);
    expect(g.every(x => x.flag === 'ok')).toBe(true);
    expect(g[0].sameCard).toHaveLength(1);
  });
});
