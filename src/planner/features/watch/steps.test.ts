// The Steps card's sums (steps.ts): today's steps from the watch's health doc, the bar to the goal, and the words.
import { describe, expect, it } from 'vitest';
import { calendarDate, STEP_GOAL, stepsView } from './steps';

describe('the Steps card', () => {
  it('shows the steps, how many are left and the resting heart rate', () => {
    const v = stepsView({ steps: 6420, restingHr: 58, updatedAt: '2026-11-13T16:29:50Z', from: 'watch' });
    expect(v.steps).toBe(6420);
    expect(v.pct).toBe(64);
    expect(v.head).toBe('6,420 steps');
    expect(v.line).toBe('3,580 to 10,000 · resting 58 bpm');
    expect(v.at).not.toBeNull();
  });
  it('stops the bar at the goal and says so', () => {
    const v = stepsView({ steps: 12_345 });
    expect(v.pct).toBe(100);
    expect(v.line).toBe('Goal reached');
  });
  it('nothing from the watch yet today', () => {
    const v = stepsView(null);
    expect(v.steps).toBe(0);
    expect(v.head).toBe('Steps');
    expect(v.line).toMatch(/Nothing from your watch yet/);
  });
  it('leaves out odd numbers rather than showing them', () => {
    const v = stepsView({ steps: 'lots', restingHr: 4, updatedAt: 'not a time' });
    expect(v.steps).toBe(0);
    expect(v.restingHr).toBeNull();
    expect(v.at).toBeNull();
    expect(v.head).toBe('0 steps');
    expect(STEP_GOAL).toBe(10_000);
  });
  it('keys by the calendar date, as the watch does', () => {
    expect(calendarDate(new Date(2026, 10, 13, 2, 30))).toBe('2026-11-13');
  });
});
