// src/planner/features/money/receiptGroups.ts — the parts of matching email receipts that take more than one receipt
// or more than one account into view. Pure (tested in receiptGroups.test.ts); mailReceipts.ts does the loading/saving.
//  • Live rows: an archived account's rows are left out of matching (a card imported once by hand and later connected
//    to the bank would otherwise offer every charge twice, and a tie is never matched by itself).
//  • One purchase, several emails: a shop sends "ordered" and then "shipped" for the same money, or an order ships in
//    parts. Only one of them should be waiting for the bank.
//  • Several emails, one charge: orders placed the same day are often billed as one card charge that posts a day
//    later. suggestGroups finds the emails that add up to a charge; chargesFor lists the charges for a hand-made group.
//  • Card history: an email older than the card's first row in the planner can't be matched, so it isn't listed.
//  • Company card: a card (by its last four digits) whose purchases are all put aside.
import { awaitingMatch, dayDiff, foreignCurrency, merchantScore, shiftDay } from './receiptMatch';
import { CASH_ACCOUNT_ID, type Account, type AccountType, type Receipt, type Txn } from './types';

const cents = (n: number) => Math.round(n * 100);
const isEmail = (r: Receipt) => r.from === 'email';
const sameShop = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase() || merchantScore(a, b) >= 0.5;
const shopOnRow = (r: Pick<Receipt, 'merchant'>, t: Txn) => Math.max(merchantScore(r.merchant, t.merchant), merchantScore(r.merchant, t.desc));
const spendRow = (t: Txn, taken: Set<string>) => t.amount < 0 && t.accountId !== CASH_ACCOUNT_ID && !t.toWallet && !taken.has(t.id);

/** The rows matching may use: not an archived account's. */
export function liveRows(rows: Txn[], accounts: Account[]): Txn[] {
  const gone = new Set(accounts.filter(a => a.archived).map(a => a.id));
  return gone.size ? rows.filter(t => !gone.has(t.accountId)) : rows;
}

// ───────────── one purchase, several emails ─────────────

/** Two emails about the same money: the same shop and total, within 6 days ("ordered" then "shipped", or one purchase
 *  sent to two mailboxes). */
export function samePurchase(a: Receipt, b: Receipt): boolean {
  return a.id !== b.id && cents(a.total) === cents(b.total) && Math.abs(dayDiff(a.date, b.date)) <= 6
    && (a.currency || 'CAD').toUpperCase() === (b.currency || 'CAD').toUpperCase() && sameShop(a.merchant, b.merchant);
}

/** The groups of 2 to `max` items whose amounts (in cents) add up to `target`; stops once `limit` are found. */
export function subsetsAdding<T>(items: T[], amount: (x: T) => number, target: number, max = 4, limit = 2): T[][] {
  const list = items.map(x => ({ x, c: amount(x) })).filter(i => i.c > 0 && i.c < target).sort((a, b) => b.c - a.c);
  const found: T[][] = [];
  const walk = (from: number, left: number, picked: T[]) => {
    if (found.length >= limit) return;
    if (left === 0) { if (picked.length >= 2) found.push([...picked]); return; }
    if (picked.length >= max) return;
    for (let i = from; i < list.length && found.length < limit; i++) {
      if (list[i].c > left) continue;
      picked.push(list[i].x); walk(i + 1, left - list[i].c, picked); picked.pop();
    }
  };
  walk(0, target, []);
  return found;
}

/** The shipping emails an order email is the total of: 2 to 4 emails from the same shop, on the order's day or up to
 *  two weeks after, that add up to it exactly. null when there are none. */
export function shipmentsOf(order: Receipt, all: Receipt[]): Receipt[] | null {
  const parts = all.filter(o => o.id !== order.id && isEmail(o) && o.ignored !== 'not_receipt' && o.total < order.total - 0.005
    && (o.currency || 'CAD').toUpperCase() === (order.currency || 'CAD').toUpperCase()
    && dayDiff(order.date, o.date) >= 0 && dayDiff(order.date, o.date) <= 14 && sameShop(order.merchant, o.merchant))
    .sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id)).slice(0, 12);
  if (parts.length < 2) return null;
  return subsetsAdding(parts, o => cents(o.total), cents(order.total), 4, 1)[0] || null;
}

export type SameAs = 'twin' | 'order' | 'part';
/** The email receipts that needn't wait for the bank because another email stands for the same money:
 *  'order' = an order email whose shipping emails add up to it (they carry the charges);
 *  'part'  = a shipping email of an order that has matched as a whole;
 *  'twin'  = the same purchase as another email that has matched or been put aside; of two that haven't, the earlier
 *            one (the later email is nearer the day the card is charged). */
export function sameAsAnother(all: Receipt[]): Map<string, SameAs> {
  const emails = all.filter(isEmail);
  const waiting = (r: Receipt) => !r.txnId && !r.ignored;
  const out = new Map<string, SameAs>();
  for (const o of emails) {
    if (o.ignored) continue;
    const parts = shipmentsOf(o, emails);
    if (!parts) continue;
    if (o.txnId) { for (const p of parts) if (waiting(p)) out.set(p.id, 'part'); }
    else out.set(o.id, 'order');
  }
  for (const r of emails) {
    if (!waiting(r) || out.has(r.id)) continue;
    const twins = emails.filter(t => samePurchase(r, t) && out.get(t.id) !== 'order');
    if (twins.some(t => t.txnId || t.ignored) || twins.some(t => waiting(t) && (t.date > r.date || (t.date === r.date && t.id < r.id)))) out.set(r.id, 'twin');
  }
  return out;
}

// ───────────── several emails, one charge ─────────────

export interface GroupSuggestion { txn: Txn; receipts: Receipt[] }
const groupable = (r: Receipt) => awaitingMatch(r) && !foreignCurrency(r) && r.paidBy !== 'etransfer';

/** Charges that are the total of 2 to 4 waiting receipts from the same shop, dated from a day after the charge to 5
 *  days before it (a card posts about a day after the order). Only when exactly one group adds up, and no single
 *  receipt is that amount. Oldest charge first; a receipt is offered in one group only. */
export function suggestGroups(pool: Receipt[], rows: Txn[], taken: Set<string>): GroupSuggestion[] {
  const list = pool.filter(groupable);
  if (list.length < 2) return [];
  const used = new Set<string>();
  const out: GroupSuggestion[] = [];
  for (const t of [...rows].sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id))) {
    if (!spendRow(t, taken)) continue;
    const paid = cents(-t.amount);
    const near = list.filter(r => !used.has(r.id) && dayDiff(r.date, t.date) >= -1 && dayDiff(r.date, t.date) <= 5 && shopOnRow(r, t) >= 0.5);
    if (near.length < 2 || near.some(r => cents(r.total) === paid)) continue;
    const cands = near.sort((a, b) => Math.abs(dayDiff(a.date, t.date)) - Math.abs(dayDiff(b.date, t.date)) || a.id.localeCompare(b.id)).slice(0, 12);
    const groups = subsetsAdding(cands, r => cents(r.total), paid, 4, 2);
    if (groups.length !== 1) continue;
    const receipts = groups[0].sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
    for (const r of receipts) used.add(r.id);
    out.push({ txn: t, receipts });
  }
  return out;
}

export interface GroupCharge { txn: Txn; /** the charge less the receipts' total (0 = to the cent) */ diff: number; name: number; days: number }
/** For a group picked by hand: the charges it could be, from 2 days before its first email to 7 days after its last.
 *  A charge of exactly the group's total (any name) first, then charges at the same shop within 15% (at least $5),
 *  nearest amount first. */
export function chargesFor(group: Receipt[], rows: Txn[], taken: Set<string>): GroupCharge[] {
  if (!group.length) return [];
  const sum = group.reduce((s, r) => s + cents(r.total), 0);
  const dates = group.map(r => r.date).sort();
  const from = shiftDay(dates[0], -2), to = shiftDay(dates[dates.length - 1], 7);
  const out: GroupCharge[] = [];
  for (const t of rows) {
    if (!spendRow(t, taken) || t.date < from || t.date > to) continue;
    const diff = cents(-t.amount) - sum;
    const name = Math.max(...group.map(r => shopOnRow(r, t)));
    if (diff !== 0 && !(name >= 0.5 && Math.abs(diff) <= Math.max(500, sum * 0.15))) continue;
    out.push({ txn: t, diff: diff / 100, name, days: dayDiff(dates[dates.length - 1], t.date) });
  }
  return out.sort((a, b) => Math.abs(a.diff) - Math.abs(b.diff) || b.name - a.name || Math.abs(a.days) - Math.abs(b.days) || a.txn.id.localeCompare(b.txn.id)).slice(0, 8);
}

// ───────────── how far back the bank's rows go ─────────────

export interface CardHistory { id: string; name: string; type: AccountType; last4?: string; /** its first row's day */ first: string }
/** Each live bank or card account that has rows, with the day of its first one. */
export function historyStarts(rows: Txn[], accounts: Account[]): CardHistory[] {
  const first = new Map<string, string>();
  for (const t of rows) { const f = first.get(t.accountId); if (!f || t.date < f) first.set(t.accountId, t.date); }
  return accounts.filter(a => !a.archived && a.id !== CASH_ACCOUNT_ID && first.has(a.id))
    .map(a => ({ id: a.id, name: a.name, type: a.type, ...(a.last4 ? { last4: a.last4 } : {}), first: first.get(a.id)! }));
}
const earliest = (h: CardHistory[]) => [...h].sort((a, b) => a.first.localeCompare(b.first))[0];
/** The account a receipt is too old for (dated more than 2 days before that account's first row), or null. Which
 *  account: the one with the receipt's last four digits; otherwise, for an e-transfer, the oldest bank account, and
 *  for anything else the oldest credit card (or the oldest account when there's no card). */
export function beforeHistory(r: Receipt, hist: CardHistory[]): CardHistory | null {
  if (!hist.length) return null;
  const cards = hist.filter(h => h.type === 'credit'), banks = hist.filter(h => h.type !== 'credit');
  const own = r.cardLast4 ? hist.find(h => h.last4 === r.cardLast4) : undefined;
  const acc = own || earliest(r.paidBy === 'etransfer' ? (banks.length ? banks : hist) : (cards.length ? cards : hist));
  return r.date < shiftDay(acc.first, -2) ? acc : null;
}
/** The first day worth reading email from: 3 days before the oldest account's first row (nothing older can match). */
export const historyFloor = (hist: CardHistory[]): string | null => (hist.length ? shiftDay(earliest(hist).first, -3) : null);

// ───────────── the company card ─────────────

/** The last four digits a receipt's card can be remembered by as a company card: four digits, and not one of the
 *  planner's own accounts (those are yours: one purchase put aside doesn't put the whole card aside). */
export function companyCard(r: Pick<Receipt, 'cardLast4'>, accounts: Account[]): string | null {
  const c = (r.cardLast4 || '').trim();
  return /^\d{4}$/.test(c) && !accounts.some(a => !a.archived && a.last4 === c) ? c : null;
}
/** The email receipts still waiting that were paid on one of the company cards. */
export const onCompanyCard = (all: Receipt[], cards: string[]): Receipt[] =>
  (cards.length ? all.filter(r => isEmail(r) && awaitingMatch(r) && !!r.cardLast4 && cards.includes(r.cardLast4)) : []);
