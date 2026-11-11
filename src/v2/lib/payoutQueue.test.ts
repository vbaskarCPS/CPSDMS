import { describe, it, expect } from 'vitest';
import { afterHref, queueHref, readQueue } from './payoutQueue';

describe('a line-up of payouts', () => {
  it('opens the first payout and carries the rest in the address', () => {
    expect(queueHref('2026-11-10', ['I1167', 'I1013', 'I1002'])).toBe('/app/workerbook/days/2026-11-10/payouts/I1167?queue=I1013,I1002&at=1&of=3');
    expect(queueHref('2026-11-10', ['I1167'])).toBe('/app/workerbook/days/2026-11-10/payouts/I1167?at=1&of=1');
    expect(queueHref('2026-11-10', [])).toBeNull();
    expect(queueHref('2026-11-10', ['I1167', 'I1167', 'bad id', '../x'])).toBe('/app/workerbook/days/2026-11-10/payouts/I1167?at=1&of=1');   // no repeats, nothing odd
  });
  it('after each payout comes the next, and after the last the day', () => {
    let href = queueHref('2026-11-10', ['I1167', 'I1013', 'I1002'])!;
    const seen: string[] = [];
    for (let i = 0; i < 5 && href.includes('/payouts/'); i++) {
      seen.push(href.split('/payouts/')[1].split('?')[0]);
      const q = readQueue(href.split('?')[1] || '');
      expect(q?.at).toBe(i + 1); expect(q?.of).toBe(3);
      href = afterHref('2026-11-10', q);
    }
    expect(seen).toEqual(['I1167', 'I1013', 'I1002']);
    expect(href).toBe('/app/workerbook/days/2026-11-10');
  });
  it('a payout opened on its own has no line-up and goes back to the day', () => {
    expect(readQueue('')).toBeNull();
    expect(readQueue('?edit=1')).toBeNull();
    expect(afterHref('2026-11-10', null)).toBe('/app/workerbook/days/2026-11-10');
  });
  it('an address that was tampered with is not followed', () => {
    expect(readQueue('?queue=I1,I2&at=0&of=2')).toBeNull();
    expect(readQueue('?queue=I1,I2&at=3&of=2')).toBeNull();
    expect(readQueue('?queue=I1,I2&at=x&of=2')).toBeNull();
    expect(readQueue('?queue=I1,../../admin,I2,I3,I4&at=1&of=3')).toEqual({ rest: ['I1', 'I2'], at: 1, of: 3 });   // never more than the line-up said
  });
});
