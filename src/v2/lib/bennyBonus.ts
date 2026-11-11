// src/v2/lib/bennyBonus.ts — the bonuses the Benny prepares, in the shapes the payout list saves them.
//
// A day is kept one of two ways, and a bonus is saved the way that day's own payout list saves it:
//   the live day  → on the cart's logsheet: its bonuses, and the pay it was closed at (PayoutToday › Add bonus)
//   a saved day   → on the day's cart (closed, or handed off to a newer day): the day's pay is then worked out again
//                   from its carts (SavedDayPayouts › Add bonus)
// Nothing here saves: these are the pure parts, tested in bennyBonus.test.ts. bennyActions.ts does the saving.
import type { Bonus, BonusType } from '../../types';
import { isFinalized, type PayoutCart } from './payoutCarts';
import { fromBonus } from './savedPayouts';

/** One bonus on the card, as the database checked it (benny_check_bonus). */
export interface BonusItem {
  /** the cart: the logsheet's id on the live day, the saved cart's id otherwise */
  key: string; cns: string[]; workers: string[]; team_size: number;
  type: BonusType; placing?: number; note?: string; label: string; amount: number;
  /** who gets how much (a team splits it evenly, the payout list's own default) */
  shares: { cn: string; name: string; percent: number; amount: number }[]; split?: Record<string, number>;
  bonus_eq?: number; rank?: number; qualifies?: boolean; pay_now?: number; pay_after?: number;
}
export interface BonusCheck {
  ok: boolean; problems?: string[]; date: string; source: 'live' | 'saved';
  bonuses: BonusItem[]; ask: unknown[]; total: number; cautions?: string[]; stamp: string;
}
/** A live logsheet's bonuses and payout as they read when the save began. */
export interface LiveNow { bonuses?: Bonus[] | null; validation?: Record<string, unknown> | null }

const suffix = (n: number) => (n % 100 >= 11 && n % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] || 'th');
/** "1st place · Performance EQ", or what an Other bonus is for. */
export const bonusName = (b: Pick<BonusItem, 'type' | 'placing' | 'note' | 'label'>): string =>
  b.type !== 'Other' && typeof b.placing === 'number' ? `${b.placing}${suffix(b.placing)} place · ${b.type}` : b.note || b.label;

/** The bonus as the payout list keeps it: the object its Add bonus makes. */
export function asBonus(b: BonusItem, id: number): Bonus {
  return {
    id, type: b.type, amount: b.amount,
    ...(b.type !== 'Other' && b.placing != null ? { placing: b.placing } : {}),
    ...(b.type === 'Other' ? { customDescription: b.note || b.label } : {}),
    ...(b.split && b.cns.length > 1 ? { splitPercentages: b.split } : {}),
  };
}

/** The live day: what Add bonus saves on a logsheet. Its bonuses with this one added, and the pay it was closed at plus the bonus. */
export function liveBonusPatch(now: LiveNow, b: BonusItem, id: number): { bonuses: Bonus[]; validation?: Record<string, unknown> } {
  const paid = now.validation ? { ...now.validation, finalCommission: (Number(now.validation.finalCommission) || 0) + b.amount } : undefined;
  return { bonuses: [...(now.bonuses || []), asBonus(b, id)], ...(paid ? { validation: paid } : {}) };
}

const up = (s: string) => String(s).toUpperCase();
const sameCrew = (a: string[], b: string[]) => a.length === b.length && a.map(up).sort().join('|') === b.map(up).sort().join('|');

/**
 * A saved day's carts with the bonuses added, each on the cart with exactly those workers. A cart that is gone, or not
 * paid out, stops it: the card was made for the day as it was.
 */
export function withBonuses(carts: PayoutCart[], bonuses: BonusItem[], firstId: number): PayoutCart[] {
  const next = carts.map(c => ({ ...c, bonuses: [...(c.bonuses || [])] }));
  bonuses.forEach((b, i) => {
    const hits = next.filter(c => sameCrew(c.members.map(m => m.cn), b.cns));
    const who = b.workers.join(' + ');
    if (hits.length !== 1) throw new Error(`${who}’s cart isn’t on that day the way it was when I checked. Ask me again.`);
    if (!isFinalized(hits[0])) throw new Error(`${who}’s cart isn’t paid out any more. Finish its payout first.`);
    hits[0].bonuses.push(fromBonus(asBonus(b, firstId + i)));
  });
  return next;
}

/**
 * An untapped bonus card is replaced once a later card gives one of the same places on the same day ("actually give
 * Mugove second"): a place goes to one cart only, so the older card is no longer the one to tap.
 */
export function bonusReplaced(cards: ({ kind: string; check: unknown } | null | undefined)[], i: number): boolean {
  const mine = cards[i];
  if (!mine || mine.kind !== 'bonus') return false;
  const a = mine.check as BonusCheck;
  return cards.slice(i + 1).some(c => !!c && c.kind === 'bonus' && (c.check as BonusCheck).date === a.date
    && (c.check as BonusCheck).bonuses.some(x => a.bonuses.some(y => y.label === x.label)));
}

/** What was saved, for the answer: "1st place to Michael ($50.00), 2nd place to Kyle ($50.00)". */
export function bonusesSaid(list: { workers: string; label: string; amount: number }[], dollars: (n: number) => string): string {
  const place = (label: string) => /- (\d+\w\w) Place$/.exec(label)?.[1];
  return list.map(x => `${place(x.label) ? `${place(x.label)} place` : x.label} to ${x.workers.split(' + ').map(w => w.split(' ')[0]).join(' + ')} (${dollars(Number(x.amount))})`).join(', ');
}
