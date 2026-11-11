import { describe, expect, it } from 'vitest';
import { asBonus, bonusName, bonusReplaced, bonusesSaid, liveBonusPatch, withBonuses, type BonusItem } from './bennyBonus';
import type { PayoutCart } from './payoutCarts';

const item = (over: Partial<BonusItem> = {}): BonusItem => ({
  key: 'sess_1', cns: ['I1013'], workers: ['Michael Asiegbunam'], team_size: 1, type: 'Performance EQ', placing: 1, label: 'Performance EQ - 1st Place', amount: 50,
  shares: [{ cn: 'I1013', name: 'Michael Asiegbunam', percent: 100, amount: 50 }], pay_now: 149.57, pay_after: 199.57, ...over,
});
const team = item({ key: 'c2', cns: ['I1002', 'I1169'], workers: ['Nathan Clark', 'Steven Doherty'], team_size: 2, placing: 2, label: 'Performance EQ - 2nd Place',
  shares: [{ cn: 'I1002', name: 'Nathan Clark', percent: 50, amount: 25 }, { cn: 'I1169', name: 'Steven Doherty', percent: 50, amount: 25 }], split: { I1002: 50, I1169: 50 } });
const member = (cn: string, first: string) => ({ hire_id: null, cn, first_name: first, last_name: 'X', equiv_split: 100, upsell_split: 100, machine_rental: 10, deductions: 0 });
const cart = (cns: string[], over: Partial<PayoutCart> = {}): PayoutCart => ({
  id: 'id-' + cns.join('-'), label: cns.join(' & '), manager: 'Franklyn Mitchell', members: cns.map(c => member(c, c)), eq_override: 20, crackfill_lbs: 0,
  bonuses: [], settings: {}, notes: null, finalized: true, sales: [{ route_code: 'R1', address: null, client_name: null, price: 100, payment_type: 'Cash', type: 'Sale', service: null, notes: null }], ...over,
});
const dollars = (n: number) => `$${n.toFixed(2)}`;

describe('a bonus the way the payout list keeps it', () => {
  it('a placed bonus carries its place; a team cart carries its split; Other carries what it is for', () => {
    expect(asBonus(item(), 7)).toEqual({ id: 7, type: 'Performance EQ', amount: 50, placing: 1 });
    expect(asBonus(team, 8)).toEqual({ id: 8, type: 'Performance EQ', amount: 50, placing: 2, splitPercentages: { I1002: 50, I1169: 50 } });
    expect(asBonus(item({ type: 'Other', placing: undefined, note: 'Best attitude', label: 'Best attitude', amount: 20 }), 9))
      .toEqual({ id: 9, type: 'Other', amount: 20, customDescription: 'Best attitude' });
    expect(asBonus(item({ split: { I1013: 100 } }), 1)).not.toHaveProperty('splitPercentages');   // a solo cart has nothing to split
  });
  it('is named the way people say it', () => {
    expect(bonusName(item())).toBe('1st place · Performance EQ');
    expect(bonusName(item({ placing: 12, type: 'Rookie' }))).toBe('12th place · Rookie');
    expect(bonusName(item({ type: 'Other', placing: undefined, note: 'Best attitude', label: 'Best attitude' }))).toBe('Best attitude');
  });
});

describe('the live day: what Add bonus saves on the logsheet', () => {
  it('adds the bonus to the ones there and puts it on the pay the cart was closed at', () => {
    const had = [{ id: 1, type: 'Rookie' as const, amount: 10, placing: 1 }];
    const patch = liveBonusPatch({ bonuses: had, validation: { isValidated: true, actualTotalEQ: 19.95, finalCommission: 149.57 } }, item(), 99);
    expect(patch.bonuses).toEqual([...had, { id: 99, type: 'Performance EQ', amount: 50, placing: 1 }]);
    expect(patch.validation).toEqual({ isValidated: true, actualTotalEQ: 19.95, finalCommission: 199.57 });
    expect(had).toHaveLength(1);                                             // what was read is left alone
  });
  it('a logsheet with no payout on it gets the bonus and no pay line (the payout list does the same)', () => {
    const patch = liveBonusPatch({ bonuses: null, validation: null }, item(), 5);
    expect(patch.bonuses).toHaveLength(1); expect(patch).not.toHaveProperty('validation');
  });
});

describe('a saved day: the bonuses go on the carts', () => {
  const day = () => [cart(['I1013']), cart(['I1169', 'I1002']), cart(['I1065'], { bonuses: [{ label: 'Rookie', amount: 10 }] })];
  it('each bonus lands on the cart with exactly those workers, in the saved shape, and nothing else moves', () => {
    const before = day(); const next = withBonuses(before, [item(), team], 1000);
    expect(next[0].bonuses).toEqual([{ label: 'Performance EQ - 1st Place', amount: 50, id: 1000, type: 'Performance EQ', placing: 1 }]);
    expect(next[1].bonuses).toEqual([{ label: 'Performance EQ - 2nd Place', amount: 50, id: 1001, type: 'Performance EQ', placing: 2, split: { I1002: 50, I1169: 50 } }]);
    expect(next[2]).toEqual(before[2]);                                      // a cart with no bonus coming is untouched
    expect(before[0].bonuses).toEqual([]);                                   // the carts as read are left alone
    expect(next.map(c => c.sales)).toEqual(before.map(c => c.sales));
  });
  it('a second bonus on a cart that has one is added after it', () => {
    const next = withBonuses(day(), [item({ cns: ['i1065'], workers: ['Kyle Pitt'] })], 1);
    expect(next[2].bonuses.map(b => b.label)).toEqual(['Rookie', 'Performance EQ - 1st Place']);
  });
  it('a cart that is gone, changed or not paid out stops it', () => {
    expect(() => withBonuses(day(), [item({ cns: ['I9999'], workers: ['Zed Q'] })], 1)).toThrow('Zed Q’s cart isn’t on that day the way it was when I checked. Ask me again.');
    expect(() => withBonuses(day(), [item({ cns: ['I1002'], workers: ['Nathan Clark'] })], 1)).toThrow(/isn’t on that day the way it was/);   // he is on a cart of two now
    expect(() => withBonuses([cart(['I1013'], { finalized: false })], [item()], 1)).toThrow('Michael Asiegbunam’s cart isn’t paid out any more. Finish its payout first.');
  });
});

describe('a newer bonus card for the same place replaces the older one', () => {
  const card = (date: string, ...list: BonusItem[]) => ({ kind: 'bonus', check: { ok: true, date, source: 'live', bonuses: list, ask: [], total: 0, stamp: 's' } });
  const second = (who: string) => item({ cns: [who], workers: [who], placing: 2, label: 'Performance EQ - 2nd Place' });
  it('"actually give Mugove second": the first card is no longer the one to tap', () => {
    const cards = [card('2026-11-10', item(), second('Kyle')), null, card('2026-11-10', item(), second('Mugove'))];
    expect(bonusReplaced(cards, 0)).toBe(true);
    expect(bonusReplaced(cards, 2)).toBe(false);                             // the newest stands
    expect(bonusReplaced(cards, 1)).toBe(false);                             // a message with no card
  });
  it('another day, another place, or another kind of card leaves it alone', () => {
    expect(bonusReplaced([card('2026-11-09', item()), card('2026-11-10', item())], 0)).toBe(false);
    expect(bonusReplaced([card('2026-11-10', item()), card('2026-11-10', second('Kyle'))], 0)).toBe(false);   // 1st place, then 2nd place: both stand
    expect(bonusReplaced([card('2026-11-10', item()), { kind: 'job', check: {} }], 0)).toBe(false);
    expect(bonusReplaced([{ kind: 'job', check: {} }, card('2026-11-10', item())], 0)).toBe(false);
  });
});

describe('what the answer says was saved', () => {
  it('place, first names and amount', () => {
    expect(bonusesSaid([{ workers: 'Michael Asiegbunam', label: 'Performance EQ - 1st Place', amount: 50 }, { workers: 'Nathan Clark + Steven Doherty', label: 'Performance EQ - 2nd Place', amount: 50 }], dollars))
      .toBe('1st place to Michael ($50.00), 2nd place to Nathan + Steven ($50.00)');
    expect(bonusesSaid([{ workers: 'Kyle Pitt', label: 'Best attitude', amount: 20 }], dollars)).toBe('Best attitude to Kyle ($20.00)');
  });
});
