// Session formats: which exercises run as a block, the tracker each exercise gets, and how a plan becomes a session.
import { describe, expect, it, vi } from 'vitest';
vi.mock('../../lib/docs', () => ({ dayKey: () => '2026-11-10', getDocs: vi.fn(async () => []), putDoc: vi.fn(), putDocs: vi.fn() }));
vi.mock('../../lib/ai', () => ({ planFromText: vi.fn() }));
import { blockHow, blocksOf, blockTitle, cleanFormat, hasSides, hrLine, isIntervals, isNoLoad, planExercisesFrom, sessionLines, settleGroups, styleLabel, targetLine } from './format';
import { foldWarmups, newExercise, startFromTemplate, templateFromPlan } from './store';
import type { Exercise, Template, TemplateExercise, Workout } from './types';

const tx = (name: string, o: Partial<TemplateExercise> = {}): TemplateExercise => ({ exerciseId: name.toLowerCase().replace(/[^a-z0-9]+/g, '-'), name, targetSets: 3, targetReps: '10', restSec: 60, ...o });

describe('which tracker an exercise gets', () => {
  it('left / right for anything done a side at a time: said in the target, in the name, or by the plan', () => {
    expect(hasSides(tx('Half-kneeling Kettlebell Chop', { targetReps: '8 per side' }))).toBe(true);
    expect(hasSides(tx('Half-kneeling Kettlebell Chop'))).toBe(true);                    // a chop is one side at a time
    expect(hasSides(tx('Kettlebell Halo', { targetReps: '5 each direction' }))).toBe(true);
    expect(hasSides(tx('Kettlebell Windmill'))).toBe(true);
    expect(hasSides(tx('Side Plank on Knees', { mode: 'time', targetReps: '', note: 'Straight line from knees to shoulders, per side' }))).toBe(true);
    expect(hasSides(tx('One-arm Dumbbell Row'))).toBe(true);
    expect(hasSides(tx('Barbell Bench Press'))).toBe(false);
    expect(hasSides(tx('Goblet Squat', { note: 'sit back between the hips' }))).toBe(false);
    expect(hasSides(tx('Dumbbell Bench Press', { note: 'lower each arm slowly' }))).toBe(false);   // a cue about a two-armed lift
    expect(hasSides(tx('Stretching', { mode: 'time', targetReps: '', note: 'Per side' }))).toBe(true);
    expect(hasSides(tx('Kettlebell Windmill', { sides: false }))).toBe(false);          // the plan's word wins
  });

  it('no weight box for mobility and bodyweight drills, unless a weight has been logged', () => {
    expect(isNoLoad(tx('Cat-Cow'))).toBe(true);
    expect(isNoLoad(tx('90/90 Hip Rotations'))).toBe(true);
    expect(isNoLoad(tx('Dead Bug'))).toBe(true);
    expect(isNoLoad(tx('Kettlebell Goblet Rotation'))).toBe(false);                     // a rotation, but loaded
    expect(isNoLoad(tx('Dumbbell Bench Press'))).toBe(false);
    expect(isNoLoad(tx('Push-up'), { equipment: 'bodyweight' } as Exercise)).toBe(true);
    expect(isNoLoad({ ...tx('Push-up'), sets: [{ weight: 25, reps: 8, done: true }] }, { equipment: 'bodyweight' } as Exercise)).toBe(false);
    expect(isNoLoad(tx('Dumbbell Curl', { noLoad: true }))).toBe(true);
  });

  it('short cardio bursts with a rest run themselves as intervals', () => {
    const bike = { equipment: 'cardio', type: 'cardio' } as Exercise;
    expect(isIntervals(tx('Bike', { mode: 'time', targetSets: 8, targetSec: 20, restSec: 40 }), bike)).toBe(true);
    expect(isIntervals(tx('Bike', { mode: 'time', targetSets: 1, targetSec: 300, restSec: 0 }), bike)).toBe(false);   // a warm-up
    expect(isIntervals(tx('Plank', { mode: 'time', targetSets: 3, targetSec: 45, restSec: 60 }))).toBe(false);          // you start a hold yourself
    expect(isIntervals(tx('Kettlebell Swing', { mode: 'time', targetSets: 6, targetSec: 30, restSec: 30, style: 'intervals' }))).toBe(true);
    expect(styleLabel(tx('Bike', { mode: 'time', targetSets: 8, targetSec: 20, restSec: 40 }), bike)).toBe('Intervals 8 × 0:20 / rest 0:40');
  });
});

describe('blocks', () => {
  const list = [tx('Bike', { mode: 'time' }), tx('Swing', { group: 'A' }), tx('Goblet Squat', { group: 'A', restSec: 75 }), tx('Bench', { style: 'pyramid', repsBySet: [12, 10, 8, 6] }),
    tx('Chop', { group: 'B', groupKind: 'emom', groupSec: 360 }), tx('Halo', { group: 'B', groupKind: 'emom', groupSec: 360 }), tx('Push-up', { group: 'C' }), tx('Row', { group: 'C' }), tx('Carry', { group: 'C' }), tx('Curl', { group: 'D' })];
  it('neighbours with the same letter run together; a letter on its own is just an exercise', () => {
    const b = blocksOf(list);
    expect(b.map(x => `${x.kind}:${x.at.join(',')}`)).toEqual(['single:0', 'superset:1,2', 'single:3', 'emom:4,5', 'circuit:6,7,8', 'single:9']);
    expect(blockTitle(b[1], list)).toBe('Superset A');
    expect(blockTitle(b[3], list)).toBe('EMOM · 6 min');
    expect(blockHow(b[1], list)).toBe('3 rounds: one set of each, back to back, then rest 75s.');
  });
  it('names the shape of an exercise’s sets', () => {
    expect(styleLabel(list[3])).toBe('Pyramid 12-10-8-6');
    expect(styleLabel(tx('Swing', { style: 'countdown', repsBySet: [10, 9, 8, 7, 6, 5, 4, 3, 2, 1] }))).toBe('Countdown 10→1');
    expect(styleLabel(list[1])).toBe('');
    expect(targetLine(tx('Kettlebell Windmill', { targetReps: '4' }))).toBe('3 × 4 per side');
    expect(targetLine(tx('Side Plank', { mode: 'time', targetSets: 2, targetSec: 25 }))).toBe('2 × 0:25 per side');
  });
});

describe('a plan from Arvy becomes a session', () => {
  const plan = { name: 'Kettlebell shake-up', exercises: planExercisesFrom([
    { name: 'Bike', sets: 6, seconds: 20, rest_seconds: 40, style: 'intervals' },
    { name: 'Kettlebell Swing', sets: 3, reps: '12', weight: 35, group: 'a', rest_seconds: 0 },
    { name: 'Kettlebell Goblet Squat', sets: 3, reps: 10, group: 'A', rest_seconds: 75 },
    { name: 'Dumbbell Bench Press', sets: 99, reps_by_set: [12, 10, 8, 6], weight_by_set: [30, 35, 40, 45], rest_seconds: 90 },
    { name: 'Half-kneeling Kettlebell Chop', sets: 1, reps: '8', per_side: true, weight: 25, group: 'B', group_style: 'emom', group_minutes: 6, muscle: 'core', equipment: 'kettlebell' },
    { name: 'Kettlebell Halo', sets: 1, reps: '5', per_side: true, group: 'B', group_style: 'emom' },
    { name: 'Cat-Cow', sets: 1, reps: '8', no_weight: true, group: 'Z' },
    { junk: true }, 'nope',
  ]) };

  it('reads Arvy’s exercise shape, dropping what isn’t an exercise', () => {
    expect(plan.exercises).toHaveLength(7);
    expect(plan.exercises[0]).toMatchObject({ mode: 'time', seconds: 20, restSec: 40, style: 'intervals', sets: 6 });
    expect(plan.exercises[3]).toMatchObject({ mode: 'reps', repsBySet: [12, 10, 8, 6], weightBySet: [30, 35, 40, 45] });
    expect(plan.exercises[4]).toMatchObject({ perSide: true, group: 'B', groupKind: 'emom', groupMinutes: 6 });
  });

  const { template, created } = templateFromPlan(plan, 'lb');
  it('builds the template: blocks settled, shapes named, new exercises described properly', () => {
    const ex = template.exercises;
    expect(blocksOf(ex).map(b => b.kind)).toEqual(['single', 'superset', 'single', 'emom', 'single']);
    expect(ex[3]).toMatchObject({ style: 'pyramid', targetSets: 4, targetReps: '12-10-8-6', repsBySet: [12, 10, 8, 6], weightBySet: [30, 35, 40, 45] });
    expect(ex[4]).toMatchObject({ sides: true, group: 'B', groupKind: 'emom', groupSec: 360 });
    expect(ex[5]).toMatchObject({ group: 'B', groupKind: 'emom', groupSec: 360 });      // the block shares one clock
    expect(ex[6].group).toBeUndefined();                                                   // a letter used once isn't a block
    expect(ex[6].noLoad).toBe(true);
    const chop = created.find(e => e.name === 'Half-kneeling Kettlebell Chop')!;
    expect(chop).toMatchObject({ equipment: 'kettlebell', muscles: ['core'], unilateral: true });
    expect(created.find(e => e.name === 'Kettlebell Halo')).toMatchObject({ equipment: 'kettlebell', unilateral: true });
    expect(created.find(e => e.name === 'Cat-Cow')).toMatchObject({ equipment: 'bodyweight' });
    expect(sessionLines(ex).slice(0, 5)).toEqual(['  Bike: Intervals 6 × 0:20 / rest 0:40', '  Superset A:', '    Kettlebell Swing: 3 × 12', '    Kettlebell Goblet Squat: 3 × 10', '  Dumbbell Bench Press: Pyramid 12-10-8-6']);
  });

  it('starts the session with the plan’s numbers and the right rows', () => {
    const w = startFromTemplate(template as Template, [], 'lb', created);
    const by = (n: string) => w.exercises.find(e => e.name === n)!;
    expect(by('Bike').sets).toHaveLength(6);
    expect(by('Dumbbell Bench Press').sets.map(s => `${s.weight}x${s.reps}`)).toEqual(['30x12', '35x10', '40x8', '45x6']);
    expect(by('Kettlebell Swing').group).toBe('A');
    expect(by('Half-kneeling Kettlebell Chop').sets).toHaveLength(1);                     // a clocked block logs its rounds when the clock stops
    expect(by('Half-kneeling Kettlebell Chop').sets[0]).toMatchObject({ reps: 8, repsR: 8 });
    expect(by('Cat-Cow').sets[0].weight).toBe(0);
  });

  it('a pyramid keeps its shape even when last session left a straight-sets prescription', () => {
    const last: Workout = { id: 'w0', date: '2026-11-08', startedAt: '2026-11-08T20:00:00Z', endedAt: '2026-11-08T21:00:00Z', name: 'x',
      exercises: [{ exerciseId: 'db-bench', name: 'Dumbbell Bench Press', restSec: 90, sets: [{ weight: 30, reps: 12, done: true }] }], next: { 'db-bench': { weight: 35, reps: 8, sets: 3 } } };
    const w = startFromTemplate(template as Template, [last], 'lb', created);
    expect(w.exercises.find(e => e.name === 'Dumbbell Bench Press')!.sets.map(s => s.reps)).toEqual([12, 10, 8, 6]);
  });
});

describe('tidying', () => {
  it('cleans a format: a ladder needs two sets, a clock only belongs to an EMOM or AMRAP', () => {
    expect(cleanFormat({ repsBySet: [5, 4, 3, 2, 1] }, 'reps')).toEqual({ repsBySet: [5, 4, 3, 2, 1], style: 'countdown' });
    expect(cleanFormat({ repsBySet: [12, 10, 8] }, 'reps').style).toBe('pyramid');
    expect(cleanFormat({ repsBySet: [8, 10, 12, 10, 8] }, 'reps').style).toBe('pyramid');
    expect(cleanFormat({ repsBySet: [10] }, 'reps')).toEqual({});
    expect(cleanFormat({ group: 'a', groupSec: 600 }, 'reps')).toEqual({ group: 'A' });
    expect(cleanFormat({ style: 'intervals' }, 'reps')).toEqual({});
    const settled = settleGroups<{ group?: string; groupKind?: 'amrap'; groupSec?: number }>([{ group: 'A', groupKind: 'amrap' }, { group: 'A' }]);
    expect(settled.map(e => `${e.groupKind} ${e.groupSec}`)).toEqual(['amrap 480', 'amrap 480']);
  });
  it('a lift’s warm-up lines fold into one cue, said once', () => {
    const list = [tx('Barbell Bench Press', { targetSets: 1 }), tx('Barbell Bench Press', { targetSets: 1 }), tx('Barbell Bench Press', { targetSets: 4 })];
    const out = foldWarmups(list);
    expect(out).toHaveLength(1);
    expect(out[0].note).toBe('1 light set first (~50%)');
  });
  it('a new exercise is described from its name when the plan doesn’t say', () => {
    expect(newExercise('KB Suitcase Carry')).toMatchObject({ equipment: 'kettlebell', muscles: ['core'], unilateral: true });
    expect(newExercise('Treadmill Sprint', { timed: true })).toMatchObject({ equipment: 'cardio', type: 'cardio', timed: true });
    expect(newExercise('Incline Dumbbell Press').unilateral).toBeUndefined();
  });
});

describe('the heart rate under a done set', () => {
  it('average / peak · how far it fell after', () => {
    expect(hrLine({ avg: 141.6, max: 156, rec: 28, recSec: 90, n: 40 })?.text).toBe('♥ 142 / 156 · −28');
    expect(hrLine({ avg: 141.6, max: 156, rec: 28 })?.words).toBe('Heart rate 142 average, 156 at the top, down 28 in the rest after');
  });
  it('without the fall until the watch has measured it', () => {
    expect(hrLine({ avg: 130, max: 149 })?.text).toBe('♥ 130 / 149');
  });
  it('nothing when the set has no heart rate', () => {
    expect(hrLine(undefined)).toBeNull();
    expect(hrLine({ avg: 0, max: 0 })).toBeNull();
  });
});
