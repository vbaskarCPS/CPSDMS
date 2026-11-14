// Bank rows from Plaid (supabase/functions/_shared/plannerMoney.ts): signs, categories, sync changes, and
// hiding a connected account's CSV rows.
import { describe, expect, it } from 'vitest';
import { applySync, bankSince, hideReplaced, plaidCategory, plaidToRow, type PlaidTxn, type PlannerTxn } from '../../../../supabase/functions/_shared/plannerMoney';
import { normalizeMerchant, visibleMonths, withBankSince } from './lib';
import type { Account, Txn } from './types';

const t = (o: Partial<PlaidTxn>): PlaidTxn => ({ transaction_id: 'tx1', account_id: 'pa1', amount: 12.5, date: '2026-10-30', pending: false, name: 'TIM HORTONS #2231', merchant_name: 'Tim Hortons', ...o });

describe('plaidToRow', () => {
  it('flips the sign: Plaid positive = money out, planner negative = money out', () => {
    expect(plaidToRow(t({ amount: 12.5 }), 'acc', {}).amount).toBe(-12.5);
    expect(plaidToRow(t({ amount: -2000, name: 'PAYROLL DEPOSIT', merchant_name: null }), 'acc', {}).amount).toBe(2000);
  });
  it('uses the same merchant names as the CSV importer, so rules stick', () => {
    const r = plaidToRow(t({ merchant_name: null, name: 'TIM HORTONS #2231 TORONTO ON' }), 'acc', {});
    expect(r.merchant).toBe(normalizeMerchant('TIM HORTONS #2231 TORONTO ON'));
    expect(r.id).toBe('plaid_tx1');
  });
  it('category: household rule, then built-in, then Plaid, then Other', () => {
    expect(plaidToRow(t({}), 'acc', { 'TIM HORTONS': 'Dining' })).toMatchObject({ category: 'Dining', source: 'rule' });
    expect(plaidToRow(t({}), 'acc', {})).toMatchObject({ category: 'Coffee', source: 'builtin' });
    expect(plaidToRow(t({ name: 'ZQX HOLDINGS', merchant_name: 'Zqx Holdings', personal_finance_category: { primary: 'MEDICAL', detailed: 'MEDICAL_OTHER' } }), 'acc', {}))
      .toMatchObject({ category: 'Health', source: 'plaid' });
    expect(plaidToRow(t({ name: 'ZQX HOLDINGS', merchant_name: 'Zqx Holdings', personal_finance_category: null }), 'acc', {}).category).toBe('Other');
  });
  it('keeps a hand-picked category and note when the bank updates the row', () => {
    const prev = { ...plaidToRow(t({}), 'acc', {}), category: 'Gifts', source: 'manual' as const, note: 'for mom' };
    expect(plaidToRow(t({ amount: 13 }), 'acc', {}, prev)).toMatchObject({ category: 'Gifts', source: 'manual', note: 'for mom', amount: -13 });
  });
  it('masks card-like numbers in the description', () => {
    expect(plaidToRow(t({ original_description: 'PAYMENT 4520 1234 5678 9012' }), 'acc', {}).desc).toBe('PAYMENT ****9012');
  });
});

describe('plaidCategory', () => {
  it('prefers the detailed category', () => {
    expect(plaidCategory({ primary: 'FOOD_AND_DRINK', detailed: 'FOOD_AND_DRINK_GROCERIES' })).toBe('Groceries');
    expect(plaidCategory({ primary: 'FOOD_AND_DRINK', detailed: 'FOOD_AND_DRINK_RESTAURANT' })).toBe('Dining');
    expect(plaidCategory({ primary: 'LOAN_PAYMENTS', detailed: 'LOAN_PAYMENTS_CREDIT_CARD_PAYMENT' })).toBe('Credit card payment');
    expect(plaidCategory(null)).toBeNull();
  });
});

describe('applySync', () => {
  const map = { pa1: 'acc1' };
  it('adds posted rows to their months, skips pending and unlinked accounts', () => {
    const months: Record<string, PlannerTxn[]> = {};
    const r = applySync(months, { added: [t({}), t({ transaction_id: 'p', pending: true }), t({ transaction_id: 'x', account_id: 'other' }), t({ transaction_id: 'n', date: '2026-11-01' })], modified: [], removed: [] }, map, {});
    expect(r.added).toBe(2);
    expect(months['2026-10'].map(x => x.id)).toEqual(['plaid_tx1']);
    expect(months['2026-11'].map(x => x.id)).toEqual(['plaid_n']);
    expect([...r.touched].sort()).toEqual(['2026-10', '2026-11']);
  });
  it('moves a modified row to its new month and removes deleted ones', () => {
    const months: Record<string, PlannerTxn[]> = {};
    applySync(months, { added: [t({}), t({ transaction_id: 'gone' })], modified: [], removed: [] }, map, {});
    const csv = { id: 'csv1', date: '2026-10-02', desc: 'X', merchant: 'X', amount: -1, accountId: 'acc1', category: 'Other', source: 'ai' as const };
    months['2026-10'].push(csv);
    const r = applySync(months, { added: [], modified: [t({ date: '2026-11-02' })], removed: [{ transaction_id: 'gone' }] }, map, {});
    expect(r).toMatchObject({ updated: 1, removed: 1, added: 0 });
    expect(months['2026-10'].map(x => x.id)).toEqual(['csv1']);   // CSV rows are never touched
    expect(months['2026-11'].map(x => x.id)).toEqual(['plaid_tx1']);
  });
  it('a row that turns pending again is taken out until it posts', () => {
    const months: Record<string, PlannerTxn[]> = {};
    applySync(months, { added: [t({})], modified: [], removed: [] }, map, {});
    applySync(months, { added: [], modified: [t({ pending: true })], removed: [] }, map, {});
    expect(months['2026-10']).toEqual([]);
  });
});

describe('hideReplaced', () => {
  const rows = [
    { id: 'csv-old', date: '2026-09-01', accountId: 'a' },
    { id: 'csv-new', date: '2026-12-01', accountId: 'a' },
    { id: 'plaid_1', date: '2026-10-01', accountId: 'a' },
    { id: 'csv-b', date: '2026-10-01', accountId: 'b' },
  ];
  it('hides a connected account’s CSV rows, keeps its bank rows and other accounts', () => {
    expect(hideReplaced(rows, { a: {} }).map(r => r.id)).toEqual(['plaid_1', 'csv-b']);
  });
  it('after disconnecting, CSV rows after that day show again', () => {
    expect(hideReplaced(rows, { a: { removedAt: '2026-11-15T10:00:00Z' } }).map(r => r.id)).toEqual(['csv-new', 'plaid_1', 'csv-b']);
  });
  it('a statement from before the bank’s own rows begin counts: only the overlap is hidden', () => {
    // the bank's history starts Oct 1: the Sep 1 statement row is not a repeat of anything
    expect(hideReplaced(rows, { a: { since: '2026-10-01' } }).map(r => r.id)).toEqual(['csv-old', 'plaid_1', 'csv-b']);
    // a statement row on the very day the bank's rows begin is taken as a repeat
    expect(hideReplaced([{ id: 'csv-same', date: '2026-10-01', accountId: 'a' }], { a: { since: '2026-10-01' } })).toEqual([]);
  });
  it('bankSince: the earliest bank row per account, whatever the month', () => {
    expect(bankSince({ '2026-10': rows, '2026-09': [{ id: 'plaid_0', date: '2026-09-20', accountId: 'a' }, { id: 'plaid_9', date: '2026-09-05', accountId: 'b' }] }))
      .toEqual({ a: '2026-09-20', b: '2026-09-05' });
  });
});

describe('the day the bank’s rows begin, kept on the account', () => {
  const acct = (id: string, plaid?: Account['plaid']): Account => ({ id, name: id, type: 'chequing', order: 0, plaid });
  const row = (id: string, date: string, accountId: string): Txn => ({ id, date, accountId, desc: id, merchant: id, amount: -1, category: 'Other', source: 'builtin' });
  const link = { itemId: 'i', plaidId: 'p', linkedAt: '2026-11-13T00:00:00Z' };
  it('withBankSince: worked out once for a connected account that lacks it, and saved', async () => {
    const saved: Account[] = [];
    let loads = 0;
    const months = { '2026-05': [row('plaid_1', '2026-05-13', 'visa'), row('csv-1', '2026-05-02', 'visa')], '2026-06': [row('plaid_2', '2026-06-01', 'visa')] };
    const out = await withBankSince([acct('visa', link), acct('old'), acct('done', { ...link, since: '2025-05-08' }), acct('empty', link)],
      async () => { loads++; return months; }, async a => { saved.push(a); });
    expect(out.map(a => a.plaid?.since)).toEqual(['2026-05-13', undefined, '2025-05-08', undefined]);   // 'empty' has no bank rows yet
    expect(saved.map(a => [a.id, a.plaid?.since])).toEqual([['visa', '2026-05-13']]);
    expect(loads).toBe(1);
    // nothing to work out: the months aren't even read
    await withBankSince(out.filter(a => a.id !== 'empty'), async () => { loads++; return months; }, async () => undefined);
    expect(loads).toBe(1);
  });
  it('visibleMonths: a statement from before the bank’s rows counts; the overlap stays hidden', () => {
    const months = { '2026-04': [row('csv-apr', '2026-04-20', 'visa')], '2026-05': [row('csv-may', '2026-05-20', 'visa'), row('plaid_1', '2026-05-20', 'visa')] };
    const shown = (a: Account) => Object.values(visibleMonths(months, [a])).flat().map(t => t.id);
    expect(shown(acct('visa', { ...link, since: '2026-05-13' }))).toEqual(['csv-apr', 'plaid_1']);
    expect(shown(acct('visa', link))).toEqual(['plaid_1']);                     // not worked out yet: all statement rows hidden
    // the bank's rows now reach further back than the day kept: the earlier day wins, so nothing counts twice
    const earlier = { ...months, '2026-04': [...months['2026-04'], row('plaid_0', '2026-04-10', 'visa')] };
    expect(Object.values(visibleMonths(earlier, [acct('visa', { ...link, since: '2026-05-13' })])).flat().map(t => t.id)).toEqual(['plaid_0', 'plaid_1']);
  });
});
