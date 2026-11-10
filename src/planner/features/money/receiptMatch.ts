// src/planner/features/money/receiptMatch.ts — which bank row a receipt belongs to, and how a receipt splits across
// categories. Pure (no network), so it's tested on its own (receiptMatch.test.ts); receipts.ts does the saving.
import { normalizeMerchant } from '../../../../supabase/functions/_shared/plannerMoney';
import { CASH_ACCOUNT_ID, type Account, type Receipt, type Txn } from './types';

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Whole days from `a` to `b` (both YYYY-MM-DD): positive when b is later. */
export function dayDiff(a: string, b: string): number {
  const t = (s: string) => Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10));
  return Math.round((t(b) - t(a)) / 86_400_000);
}

const FILLER = new Set(['THE', 'AND', 'INC', 'LTD', 'LLC', 'CORP', 'CO', 'STORE', 'STORES', 'CANADA', 'CDN', 'SHOP', 'MARKET', 'POS', 'PURCHASE', 'DEBIT', 'VISA', 'MC', 'INTERAC', 'RETAIL', 'PAYMENT', 'ONLINE', 'WWW', 'COM', 'CA']);
const tokens = (s: string) => normalizeMerchant(s).split(/[\s/.\-&']+/).filter(w => w.length >= 2 && !FILLER.has(w));

/** How alike a receipt's store name and a bank line are, 0–1 ("Costco Wholesale" vs "COSTCO WHOLESAL W540" → 1). */
export function merchantScore(receiptName: string, bankText: string): number {
  const a = tokens(receiptName), b = tokens(bankText);
  if (!a.length || !b.length) return 0;
  const same = (x: string, y: string) => x === y || (x.length >= 4 && y.length >= 4 && (x.startsWith(y) || y.startsWith(x)));
  const hits = a.filter(x => b.some(y => same(x, y))).length;
  let s = hits / Math.min(a.length, b.length);
  // run together: "TIMHORTONS" / "TIM HORTONS", "HOMEDEPOT" / "THE HOME DEPOT"
  const ja = a.join(''), jb = b.join('');
  if (s < 1 && ja.length >= 5 && jb.length >= 5 && (jb.includes(ja.slice(0, 6)) || ja.includes(jb.slice(0, 6)))) s = Math.max(s, 0.8);
  return Math.min(1, s);
}

export interface Candidate { txn: Txn; score: number; exact: boolean; days: number; name: number }

/** The bank rows a card receipt could be: money out, not the cash wallet, not already some receipt's, dated from 2 days
 *  before to 7 days after (cards post late), and the same amount — or, for a receipt without a printed tip, up to 30%
 *  more at a matching store (a tip added on the card). Best first. */
export function matchCandidates(r: Pick<Receipt, 'date' | 'total' | 'tip' | 'merchant' | 'cardLast4'>, rows: Txn[], accounts: Account[], taken: Set<string>): Candidate[] {
  const last4 = new Map(accounts.map(a => [a.id, a.last4]));
  const out: Candidate[] = [];
  for (const t of rows) {
    if (t.amount >= 0 || t.accountId === CASH_ACCOUNT_ID || t.toWallet || taken.has(t.id)) continue;
    const days = dayDiff(r.date, t.date);
    if (days < -2 || days > 7) continue;
    const paid = -t.amount;
    const exact = Math.abs(paid - r.total) < 0.015 || (!!r.tip && Math.abs(paid - (r.total - r.tip)) < 0.015);
    const name = Math.max(merchantScore(r.merchant, t.merchant), merchantScore(r.merchant, t.desc));
    const tipped = !exact && !r.tip && paid > r.total && paid <= r.total * 1.3 + 0.01 && name >= 0.5;
    if (!exact && !tipped) continue;
    let score = (exact ? 60 : 25) + name * 30 - Math.abs(days) * 3;
    const l4 = last4.get(t.accountId);
    if (r.cardLast4 && l4) score += r.cardLast4 === l4 ? 10 : -5;
    out.push({ txn: t, score: round2(score), exact, days, name });
  }
  return out.sort((a, b) => b.score - a.score || a.txn.id.localeCompare(b.txn.id));
}

/** The candidate to link without asking, or null when it should be the person's pick: the amount must match exactly,
 *  and either the store name agrees or it's a to-the-cent amount within 3 days, and nothing else comes close. */
export function autoPick(c: Candidate[], total: number): Candidate | null {
  const [a, b] = c;
  if (!a || !a.exact) return null;
  if (b && a.score - b.score < 15) return null;
  const cents = Math.abs(total * 100 - Math.round(total) * 100) > 0.5;
  return a.name >= 0.3 || (cents && Math.abs(a.days) <= 3) ? a : null;
}

/** Where the money went, by category: the lines grouped (what's left after the lines — tax, rounding — follows the
 *  biggest group). Used to pick the receipt's category and to show the split. */
export function splitByCategory(r: Pick<Receipt, 'items' | 'total' | 'category'>): { category: string; amount: number }[] {
  const sums = new Map<string, number>();
  for (const i of r.items) sums.set(i.category, round2((sums.get(i.category) || 0) + i.amount));
  if (!sums.size) return [{ category: r.category, amount: r.total }];
  const list = [...sums.entries()].map(([category, amount]) => ({ category, amount })).sort((a, b) => b.amount - a.amount);
  const rest = round2(r.total - list.reduce((s, x) => s + x.amount, 0));
  if (Math.abs(rest) >= 0.01) list[0].amount = round2(list[0].amount + rest);
  return list.filter(x => x.amount > 0);
}

export function shiftDay(iso: string, by: number): string {
  const d = new Date(Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10) + by));
  return d.toISOString().slice(0, 10);
}
