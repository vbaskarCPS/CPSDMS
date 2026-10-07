// computePayoutStats on a real (anonymized) closed day: carts from Oct 6, 2026 at Sealing RTs.
// Each cart's worker lines must add up to the cart's finalized commission, team splits included.
import { describe, expect, it } from 'vitest';
import { computePayoutStats } from '../../lib/exportService';
import { statsToLine } from './payslips';

const CC = 'e76a19fd-ec20-48c5-93d3-88b641e5db4d';
const zero = { totalEQ: 0, iosCount: 0, prodCash: 0, prodFlats: 0, prodGross: 0, stepCount: 0, prodBilled: 0, prodCheque: 0, upsellCash: 0, prodPayable: 0,
  prodPrepaid: 0, upsellCount: 0, upsellGross: 0, upsellBilled: 0, upsellCheque: 0, prodETransfer: 0, upsellPayable: 0, upsellPrepaid: 0,
  prodCreditCard: 0, upsellETransfer: 0, prodPrepaidSplit: 0, upsellCreditCard: 0 };
const sess = (id: string, workers: string[], split: Record<string, number>, eq: number, finalCommission: number, bonuses: unknown[] = []) => ({
  id, date: '2026-10-06', status: 'PAID', worker_id: workers[0], team_worker_ids: workers, command_center_id: CC, bonuses,
  equiv_split: split, upsell_split: Object.fromEntries(workers.map(w => [w, 100 / workers.length])), stats: { ...zero, totalEQ: eq },
  validation: { isValidated: true, actualTotalEQ: eq, finalCommission, machineRental: false, crackfillerPounds: 0,
    workerDeductions: Object.fromEntries(workers.map(w => [w, 0])), workerMachineRentals: Object.fromEntries(workers.map(w => [w, true])) },
});
const tx = (id: string, session: string, worker: string, price: number, method: string) => ({
  id, type: 'Sale', items: [{ name: 'Sealing', price }], price, job_id: `NEW-${id}`, worker_id: worker, session_id: session,
  display_price: String(price), payment_method: method, command_center_id: CC, payment_breakdown: null, completed_by_worker_ids: [worker],
  timestamp: '2026-10-06T16:00:00Z', is_west_split: false, services: {},
});
const user = (id: string, role = 'Worker', alumni = 0, silver = 0) => ({ user_id: id, role, name: `${role} ${id}`, command_center_id: CC,
  metadata: { assignedManagerId: 'rm_cherylmerrick', alumniRate: alumni, silverRate: silver } });

const sessions = [
  sess('s4', ['E1004'], { E1004: 100 }, 14.879646017699118, 101.59734513274338),
  sess('s6', ['H1055', 'C1219'], { H1055: 50, C1219: 50 }, 15.92920353982301, 107.43362831858408),
  sess('s5', ['EDM1225', 'T1065'], { EDM1225: 40, T1065: 60 }, 13.964601769911505, 91.71681415929206),
  sess('s7', ['T1001'], { T1001: 100 }, 31.12920353982301, 276.77522123893806, [{ id: 1, type: 'Performance EQ', amount: 100, placing: 1 }]),
  sess('s2', ['C1026'], { C1026: 100 }, 0, -10),
  { ...sess('open', [], {}, 0, 0), status: 'OPEN', worker_id: null, validation: {} },
];
const transactions = [
  tx('a', 's4', 'E1004', 200, 'Cash'), tx('b', 's4', 'E1004', 220.35, 'E-Transfer'),
  tx('c', 's6', 'C1219', 150, 'Cash'), tx('d', 's6', 'C1219', 150, 'Cash'), tx('e', 's6', 'C1219', 150, 'Cash'),
  tx('f', 's5', 'EDM1225', 175, 'Cash'), tx('g', 's5', 'T1065', 169.5, 'E-Transfer'), tx('h', 's5', 'EDM1225', 150, 'Cash'),
  tx('i', 's7', 'T1001', 203.4, 'Credit Card'), tx('j', 's7', 'T1001', 150, 'Cash'), tx('k', 's7', 'T1001', 226, 'Credit Card'),
  tx('l', 's7', 'T1001', 150, 'Cash'), tx('m', 's7', 'T1001', 150, 'Cash'),
];
const users = [user('E1004', 'Worker', 0.5, 1), user('H1055'), user('C1219'), user('EDM1225'), user('T1065'), user('T1001'), user('C1026'),
  { ...user('rm_cherylmerrick', 'RouteManager'), name: 'Cheryl Merrick', metadata: {} }];

describe('computePayoutStats (Oct 6 carts)', () => {
  const rows = computePayoutStats({ sessions, transactions, users, seasonType: 'sealing', productCostPercent: 0, noTaxOnCash: false, taxRate: 13 });
  const lines = rows.map(statsToLine);
  it('one line per worker per finalized cart; the open cart is skipped', () => {
    expect(lines.map(l => l.cn).sort()).toEqual(['C1026', 'C1219', 'E1004', 'EDM1225', 'H1055', 'T1001', 'T1065']);
  });
  it("each cart's lines add up to its finalized commission", () => {
    const sum = (ids: string[]) => lines.filter(l => ids.includes(l.cn)).reduce((s, l) => s + l.total_payout, 0);
    expect(sum(['E1004'])).toBeCloseTo(101.597, 2);
    expect(sum(['H1055', 'C1219'])).toBeCloseTo(107.434, 2);
    expect(sum(['EDM1225', 'T1065'])).toBeCloseTo(91.717, 2);
    expect(sum(['T1001'])).toBeCloseTo(276.775, 2);
    expect(sum(['C1026'])).toBeCloseTo(-10, 2);
  });
  it('carries the manager, the split EQ and the bonus', () => {
    const t = lines.find(l => l.cn === 'T1001')!;
    expect(t.daily_bonus).toBe(100);
    expect(t.manager).toBe('Cheryl Merrick');
    const a = lines.find(l => l.cn === 'EDM1225')!, b = lines.find(l => l.cn === 'T1065')!;
    expect(a.equiv + b.equiv).toBeCloseTo(13.9646, 3);
    expect(b.equiv).toBeGreaterThan(a.equiv);
  });
});
