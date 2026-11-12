// The Start-workout habit counts only when Start workout is pressed within 30 minutes of I'm up (auto.ts).
import { describe, expect, it } from 'vitest';
import { GYM_START_WITHIN_MIN, startedInTime } from './auto';

const iso = (day: string, hm: string) => new Date(`${day}T${hm}:00`).toISOString();
describe('startedInTime', () => {
  const D = '2026-11-12';
  it('within 30 minutes of Up counts; later does not', () => {
    expect(GYM_START_WITHIN_MIN).toBe(30);
    expect(startedInTime({ up: '05:20', upAt: iso(D, '05:20') }, D, iso(D, '05:49'))).toBe(true);
    expect(startedInTime({ up: '05:20', upAt: iso(D, '05:20') }, D, iso(D, '05:50'))).toBe(true);
    expect(startedInTime({ up: '05:20', upAt: iso(D, '05:20') }, D, iso(D, '06:29'))).toBe(false);
  });
  it('uses the minute on the tick when the exact moment is missing; no Up tick, no tick', () => {
    expect(startedInTime({ up: '05:00' }, D, iso(D, '05:25'))).toBe(true);
    expect(startedInTime({}, D, iso(D, '05:25'))).toBe(false);
    expect(startedInTime(undefined, D, iso(D, '05:25'))).toBe(false);
  });
  it('a session started before Up does not count', () => {
    expect(startedInTime({ up: '05:20' }, D, iso(D, '05:10'))).toBe(false);
  });
});
