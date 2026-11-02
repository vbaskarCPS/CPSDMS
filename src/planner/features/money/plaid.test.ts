// Bank rows from Plaid (supabase/functions/_shared/plannerMoney.ts): signs, categories, sync changes, and
// hiding a connected account's CSV rows.
import { describe, expect, it } from 'vitest';
import { applySync, hideReplaced, plaidCategory, plaidToRow, type PlaidTxn, type PlannerTxn } from '../../../../supabase/functions/_shared/plannerMoney';
import { normalizeMerchant } from './lib';

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
});
