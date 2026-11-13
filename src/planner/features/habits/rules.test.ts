// The rules a habit that ticks itself can carry (rules.ts): "by 5:05", "within 30 minutes of I'm up", both, neither.
import { describe, expect, it } from 'vitest';
import { countsFor, rulesLine, rulesOf } from './rules';

const D = '2026-11-12';
const at = (day: string, hm: string, s = 0) => { const [y, mo, d] = day.split('-').map(Number); const [h, m] = hm.split(':').map(Number); return new Date(y, mo - 1, d, h, m, s).getTime(); };
const next = '2026-11-13';

describe('does it count for the habit', () => {
  it('no rules: it always counts, even with no moment', () => {
    expect(countsFor({}, D, at(D, '23:59'))).toBe(true);
    expect(countsFor({}, D, null)).toBe(true);
  });
  it('by 5:05: 5:04 and 5:05 count, 5:06 does not', () => {
    const r = { by: '05:05' };
    expect(countsFor(r, D, at(D, '05:04'))).toBe(true);
    expect(countsFor(r, D, at(D, '05:05', 40))).toBe(true);
    expect(countsFor(r, D, at(D, '05:06'))).toBe(false);
  });
  it('the day starts at 4 am: "by 1:00" takes 11 pm and half past midnight, not 1:30', () => {
    const r = { by: '01:00' };
    expect(countsFor(r, D, at(D, '23:00'))).toBe(true);
    expect(countsFor(r, D, at(next, '00:30'))).toBe(true);
    expect(countsFor(r, D, at(next, '01:30'))).toBe(false);
    // and "by 23:00" does not take the small hours after it
    expect(countsFor({ by: '23:00' }, D, at(next, '00:30'))).toBe(false);
  });
  it('within 30 minutes of I\'m up', () => {
    const r = { withinUpMin: 30 }, up = at(D, '05:20');
    expect(countsFor(r, D, at(D, '05:50'), up)).toBe(true);
    expect(countsFor(r, D, at(D, '05:51'), up)).toBe(false);
    expect(countsFor(r, D, at(D, '05:10'), up)).toBe(false);   // before Up
  });
  it('no I\'m up that day: a within rule never counts', () => {
    expect(countsFor({ withinUpMin: 30 }, D, at(D, '05:30'), null)).toBe(false);
    expect(countsFor({ withinUpMin: 30 }, D, at(D, '05:30'))).toBe(false);
  });
  it('both rules: both have to hold', () => {
    const r = { by: '06:00', withinUpMin: 30 };
    expect(countsFor(r, D, at(D, '05:40'), at(D, '05:20'))).toBe(true);
    expect(countsFor(r, D, at(D, '06:10'), at(D, '05:50'))).toBe(false);   // in time after Up, too late in the day
    expect(countsFor(r, D, at(D, '05:55'), at(D, '05:00'))).toBe(false);   // early enough, too long after Up
  });
  it('a rule but no moment to check it by: no', () => {
    expect(countsFor({ by: '15:00' }, D, null)).toBe(false);
    expect(countsFor({ by: '15:00' }, D, undefined)).toBe(false);
  });
});

describe('the rules a habit has', () => {
  it('its own, else its trigger\'s: Start workout is within 30 minutes unless it says otherwise', () => {
    expect(rulesOf({ auto: 'gymStart' })).toEqual({ withinUpMin: 30 });
    expect(rulesOf({ auto: 'gymStart', withinUpMin: 45 })).toEqual({ withinUpMin: 45 });
    expect(rulesOf({ auto: 'wake', by: '05:05' })).toEqual({ by: '05:05' });
    expect(rulesOf({ auto: 'wake' })).toEqual({});
  });
  it('a malformed rule is left out', () => {
    expect(rulesOf({ auto: 'wake', by: '5:05', withinUpMin: -3 })).toEqual({});
    expect(rulesOf({ auto: 'wake', by: '25:00', withinUpMin: Number.NaN })).toEqual({});
  });
  it('the line on the card', () => {
    expect(rulesLine({ by: '05:05' })).toBe('by 5:05 am');
    expect(rulesLine({ by: '15:00' })).toBe('by 3:00 pm');
    expect(rulesLine({ withinUpMin: 30 })).toBe("within 30 min of I'm up");
    expect(rulesLine({ by: '06:00', withinUpMin: 30 })).toBe("by 6:00 am · within 30 min of I'm up");
    expect(rulesLine({})).toBe('');
  });
});
