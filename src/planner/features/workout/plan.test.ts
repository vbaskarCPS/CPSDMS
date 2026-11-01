// A coach's plan → session: a lift's warm-up set folds into its working sets.
import { describe, expect, it } from 'vitest';
import { foldWarmups } from './store';
import type { TemplateExercise } from './types';

const ex = (exerciseId: string, targetSets: number, note?: string, mode: 'reps' | 'time' = 'reps'): TemplateExercise =>
  ({ exerciseId, name: exerciseId, targetSets, targetReps: mode === 'reps' ? '10' : '', restSec: 60, mode, note });

describe('foldWarmups', () => {
  it('folds a 1-set warm-up of a lift into the working sets that follow', () => {
    const out = foldWarmups([ex('bike', 1, undefined, 'time'), ex('db-row', 1, 'light, ~50%'), ex('pull-up', 3), ex('db-row', 4, 'brace on a bench')]);
    expect(out.map(e => e.exerciseId)).toEqual(['bike', 'pull-up', 'db-row']);
    expect(out[2].note).toBe('1 light set first (~50%) · brace on a bench');
    expect(out[2].targetSets).toBe(4);
  });
  it('leaves a single-set exercise alone when the lift does not come back', () => {
    const out = foldWarmups([ex('kb-swing', 1), ex('plank', 2, undefined, 'time')]);
    expect(out).toHaveLength(2);
  });
});
