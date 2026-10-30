import { describe, expect, it } from 'vitest';
import { cycles, median, projections, stats, today, marksFor } from './predict';
import type { Period } from './types';

const P = (start: string, end: string): Period => ({ start, end });
// regular 30-day cycles, 4-day periods, with a pregnancy gap in the middle
const periods: Period[] = [
  P('2024-01-01', '2024-01-04'), P('2024-01-31', '2024-02-03'), P('2024-03-01', '2024-03-04'),
  P('2024-10-01', '2024-10-05'),   // 214 days later: ignored for averages
  P('2024-10-31', '2024-11-03'), P('2024-11-30', '2024-12-03'), P('2024-12-30', '2025-01-02'),
];

describe('cycles & stats', () => {
  it('measures cycles and skips long gaps', () => {
    const cs = cycles(periods);
    expect(cs.map(c => c.cycleDays)).toEqual([30, 30, null, 30, 30, 30, null]);
    expect(cs[3].periodDays).toBe(5);
  });
  it('medians and overrides', () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([1, 2, 3, 4])).toBe(2.5);
    const s = stats(periods);
    expect(s.cycleLength).toBe(30); expect(s.periodLength).toBe(4); expect(s.validCycles).toBe(5); expect(s.irregular).toBe(false);
    expect(stats(periods, { cycleLength: 28 }).cycleLength).toBe(28);
    expect(stats([]).cycleLength).toBe(28); expect(stats([]).periodLength).toBe(5);
  });
  it('flags irregular cycles', () => {
    const irr = [P('2024-01-01', '2024-01-04'), P('2024-01-25', '2024-01-28'), P('2024-03-10', '2024-03-13'), P('2024-04-02', '2024-04-05'), P('2024-05-20', '2024-05-23')];
    expect(stats(irr).irregular).toBe(true);
  });
});

describe('predictions', () => {
  it('projects the next cycles from the last start', () => {
    const pr = projections(periods);
    expect(pr).toHaveLength(3);
    expect(pr[0].start).toBe('2025-01-29');
    expect(pr[0].ovulation).toBe('2025-01-15');            // start − 14
    expect(pr[0].fertileStart).toBe('2025-01-10'); expect(pr[0].fertileEnd).toBe('2025-01-16');
    expect(pr[1].start).toBe('2025-02-28');
  });
  it('knows the day, phase and lateness', () => {
    expect(today(periods, {}, '2025-01-01')).toMatchObject({ day: 3, phase: 'menstrual' });
    expect(today(periods, {}, '2025-01-10').phase).toBe('follicular');
    expect(today(periods, {}, '2025-01-15').phase).toBe('ovulation');
    expect(today(periods, {}, '2025-01-20').phase).toBe('luteal');
    expect(today(periods, {}, '2025-02-01').late).toBe(3);
    expect(today([], {}, '2025-02-01').day).toBeNull();
  });
  it('marks calendar days', () => {
    const m = marksFor(periods, {});
    expect(m('2024-12-31').period).toBe(true);
    expect(m('2025-01-15')).toMatchObject({ fertile: true, ovulation: true });
    expect(m('2025-01-30').predicted).toBe(true);
    expect(m('2025-01-05')).toEqual({});
  });
});
