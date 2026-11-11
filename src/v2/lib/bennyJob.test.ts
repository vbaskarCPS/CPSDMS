// Saving a logsheet job change from the Benny (jobFromBenny): the order of the steps is what keeps pay safe.
//   the database checks again and starts the record → the old app's own edit save → the database reads the job back.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const rpc = vi.fn();
const updateTransaction = vi.fn();
let liveDate: string | null = '2026-11-10';
vi.mock('./client', async orig => ({
  ...(await orig<Record<string, unknown>>()),
  db: { rpc: (...a: unknown[]) => rpc(...a) },
  must: <T,>(r: { data: T; error: { message: string } | null }) => { if (r.error) throw new Error(r.error.message); return r.data; },
}));
vi.mock('./legacy', () => ({ pointLegacyAt: vi.fn(async () => {}) }));
vi.mock('../../lib/sessionService', () => ({ sessionService: { getDailySessionDate: async () => liveDate, updateTransaction: (...a: unknown[]) => updateTransaction(...a) } }));
vi.mock('../../lib/commandCenterService', () => ({ seasonHasTeams: () => true }));

import { jobFromBenny, type JobCheck } from './bennyActions';

const check: JobCheck = {
  ok: true, date: '2026-11-10', worker: { cn: 'I1479', name: 'Kevontae Ragguette' }, cart: { id: 's7', workers: ['Kevontae Ragguette'] },
  job: { id: 't1', client: 'Ron Gee', address: '406 Cumberland St', type: 'Sale', service: 'Lawn Rejuvenation', amount: 180, paid_by: 'Cash' },
  change: { amount: { from: 180, to: 250 }, paid_by: { from: 'Cash', to: 'Prepaid' } }, ask: { amount: 250, paid_by: 'Prepaid' },
  // the card's own copy of the patch is deliberately wrong here: the save must use the one the database hands back at the last moment
  patch: { price: 999, display_price: 'X', payment_method: 'Cash', payment_breakdown: { Cash: 999 } }, stamp: 'stamp-1', notes: [],
};
const fresh = { price: 250, display_price: 'RJ250.00', payment_method: 'Prepaid', payment_breakdown: { Prepaid: 250 }, items: [{ name: 'Lawn Rejuvenation', price: 250 }] };
const answers = (begin: unknown, done: unknown = { state: 'done' }) => rpc.mockImplementation(async (fn: string) =>
  fn === 'benny_job_begin' ? { data: begin, error: null } : fn === 'benny_job_done' ? { data: done, error: null } : { data: null, error: { message: `unexpected ${fn}` } });
const calls = () => rpc.mock.calls.map(c => c[0]);

describe('saving a logsheet job change', () => {
  beforeEach(() => { rpc.mockReset(); updateTransaction.mockReset(); updateTransaction.mockResolvedValue(undefined); liveDate = '2026-11-10'; });

  it('checks again, saves with the edit screen’s own save, then reads the job back', async () => {
    const order: string[] = [];
    rpc.mockImplementation(async (fn: string) => { order.push(fn); return { data: fn === 'benny_job_begin' ? { ...check, patch: fresh, change_id: 'c1' } : { state: 'done' }, error: null }; });
    updateTransaction.mockImplementation(async () => { order.push('save'); });
    await expect(jobFromBenny({ kind: 'job', check }, 'c1')).resolves.toBe('Ron’s job on Kevontae’s logsheet now reads $250.00, Prepaid. The totals are worked out again.');
    expect(order).toEqual(['benny_job_begin', 'save', 'benny_job_done']);
    expect(rpc.mock.calls[0][1]).toEqual({ p_center: 'c1', p_worker: 'I1479', p_job: 't1', p_change: { amount: 250, paid_by: 'Prepaid' }, p_stamp: 'stamp-1' });
    // exactly the five fields, from the database's fresh check: nothing else about the job can change
    expect(updateTransaction).toHaveBeenCalledTimes(1);
    expect(updateTransaction).toHaveBeenCalledWith('t1', { price: 250, displayPrice: 'RJ250.00', paymentMethod: 'Prepaid', paymentBreakdown: { Prepaid: 250 }, items: [{ name: 'Lawn Rejuvenation', price: 250 }] });
    expect(rpc.mock.calls[1][1]).toEqual({ p_id: 'c1' });
  });

  it('saves nothing when the database says no at the last moment (paid out since, or the job changed)', async () => {
    answers({ ok: false, problems: ['Kevontae’s logsheet is already paid out, so I won’t change it from here: the pay wouldn’t follow. Change it in Payout, where the pay is worked out again.'] });
    await expect(jobFromBenny({ kind: 'job', check }, 'c1')).rejects.toThrow('already paid out');
    answers({ ...check, ok: false, problems: ['That job changed since I checked. Ask me again.'] });
    await expect(jobFromBenny({ kind: 'job', check }, 'c1')).rejects.toThrow('changed since I checked');
    answers({ ...check, patch: fresh });   // ok, but no record was started: don't save without one
    await expect(jobFromBenny({ kind: 'job', check }, 'c1')).rejects.toThrow('can’t be changed now');
    expect(updateTransaction).not.toHaveBeenCalled();
    expect(calls()).not.toContain('benny_job_done');
  });

  it('saves nothing when the live day is no longer the one the card was made for', async () => {
    liveDate = '2026-11-11';
    await expect(jobFromBenny({ kind: 'job', check }, 'c1')).rejects.toThrow('The live day changed');
    liveDate = null;
    await expect(jobFromBenny({ kind: 'job', check }, 'c1')).rejects.toThrow('The live day changed');
    expect(rpc).not.toHaveBeenCalled(); expect(updateTransaction).not.toHaveBeenCalled();
  });

  it('a save that fails still closes the record, and says what the job still reads', async () => {
    answers({ ...check, patch: fresh, change_id: 'c1' }, { state: 'not_saved' });
    updateTransaction.mockRejectedValue(new Error('network'));
    await expect(jobFromBenny({ kind: 'job', check }, 'c1')).rejects.toThrow('The change didn’t save: Kevontae’s job still reads $180.00, Cash.');
    expect(calls()).toEqual(['benny_job_begin', 'benny_job_done']);
  });

  it('never calls it saved unless the database read the new amount and payment type back', async () => {
    answers({ ...check, patch: fresh, change_id: 'c1' }, { state: 'not_saved' });   // the save returned, but the job reads as before
    await expect(jobFromBenny({ kind: 'job', check }, 'c1')).rejects.toThrow('didn’t save');
    answers({ ...check, patch: fresh, change_id: 'c1' }, { state: 'differs' });
    await expect(jobFromBenny({ kind: 'job', check }, 'c1')).rejects.toThrow('doesn’t read the way you asked');
    rpc.mockImplementation(async (fn: string) => fn === 'benny_job_begin' ? { data: { ...check, patch: fresh, change_id: 'c1' }, error: null } : { data: null, error: { message: 'offline' } });
    await expect(jobFromBenny({ kind: 'job', check }, 'c1')).rejects.toThrow('couldn’t read the job back');   // not called saved, and not called failed either
    rpc.mockImplementation(async (fn: string) => { if (fn === 'benny_job_begin') return { data: { ...check, patch: fresh, change_id: 'c1' }, error: null }; throw new TypeError('Failed to fetch'); });
    await expect(jobFromBenny({ kind: 'job', check }, 'c1')).rejects.toThrow('couldn’t read the job back');
  });
});
