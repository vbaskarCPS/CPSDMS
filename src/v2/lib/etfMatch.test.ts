// The e-transfer receipt ↔ sale rules used by the payments@ matcher (supabase/functions/_shared/etfMatch.ts).
import { describe, expect, it } from 'vitest';
import { amountGap, decide, isClose, isForward, memoHit, nameScore, plainText, type Candidate } from '../../../supabase/functions/_shared/etfMatch';

const c = (key: string, client: string, amount: number, same: boolean, extra: Partial<Candidate> = {}): Candidate =>
  ({ key, day: '2026-10-31', client, address: '3938 Paradise Pl', amount, same_amount: same, ...extra });

describe('names', () => {
  it('scores the sender against the client', () => {
    expect(nameScore('KIM DYKE', 'Kim Dyke')).toBe(1);
    expect(nameScore('Jesse D Wilson', 'Jesse Wilson')).toBe(1);
    expect(nameScore('Manju Bhatt', 'Manju  Bhatt')).toBe(1);
    expect(nameScore('Raj Bhatt', 'Manju Bhatt')).toBe(0.5);
    expect(nameScore('Tricia Noorani', 'Kim Dyke')).toBe(0);
    expect(nameScore(null, 'Kim Dyke')).toBe(0);
  });
  it('reads the message for the address or last name', () => {
    expect(memoHit('lawn at 3938 paradise', { client: 'Kelton Kowalchuck', address: '3938 Paradise Pl' })).toBe(true);
    expect(memoHit('for kowalchuck lawn', { client: 'Kelton Kowalchuck', address: '1 Main St' })).toBe(true);
    expect(memoHit('thanks!', { client: 'Kelton Kowalchuck', address: '3938 Paradise Pl' })).toBe(false);
  });
});

describe('deciding', () => {
  it('same amount and name: matched without anyone looking', () => {
    const d = decide({ sender_name: 'KIM DYKE', amount: 300 }, [c('a', 'Kim Dyke', 300, true), c('b', 'Tricia Noorani', 200, false)]);
    expect(d).toMatchObject({ key: 'a', confirmed: true, how: 'auto', confidence: 'high' });
  });
  it('same amount, someone else paid: suggested for a person to confirm', () => {
    const d = decide({ sender_name: 'Raj Patel', amount: 600 }, [c('a', 'Manju Bhatt', 600, true)]);
    expect(d).toMatchObject({ key: 'a', confirmed: false, confidence: 'medium' });
    expect(d.reason).toMatch(/name differs/);
  });
  it('two sales for the same amount and name: Claude picks, nothing confirmed', () => {
    const d = decide({ sender_name: 'Jesse Wilson', amount: 357 }, [c('a', 'Jesse Wilson', 357, true), c('b', 'Jesse Wilson', 357, true, { day: '2026-10-30' })]);
    expect(d.key).toBeNull();
    expect(d.ask?.map(x => x.key)).toEqual(['a', 'b']);
  });
  it('the message settles it between same-amount sales', () => {
    const d = decide({ sender_name: 'Bob Lee', amount: 357, memo: 'for suhail' },
      [c('a', 'Mohammad Suhail', 357, true), c('b', 'Jesse Wilson', 357, true)]);
    expect(d).toMatchObject({ key: 'a', confirmed: true });
  });
  it('name matches, amount near: suggested, medium; far off: suggested, low', () => {
    const d = decide({ sender_name: 'Tricia Noorani', amount: 210 }, [c('a', 'Tricia Noorani', 200, false)]);
    expect(d).toMatchObject({ key: 'a', confirmed: false, confidence: 'medium' });
    expect(d.reason).toMatch(/\$10\.00 over/);
    const far = decide({ sender_name: 'Tricia Noorani', amount: 100 }, [c('a', 'Tricia Noorani', 400, false)]);
    expect(far).toMatchObject({ key: 'a', confirmed: false, confidence: 'low' });
  });
  it('close amount and the name: suggested, saying how far off it is', () => {
    const d = decide({ sender_name: 'Kim Dyke', amount: 336 }, [c('a', 'Kim Dyke', 300, false, { close_amount: true })]);
    expect(d).toMatchObject({ key: 'a', confirmed: false, confidence: 'medium' });
    expect(d.reason).toMatch(/\$36\.00 over/);
  });
  it('close amount, other name, only sale near it: suggested low; part payment reads as short', () => {
    const d = decide({ sender_name: 'Raj Patel', amount: 180 }, [c('a', 'Manju Bhatt', 200, false, { close_amount: true })]);
    expect(d).toMatchObject({ key: 'a', confirmed: false, confidence: 'low' });
    expect(d.reason).toMatch(/\$20\.00 short/);
  });
  it('the gap', () => {
    expect(amountGap(300, 300)).toBe('');
    expect(amountGap(288, 300)).toBe('$12.00 short');
    expect(amountGap(315, 300)).toBe('$15.00 over');
    expect(isClose(325, 300)).toBe(true);
    expect(isClose(400, 300)).toBe(false);
    expect(isClose(1050, 1000)).toBe(true);
  });
  it('nothing fits: unmatched', () => {
    expect(decide({ sender_name: 'Nobody', amount: 12 }, []).key).toBeNull();
    expect(decide({ sender_name: 'Nobody', amount: 12 }, []).ask).toBeUndefined();
  });
  it('a sale already suggested for another receipt is only used when nothing else fits', () => {
    const d = decide({ sender_name: 'Kim Dyke', amount: 300 }, [c('a', 'Kim Dyke', 300, true, { suggested: true }), c('b', 'Kim Dyke', 300, true)]);
    expect(d).toMatchObject({ key: 'b', confirmed: true });
  });
});

describe('the email', () => {
  it('only forwards are processed', () => {
    expect(isForward('Fwd: INTERAC e-Transfer: KIM DYKE sent you money', '')).toBe(true);
    expect(isForward('FW: Funds deposited', '')).toBe(true);
    expect(isForward('Funds deposited', '---------- Forwarded message ---------\nFrom: notify@payments.interac.ca')).toBe(true);
    expect(isForward('INTERAC e-Transfer: KIM DYKE sent you money', 'Hi, KIM DYKE sent you $300.00')).toBe(false);
  });
  it('turns the html into plain text', () => {
    expect(plainText('<style>x{}</style><p>Amount:&nbsp;<b>$300.00</b></p><p>From: Kim</p>')).toBe('Amount: $300.00\nFrom: Kim');
  });
});
