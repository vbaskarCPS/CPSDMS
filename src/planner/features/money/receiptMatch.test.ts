// Receipts → bank rows (receiptMatch.ts), the receipt's split by category, and ATM withdrawals once cash is logged.
import { describe, expect, it } from 'vitest';
import { autoPick, dayDiff, matchCandidates, merchantScore, shiftDay, splitByCategory } from './receiptMatch';
import { sumByCategory, visibleMonths } from './lib';
import type { Account, Txn } from './types';

const row = (o: Partial<Txn>): Txn => ({ id: o.id || 'r1', date: '2026-11-08', desc: 'COSTCO WHOLESAL W540', merchant: 'COSTCO WHOLESAL', amount: -182.37, accountId: 'visa', category: 'Groceries', source: 'builtin', ...o });
const visa: Account = { id: 'visa', name: 'TD Visa', type: 'credit', last4: '4421', order: 0 };
const receipt = { date: '2026-11-08', total: 182.37, merchant: 'Costco Wholesale', tip: 0, cardLast4: '' };

describe('dates', () => {
  it('counts days across months', () => {
    expect(dayDiff('2026-10-30', '2026-11-02')).toBe(3);
    expect(dayDiff('2026-11-02', '2026-10-30')).toBe(-3);
    expect(shiftDay('2026-11-01', -2)).toBe('2026-10-30');
  });
});

describe('merchantScore', () => {
  it('matches a printed name to the bank line', () => {
    expect(merchantScore('Costco Wholesale', 'COSTCO WHOLESAL')).toBe(1);
    expect(merchantScore('Tim Hortons', 'TIMHORTONS 2231')).toBeGreaterThanOrEqual(0.8);
    expect(merchantScore('The Home Depot', 'HOME DEPOT 7012')).toBe(1);
  });
  it('tells different stores apart', () => {
    expect(merchantScore('Costco Wholesale', 'SHOPPERS DRUG MART')).toBe(0);
    expect(merchantScore('', 'ANYTHING')).toBe(0);
  });
});

describe('matchCandidates', () => {
  it('finds the same amount a day or two later on the card', () => {
    const c = matchCandidates(receipt, [row({ date: '2026-11-10' })], [visa], new Set());
    expect(c).toHaveLength(1);
    expect(c[0].exact).toBe(true);
    expect(c[0].days).toBe(2);
  });
  it('skips money in, the cash wallet, rows another receipt has, and rows outside the window', () => {
    const rows = [
      row({ id: 'in', amount: 182.37 }),
      row({ id: 'cash_1', accountId: 'cash' }),
      row({ id: 'taken' }),
      row({ id: 'early', date: '2026-11-05' }),
      row({ id: 'late', date: '2026-11-16' }),
    ];
    expect(matchCandidates(receipt, rows, [visa], new Set(['taken']))).toHaveLength(0);
  });
  it('allows a tip added on the card at the same restaurant, not at another store', () => {
    const dinner = { date: '2026-11-07', total: 50, merchant: 'Pai Northern Thai', tip: 0, cardLast4: '' };
    const c = matchCandidates(dinner, [row({ id: 'pai', merchant: 'PAI NORTHERN THAI', desc: 'PAI NORTHERN THAI TORONTO', amount: -58.5, date: '2026-11-08' }), row({ id: 'other', merchant: 'ESSO', desc: 'ESSO', amount: -58.5 })], [visa], new Set());
    expect(c.map(x => x.txn.id)).toEqual(['pai']);
    expect(c[0].exact).toBe(false);
    expect(autoPick(c, dinner.total)).toBeNull();   // a tipped match is the person's pick
  });
  it('matches the pre-tip amount when the receipt includes a written tip', () => {
    const c = matchCandidates({ ...receipt, total: 60, tip: 10, merchant: 'Pai' }, [row({ amount: -50, merchant: 'PAI', desc: 'PAI' })], [visa], new Set());
    expect(c[0]?.exact).toBe(true);
  });
  it('ranks the right store first when two charges have the same amount', () => {
    const c = matchCandidates(receipt, [row({ id: 'esso', merchant: 'ESSO', desc: 'ESSO 123' }), row({ id: 'costco' })], [visa], new Set());
    expect(c[0].txn.id).toBe('costco');
    expect(autoPick(c, receipt.total)?.txn.id).toBe('costco');
  });
});

describe('autoPick', () => {
  it('links one exact match at the same store', () => {
    expect(autoPick(matchCandidates(receipt, [row({})], [visa], new Set()), receipt.total)?.txn.id).toBe('r1');
  });
  it('asks when two rows look the same', () => {
    expect(autoPick(matchCandidates(receipt, [row({ id: 'a' }), row({ id: 'b', date: '2026-11-09' })], [visa], new Set()), receipt.total)).toBeNull();
  });
  it('asks for a round amount at a store it can’t recognise', () => {
    const r = { date: '2026-11-08', total: 20, merchant: 'Corner Store', tip: 0, cardLast4: '' };
    expect(autoPick(matchCandidates(r, [row({ amount: -20, merchant: 'SQ GHX', desc: 'SQ GHX' })], [visa], new Set()), 20)).toBeNull();
  });
  it('links an unrecognised name when the amount has cents and the date is close', () => {
    const r = { date: '2026-11-08', total: 23.47, merchant: 'Corner Store', tip: 0, cardLast4: '' };
    expect(autoPick(matchCandidates(r, [row({ amount: -23.47, merchant: 'SQ GHX', desc: 'SQ GHX' })], [visa], new Set()), 23.47)).not.toBeNull();
  });
});

describe('splitByCategory', () => {
  it('groups the lines and puts tax on the biggest group', () => {
    const s = splitByCategory({ total: 113, category: 'Groceries', items: [{ name: 'Milk', amount: 60, category: 'Groceries' }, { name: 'Towels', amount: 40, category: 'Shopping' }] });
    expect(s).toEqual([{ category: 'Groceries', amount: 73 }, { category: 'Shopping', amount: 40 }]);
  });
  it('with no lines, the whole total is the receipt category', () => {
    expect(splitByCategory({ total: 9.5, category: 'Coffee', items: [] })).toEqual([{ category: 'Coffee', amount: 9.5 }]);
  });
});

describe('ATM withdrawals once cash is logged', () => {
  const wallet: Account = { id: 'cash', name: 'Cash', type: 'cash', order: 1, cashSince: '2026-11-05' };
  const months = { '2026-11': [
    row({ id: 'atm-before', date: '2026-11-02', category: 'Cash', amount: -100, desc: 'ATM WITHDRAWAL', merchant: 'ATM WITHDRAWAL' }),
    row({ id: 'atm-after', date: '2026-11-06', category: 'Cash', amount: -100, desc: 'ATM WITHDRAWAL', merchant: 'ATM WITHDRAWAL' }),
    row({ id: 'cash_lunch', date: '2026-11-07', accountId: 'cash', category: 'Dining', amount: -18, desc: 'Lunch', merchant: 'LUNCH' }),
  ] };
  it('counts withdrawals from cashSince as a move into the wallet, and the cash spending instead', () => {
    const v = visibleMonths(months, [visa, wallet])['2026-11'];
    expect(v.find(t => t.id === 'atm-after')).toMatchObject({ category: 'Transfers', toWallet: true });
    expect(v.find(t => t.id === 'atm-before')?.category).toBe('Cash');
    expect(sumByCategory(v)).toEqual({ Cash: 100, Dining: 18 });
  });
  it('leaves the saved rows alone', () => {
    visibleMonths(months, [visa, wallet]);
    expect(months['2026-11'][1].category).toBe('Cash');
  });
  it('changes nothing until a wallet exists', () => {
    expect(visibleMonths(months, [visa])).toBe(months);
  });
});
