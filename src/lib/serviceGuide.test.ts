import { describe, expect, it } from 'vitest';
import { BC_LAWN_REJUV, serviceGuideFor, withGst, money } from './serviceGuide';

describe('BC service guide', () => {
  it('prints GST the way the guide does', () => {
    // the guide's own "w/GST" figures
    expect(withGst(425, 0.05)).toBe(446.25);
    expect(withGst(345, 0.05)).toBe(362.25);
    expect(withGst(150, 0.05)).toBe(157.5);
    expect(withGst(850, 0.05)).toBe(892.5);
    expect(money(446.25)).toBe('$446.25');
    expect(money(450)).toBe('$450');
  });
  it('has a price for every lot size, Lot 5 quoted', () => {
    for (const t of BC_LAWN_REJUV.tables) for (const r of t.rows) {
      expect(r.prices).toHaveLength(BC_LAWN_REJUV.lots.length);
      expect(r.prices[5]).toBeNull();
      expect(r.prices.slice(0, 5).every((p, i, a) => p !== null && (i === 0 || p >= a[i - 1]!))).toBe(true);
    }
  });
  it('the rejuvenation package is cheaper than its services on their own', () => {
    const single = BC_LAWN_REJUV.tables[1].rows;
    const rejuv = BC_LAWN_REJUV.tables[0].rows[0];
    for (let i = 0; i < 5; i++) expect(rejuv.prices[i]!).toBeLessThan(single.reduce((t, r) => t + r.prices[i]!, 0));
  });
  it('shows only on BC lawn rejuvenation days', () => {
    expect(serviceGuideFor('lawn_rejuv', 'West')).toBe(BC_LAWN_REJUV);
    expect(serviceGuideFor('sealing', 'West')).toBeNull();
    expect(serviceGuideFor('lawn_rejuv', 'East')).toBeNull();
  });
});
