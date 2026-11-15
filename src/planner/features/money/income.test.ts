// Income is what came in, less cash that was deposited only to be e-transferred on to someone ('Transferred cash').
import { describe, it, expect } from 'vitest';
import { isPassedOn, isSpending, sumByCategory, totals } from './lib';
import { CATEGORIES, SPENDING_CATEGORIES, TRANSFERRED_CASH } from './categories';
import type { Txn } from './types';

let n = 0;
const tx = (amount: number, category: string, desc = 'X'): Txn => ({ id: `t${n++}`, date: '2026-05-02', desc, merchant: desc, amount, accountId: 'chq', category, source: 'manual' });

describe('transferred cash comes off income', () => {
  it('is a category that is neither spending nor income', () => {
    expect(CATEGORIES.find(c => c.name === TRANSFERRED_CASH)).toMatchObject({ spending: false });
    expect(SPENDING_CATEGORIES).not.toContain(TRANSFERRED_CASH);
    const sent = tx(-500, TRANSFERRED_CASH, 'SEND E-TFR ***aB1');
    expect(isSpending(sent)).toBe(false);
    expect(isPassedOn(sent)).toBe(true);
    expect(sumByCategory([sent])).toEqual({});
  });
  it('totals: the amount is taken off income, and spending is untouched', () => {
    const rows = [tx(900, 'Income', 'GC 1234-DEPOSIT'), tx(2000, 'Income', 'PAYROLL'), tx(-500, TRANSFERRED_CASH, 'SEND E-TFR ***aB1'), tx(-80, 'Groceries'), tx(-300, 'Transfers')];
    expect(totals(rows)).toEqual({ spent: 80, income: 2400, net: 2320, passedOn: 500 });
    // without the mark, the deposit counted in full
    expect(totals(rows.map(t => (t.category === TRANSFERRED_CASH ? { ...t, category: 'Transfers' } : t)))).toEqual({ spent: 80, income: 2900, net: 2820, passedOn: 0 });
  });
  it('money coming in is never "passed on", whatever its category', () => {
    expect(totals([tx(500, TRANSFERRED_CASH)])).toEqual({ spent: 0, income: 0, net: 0, passedOn: 0 });
  });
});
