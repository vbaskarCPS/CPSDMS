import { describe, expect, it } from 'vitest';
import { sleepHours, trainingState } from './trainingState';
import { LIBRARY } from './library';
import type { Workout } from './types';

const set = (weight: number, reps: number, rpe?: number) => ({ weight, reps, rpe, done: true });
const wo = (date: string, ex: { id: string; name: string; sets: ReturnType<typeof set>[]; comment?: string }[]): Workout => ({
  id: date, date, startedAt: `${date}T10:00:00`, endedAt: `${date}T11:00:00`, name: 'S',
  exercises: ex.map(e => ({ exerciseId: e.id, name: e.name, restSec: 90, sets: e.sets, comment: e.comment })),
});

describe('sleepHours', () => {
  it('counts lights out after midnight as the same night', () => {
    expect(sleepHours({ date: '2026-11-02', ticks: { lightsOut: '00:30' } }, { date: '2026-11-03', ticks: { up: '08:19' } })).toBe(7.8);
    expect(sleepHours({ date: '2026-11-02', ticks: { lightsOut: '22:30' } }, { date: '2026-11-03', ticks: { up: '06:30' } })).toBe(8);
  });
  it('ignores impossible nights', () => {
    expect(sleepHours({ date: 'a', ticks: { lightsOut: '08:19' } }, { date: 'b', ticks: { up: '08:30' } })).toBeNull();
  });
});

describe('trainingState', () => {
  const bench = (w: number, r: number) => ({ id: 'bench-press', name: 'Barbell Bench Press', sets: [set(w, r, 8), set(w, r, 8), set(45, 10, 4)] });
  const s = trainingState({
    today: '2026-11-07', units: 'lb', exercises: LIBRARY, proteinTarget: 180,
    workouts: [wo('2026-10-20', [bench(135, 8)]), wo('2026-10-27', [bench(140, 8)]), wo('2026-11-03', [bench(145, 8)]), wo('2026-11-06', [{ id: 'deadlift', name: 'Deadlift', sets: [set(185, 5)], comment: 'lower back a bit tight' }])],
    days: [{ date: '2026-11-05', ticks: { lightsOut: '00:30' } }, { date: '2026-11-06', ticks: { up: '06:00', lightsOut: '23:30' } }, { date: '2026-11-07', ticks: { up: '07:30' } }],
    meals: [{ date: '2026-11-07', time: '08:00', totals: { kcal: 500, protein: 40 } }],
  });
  it('reads sleep and food', () => {
    expect(s.readiness.sleep_last_night_h).toBe(8);
    expect(s.readiness.sleep_avg_7_nights_h).toBe(6.8);
    expect(s.readiness.protein_today_g).toBe(40);
  });
  it('counts hard sets per muscle (warm-ups out) and days since', () => {
    const chest = s.muscles.find(m => m.muscle === 'chest')!;
    expect(chest.hard_sets_last_7_days).toBe(2);
    expect(chest.days_since_trained).toBe(4);
    expect(s.muscles.find(m => m.muscle === 'hamstrings')!.days_since_trained).toBe(1);
  });
  it('tracks e1RM progress and pain notes', () => {
    const b = s.progress.find(p => p.lift === 'Barbell Bench Press')!;
    expect(b.trend).toBe('up');
    expect(b.e1rm_latest).toBeGreaterThan(b.e1rm_first);
    expect(s.pain_or_niggles_last_14_days[0].where).toBe('Deadlift');
  });
});

describe('inferMuscles', () => {
  it('reads custom moves by name', async () => {
    const { inferMuscles } = await import('./trainingState');
    expect(inferMuscles('Assisted Pull-up')).toEqual(['back', 'biceps']);
    expect(inferMuscles('Kettlebell Halo')).toEqual(['shoulders']);
    expect(inferMuscles('Half-kneeling Kettlebell Chop')).toEqual(['core']);
    expect(inferMuscles('Cat-Cow')).toEqual([]);
    expect(inferMuscles('Deep squat')).toEqual(['quads', 'glutes']);
  });
});
