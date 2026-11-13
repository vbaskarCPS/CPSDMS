import { describe, expect, it } from 'vitest';
import { draftCrews, leftToPick, turnOf, type Draft } from './bennyDraft';

describe('crew draft', () => {
  it('snakes from the coin toss winner', () => {
    const seq = Array.from({ length: 6 }, (_, k) => turnOf(['f', 'j'], 'j', k));
    expect(seq).toEqual(['j', 'f', 'f', 'j', 'j', 'f']);
    expect(Array.from({ length: 6 }, (_, k) => turnOf(['a', 'b', 'c'], 'a', k))).toEqual(['a', 'b', 'c', 'c', 'b', 'a']);
  });
  it('lists crews and who is left', () => {
    const d = { teams: [{ key: 'f', managers: [], picks: ['1'] }, { key: 'j', managers: [], picks: ['2'] }],
      pool: [{ hire_id: '1', name: 'A' }, { hire_id: '2', name: 'B' }, { hire_id: '3', name: 'C' }],
      picks: [{ team: 'f', hire_id: '1' }, { team: 'j', hire_id: '2' }] } as unknown as Draft;
    expect(draftCrews(d)).toEqual([['A'], ['B']]);
    expect(leftToPick(d).map(w => w.name)).toEqual(['C']);
  });
});
