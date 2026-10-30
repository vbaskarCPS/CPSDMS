import { describe, expect, it } from 'vitest';
import { parseReps, roundTo, stepFor, suggest } from './progression';

const set = (weight: number, reps: number, rpe?: number) => ({ weight, reps, rpe, done: true });

describe('parseReps', () => {
  it('reads ranges and singles', () => {
    expect(parseReps('8-12')).toEqual({ lo: 8, hi: 12 });
    expect(parseReps('5')).toEqual({ lo: 5, hi: 5 });
    expect(parseReps('12 to 15')).toEqual({ lo: 12, hi: 15 });
    expect(parseReps('')).toEqual({ lo: 8, hi: 12 });
  });
});

describe('stepFor', () => {
  it('uses bigger steps for lower body and halves for kg', () => {
    expect(stepFor({ units: 'lb', lower: false })).toBe(5);
    expect(stepFor({ units: 'lb', lower: true })).toBe(10);
    expect(stepFor({ units: 'kg', lower: false })).toBe(2.5);
    expect(stepFor({ units: 'kg', lower: true })).toBe(5);
    expect(stepFor({ units: 'lb', lower: false, defaultStep: 2.5 })).toBe(2.5);
    expect(stepFor({ units: 'kg', lower: false, defaultStep: 10 })).toBe(5);
  });
  it('rounds to the step', () => { expect(roundTo(137, 5)).toBe(135); expect(roundTo(138, 5)).toBe(140); });
});

describe('suggest', () => {
  const base = { targetReps: '8-12', targetSets: 3, units: 'lb' as const, lower: false };

  it('starts empty', () => {
    expect(suggest({ ...base, history: [] }).weight).toBe(0);
  });
  it('adds a step when every set hit the top of the range at RPE ≤ 8', () => {
    const s = suggest({ ...base, history: [{ sets: [set(100, 12, 8), set(100, 12, 8), set(100, 12, 7)] }] });
    expect(s.weight).toBe(105);
    expect(s.reps).toBe(8);
  });
  it('adds a step when no RPE was logged', () => {
    expect(suggest({ ...base, history: [{ sets: [set(100, 12), set(100, 12), set(100, 12)] }] }).weight).toBe(105);
  });
  it('does not add when RPE was 9+', () => {
    expect(suggest({ ...base, history: [{ sets: [set(100, 12, 9), set(100, 12, 9), set(100, 12, 9)] }] }).weight).toBe(100);
  });
  it('does not add when a set fell short of the top', () => {
    const s = suggest({ ...base, history: [{ sets: [set(100, 12), set(100, 11), set(100, 10)] }] });
    expect(s.weight).toBe(100);
    expect(s.reps).toBe(12);
  });
  it('uses lower-body steps', () => {
    expect(suggest({ ...base, lower: true, history: [{ sets: [set(200, 12), set(200, 12), set(200, 12)] }] }).weight).toBe(210);
  });
  it('deloads 10% after two sessions missing reps on 2+ sets', () => {
    const bad = { sets: [set(100, 7), set(100, 6), set(100, 5)] };
    const s = suggest({ ...base, history: [bad, bad] });
    expect(s.weight).toBe(90);
    expect(s.reason).toMatch(/deload/i);
  });
  it('does not deload after one bad session', () => {
    const bad = { sets: [set(100, 7), set(100, 6), set(100, 5)] };
    const good = { sets: [set(100, 10), set(100, 9), set(100, 9)] };
    expect(suggest({ ...base, history: [bad, good] }).weight).toBe(100);
  });
  it('needs all target sets done to add', () => {
    expect(suggest({ ...base, history: [{ sets: [set(100, 12), set(100, 12)] }] }).weight).toBe(100);
  });
});
