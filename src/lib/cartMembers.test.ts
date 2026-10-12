// A cart saved with nobody on it (a late arrival who signed in on their own) is that worker's solo cart.
import { describe, expect, it } from 'vitest';
import { withCartMembers } from './commandCenterService';

describe('carts that list nobody', () => {
  it('reads as the worker on their own, split 100%', () => {
    const r = withCartMembers({ id: 'sess_I1012_1', worker_id: 'I1012', team_worker_ids: [] as string[], equiv_split: {}, upsell_split: {} });
    expect(r.team_worker_ids).toEqual(['I1012']);
    expect(r.equiv_split).toEqual({ I1012: 100 });
    expect(r.upsell_split).toEqual({ I1012: 100 });
    expect(r.id).toBe('sess_I1012_1');
  });
  it('also when the columns are missing', () => {
    const r = withCartMembers({ worker_id: 'I1', team_worker_ids: null, equiv_split: null, upsell_split: null });
    expect(r.team_worker_ids).toEqual(['I1']);
    expect(r.equiv_split).toEqual({ I1: 100 });
  });
  it('leaves a cart that lists its members exactly as it is', () => {
    const row = { worker_id: 'I1003', team_worker_ids: ['I1003', 'I1169'], equiv_split: { I1003: 60, I1169: 40 }, upsell_split: { I1003: 50, I1169: 50 } };
    expect(withCartMembers(row)).toBe(row);
  });
  it('keeps a split that was already set', () => {
    const r = withCartMembers({ worker_id: 'I1', team_worker_ids: [], equiv_split: { I1: 100 }, upsell_split: null });
    expect(r.equiv_split).toEqual({ I1: 100 });
    expect(r.upsell_split).toEqual({ I1: 100 });
  });
});
