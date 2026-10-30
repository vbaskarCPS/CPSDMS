import { describe, it, expect } from 'vitest';
import { importCsv, parseDate, parseAmount } from './index';
import { normalizeMerchant, maskNumbers, sumByCategory, totals } from '../lib';
import { builtinCategory } from '../categories';

// made-up sample lines in TD EasyWeb's shape: Date, Description, Debit, Credit, Balance
const TD = `10/01/2026,TIM HORTONS #2231 TORONTO ON,4.52,,1234.56
10/01/2026,TIM HORTONS #2231 TORONTO ON,4.52,,1230.04
10/02/2026,LOBLAWS 1055 MISSISSAUGA,86.10,,1143.94
10/03/2026,PAYROLL DEPOSIT ACME CORP,,2500.00,3643.94
10/04/2026,SEND E-TFR ***abc,200.00,,3443.94
10/05/2026,SQ *THE LITTLE BAKERY,12.00,,3431.94
10/31/2026,MONTHLY PLAN FEE,16.95,,3414.99
`;

describe('TD EasyWeb CSV', () => {
  it('parses lines without a header', () => {
    const r = importCsv(TD, 'acc1');
    expect(r?.importer.name).toBe('TD EasyWeb CSV');
    const t = r!.txns;
    expect(t).toHaveLength(7);
    expect(t[0]).toMatchObject({ date: '2026-10-01', amount: -4.52, balance: 1234.56, accountId: 'acc1' });
    expect(t[3]).toMatchObject({ date: '2026-10-03', amount: 2500 });
  });
  it('gives two identical lines different ids, and the same line the same id twice', () => {
    const a = importCsv(TD, 'acc1')!.txns, b = importCsv(TD, 'acc1')!.txns;
    expect(a[0].id).not.toBe(a[1].id);
    expect(a.map(t => t.id)).toEqual(b.map(t => t.id));
    expect(importCsv(TD, 'acc2')!.txns[0].id).not.toBe(a[0].id);
  });
  it('normalizes merchants so rules stick', () => {
    expect(normalizeMerchant('TIM HORTONS #2231 TORONTO ON')).toBe('TIM HORTONS');
    expect(normalizeMerchant('LOBLAWS 1055 MISSISSAUGA')).toBe('LOBLAWS');
    expect(normalizeMerchant('SQ *THE LITTLE BAKERY')).toBe('THE LITTLE BAKERY');
  });
  it('masks anything that looks like a card number', () => {
    expect(maskNumbers('PAYMENT 4111 1111 1111 1111 THANK YOU')).toBe('PAYMENT ****1111 THANK YOU');
    expect(maskNumbers('STORE 12345')).toBe('STORE 12345');
  });
  it('knows the common Canadian merchants', () => {
    expect(builtinCategory('TIM HORTONS')).toBe('Coffee');
    expect(builtinCategory('LOBLAWS')).toBe('Groceries');
    expect(builtinCategory('PAYROLL DEPOSIT ACME CORP')).toBe('Income');
    expect(builtinCategory('SEND E-TFR')).toBe('Transfers');
    expect(builtinCategory('MONTHLY PLAN FEE')).toBe('Fees & interest');
    expect(builtinCategory('PAYMENT - THANK YOU')).toBe('Credit card payment');
    expect(builtinCategory('ZZZ UNKNOWN SHOP')).toBeNull();
  });
  it('sums spending without transfers or income', () => {
    const t = importCsv(TD, 'acc1')!.txns;
    for (const x of t) { x.category = builtinCategory(x.merchant, x.desc) || 'Other'; }
    const s = totals(t);
    expect(s.income).toBe(2500);
    expect(s.spent).toBe(124.09);
    expect(sumByCategory(t).Coffee).toBe(9.04);
  });
});

describe('header CSVs', () => {
  it('reads date/description/amount with a header', () => {
    const r = importCsv('Date,Description,Amount\n2026-09-02,NETFLIX.COM,-18.99\n2026-09-03,Refund,20.00\n', 'x');
    expect(r?.importer.name).toBe('CSV with headers');
    expect(r!.txns.map(t => t.amount)).toEqual([-18.99, 20]);
  });
  it('parses dates and amounts', () => {
    expect(parseDate('10/30/2026')).toBe('2026-10-30');
    expect(parseDate('30/10/2026')).toBe('2026-10-30');
    expect(parseDate('2026-1-5')).toBe('2026-01-05');
    expect(parseAmount('$1,234.50')).toBe(1234.5);
    expect(parseAmount('(12.00)')).toBe(-12);
    expect(parseAmount('')).toBeNull();
  });
});
