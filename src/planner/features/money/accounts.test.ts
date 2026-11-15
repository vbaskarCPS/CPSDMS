// Deleting an account (accounts.ts): which rows go, which months are written, and which receipts lose their match.
import { describe, expect, it } from 'vitest';
import { isBankLinked, isCashWallet, receiptsUnlinked, rowIdsOf, rowsOf, withoutAccount } from './accounts';
import type { Receipt, Txn } from './types';

const tx = (id: string, date: string, accountId: string, amount = -10): Txn =>
  ({ id, date, desc: id.toUpperCase(), merchant: id.toUpperCase(), amount, accountId, category: 'Other', source: 'builtin' });
const months = (): Record<string, Txn[]> => ({
  '2026-08': [tx('a1', '2026-08-02', 'chq'), tx('a2', '2026-08-09', 'chq')],
  '2026-09': [tx('b1', '2026-09-01', 'chq'), tx('b2', '2026-09-03', 'visa'), tx('b3', '2026-09-03', 'chq'), tx('b4', '2026-09-20', 'visa')],
  '2026-10': [tx('c1', '2026-10-05', 'visa'), tx('plaid_c2', '2026-10-06', 'visa'), tx('cash_c3', '2026-10-07', 'cash')],
  '2026-11': [],
});
const rc = (id: string, more: Partial<Receipt> = {}): Receipt =>
  ({ id, date: '2026-10-05', merchant: 'Costco', total: 10, payment: 'card', items: [], category: 'Groceries', photos: 0, addedAt: '2026-10-05T12:00:00Z', ...more });
const matched = (txnId: string, month = '2026-10'): Partial<Receipt> => ({ txnId, txnMonth: month, matchedAt: '2026-10-06T09:00:00Z', matchedBy: 'auto' });

describe('rowsOf / rowIdsOf', () => {
  it('counts an account’s rows across every month', () => {
    expect(rowsOf(months(), 'chq')).toBe(4);
    expect(rowsOf(months(), 'visa')).toBe(4);
    expect(rowsOf(months(), 'cash')).toBe(1);
    expect(rowsOf(months(), 'nobody')).toBe(0);
    expect(rowsOf({}, 'chq')).toBe(0);
  });
  it('lists their ids', () => {
    expect([...rowIdsOf(months(), 'visa')].sort()).toEqual(['b2', 'b4', 'c1', 'plaid_c2']);
    expect(rowIdsOf(months(), 'nobody').size).toBe(0);
  });
});

describe('withoutAccount', () => {
  it('takes the account’s rows out and says which months changed', () => {
    const r = withoutAccount(months(), 'visa');
    expect(r.removed).toBe(4);
    expect(r.changed).toEqual(['2026-09', '2026-10']);
    expect(r.months['2026-09'].map(t => t.id)).toEqual(['b1', 'b3']);
    expect(r.months['2026-10'].map(t => t.id)).toEqual(['cash_c3']);
    expect(rowsOf(r.months, 'visa')).toBe(0);
  });
  it('leaves the other accounts’ rows as they were, in the same order, and the other months alone', () => {
    const before = months();
    const r = withoutAccount(before, 'visa');
    expect(r.months['2026-08']).toBe(before['2026-08']);   // not changed: the very same list
    expect(r.months['2026-11']).toBe(before['2026-11']);
    expect(Object.keys(r.months).sort()).toEqual(Object.keys(before).sort());
    expect(r.months['2026-09']).toEqual([before['2026-09'][0], before['2026-09'][2]]);
    expect(rowsOf(r.months, 'chq')).toBe(4);
    expect(rowsOf(r.months, 'cash')).toBe(1);
  });
  it('does not change what it was given', () => {
    const before = months();
    withoutAccount(before, 'chq');
    expect(before).toEqual(months());
  });
  it('keeps a month that ends up empty (it is written as empty)', () => {
    const r = withoutAccount(months(), 'chq');
    expect(r.changed).toEqual(['2026-08', '2026-09']);
    expect(r.months['2026-08']).toEqual([]);
    expect(r.removed).toBe(4);
  });
  it('changes nothing for an account with no rows', () => {
    const before = months();
    const r = withoutAccount(before, 'nobody');
    expect(r).toEqual({ months: before, changed: [], removed: 0 });
  });
  it('lists the changed months oldest first, whatever order they came in', () => {
    const r = withoutAccount({ '2026-10': [tx('x', '2026-10-01', 'visa')], '2025-12': [tx('y', '2025-12-01', 'visa')], '2026-02': [tx('z', '2026-02-01', 'visa')] }, 'visa');
    expect(r.changed).toEqual(['2025-12', '2026-02', '2026-10']);
  });
});

describe('receiptsUnlinked', () => {
  const gone = new Set(['c1', 'plaid_c2', 'b2', 'b4']);
  it('returns the receipts matched to a removed row, with the match taken off', () => {
    const list = [rc('r1', matched('c1')), rc('r2', matched('a1', '2026-08')), rc('r3')];
    const out = receiptsUnlinked(list, gone);
    expect(out.map(r => r.id)).toEqual(['r1']);
    expect(out[0]).toEqual(rc('r1'));
    for (const k of ['txnId', 'txnMonth', 'txnMore', 'matchedAt', 'matchedBy']) expect(k in out[0]).toBe(false);
  });
  it('keeps the rest of the receipt, and leaves the one it was given alone', () => {
    const r = rc('r1', { ...matched('c1'), note: 'for the trip', from: 'email', cardLast4: '2866', items: [{ name: 'Milk', amount: 10, category: 'Groceries' }] });
    const [out] = receiptsUnlinked([r], gone);
    expect(out).toMatchObject({ id: 'r1', note: 'for the trip', from: 'email', cardLast4: '2866', category: 'Groceries' });
    expect(out.items).toEqual(r.items);
    expect(r.txnId).toBe('c1');
  });
  it('counts a split order: any of its charges gone unmatches it', () => {
    const more = rc('r1', { ...matched('a1', '2026-08'), txnMore: [{ id: 'a2', month: '2026-08' }, { id: 'b4', month: '2026-09' }] });
    const other = rc('r2', { ...matched('a1', '2026-08'), txnMore: [{ id: 'a2', month: '2026-08' }] });
    const out = receiptsUnlinked([more, other], gone);
    expect(out.map(r => r.id)).toEqual(['r1']);
    expect(out[0].txnId).toBeUndefined();
    expect(out[0].txnMore).toBeUndefined();
  });
  it('returns each of several receipts on one removed charge', () => {
    expect(receiptsUnlinked([rc('r1', matched('b2', '2026-09')), rc('r2', matched('b2', '2026-09'))], gone).map(r => r.id)).toEqual(['r1', 'r2']);
  });
  it('clears a cash receipt on a removed row the same way', () => {
    const cash = rc('r1', { payment: 'cash', txnId: 'cash_x', txnMonth: '2026-10', matchedAt: '2026-10-06T09:00:00Z', matchedBy: 'cash' });
    const [out] = receiptsUnlinked([cash, rc('r2', { payment: 'cash', txnId: 'cash_y', txnMonth: '2026-10', matchedBy: 'cash' })], new Set(['cash_x']));
    expect(out).toEqual(rc('r1', { payment: 'cash' }));
  });
  it('returns nothing when no row is gone or no receipt is matched', () => {
    expect(receiptsUnlinked([rc('r1', matched('c1'))], new Set())).toEqual([]);
    expect(receiptsUnlinked([rc('r1'), rc('r2', { ignored: 'company' })], gone)).toEqual([]);
    expect(receiptsUnlinked([], gone)).toEqual([]);
  });
  it('fits together: delete an account, and only the receipts on its rows are unmatched', () => {
    const all = months();
    const list = [rc('r1', matched('plaid_c2')), rc('r2', matched('b3', '2026-09')), rc('r3', { payment: 'cash', txnId: 'cash_c3', txnMonth: '2026-10', matchedBy: 'cash' })];
    expect(receiptsUnlinked(list, rowIdsOf(all, 'visa')).map(r => r.id)).toEqual(['r1']);
  });
});

describe('isCashWallet / isBankLinked', () => {
  it('knows the cash wallet by its id or its type', () => {
    expect(isCashWallet({ id: 'cash', type: 'cash' })).toBe(true);
    expect(isCashWallet({ id: 'cash', type: 'chequing' })).toBe(true);
    expect(isCashWallet({ id: 'x', type: 'cash' })).toBe(true);
    expect(isCashWallet({ id: 'chq', type: 'chequing' })).toBe(false);
  });
  it('is connected only while the bank link has not ended', () => {
    const link = { itemId: 'i1', plaidId: 'p1', linkedAt: '2026-10-01T00:00:00Z' };
    expect(isBankLinked({ plaid: link })).toBe(true);
    expect(isBankLinked({ plaid: { ...link, removedAt: '2026-11-01T00:00:00Z' } })).toBe(false);
    expect(isBankLinked({})).toBe(false);
  });
});
