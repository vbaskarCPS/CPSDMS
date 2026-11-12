import { describe, expect, it } from 'vitest';
import { cleanCode, seenWhen } from './watch';

describe('watch pairing helpers', () => {
  it('keeps only four digits of a typed code', () => {
    expect(cleanCode(' 4 8-2 7 9')).toBe('4827');
    expect(cleanCode('ab12')).toBe('12');
  });
  it('says when a watch was last used', () => {
    const now = new Date(2026, 10, 12, 12, 0);
    expect(seenWhen(new Date(2026, 10, 12, 8, 0).toISOString(), now)).toBe('today');
    expect(seenWhen(new Date(2026, 10, 11, 22, 0).toISOString(), now)).toBe('yesterday');
    expect(seenWhen(new Date(2026, 10, 3, 9, 0).toISOString(), now)).toMatch(/Nov/);
  });
});
