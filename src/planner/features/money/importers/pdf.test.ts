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
