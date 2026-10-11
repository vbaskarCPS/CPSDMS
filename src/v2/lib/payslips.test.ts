import { describe, expect, it } from 'vitest';
import { daysBetween, defaultSettings, lineCosts, lineToDay, mmmdd, statsToLine, toWorkerData, type PayoutLine } from './payslips';
import { crackfillCostFor, payslipTotals, productCostTaken, sealantCostFor } from '../../lib/payslipExport';

describe('payout lines', () => {
  it('maps a Payout Stats row the way the old payslip read the sheet', () => {
    const l = statsToLine({ contractorId: 'I1004', firstName: 'Ann', lastName: 'Lee', manager: 'Cheryl Merrick', stepCount: 2.5, assignedEQ: 12.4,
      upsellPayable: 40, totalPayoutRate: 11, productionComm: 136.4, upsellComm: 6, machineRental: 10, deductions: 10, bonuses: 20,
      finalPay: 152.4, prodGross: 420, crackfillerCost: 3 });
    expect(l).toMatchObject({ cn: 'I1004', steps: 2.5, equiv: 12.4, total_prepay: 40, payout_rate: 11, aer_comm: 136.4, mach_rent: 10,
      daily_bonus: 20, total_payout: 152.4, indiv_gross: 420, crackfill_base: 3 });
  });
  it('dates and ranges', () => {
    expect(mmmdd('2026-10-07')).toBe('Oct07');
    expect(daysBetween('2026-10-01', '2026-10-07')).toBe(7);
  });
  it('final pay: $120 program floor, extras and crackfill', () => {
    const line = (day: string, total: number) => ({ day, total_payout: total, manager: '', steps: 0, equiv: 0, total_prepay: 0, payout_rate: 0,
      aer_comm: 0, upsell_comm: 0, mach_rent: 0, deductions: 0, daily_bonus: 0, indiv_gross: 0, crackfill_base: 0 }) as unknown as PayoutLine;
    const days = [line('2026-10-06', 100), line('2026-10-07', 90)].map(lineToDay);
    const shown = { hotels: false, advances: false, travelPkg: false };
    const base = payslipTotals(toWorkerData('I1', 'A', 'B', days, defaultSettings()), shown, 'sealing');
    expect(base.finalPay).toBe(190);
    const prog = payslipTotals(toWorkerData('I1', 'A', 'B', days, { ...defaultSettings(), is120Program: true }), shown, 'sealing');
    expect(prog.finalPay).toBe(240);
    const extras = payslipTotals(toWorkerData('I1', 'A', 'B', days, { ...defaultSettings(), hotels: 50, advances: 20, crackfillPct: 10,
      extraDeductions: [{ id: '1', label: 'x', amount: 5 }], additions: [{ id: '2', label: 'y', amount: 15 }] }), shown, 'sealing');
    expect(extras.finalPay).toBe(190 - 50 - 20 - 19 - 5 + 15);
    expect(payslipTotals(toWorkerData('I1', 'A', 'B', days, { ...defaultSettings(), hotels: 50 }), { ...shown, hotels: true }, 'sealing').finalPay).toBe(190);
  });
});

describe('sealant and crackfill on the payslip', () => {
  const base = { date: 'Oct09', manager: 'Sam', steps: 4, equiv: 14.6, totalPrepay: 0, payoutRate: 20, aerComm: 292, upsellComm: 0, machRent: 0, deductions: 0, dailyBonus: 0, totalPayout: 292 };
  it('a day paid with 0% product cost shows $0 sealant, not the old 20% estimate', () => {
    // a real sealing day this trip: $413 cash, 13% tax, 0% product cost → payable 365.49
    const st = { prodGross: 413, prodCash: 413, prodPayable: 365.4867, productCostPercent: 0 };
    expect(productCostTaken(st)).toBe(0);
    const d = { ...base, indivGross: 413, crackfillBase: 0, ...lineCosts({ crackfill_base: 0, stats: st }) };
    expect(sealantCostFor(d)).toBe(0);
    expect(sealantCostFor({ ...d, sealantCost: undefined })).toBe(73.1);   // what the PDF printed before
  });
  it('a day paid with product cost shows exactly what was taken off', () => {
    // payable 283.19 after 20% off: the cost was 283.19 × 20 ÷ 80 = 70.80 (the day breakdown shows the same)
    expect(Math.round(productCostTaken({ prodPayable: 283.1858, productCostPercent: 20, taxRate: 13 })! * 100) / 100).toBe(70.8);
    // flats aren't charged product cost: $113 of flats is $100 after tax, left out of the cost
    expect(Math.round(productCostTaken({ prodPayable: 383.1858, prodFlats: 113, productCostPercent: 20, taxRate: 13 })! * 100) / 100).toBe(70.8);
  });
  it('crackfill is the day line’s dollars, not ×4 again; old sheet rows keep base × 4', () => {
    const d = { ...base, indivGross: 300, crackfillBase: 12, ...lineCosts({ crackfill_base: 12, stats: { prodGross: 300, prodPayable: 265.49, productCostPercent: 0 } }) };
    expect(crackfillCostFor(d)).toBe(12);
    expect(crackfillCostFor({ ...base, indivGross: 300, crackfillBase: 3 })).toBe(12);
  });
  it('a line that doesn’t say its product cost keeps the old estimate', () => {
    expect(productCostTaken({ prodGross: 226 })).toBeNull();
    expect(lineCosts({ crackfill_base: 0, stats: {} })).toEqual({ crackfillCost: 0 });
  });
});
