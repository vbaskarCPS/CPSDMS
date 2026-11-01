// src/v2/lib/cards.ts — Super Admin › Accounts Reporting › Credit cards: every card charge the app attempted
// (bambora_idempotency, via app_cards_report), grouped into the tries made for one sale so a double charge
// stands out. Only what Bambora answered is here: card type and last 4, never a card number.
import { db, must } from './client';

export type ChargeStatus = 'processing' | 'approved' | 'declined' | 'error';
export interface Charge {
  key: string; at: string; day: string; status: ChargeStatus; amount: string | null; client: string | null;
  card_type?: string | null; last4?: string | null; transaction_id?: string | null; auth_code?: string | null; message?: string | null; code?: string | null;
  sale?: { id: string; day: string; client: string | null; price: number; route_code: string | null; address: string | null; center: string | null; center_id: string; payment_type: string | null } | null;
}
export async function cardsReport(from: string, to: string, centerId: string | null): Promise<Charge[]> {
  return (must(await db.rpc('app_cards_report', { p_from: from, p_to: to, p_center: centerId })) as Charge[]) || [];
}

/** The tries for one sale: same client, same amount, same day. */
export interface ChargeGroup {
  id: string; day: string; client: string | null; amount: number; tries: Charge[]; approved: Charge[]; declined: Charge[]; processing: Charge[];
  card: string | null; sale: Charge['sale']; flag: 'double' | 'stuck' | 'declined' | 'ok';
  /** other charges on the same card that day, outside this group (e.g. two different sales) */
  sameCard: Charge[];
}
const norm = (s: string | null | undefined) => (s || '').toLowerCase().replace(/\s+/g, ' ').trim();
const amt = (c: Charge) => Math.round(Number(c.amount || 0) * 100) / 100;
export const cardLabel = (c: Pick<Charge, 'card_type' | 'last4'>) => c.last4 ? `${c.card_type || 'Card'} ••${c.last4}` : null;

export function groupCharges(charges: Charge[]): ChargeGroup[] {
  const sorted = [...charges].sort((a, b) => a.at.localeCompare(b.at));
  const byKey = new Map<string, Charge[]>();
  for (const c of sorted) {
    const k = `${c.day}|${norm(c.client)}|${amt(c).toFixed(2)}`;
    byKey.set(k, [...(byKey.get(k) || []), c]);
  }
  const groups: ChargeGroup[] = [];
  for (const [id, tries] of byKey) {
    const approved = tries.filter(t => t.status === 'approved');
    const declined = tries.filter(t => t.status === 'declined' || t.status === 'error');
    const processing = tries.filter(t => t.status === 'processing');
    const withCard = tries.find(t => t.last4);
    const flag: ChargeGroup['flag'] = approved.length >= 2 ? 'double' : approved.length === 1 ? 'ok' : processing.length ? 'stuck' : 'declined';
    const sale = tries.map(t => t.sale).find(Boolean) || null;
    groups.push({ id, day: tries[0].day, client: tries[0].client, amount: amt(tries[0]), tries, approved, declined, processing,
      card: withCard ? cardLabel(withCard) : null, sale, flag, sameCard: [] });
  }
  // the same card charged for something else that day: shown as a note, not a flag
  for (const g of groups) {
    const last4 = g.tries.find(t => t.last4)?.last4;
    if (!last4) continue;
    g.sameCard = sorted.filter(c => c.day === g.day && c.last4 === last4 && c.status === 'approved' && !g.tries.includes(c));
  }
  return groups.sort((a, b) => b.tries[b.tries.length - 1].at.localeCompare(a.tries[a.tries.length - 1].at));
}

export function cardTotals(groups: ChargeGroup[]) {
  const sum = (a: Charge[]) => Math.round(a.reduce((t, c) => t + amt(c), 0) * 100) / 100;
  const approved = groups.flatMap(g => g.approved);
  const doubles = groups.filter(g => g.flag === 'double');
  return {
    charged: sum(approved), approvedCount: approved.length,
    declinedCount: groups.reduce((n, g) => n + g.declined.length, 0),
    doubles: doubles.length, doubleAmount: sum(doubles.flatMap(g => g.approved.slice(1))),
    stuck: groups.filter(g => g.flag === 'stuck').length,
  };
}
