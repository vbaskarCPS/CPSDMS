// A payslip day worked out step by step: money → tax → product cost → payable → EQ → rate → pay.
import { describe, expect, it } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { DayBreakdown } from './DayBreakdown';

const text = (el: React.ReactElement) => renderToStaticMarkup(el).replace(/<[^>]+>/g, ' ').replace(/&#x27;/g, "'").replace(/\s+/g, ' ');

describe('a payslip day', () => {
  // sealing, 2-person cart, worker has 50%: their share is $300 cash + $200 prepaid, 13% tax, 20% product cost
  // taxable 300 + 100 (prepaid at 50%) = 400 → after tax 353.98 (tax 46.02) → product cost 70.80 → payable 283.19 → 11.33 EQ
  const stats = {
    cart: 'Cart 2', teamSize: 2, equivSplitPercent: 50, upsellSplitPercent: 50, stepCount: 7.5, iosCount: 1,
    prodCash: 300, prodPrepaid: 200, prodGross: 500, prodPayable: 283.1858, assignedEQ: 11.3274, teamTotalEQ: 22.6549,
    taxRate: 13, productCostPercent: 20, prepaidWeight: 0.5, billedWeight: 0.5, eqDivisor: 25, noTaxOnCash: false,
    basePayoutRate: 17, alumniRate: 1.5, silverRate: 2, totalPayoutRate: 20.5, contractorYear: 2, daysBefore: 46, silverHats: 3,
    productionComm: 232.21, upsellPayable: 88.5, upsellComm: 8.85, iosComm: 5, bonuses: 10, machineRental: 0, deductions: 0, source: 'cart',
  };
  const t = text(<DayBreakdown line={{ day: '2026-10-06', manager: 'Sam Abara', total_payout: 256.06, stats }} season="sealing" />);

  it('shows the day and the money collected', () => {
    expect(t).toContain('Cart Cart 2');
    expect(t).toContain('Team of 2 your EQ split 50%');
    expect(t).toContain('Steps (your share) 7.5');
    expect(t).toContain('Cash $300.00');
    expect(t).toContain('Prepaid $200.00');
    expect(t).toContain('Collected (your 50% of the cart) $500.00');
  });
  it('works money into EQ the way the payout does', () => {
    expect(t).toContain('Prepaid counts at 50% −$100.00');
    expect(t).toContain('Tax taken off (13%) −$46.02');
    expect(t).toContain('Product cost (20%) −$70.80');
    expect(t).toContain('Payable $283.19');
    expect(t).not.toContain('asphalt');       // no unexplained gap
    expect(t).toContain('÷ 25 per EQ 11.33 EQ');
    expect(t).toContain('Your EQ 11.33 EQ');
  });
  it('shows the rate parts and the pay adding up to the day total', () => {
    expect(t).toContain('Base (team) $17.00');
    expect(t).toContain("Alumni · year 2, 46 days worked before this day +$1.50");
    expect(t).toContain('Silver · 3 Silver Hats +$2.00');
    expect(t).toContain('Rate per EQ $20.50');
    expect(t).toContain('11.33 EQ × $20.50 $232.21');
    expect(t).toContain('Upsells: $88.50 payable × 10% +$8.85');
    expect(t).toContain('IOS: 1.00 × $5 +$5.00');
    expect(t).toContain('Bonuses +$10.00');
    expect(t).toContain('Day total $256.06');
    expect(t).not.toContain('Adjusted on the day');
  });
  it('says when the manager set the EQ, and when the center’s rate stands in for a missing tax rate', () => {
    const u = text(<DayBreakdown line={{ day: '2026-10-06', total_payout: 300, stats: { ...stats, taxRate: undefined, assignedEQ: 14, eqSetByManager: true, productionComm: 287, bonuses: 0 } }}
      season="sealing" centerTaxRate={13} />);
    expect(u).toContain('EQ set by the manager for this day 14.00 EQ');
    expect(u).toContain('the center’s current rate');
  });
  it('a day from the old Payout Stats sheet shows only what the sheet kept', () => {
    const o = text(<DayBreakdown line={{ day: '2026-09-01', steps: 6, equiv: 9.5, payout_rate: 18, total_payout: 171, stats: {} }} season="aeration" />);
    expect(o).toContain('Rate per EQ $18.00');
    expect(o).toContain('old Payout Stats sheet');
  });
});
