import { describe, expect, it } from 'vitest';
import { countBefore, payFromInputs, rateFor, upsellCommissionRate } from './payoutEngine';
import { defaultRateCard } from './rateCard';

const card = defaultRateCard('sealing', { name: 'HST', rate: 13 });

describe('payout engine', () => {
  it('rate = base (solo/team) + Alumni (2nd year on, by days before the day) + Silver (by hats in the service)', () => {
    const w = { firstYear: 2025, lifetimeDays: 45, hats: { SE: 2, AER: 9 } };
    expect(rateFor(card, 'sealing', 2026, 1, w, 0).total).toBe(6.25);              // 45 days: no Alumni; 2 SE hats: .25
    expect(rateFor(card, 'sealing', 2026, 2, w, 5)).toMatchObject({ base: 8, alumni: 0.25, silver: 0.25, total: 8.5, days: 50 });
    expect(rateFor(card, 'sealing', 2026, 1, { ...w, lifetimeDays: 210 }, 0).alumni).toBe(0.5);
    expect(rateFor(card, 'sealing', 2026, 1, { ...w, firstYear: 2026 }, 300).alumni).toBe(0);   // rookies: no Alumni
    expect(rateFor(card, 'aeration', 2026, 1, w, 0).silver).toBe(1);               // 9 AER hats
    expect(countBefore(['2026-10-02', '2026-10-03', '2026-10-05'], '2026-10-04')).toBe(2);
  });
  it('pay = EQ × rate + upsells × 10% + IOS × $5 + bonuses − machine rental − deductions (same as the old payout)', () => {
    // a real Oct 6 line: team of 2, 7.96 EQ at 8.00 → $53.72 after $10 machine rental
    const out = payFromInputs({ assignedEQ: 7.96, teamSize: 2, upsellPayable: 0, iosCount: 0, bonuses: 0, machineRental: 10, deductions: 0 },
      { base: 8, alumni: 0, silver: 0, total: 8, days: 0, hats: 0, contractorYear: 1 }, 'sealing');
    expect(Number(out.finalPay)).toBeCloseTo(53.68, 2);
    const up = payFromInputs({ assignedEQ: 10, upsellPayable: 200, iosCount: 2, bonuses: 25, machineRental: 10, deductions: 5 },
      { base: 6, alumni: 0.5, silver: 0.25, total: 6.75, days: 0, hats: 0, contractorYear: 2 }, 'sealing');
    expect(Number(up.finalPay)).toBeCloseTo(67.5 + 20 + 10 + 25 - 10 - 5, 6);
    expect(upsellCommissionRate('aeration')).toBe(0.15);
  });
});
