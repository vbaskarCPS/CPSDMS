// Starting a new day while an older one is open: the older day's carts are saved (a cart not paid
// out yet as not finalized, with no lines), then the old app's session is handed off.
import { beforeEach, describe, expect, it, vi } from 'vitest';

const calls: [string, unknown][] = [];
vi.mock('./client', () => {
  const chain: Record<string, unknown> = {};
  for (const k of ['select', 'eq', 'in']) chain[k] = () => chain;
  (chain as { then: unknown }).then = (res: (v: unknown) => void) => res({ data: [{ id: 'h1', cn: 'E1004' }], error: null });
  return {
    db: {
      from: () => chain,
      rpc: async (fn: string, args: unknown) => { calls.push([fn, args]); return { data: fn === 'app_save_payout_day' ? 1 : 4, error: null }; },
    },
    must: <T,>(r: { data: T; error: { message: string } | null }) => { if (r.error) throw new Error(r.error.message); return r.data; },
  };
});
vi.mock('./legacy', () => ({ pointLegacyAt: async () => undefined }));
const session = (id: string, worker: string, validated: boolean) => ({
  id, date: '2026-10-06', status: validated ? 'PAID' : 'OPEN', worker_id: worker, team_worker_ids: [worker], equiv_split: { [worker]: 100 }, bonuses: [],
  stats: {}, validation: validated ? { isValidated: true, actualTotalEQ: 10, finalCommission: 65, workerMachineRentals: { [worker]: true } } : {},
});
vi.mock('../../lib/exportService', () => ({
  loadLivePayoutInput: async () => ({
    date: '2026-10-06', seasonType: 'sealing', productCostPercent: 0, noTaxOnCash: false, taxRate: 13,
    sessions: [session('s1', 'E1004', true), session('s2', 'H1055', false), session('s3', 'C1219', false)],
    transactions: [
      { id: 't1', session_id: 's1', worker_id: 'E1004', type: 'Sale', price: 226, payment_method: 'Cash', cc_full_number: '4111111111111111', cc_cvc: '123' },
      { id: 't2', session_id: 's2', worker_id: 'H1055', type: 'Sale', price: 150, payment_method: 'Cash' },
    ],
    users: [{ user_id: 'E1004', name: 'Ann Lee', role: 'Worker', metadata: {} }, { user_id: 'H1055', name: 'Hal Moe', role: 'Worker', metadata: {} }],
  }),
  computePayoutStats: () => [
    { contractorId: 'E1004', firstName: 'Ann', lastName: 'Lee', totalPayout: 65, finalPay: 65 },
    { contractorId: 'H1055', firstName: 'Hal', lastName: 'Moe', totalPayout: 0, finalPay: 0 },
  ],
}));

import { handOffDay } from './payoutCarts';

describe('handing an open day off to a newer one', () => {
  beforeEach(() => { calls.length = 0; });
  it('saves the carts (unpaid with sales kept, not finalized; empty ones skipped), lines only for paid-out carts, then hands off', async () => {
    const r = await handOffDay('cc1', '2026-10-06');
    expect(r).toEqual({ carts: 2, open: 1 });
    expect(calls.map(c => c[0])).toEqual(['app_save_payout_day', 'app_handoff_day']);
    const save = calls[0][1] as { p_day: string; p_carts: { finalized: boolean; members: { cn: string }[] }[]; p_lines: { cn: string }[] };
    expect(save.p_day).toBe('2026-10-06');
    expect(save.p_carts.map(c => [c.members[0].cn, c.finalized])).toEqual([['E1004', true], ['H1055', false]]);
    expect(save.p_lines.map(l => l.cn)).toEqual(['E1004']);
    expect(JSON.stringify(save)).not.toMatch(/4111|cvc|cc_/i);
    expect(calls[1][1]).toEqual({ p_center: 'cc1', p_day: '2026-10-06' });
  });
  it('refuses when the old app holds a different day', async () => {
    await expect(handOffDay('cc1', '2026-10-05')).rejects.toThrow(/2026-10-06/);
    expect(calls).toEqual([]);
  });
});
