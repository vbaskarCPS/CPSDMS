import { describe, expect, it } from 'vitest';
import fx from './__fixtures__/rtCartsOct.json';
import { cartLines, cartProblems, type CartContext, type PayoutCart } from './payoutCarts';
import { defaultRateCard } from './rateCard';

// Oct 2–6 of the Sealing RTs road trip (client names and addresses removed): 62 carts and 160 sales rebuilt
// from the Logsheets sheet, and the 80 payout lines worked out from Payout Stats inputs.
const card = defaultRateCard('sealing', { name: 'HST', rate: 13 });
const ctxFor = (day: string): CartContext => ({
  day, card, service: 'sealing', seasonYear: 2026, settings: { taxRate: 13, productCostPercent: 0, noTaxOnCash: false },
  facts: fx.facts as unknown as CartContext['facts'],
  showed: Object.fromEntries(Object.entries(fx.showed as Record<string, string[]>).map(([k, v]) => [k, new Set(v)])),
});
const carts = fx.carts as unknown as (PayoutCart & { day: string })[];

describe('pay from carts and sales', () => {
  it('every Oct 2–6 line comes out the same from the carts as from the Payout Stats inputs', async () => {
    const got = new Map<string, { equiv: number; payout_rate: number; total_payout: number }>();
    for (const c of carts) for (const l of await cartLines(c, ctxFor(c.day))) got.set(`${c.day}|${l.cn}`, l);
    expect(got.size).toBe(80);
    for (const want of fx.lines) {
      const g = got.get(`${want.day}|${want.cn}`)!;
      expect(g, `${want.day} ${want.cn}`).toBeDefined();
      expect(g.equiv).toBeCloseTo(Number(want.equiv), 3);
      expect(g.payout_rate).toBeCloseTo(Number(want.payout_rate), 6);
      expect(g.total_payout).toBeCloseTo(Number(want.total_payout), 2);
    }
  });

  it('editing a sale changes the pay; an EQ set at payout stays until it is cleared', async () => {
    const c = carts.find(x => x.eq_override == null && x.members.length === 1 && x.sales.length >= 2)!;
    const base = (await cartLines(c, ctxFor(c.day)))[0];
    const edited = { ...c, sales: c.sales.map((s, i) => i === 0 ? { ...s, price: s.price + 113 } : s) };   // +$113 with tax = +$100 payable = +4 EQ
    const after = (await cartLines(edited, ctxFor(c.day)))[0];
    expect(after.equiv - base.equiv).toBeCloseTo(4, 6);
    expect(after.total_payout - base.total_payout).toBeCloseTo(4 * after.payout_rate, 6);
    const pinned = { ...edited, eq_override: c.eq_override ?? base.equiv };
    expect((await cartLines(pinned, ctxFor(c.day)))[0].equiv).toBeCloseTo(base.equiv, 6);
  });

  it('flags splits that don’t add up and people on two carts', () => {
    const c = carts[0];
    const bad = [{ ...c, members: c.members.map(m => ({ ...m, equiv_split: 60 })) }, { ...c, label: 'Other' }];
    const p = cartProblems(bad as PayoutCart[]);
    expect(p.some(x => x.includes('EQ splits add up to 60%'))).toBe(true);
    expect(p.some(x => x.includes('is on both'))).toBe(true);
  });
});
