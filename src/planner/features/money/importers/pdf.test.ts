import { describe, expect, it } from 'vitest';
import { maskStatement } from './pdf';

describe('maskStatement', () => {
  it('hides account, card and phone numbers but keeps amounts and dates', () => {
    const s = 'Account No. 1234-5678901   Tel: 416-555-0199   VISA 4520123456789012   PETRO-CANADA 10 _F   60.00   AUG04   1,234.56';
    const m = maskStatement(s);
    expect(m).not.toContain('5678901');
    expect(m).not.toContain('4520123456789012');
    expect(m).not.toContain('416-555-0199');
    expect(m).toContain('60.00');
    expect(m).toContain('1,234.56');
    expect(m).toContain('AUG04');
    expect(m).toContain('PETRO-CANADA 10');
  });
  it('leaves short reference numbers alone', () => {
    expect(maskStatement('GC 2035-DEPOSIT 2,947.80')).toBe('GC 2035-DEPOSIT 2,947.80');
    expect(maskStatement('FIDO 11 PMT# R9Y8K 85.78')).toBe('FIDO 11 PMT# R9Y8K 85.78');
  });
});

import { reconcileSigns } from './pdf';
describe('reconcileSigns', () => {
  it('flips the rows whose sign contradicts the running balance', () => {
    const rows = [
      { amount: -13.55 }, { amount: 26.44 /* wrong: was a withdrawal */ }, { amount: 1480, balance: 2298.29 },
      { amount: -9.61 }, { amount: 2947.80, balance: 5236.48 },
    ];
    const r = reconcileSigns(rows, 858.28);
    expect(r.fixed).toBe(1);
    expect(r.rows[1].amount).toBe(-26.44);
    expect(r.rows.map(x => x.amount)).toEqual([-13.55, -26.44, 1480, -9.61, 2947.80]);
  });
  it('leaves consistent rows alone and copes without an opening balance', () => {
    const rows = [{ amount: -5, balance: 95 }, { amount: -10 }, { amount: 20, balance: 105 }];
    const r = reconcileSigns(rows);
    expect(r.fixed).toBe(0);
    expect(r.rows[1].amount).toBe(-10);
  });
});
