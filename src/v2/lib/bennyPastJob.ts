// src/v2/lib/bennyPastJob.ts — the Benny's "change a job on a closed day's payout" card (and "add one").
// The database checks it first (benny_check_past_job: the day is closed, not on a payslip, the cart is paid out, the job
// is the one meant). On the tap the app changes that cart's sales and saves the day the way its payout list does
// (saveDay with the lines the payout engine works out), so the worker's equiv and pay are worked out again, never typed
// in. A cart whose equiv was set at payout is switched back to its sales, or the change would not reach the pay. An open
// booking at the same address is marked done with it, unless they said to leave it.
import type { CartSale, PayoutCart, SaleType } from './payoutCarts';

export interface PastJobSide { address?: string; type: string; amount: number; paid_by: string; shown_as?: string; service?: string; route?: string; client?: string }
export interface PastJobCheck {
  ok: boolean; problems?: string[]; date: string; stamp: string; add: boolean;
  worker: { cn: string; name: string };
  /** eq_set = the cart's equiv as set at payout (then its pay doesn't follow its sales until the save switches it back) */
  cart: { id: string; label: string; members: number; eq_set?: number | null };
  /** the job being changed (missing when a new one is added) */
  line?: string; from?: PastJobSide; to: PastJobSide;
  /** the open booking at that address, marked done with the save */
  booking?: { id: string; address: string; route?: string; job_code?: string; prepaid?: boolean };
  pay_now?: { equiv: number; pay: number };
  /** the request, to run the same check again right before saving */
  ask: Record<string, unknown>;
}

const money = (n: number) => `$${Number(n).toLocaleString('en-CA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const pretty = (d: string) => new Date(d + 'T12:00').toLocaleDateString('en-CA', { weekday: 'short', month: 'short', day: 'numeric' });
/** A job in a few words: "Sale · $210.00 · Cash", "Production · AFSL ($210.00) · Prepaid". */
export function jobSaid(j: PastJobSide): string {
  const code = j.shown_as && !/^\d+(\.\d+)?$/.test(j.shown_as) ? j.shown_as : null;
  return [j.type, code ? `${code} (${money(j.amount)})` : money(j.amount), j.paid_by].join(' · ');
}

export function pastJobCard(c: PastJobCheck): { title: string; lines: string[]; action: string } {
  const first = c.worker.name.split(' ')[0];
  return {
    title: c.add ? `Add a job to ${first}’s payout for ${pretty(c.date)}` : `Change a job on ${first}’s payout for ${pretty(c.date)}`,
    lines: [
      [c.to.client, c.to.address].filter(Boolean).join(' · ') || 'A job with no address',
      c.add || !c.from ? `New: ${jobSaid(c.to)}${c.to.route ? ` · ${c.to.route}` : ''}` : `${jobSaid(c.from)} → ${jobSaid(c.to)}`,
      ...(c.booking ? [`The open booking at ${c.booking.address}${c.booking.job_code ? ` (${c.booking.job_code})` : ''} is marked done.`] : []),
      ...(c.pay_now ? [`${first}’s pay now: ${money(c.pay_now.pay)} on ${Number(c.pay_now.equiv).toFixed(2)} equiv.`] : []),
      ...(c.cart.eq_set != null ? [`${c.cart.members > 1 ? 'The cart’s' : `${first}’s`} equiv was set at ${Number(c.cart.eq_set).toFixed(2)} at payout. Saving works it out from the sales instead, so the pay follows this job.`] : []),
      `That day is saved, so this works its pay out again (${c.cart.members > 1 ? 'the cart’s' : `${first}’s`} equiv and pay), the same as on its payout list.`,
    ],
    action: c.add ? 'Add the job' : 'Save',
  };
}

const sameCart = (cart: PayoutCart, c: PastJobCheck) => cart.id === c.cart.id || cart.members.some(m => (m.cn || '').toUpperCase() === c.worker.cn.toUpperCase());

/** The day's carts with the card's job changed (or added) on its cart. Pure, so it's tested. Throws when the day no longer reads the way it did. */
export function withPastJob(carts: PayoutCart[], c: PastJobCheck): PayoutCart[] {
  const hits = carts.filter(x => sameCart(x, c));
  const first = c.worker.name.split(' ')[0];
  if (hits.length !== 1) throw new Error(`${first}’s cart isn’t on that day the way it was when I checked. Ask me again.`);
  const t = c.to;
  const patch: Pick<CartSale, 'type' | 'price' | 'payment_type' | 'payments' | 'display_price'> = {
    type: t.type as SaleType, price: Number(t.amount) || 0, payment_type: t.paid_by, payments: null, display_price: t.shown_as || String(t.amount),
  };
  return carts.map(cart0 => {
    if (cart0 !== hits[0]) return cart0;
    // the equiv set at payout was worked out from the job as it was: from here the cart's sales decide it ("Use the sales")
    const cart = { ...cart0, eq_override: null };
    if (c.add) {
      return { ...cart, sales: [...cart.sales, { route_code: t.route || null, address: t.address || null, client_name: t.client || null, service: t.service || 'FP', notes: null, ...patch }] };
    }
    if (!cart.sales.some(s => s.id === c.line)) throw new Error('That job isn’t on the payout any more. Ask me again.');
    return { ...cart, sales: cart.sales.map(s => (s.id === c.line ? { ...s, ...patch, service: t.service || s.service, route_code: t.route || s.route_code } : s)) };
  });
}

/** Does the saved day now hold the job the card asked for? (Sale ids change on a save, so it is matched by what it reads.) */
export function pastJobSaved(carts: PayoutCart[], c: PastJobCheck): boolean {
  const cart = carts.find(x => sameCart(x, c)); const t = c.to;
  return !!cart && cart.sales.some(s => s.type === t.type && s.payment_type === t.paid_by && Number(s.price) === Number(t.amount)
    && (s.address || '') === (t.address || '') && (s.display_price || '') === (t.shown_as || String(t.amount)));
}

/** What the Benny says once it's saved. pay = the worker's line after the day was worked out again. */
export function pastJobSaid(c: PastJobCheck, pay: { equiv: number; pay: number } | null, booking: 'done' | 'failed' | null): string {
  const first = c.worker.name.split(' ')[0];
  const head = c.add ? `Added to ${first}’s payout for ${pretty(c.date)}: ${jobSaid(c.to)}.` : `${first}’s job at ${c.to.address || 'that address'} now reads ${jobSaid(c.to)}.`;
  const money2 = pay
    ? c.pay_now ? ` ${first}’s pay for the day: ${money(c.pay_now.pay)} → ${money(pay.pay)} (equiv ${Number(c.pay_now.equiv).toFixed(2)} → ${Number(pay.equiv).toFixed(2)}).` : ` ${first}’s pay for the day is ${money(pay.pay)}.`
    : ' The day’s pay is worked out again.';
  const b = booking === 'done' ? ` The booking at ${c.booking?.address} is marked done.` : booking === 'failed' ? ` The booking at ${c.booking?.address} did NOT save as done: mark it in Bookings › List.` : '';
  return head + money2 + b;
}
