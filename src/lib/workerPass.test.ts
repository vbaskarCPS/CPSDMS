// The worker dashboard's pass: kept per phone, forgotten when it runs out or the server says so,
// and plain words for a failed sign-in. Plus the worker's copy of a payslip adds up like the PDF.
import { beforeEach, describe, expect, it, vi } from 'vitest';

const rpc = vi.fn();
vi.mock('./supabase', () => ({ supabase: { rpc: (...a: unknown[]) => rpc(...a) } }));
vi.mock('../v2/lib/client', () => ({ db: {}, must: (x: unknown) => x }));

import { getPass, savePass, SignedOut, signInProblem, withPass, workerSignIn, workerSignOut } from './workerPass';
import { slipData, type WorkerPayslip } from '../v2/features/worker/WorkerHome';
import { payslipTotals } from './payslipExport';
import { lineLock } from '../v2/lib/payslips';

const store = new Map<string, string>();
beforeEach(() => {
  store.clear(); rpc.mockReset();
  vi.stubGlobal('localStorage', { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => store.set(k, v), removeItem: (k: string) => store.delete(k) });
});
const worker = { hire_id: 'h1', cn: 'I1001', year: 2026, status: 'active', first_name: 'Ann', last_name: 'Lee', center_id: 'c1', center_name: 'Sealing RTs', region: 'East', services: ['sealing'], has_pin: false };

describe('the pass', () => {
  it('signs in, keeps the pass, and forgets it when it runs out', async () => {
    rpc.mockResolvedValueOnce({ data: { ok: true, token: 'abc', expires_at: new Date(Date.now() + 864e5).toISOString(), worker }, error: null });
    const r = await workerSignIn(' I1001 ', 'ann');
    expect(r.ok).toBe(true);
    expect(rpc).toHaveBeenCalledWith('app_worker_sign_in', { p_cn: 'I1001', p_secret: 'ann' });
    expect(getPass()?.worker.cn).toBe('I1001');
    savePass({ token: 'old', expires_at: new Date(Date.now() - 1000).toISOString(), worker });
    expect(getPass()).toBeNull();
  });
  it('turns failures into plain words; a missing server function is "unavailable", not a wrong PIN', async () => {
    rpc.mockResolvedValueOnce({ data: { ok: false, reason: 'left' }, error: null });
    const r = await workerSignIn('I1002', 'bo');
    expect(r).toEqual({ ok: false, reason: 'left', until: undefined });
    if (!r.ok) expect(signInProblem(r)).toMatch(/not on this year’s contractor list/);
    rpc.mockResolvedValueOnce({ data: null, error: { message: 'function app_worker_sign_in does not exist' } });
    const u = await workerSignIn('I1001', 'x');
    expect(u.ok === false && u.reason).toBe('unavailable');
    expect(signInProblem({ ok: false, reason: 'wrong' })).toMatch(/isn’t right/);
  });
  it('a pass the server no longer accepts is forgotten', async () => {
    savePass({ token: 't', expires_at: new Date(Date.now() + 864e5).toISOString(), worker });
    rpc.mockResolvedValueOnce({ data: { ok: false, reason: 'signed_out' }, error: null });
    await expect(withPass('app_worker_me')).rejects.toBeInstanceOf(SignedOut);
    expect(getPass()).toBeNull();
    await expect(withPass('app_worker_me')).rejects.toBeInstanceOf(SignedOut);
  });
  it('signing out forgets it here and tells the server', async () => {
    savePass({ token: 't', expires_at: new Date(Date.now() + 864e5).toISOString(), worker });
    rpc.mockResolvedValueOnce({ data: null, error: null });
    await workerSignOut();
    expect(getPass()).toBeNull();
    expect(rpc).toHaveBeenCalledWith('app_worker_sign_out', { p_token: 't' });
  });
});

describe('the worker’s copy of a payslip', () => {
  const day = (totalPayout: number) => ({ date: 'Oct01', manager: 'Sam', steps: 4, equiv: 1.5, totalPrepay: 0, payoutRate: 0, aerComm: 0, upsellComm: 0, machRent: 0, deductions: 0, dailyBonus: 0, totalPayout, indivGross: 0, crackfillBase: 0 });
  const slip: WorkerPayslip = {
    id: 's1', cn: 'I1001', first_name: 'Ann', last_name: 'Lee', start_day: '2026-10-01', end_day: '2026-10-07', season: 'sealing',
    hidden: { hotels: false, advances: true, travelPkg: false }, center_name: 'Sealing RTs',
    settings: { is120Program: false, hotels: 20, advances: 50, travelPkg: 0, crackfillPct: 10, extraDeductions: [{ id: '1', label: 'Vest', amount: 15 }], additions: [{ id: '2', label: 'Bonus', amount: 25 }] },
    days: [day(180.25), day(105.10), day(210)], earned: 495.35, final_pay: 0, status: 'generated', generated_at: '', updated_at: null, paid_at: null,
  };
  it('adds up the same as the server and the PDF (hidden advances left out)', () => {
    const t = payslipTotals(slipData(slip), slip.hidden, slip.season);
    // 495.35 − hotels 20 − crackfill 49.54 (10%, rounded) − vest 15 + bonus 25
    expect(t.earnedComm).toBe(495.35);
    expect(t.crackfillDed).toBe(49.54);
    expect(t.finalPay).toBe(435.81);
  });
  it('the $120 program tops a short week up', () => {
    const t = payslipTotals(slipData({ ...slip, season: 'aeration', settings: { is120Program: true }, days: [day(80), day(100)] }), slip.hidden, 'aeration');
    expect(t.gi).toBe(240);
    expect(t.trainingBump).toBe(60);
  });
});

describe('which payslip locks a day', () => {
  it('only a paid one', () => {
    expect(lineLock([{ payslip_id: 'p', payslip: { status: 'generated' } }])).toEqual({ paid: false, generated: true });
    expect(lineLock([{ payslip_id: 'p', payslip: { status: 'paid' } }, { payslip_id: null }])).toEqual({ paid: true, generated: false });
    expect(lineLock([{ payslip_id: null }])).toEqual({ paid: false, generated: false });
  });
});
