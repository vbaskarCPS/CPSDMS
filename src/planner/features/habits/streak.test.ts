import { describe, expect, it } from 'vitest';
import { bestStreak, completion, currentStreak, dayState, missedLastDue, type Logs } from './streak';
import type { Habit } from './types';

const h = (days = [0, 1, 2, 3, 4, 5, 6]): Habit => ({ id: 'a', name: 'Read', identity: '', cue: { time: '', place: '' }, stack: '', twoMinute: '', why: '', days, createdAt: '2026-10-01T05:00:00Z', order: 0 });
const log = (...keys: string[]): Logs => Object.fromEntries(keys.map(k => [k, { a: 'done' as const }]));

describe('currentStreak', () => {
  it('counts consecutive done days', () => {
    expect(currentStreak(h(), log('2026-10-28', '2026-10-29', '2026-10-30'), '2026-10-30')).toBe(3);
  });
  it('one miss keeps the chain, two misses break it', () => {
    expect(currentStreak(h(), log('2026-10-26', '2026-10-27', '2026-10-29', '2026-10-30'), '2026-10-30')).toBe(4);   // 28th missed once
    expect(currentStreak(h(), log('2026-10-25', '2026-10-26', '2026-10-29', '2026-10-30'), '2026-10-30')).toBe(2);   // 27th+28th missed
  });
  it('days not due are skipped', () => {
    // weekdays only; Oct 31 2026 is a Saturday, Nov 1 Sunday, Nov 2 Monday
    expect(currentStreak(h([1, 2, 3, 4, 5]), log('2026-10-29', '2026-10-30', '2026-11-02'), '2026-11-02')).toBe(3);
  });
  it('today undone is neither a hit nor a miss', () => {
    expect(currentStreak(h(), log('2026-10-28', '2026-10-29'), '2026-10-30')).toBe(2);
  });
  it('mini counts', () => {
    expect(currentStreak(h(), { '2026-10-29': { a: 'mini' }, '2026-10-30': { a: 'done' } }, '2026-10-30')).toBe(2);
  });
});

describe('bestStreak', () => {
  it('finds the longest run under the same rules', () => {
    const logs = log('2026-10-02', '2026-10-03', '2026-10-04', '2026-10-05', '2026-10-10', '2026-10-11');   // 6–9 missed → reset
    expect(bestStreak(h(), logs, '2026-10-12')).toBe(4);
    expect(bestStreak(h(), log('2026-10-02', '2026-10-03', '2026-10-05', '2026-10-06'), '2026-10-12')).toBe(4);   // one gap bridges
  });
});

describe('missedLastDue', () => {
  it('is true when the last due day before today has no mark', () => {
    expect(missedLastDue(h(), log('2026-10-28'), '2026-10-30')).toBe(true);
    expect(missedLastDue(h(), log('2026-10-29'), '2026-10-30')).toBe(false);
  });
  it('looks past days that are not due', () => {
    expect(missedLastDue(h([1, 2, 3, 4, 5]), log('2026-10-30'), '2026-11-02')).toBe(false);   // Fri done; Sat/Sun off
    expect(missedLastDue(h([1, 2, 3, 4, 5]), {}, '2026-11-02')).toBe(true);
  });
});

describe('dayState and completion', () => {
  it('classifies days', () => {
    const logs: Logs = { '2026-10-28': { a: 'done' }, '2026-10-27': { a: 'mini' } };
    expect(dayState(h(), logs, '2026-10-28', '2026-10-30')).toBe('done');
    expect(dayState(h(), logs, '2026-10-27', '2026-10-30')).toBe('mini');
    expect(dayState(h(), logs, '2026-10-29', '2026-10-30')).toBe('missed');
    expect(dayState(h(), logs, '2026-10-30', '2026-10-30')).toBe('off');
    expect(dayState(h(), logs, '2026-10-31', '2026-10-30')).toBe('future');
    expect(dayState(h(), logs, '2026-09-30', '2026-10-30')).toBe('off');   // before it existed
  });
  it('completion over 30 days', () => {
    const c = completion(h(), log('2026-10-29', '2026-10-30'), '2026-10-30');
    expect(c.due).toBe(30); expect(c.done).toBe(2); expect(c.pct).toBe(7);
  });
});
