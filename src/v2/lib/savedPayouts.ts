// src/v2/lib/savedPayouts.ts — a saved day's carts in the shape of the live payout screen, so an
// earlier day (closed, or handed off to a newer one) looks exactly like the live day's payouts.
//
//   cart            → one logsheet session (the cart): its sales, stats, splits and bonuses
//   paid-out cart   → validated, with the team's pay = the sum of its members' payout lines
//   cart member     → a worker (rates from their payout line), under the cart's manager
import type { Bonus, BonusType, LogsheetSession, ManagementUser, SessionStats, SessionTransaction, Worker } from '../../types';
import { isFinalized, type CartBonus, type PayoutCart } from './payoutCarts';
import { legacyManagerId } from './startSession';

export interface SavedLine { cn: string; total_payout: number | string; stats?: unknown }
export interface SavedDayView { sessions: LogsheetSession[]; workers: Worker[]; managers: ManagementUser[] }

export const cartSessionId = (c: PayoutCart, i: number) => c.id || `cart-${i + 1}`;

const BONUS_TYPES: BonusType[] = ['Performance EQ', 'Total Upsell', 'Rookie', 'Other'];
const suffix = (n: number) => (n % 100 >= 11 && n % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] || 'th');

/** A cart bonus as the payout screen keeps it. */
export function toBonus(b: CartBonus, fallbackId: number): Bonus {
  const type = (BONUS_TYPES as string[]).includes(String(b.type)) ? b.type as BonusType : 'Other';
  return {
    id: b.id ?? fallbackId, type, amount: Number(b.amount) || 0,
    ...(b.placing != null && type !== 'Other' ? { placing: b.placing } : {}),
    ...(type === 'Other' || b.placing === 'other' ? { customDescription: b.customDescription ?? b.label } : {}),
    ...(b.split ? { splitPercentages: b.split } : {}),
    ...(b.sortOrder != null ? { sortOrder: b.sortOrder } : {}),
  };
}

/** The payout screen's bonus, kept on the cart. */
export function fromBonus(b: Bonus): CartBonus {
  const label = b.type === 'Other' ? (b.customDescription || 'Other')
    : b.placing === 'other' ? `${b.type} - ${b.customDescription || ''}`.trim()
      : typeof b.placing === 'number' ? `${b.type} - ${b.placing}${suffix(b.placing)} Place` : b.type;
  return {
    label, amount: Number(b.amount) || 0, id: b.id, type: b.type,
    ...(b.placing != null ? { placing: b.placing } : {}), ...(b.customDescription ? { customDescription: b.customDescription } : {}),
    ...(b.splitPercentages ? { split: Object.fromEntries(Object.entries(b.splitPercentages).map(([k, v]) => [k.toUpperCase(), Number(v)])) } : {}),
    ...(b.sortOrder != null ? { sortOrder: b.sortOrder } : {}),
  };
}

/**
 * The saved day as the live payout screen sees it. `stats` is each cart's totals (cartStats, same
 * order as the carts); `lines` are the day's payout lines.
 */
export function savedDayView(date: string, carts: PayoutCart[], stats: Record<string, number>[], lines: SavedLine[]): SavedDayView {
  const lineByCn = new Map(lines.map(l => [String(l.cn).toUpperCase(), l]));
  const sessions: LogsheetSession[] = [];
  const workers: Worker[] = [];
  const managers = new Map<string, ManagementUser>();
  carts.forEach((c, i) => {
    if (!c.members.length) return;
    const id = cartSessionId(c, i);
    const st = (stats[i] || {}) as unknown as SessionStats;
    const cns = c.members.map(m => m.cn.toUpperCase());
    const paid = isFinalized(c);
    const mgrId = c.manager ? legacyManagerId(c.manager) : undefined;
    if (c.manager && mgrId && !managers.has(mgrId)) managers.set(mgrId, { userId: mgrId, username: '', name: c.manager, role: 'RouteManager' });
    for (const m of c.members) {
      const ls = (lineByCn.get(m.cn.toUpperCase())?.stats || {}) as Record<string, unknown>;
      workers.push({
        contractorId: m.cn.toUpperCase(), firstName: m.first_name, lastName: m.last_name, status: 'Return',
        alumniRate: Number(ls.alumniRate) || 0, silverRate: Number(ls.silverRate) || 0, assignedManagerId: mgrId,
      });
    }
    const teamPay = cns.reduce((a, cn) => a + (Number(lineByCn.get(cn)?.total_payout) || 0), 0);
    const financialStore = c.sales.map((s, k) => {
      const details = Number((s.meta as { details?: number } | undefined)?.details) || 0;
      return {
        id: s.id || `${id}-${k}`, jobId: s.id || `${id}-${k}`, timestamp: '', customerId: '', customerName: s.client_name || '', address: s.address || '',
        workerId: cns[0], workerName: '', routeCode: s.route_code || '', type: s.type, price: Number(s.price) || 0, displayPrice: s.display_price || undefined,
        items: [], isPaid: true, paymentMethod: s.payment_type, paymentBreakdown: s.payments || undefined,
        customerPhone: details >= 1 ? 'on file' : '', customerEmail: details >= 2 ? 'on file' : '',
      } as unknown as SessionTransaction;
    });
    sessions.push({
      id, workerId: cns[0], date, status: paid ? 'PAID' : 'OPEN', managerName: c.manager || undefined,
      dailyRouteStore: [], financialStore, stats: st,
      teamWorkerIds: cns,
      equivSplit: Object.fromEntries(c.members.map(m => [m.cn.toUpperCase(), Number(m.equiv_split) || 0])),
      upsellSplit: Object.fromEntries(c.members.map(m => [m.cn.toUpperCase(), Number(m.upsell_split) || 0])),
      bonuses: c.bonuses.map((b, k) => toBonus(b, (i + 1) * 1000 + k)),
      validation: paid ? {
        isValidated: true,
        verifiedCash: st.prodCash || 0, verifiedCheque: st.prodCheque || 0, cashDiff: 0, chequeDiff: 0,
        actualProdCash: st.prodCash || 0, actualProdCheque: st.prodCheque || 0,
        actualTotalEQ: c.eq_override != null ? c.eq_override : st.totalEQ || 0,
        machineRental: true, finalCommission: teamPay, managerName: c.manager || undefined,
        workerMachineRentals: Object.fromEntries(c.members.map(m => [m.cn.toUpperCase(), (Number(m.machine_rental) || 0) > 0])),
        workerDeductions: Object.fromEntries(c.members.map(m => [m.cn.toUpperCase(), Number(m.deductions) || 0])),
        crackfillerPounds: c.crackfill_lbs || 0,
      } : undefined,
    });
  });
  return { sessions, workers, managers: [...managers.values()] };
}
