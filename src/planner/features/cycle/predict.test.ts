import { describe, expect, it } from 'vitest';
import { cycles, median, projections, stats, today, marksFor, staleAfter } from './predict';
import { periodFrom } from './LastPeriod';
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
  it('stops counting from a last period that is too old, instead of "671 days late"', () => {
    // 30-day cycles: late is counted up to 60 days past the due date (day 90), then the tracker asks for the latest period
    expect(staleAfter(stats(periods, {}))).toBe(90);
    expect(today(periods, {}, '2025-03-29')).toMatchObject({ day: 90, late: 59 });
    expect(today(periods, {}, '2025-03-29').stale).toBeUndefined();
    expect(today(periods, {}, '2025-03-30')).toEqual({ day: null, phase: null, lastStart: '2024-12-30', inPeriod: null, next: null, late: 0, projections: [], stale: true });
    // her case: the imported history stops in December 2024 and it is November 2026
    expect(today(periods, {}, '2026-11-11')).toMatchObject({ stale: true, late: 0, day: null });
    // once the latest period is logged, the count is back (the long gap before it is left out of the averages)
    const caughtUp = [...periods, P('2026-09-22', '2026-09-26')];
    expect(today(caughtUp, {}, '2026-11-11')).toMatchObject({ day: 51, late: 20, phase: 'luteal' });
    expect(today(caughtUp, {}, '2026-11-11').stale).toBeUndefined();
    // a period that is running now is never too old, however long it is
    expect(today([P('2026-01-01', '2026-11-30')], {}, '2026-11-11').stale).toBeUndefined();
  });
  it('makes the period to save from the day her last one started', () => {
    expect(periodFrom('2026-09-22', 5, '2026-11-11', periods)).toEqual({ start: '2026-09-22', end: '2026-09-26', source: 'app' });
    expect(periodFrom('2026-11-10', 5, '2026-11-11', periods)).toEqual({ start: '2026-11-10', end: '2026-11-11', source: 'app' });   // still running: ends today for now
    expect(periodFrom('2026-11-12', 5, '2026-11-11', periods)).toBeNull();   // not yet
    expect(periodFrom('2024-12-31', 5, '2026-11-11', periods)).toBeNull();   // a period is already logged on that day
    expect(periodFrom('soon', 5, '2026-11-11', periods)).toBeNull();
    expect(periodFrom('2026-09-22', 0, '2026-11-11', [])).toMatchObject({ end: '2026-09-26' });   // no usual length yet: 5 days
  });
  it('marks calendar days', () => {
    const m = marksFor(periods, {});
    expect(m('2024-12-31').period).toBe(true);
    expect(m('2025-01-15')).toMatchObject({ fertile: true, ovulation: true });
    expect(m('2025-01-30').predicted).toBe(true);
    expect(m('2025-01-05')).toEqual({});
  });
});
