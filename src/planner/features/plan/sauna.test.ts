// The sauna ticks itself when its timer runs out (dates.ts, saunaDue).
import { describe, expect, it } from 'vitest';
import { saunaDue } from './dates';

const at = (hm: string) => new Date(`2026-11-12T${hm}:00`).getTime();
const start = new Date(at('06:40')).toISOString();
describe('saunaDue', () => {
  it('nothing while the timer is still on; the end time once it has run out', () => {
    expect(saunaDue(start, undefined, 10, at('06:49'))).toBeNull();
    expect(saunaDue(start, undefined, 10, at('06:50'))).toBe('06:50');
    expect(saunaDue(start, undefined, 10, at('07:53'))).toBe('06:50');   // noticed later: still the time it ended
  });
  it('nothing when already ticked, never started, no sauna today, or a broken start', () => {
    expect(saunaDue(start, '06:48', 10, at('07:00'))).toBeNull();
    expect(saunaDue(undefined, undefined, 10, at('07:00'))).toBeNull();
    expect(saunaDue(start, undefined, 0, at('07:00'))).toBeNull();
    expect(saunaDue('not a time', undefined, 10, at('07:00'))).toBeNull();
  });
});
