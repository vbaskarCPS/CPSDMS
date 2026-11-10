import { describe, expect, it } from 'vitest';
import { NIGHT_ROUTINE, MORNING_ROUTINE } from '../../lib/routine';
import { CHALLENGES, challengeFor, challengeLine, shouldAskMissedGym, startHomeChallenge } from './homeChallenge';

const at = (hhmm: string) => { const [h, m] = hhmm.split(':').map(Number); return new Date(2026, 10, 9, h, m); };
const base = { routine: NIGHT_ROUTINE, ticks: {}, answered: false, workoutToday: false, gymDue: true };

describe('shouldAskMissedGym', () => {
  // NIGHT_ROUTINE: gym 05:15, sauna 25 min before review 06:45 → gym block ends 06:20
  it('asks once the gym block is over and nothing says you went', () => {
    expect(shouldAskMissedGym({ ...base, now: at('06:00') })).toBe(false);
    expect(shouldAskMissedGym({ ...base, now: at('06:40') })).toBe(true);
    expect(shouldAskMissedGym({ ...base, now: at('21:00') })).toBe(true);
  });
  it('asks right away when you were up well after the gym started', () => {
    expect(shouldAskMissedGym({ ...base, now: at('05:50'), ticks: { up: '05:50' } })).toBe(true);
    expect(shouldAskMissedGym({ ...base, now: at('05:10'), ticks: { up: '05:05' } })).toBe(false);
  });
  it("doesn't ask when you went, already answered, it's not a gym day, or the routine has no gym", () => {
    const late = at('09:00');
    expect(shouldAskMissedGym({ ...base, now: late, ticks: { gym: '05:20' } })).toBe(false);
    expect(shouldAskMissedGym({ ...base, now: late, workoutToday: true })).toBe(false);
    expect(shouldAskMissedGym({ ...base, now: late, answered: true })).toBe(false);
    expect(shouldAskMissedGym({ ...base, now: late, gymDue: false })).toBe(false);
    expect(shouldAskMissedGym({ ...base, now: late, routine: MORNING_ROUTINE })).toBe(false);
  });
  it('after midnight still belongs to the same planner day (4 am rollover)', () => {
    expect(shouldAskMissedGym({ ...base, now: at('01:00') })).toBe(true);
  });
});

describe('the home challenge', () => {
  it('is 5–10 minutes of 2 rounds, and rotates by day', () => {
    for (const c of CHALLENGES) {
      expect(c.minutes).toBeGreaterThanOrEqual(5); expect(c.minutes).toBeLessThanOrEqual(10);
      expect(c.items.every(i => i.sets === 2)).toBe(true);
      expect(c.items.some(i => i.exerciseId === 'push-up' && i.reps === 10)).toBe(true);
    }
    const names = new Set(['2026-11-09', '2026-11-10', '2026-11-11'].map(d => challengeFor(d).name));
    expect(names.size).toBe(3);
    expect(challengeFor('2026-11-09')).toBe(challengeFor('2026-11-09'));
    expect(challengeLine(CHALLENGES[0])).toContain('2 × 10 push-up');
  });
  it('starts a home session with the exact sets, bodyweight, nothing done yet', () => {
    const w = startHomeChallenge('2026-11-09', new Date(2026, 10, 9, 21, 0));
    expect(w.kind).toBe('home');
    expect(w.date).toBe('2026-11-09');
    const c = challengeFor('2026-11-09');
    expect(w.exercises.map(e => e.exerciseId)).toEqual(c.items.map(i => i.exerciseId));
    for (const [k, e] of w.exercises.entries()) {
      const it = c.items[k];
      expect(e.sets).toHaveLength(2);
      expect(e.sets.every(s => !s.done && s.weight === 0)).toBe(true);
      if (it.seconds) { expect(e.mode).toBe('time'); expect(e.sets[0].seconds).toBe(it.seconds); }
      else expect(e.sets[0].reps).toBe(it.reps);
    }
  });
});
