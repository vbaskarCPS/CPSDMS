// src/v2/lib/payoutCarts.ts — a closed day's carts and sales, and what they pay.
//
// Each cart keeps its sales (price, how it was paid, service), who was on it with their splits,
// machine rental and deductions, the EQ if it was set at payout, crackfiller and bonuses. Pay is
// worked out from those exactly as the old payout did:
//   sales ──(sessionService.recalculateStats: tax, product cost, prepaid/billed weights)──▶ cart stats
//   cart stats × each member's split ──▶ their EQ, upsells, IOS ──(payout engine: rate, pay)──▶ line
// Until a payslip is generated for the day, all of it can be edited; saving replaces the day's
// carts, sales and payout lines together.
import { db, must } from './client';
import type { Service } from './permissions';
import type { RateCardData } from './rateCard';
import { appShowedDates, countBefore, payFromInputs, rateFacts, rateFor, type WorkerRateFacts } from './payoutEngine';
import { dayContext } from './dayContext';
import { statsToLine, type NewLine } from './payslips';

export const PAYMENT_TYPES = ['Cash', 'Cheque', 'Credit Card', 'E-Transfer', 'Prepaid', 'Billed', 'IOS'] as const;
export const SALE_TYPES = ['Sale', 'Production', 'Upgrade', 'Add-On'] as const;
export type SaleType = typeof SALE_TYPES[number];
export const CRACKFILL_PER_LB = 4;

export interface CartMember {
  hire_id: string | null; cn: string; first_name: string; last_name: string;
  equiv_split: number; upsell_split: number;   // percent
  machine_rental: number; deductions: number;  // dollars
}
/** A bonus on a cart, split by cn (percent; by EQ split when missing). The payout screen's own fields ride along. */
export interface CartBonus {
  label: string; amount: number; split?: Record<string, number>;
  id?: number; type?: string; placing?: number | 'other'; customDescription?: string; sortOrder?: number;
}
export interface CartSale {
  id?: string; route_code: string | null; address: string | null; client_name: string | null;
  price: number; payment_type: string; payments?: Record<string, number> | null; type: SaleType;
  display_price?: string | null; service: string | null; notes: string | null; meta?: Record<string, unknown>;
}
export interface DaySettings { taxRate: number; productCostPercent: number; noTaxOnCash: boolean }
export interface PayoutCart {
  id?: string; label: string; manager: string | null; members: CartMember[]; eq_override: number | null;
  crackfill_lbs: number; bonuses: CartBonus[]; settings: Partial<DaySettings>; notes: string | null; source?: string | null;
  /** paid out (signed off). A cart saved when its day was handed off before it was paid out isn't, until it's finished. */
  finalized?: boolean;
  sales: CartSale[];
}

/** Carts that count for pay: the ones paid out. */
export const isFinalized = (c: Pick<PayoutCart, 'finalized'>) => c.finalized !== false;

export async function listCarts(centerId: string, day: string): Promise<PayoutCart[]> {
  const rows = must(await db.from('payout_carts').select('*, sales:payout_sales(*)').eq('center_id', centerId).eq('day', day).order('sort')) as unknown as
    (PayoutCart & { sales: (CartSale & { sort: number })[] })[];
  return rows.map(c => ({
    ...c, eq_override: c.eq_override == null ? null : Number(c.eq_override), crackfill_lbs: Number(c.crackfill_lbs) || 0,
    sales: [...(c.sales || [])].sort((a, b) => a.sort - b.sort).map(s => ({ ...s, price: Number(s.price) || 0 })),
  }));
}

/** Saves the day's carts and the lines they work out to (refused once a payslip is generated). */
export async function saveDay(centerId: string, day: string, carts: PayoutCart[], lines: NewLine[]): Promise<number> {
  const clean = carts.map(c => ({ ...c, sales: c.sales.map(s => ({ ...s, price: Number(s.price) || 0 })) }));
  return must(await db.rpc('app_save_payout_day', { p_center: centerId, p_day: day, p_carts: clean, p_lines: lines })) as number;
}

type Stats = Record<string, number>;

/** The cart's totals from its sales, with the old app's maths. */
export async function cartStats(cart: PayoutCart, service: Service, defaults: DaySettings): Promise<Stats> {
  const { sessionService } = await import('../../lib/sessionService');
  const s = { ...defaults, ...cart.settings };
  const tx = (cart.sales || []).map((x, i) => ({
    id: String(i), jobId: String(i), workerId: '', timestamp: '', type: x.type || 'Sale', price: Number(x.price) || 0,
    paymentMethod: x.payment_type, paymentBreakdown: x.payments || undefined, displayPrice: x.display_price || undefined,
    items: [], isPaid: true, customerId: String(i), customerName: '', address: '', routeCode: x.route_code || '', workerName: '',
    payoutShare: (x.meta as { payoutShare?: number } | undefined)?.payoutShare, asphaltMeta: (x.meta as { asphaltMeta?: unknown } | undefined)?.asphaltMeta,
  }));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return sessionService.recalculateStats(tx as any, s.taxRate, service as any, s.productCostPercent, s.noTaxOnCash) as unknown as Stats;
}

export interface CartContext {
  day: string; card: RateCardData; service: Service; seasonYear: number; settings: DaySettings;
  facts: Record<string, WorkerRateFacts>;     // by hire id
  showed: Record<string, Set<string>>;        // app days by hire id
}

const SPLIT_KEYS = ['stepCount', 'prodBilled', 'prodCash', 'prodCheque', 'prodCreditCard', 'prodETransfer', 'prodFlats', 'prodPrepaid', 'prodPrepaidSplit', 'prodGross', 'prodPayable'];
const UPSELL_KEYS = ['iosCount', 'upsellCount', 'upsellCash', 'upsellCheque', 'upsellCreditCard', 'upsellETransfer', 'upsellPrepaid', 'upsellGross', 'upsellPayable'];

/** Everything needed to work out a day's carts: rate card, settings, each member's days and Silver Hats. */
export async function cartContext(centerId: string, region: string, day: string, carts: PayoutCart[]): Promise<CartContext> {
  const ids = [...new Set(carts.flatMap(c => c.members.map(m => m.hire_id)).filter(Boolean) as string[])];
  const [dc, facts, showed] = await Promise.all([dayContext(centerId, day, region), rateFacts(ids), appShowedDates(ids)]);
  return { day, ...dc, facts, showed, settings: { taxRate: dc.card.taxRate, productCostPercent: dc.card.productCostPercent, noTaxOnCash: dc.card.noTaxOnCashDefault } };
}

/** One payout line per cart member, worked out from the cart. */
export async function cartLines(cart: PayoutCart, ctx: CartContext): Promise<NewLine[]> {
  const stats = await cartStats(cart, ctx.service, ctx.settings);
  const teamEQ = cart.eq_override != null ? cart.eq_override : stats.totalEQ || 0;
  const teamSize = Math.max(1, cart.members.length);
  return cart.members.map(m => {
    const eqShare = (Number(m.equiv_split) || 0) / 100, upShare = (Number(m.upsell_split) || 0) / 100;
    const row: Record<string, unknown> = {
      contractorId: m.cn, firstName: m.first_name, lastName: m.last_name, manager: cart.manager || '',
      teamSize, equivSplitPercent: m.equiv_split, upsellSplitPercent: m.upsell_split, cart: cart.label,
      productCostPercent: ctx.settings.productCostPercent, source: cart.source || 'cart',
      assignedEQ: teamEQ * eqShare, teamTotalEQ: teamEQ,
      bonuses: cart.bonuses.reduce((a, b) => a + (Number(b.amount) || 0) * ((b.split?.[m.cn] ?? m.equiv_split) / 100), 0),
      machineRental: Number(m.machine_rental) || 0, deductions: Number(m.deductions) || 0,
      crackfillerCost: (ctx.service === 'sealing' ? (cart.crackfill_lbs || 0) * CRACKFILL_PER_LB : 0) * eqShare,
    };
    for (const k of SPLIT_KEYS) row[k] = (stats[k] || 0) * eqShare;
    for (const k of UPSELL_KEYS) row[k] = (stats[k] || 0) * upShare;
    const facts = (m.hire_id && ctx.facts[m.hire_id]) || { firstYear: null, lifetimeDays: 0, hats: null };
    const rate = rateFor(ctx.card, ctx.service, ctx.seasonYear, teamSize, facts, m.hire_id ? countBefore(ctx.showed[m.hire_id], ctx.day) : 0);
    return statsToLine(payFromInputs(row, rate, ctx.service));
  });
}

/** The day's payout lines: one per member of each paid-out cart (a cart not finalized has none yet). */
export async function dayLines(carts: PayoutCart[], ctx: CartContext): Promise<NewLine[]> {
  return (await Promise.all(carts.filter(isFinalized).map(c => cartLines(c, ctx)))).flat();
}

/** Problems that stop a save. */
export function cartProblems(carts: PayoutCart[]): string[] {
  const out: string[] = [];
  const seen = new Map<string, string>();
  carts.forEach((c, i) => {
    const name = c.label || `Cart ${i + 1}`;
    if (!c.members.length && (c.sales || []).length) out.push(`${name} has sales but nobody on it.`);
    const eq = c.members.reduce((a, m) => a + (Number(m.equiv_split) || 0), 0);
    const up = c.members.reduce((a, m) => a + (Number(m.upsell_split) || 0), 0);
    if (c.members.length && Math.abs(eq - 100) > 0.01) out.push(`${name}: EQ splits add up to ${eq}%, not 100%.`);
    if (c.members.length && Math.abs(up - 100) > 0.01) out.push(`${name}: upsell splits add up to ${up}%, not 100%.`);
    for (const m of c.members) {
      if (seen.has(m.cn)) out.push(`${m.first_name} ${m.last_name} (${m.cn}) is on both ${seen.get(m.cn)} and ${name}.`);
      seen.set(m.cn, name);
    }
    (c.sales || []).forEach((s, j) => {
      if (!(Number(s.price) >= 0)) out.push(`${name}, sale ${j + 1}: the price isn't a number.`);
      if ([s.notes, s.address, s.client_name].some(t => t && /(\d[ -]?){13,19}/.test(t))) out.push(`${name}, sale ${j + 1}: that looks like a card number; card numbers are never kept.`);
    });
  });
  return out;
}

// ───────────── from the live session (Close day) ─────────────
type Row = Record<string, any>;   // eslint-disable-line @typescript-eslint/no-explicit-any

/**
 * The live session's carts and sales, read from the old app's tables, for saving with the day at
 * Close day. Only what pay needs: card numbers, expiry dates and CVCs are never read into these.
 */
export function cartsFromSession(input: { sessions: Row[]; transactions: Row[]; users: Row[]; seasonType: string; productCostPercent: number; noTaxOnCash: boolean; taxRate: number },
  hireIdByCn: Record<string, string>, opts: { includeOpen?: boolean } = {}): PayoutCart[] {
  const users = new Map(input.users.map(u => [String(u.user_id), u]));
  const settings = { taxRate: input.taxRate, productCostPercent: input.productCostPercent, noTaxOnCash: input.noTaxOnCash };
  const hasSales = (s: Row) => input.transactions.some(t => t.session_id === s.id);
  // paid-out carts; with includeOpen (a day handed off) also the carts with sales not paid out yet
  const sessions = input.sessions.filter(s => s.validation?.isValidated || (opts.includeOpen && hasSales(s)));
  return sessions.map((s, i) => {
    const ids: string[] = s.team_worker_ids?.length ? s.team_worker_ids : [s.worker_id];
    const even = 100 / ids.length;
    const v = s.validation || {};
    const tx = input.transactions.filter(t => t.session_id ? t.session_id === s.id : ids.includes(t.worker_id));
    const members: CartMember[] = ids.map(id => {
      const u = users.get(String(id)); const name = String(u?.name || id).split(' ');
      const rental = v.workerMachineRentals?.[id] ?? v.machineRental ?? true;
      return {
        hire_id: hireIdByCn[String(id).toUpperCase()] || null, cn: String(id).toUpperCase(), first_name: name[0] || '', last_name: name.slice(1).join(' '),
        equiv_split: Number(s.equiv_split?.[id] ?? even), upsell_split: Number((s.upsell_split || s.equiv_split)?.[id] ?? even),
        machine_rental: rental ? 10 : 0, deductions: Number(v.workerDeductions?.[id] || 0),
      };
    });
    const lead = users.get(String(s.worker_id));
    const manager = lead?.metadata?.assignedManagerId ? users.get(String(lead.metadata.assignedManagerId))?.name || null : null;
    const sales: CartSale[] = tx.map(t => ({
      route_code: t.customer_snapshot?.routeCode || null, address: t.customer_snapshot?.address || null,
      client_name: `${t.customer_snapshot?.firstName || ''} ${t.customer_snapshot?.lastName || ''}`.trim() || null,
      price: Number(t.price) || 0, payment_type: String(t.payment_method || 'Cash'), payments: t.payment_breakdown || null,
      type: (SALE_TYPES as readonly string[]).includes(t.type) ? t.type : 'Sale', display_price: t.display_price || null,
      service: t.customer_snapshot?.serviceType || null, notes: null,
      meta: {
        ...(t.payout_share != null ? { payoutShare: Number(t.payout_share) } : {}), ...(t.asphalt_meta ? { asphaltMeta: t.asphalt_meta } : {}),
        // whether a phone and an email were taken (for the bonus check), never the details themselves
        details: Number(!!String(t.customer_phone || '').trim()) + Number(!!String(t.customer_email || '').trim()),
      },
    }));
    return {
      label: members.length > 1 ? `Cart ${members.map(m => m.first_name).join(' & ')}` : `${members[0]?.first_name || ''} ${members[0]?.last_name || ''}`.trim() || `Cart ${i + 1}`,
      manager, members, eq_override: typeof v.actualTotalEQ === 'number' ? v.actualTotalEQ : null,
      crackfill_lbs: Number(v.crackfillerPounds || 0), settings, notes: null, source: 'close_day',
      finalized: !!v.isValidated,
      bonuses: (s.bonuses || []).map((b: Row) => ({ label: String(b.customDescription || b.type || 'Bonus'), amount: Number(b.amount) || 0,
        split: b.splitPercentages ? Object.fromEntries(Object.entries(b.splitPercentages).map(([k, x]) => [k.toUpperCase(), Number(x)])) : undefined,
        ...(b.id != null ? { id: Number(b.id) } : {}), ...(b.type ? { type: String(b.type) } : {}), ...(b.placing != null ? { placing: b.placing } : {}),
        ...(b.customDescription ? { customDescription: String(b.customDescription) } : {}), ...(b.sortOrder != null ? { sortOrder: Number(b.sortOrder) } : {}) })),
      sales,
    };
  });
}

/**
 * Carts and lines for the live session at a center, for Close day — or, with includeOpen, for
 * handing the day off to a newer one: carts not paid out yet are kept (not finalized), and only
 * the paid-out carts' members get lines.
 */
export async function liveDayForClose(centerId: string, year: number, opts: { includeOpen?: boolean } = {}): Promise<{ date: string; carts: PayoutCart[]; lines: NewLine[] }> {
  const { pointLegacyAt } = await import('./legacy');
  await pointLegacyAt(centerId);
  const { loadLivePayoutInput, computePayoutStats } = await import('../../lib/exportService');
  const input = await loadLivePayoutInput();
  const cns = [...new Set(input.sessions.flatMap(s => (s.team_worker_ids?.length ? s.team_worker_ids : [s.worker_id]).map((x: string) => String(x).toUpperCase())))];
  const hires = cns.length ? must(await db.from('hires').select('id, cn').eq('year', year).in('cn', cns)) as { id: string; cn: string }[] : [];
  const { statsToLine } = await import('./payslips');
  const carts = cartsFromSession(input, Object.fromEntries(hires.map(h => [h.cn.toUpperCase(), h.id])), opts);
  const paid = new Set(carts.filter(isFinalized).flatMap(c => c.members.map(m => m.cn)));
  return {
    date: input.date, carts,
    // the lines are what the payout screen showed and was signed off on
    lines: computePayoutStats(input).map(statsToLine).filter(l => paid.has(String(l.cn).toUpperCase())),
  };
}

/**
 * Hands the open day off so a newer day can take the old app's tables (worker sign-ins, logsheets,
 * the RM map): its carts and sales are saved first (those not paid out yet as not finalized), then
 * the old session is copied and cleared. The day stays open; it's finished and closed in the app.
 */
export async function handOffDay(centerId: string, date: string): Promise<{ carts: number; open: number }> {
  const live = await liveDayForClose(centerId, Number(date.slice(0, 4)), { includeOpen: true });
  if (live.date !== date) throw new Error(`The open session is for ${live.date}, not ${date}`);
  await saveDay(centerId, date, live.carts, live.lines);
  must(await db.rpc('app_handoff_day', { p_center: centerId, p_day: date }));
  return { carts: live.carts.length, open: live.carts.filter(c => !isFinalized(c)).length };
}
