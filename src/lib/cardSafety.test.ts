import { describe, it, expect } from 'vitest';
import { maskCardNumber, safeCardFields, cardColumnsForSave } from './cardSafety';

describe('card data is never stored', () => {
  it('masks a full card number to its last 4', () => {
    expect(maskCardNumber('4111 1111 1111 1234')).toBe('CARD-••••1234');
    expect(maskCardNumber('5500-0000-0000-0004')).toBe('CARD-••••0004');
  });
  it('leaves Bambora references and already-masked values alone', () => {
    expect(maskCardNumber('BAMBORA-12345')).toBe('BAMBORA-12345');
    expect(maskCardNumber('CARD-••••1234')).toBe('CARD-••••1234');
  });
  it('returns nothing for empty or too-short input', () => {
    expect(maskCardNumber('')).toBeUndefined();
    expect(maskCardNumber(undefined)).toBeUndefined();
    expect(maskCardNumber('12')).toBeUndefined();
  });
  it('drops expiry and CVC for a typed card', () => {
    expect(safeCardFields('4111111111111234', '12/28', '123'))
      .toEqual({ number: 'CARD-••••1234', expiry: null, cvc: null });
  });
  it('keeps the Bambora auth code and last 4', () => {
    expect(safeCardFields('BAMBORA-998877', 'AUTH42', '4321'))
      .toEqual({ number: 'BAMBORA-998877', expiry: 'AUTH42', cvc: '4321' });
  });
  it('stores nothing when there was no card', () => {
    expect(safeCardFields(undefined, undefined, undefined)).toEqual({ number: null, expiry: null, cvc: null });
  });
  it('leaves card columns untouched when they were not sent', () => {
    expect(cardColumnsForSave(undefined, undefined, undefined)).toEqual({});
    expect(cardColumnsForSave('4111111111111234', '12/28', '123'))
      .toEqual({ cc_full_number: 'CARD-\u2022\u2022\u2022\u20221234', cc_expiry: null, cc_cvc: null });
    expect(cardColumnsForSave(undefined, '12/28', '123')).toEqual({ cc_expiry: null, cc_cvc: null });
  });
});
