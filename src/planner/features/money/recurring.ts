// src/planner/features/money/recurring.ts — bills and subscriptions: charges that come back on a regular beat for a
// steady amount. Tested in recurring.test.ts.
//
// How a charge counts as recurring:
//  1. Money out only (not transfers, card payments, income or cash). One merchant under its name variants ("GOODLIFE"
//     and "GOODLIFE CLUBS MSP", "MICROSOFT" and "MICROSOFT _V"), and the same charge seen twice (two imports, two
//     accounts, within 3 days) counted once.
//  2. Within a merchant, charges are split by amount (±3%: a subscription costs the same each time; a price change is
//     joined back up), so two policies from one insurer, or Prime inside all the Amazon
//     shopping, are each their own line. Bills that vary (phone, hydro, gas, insurance) are allowed a wider spread.
//  3. The dates have to keep a beat (a second charge within 5 days counts as the same one): weekly, every 2 weeks, monthly, every 3 months or yearly, with most gaps on it
//     (a skipped month is forgiven). Everyday spending at the same shop (coffee, groceries, gas, rides) has no beat and
//     stays out, however often it happens.
//  4. A subscription that moved to another name (YOUTUBE → GOOGLE) is followed by its exact price on its beat. Under $1
//     a month (overdraft interest pennies) isn't a bill.
//  5. A charge that has missed its beat by a good margin is "stopped": shown apart, not added to the monthly total.
import { round2, shiftMonth } from './lib';
import type { Txn } from './types';

export type Cadence = 'weekly' | 'biweekly' | 'monthly' | 'quarterly' | 'yearly';

export interface Recurring {
  /** Unique per line (a merchant can have two: two policies). */
  id: string;
  /** The name the bank uses most for it. */
  merchant: string;
  /** Every name it came under (for "Not recurring", which hides by name). */
  names: string[];
  /** Every charge it's made of, newest first (twins seen twice counted once). */
  txns: Txn[];
  category: string;
  /** What it usually costs each time: the latest for a fixed price, the average of the last 3 for a bill that varies. */
  avg: number;
  cadence: Cadence;
  /** The months it was charged in, oldest first. */
  months: string[];
  count: number;
  last: string;
  lastAmount: number;
  /** The price before, when a fixed price changed by more than 5% within the last 3 charges (not currency wobble). */
  prevAmount?: number;
  next: string;
  /** False when it has missed its beat: it seems to have stopped (or moved to another card). */
  active: boolean;
  /** Its amount changes from one charge to the next (a bill, not a subscription). */
  varies: boolean;
}

const SKIP = new Set(['Transfers', 'Credit card payment', 'Income', 'Cash']);
/** Bills whose amount changes month to month: allowed ±40% instead of ±8%. */
const VARIABLE = new Set(['Utilities', 'Phone & Internet', 'Insurance', 'Fees & interest', 'Health']);
/** Spending that repeats without being a bill: a price that happens to recur needs more charges to count. */
const EVERYDAY = new Set(['Groceries', 'Dining', 'Coffee', 'Gas', 'Transport', 'Shopping', 'Entertainment', 'Personal care']);

const BEATS: { cadence: Cadence; days: number; slack: number; min: number }[] = [
  { cadence: 'weekly', days: 7, slack: 2, min: 4 },
  { cadence: 'biweekly', days: 14, slack: 3, min: 3 },
  { cadence: 'monthly', days: 30.44, slack: 4, min: 3 },
  { cadence: 'quarterly', days: 91.3, slack: 12, min: 3 },
  { cadence: 'yearly', days: 365.25, slack: 20, min: 2 },
];
const PER_MONTH: Record<Cadence, number> = { weekly: 52 / 12, biweekly: 26 / 12, monthly: 1, quarterly: 1 / 3, yearly: 1 / 12 };

// ---- dates (local, YYYY-MM-DD) ----
const toDate = (iso: string) => { const [y, m, d] = iso.split('-').map(Number); return new Date(y, m - 1, d); };
const iso = (dt: Date) => `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
const daysBetween = (a: string, b: string) => Math.round((toDate(b).getTime() - toDate(a).getTime()) / 86_400_000);
const addDays = (s: string, n: number) => { const d = toDate(s); d.setDate(d.getDate() + n); return iso(d); };
const daysIn = (y: number, m0: number) => new Date(y, m0 + 1, 0).getDate();
/** `months` months after `s`, on day `dom` (the month's last day when it's shorter; `dom` 31 = always the last day). */
function addMonths(s: string, months: number, dom: number): string {
  const d = toDate(s);
  const y = d.getFullYear(), m0 = d.getMonth() + months;
  const ty = y + Math.floor(m0 / 12), tm = ((m0 % 12) + 12) % 12;
  return iso(new Date(ty, tm, Math.min(dom, daysIn(ty, tm))));
}
const median = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); const n = s.length; return n ? (n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2) : 0; };

/** The merchant without the bits that change between imports: a trailing source tag (" _V"), amounts and numbers. */
export function merchantKey(merchant: string): string {
  const words = merchant.toUpperCase().replace(/_[A-Z]\b/g, ' ').split(/\s+/).filter(Boolean);
  // the first word stays even with a digit in it (LINE2, 7-ELEVEN); later words with digits are amounts or numbers
  const kept = words.filter((w, i) => i === 0 || !/\d/.test(w)).map(w => w.replace(/[^A-Z0-9&'-]+/g, '')).filter(Boolean);
  return kept.join(' ') || merchant.toUpperCase().trim();
}

/** Name variants under one key: a key that is another key plus more words joins it ("GOODLIFE CLUBS MSP" → "GOODLIFE"). */
function groupByMerchant(txns: Txn[]): Map<string, Txn[]> {
  const keys = [...new Set(txns.map(t => merchantKey(t.merchant)))].sort((a, b) => a.length - b.length);
  const root = new Map<string, string>();
  for (const k of keys) {
    const parent = keys.find(p => p !== k && p.length >= 4 && k.startsWith(`${p} `));
    root.set(k, parent ? root.get(parent) ?? parent : k);
  }
  const out = new Map<string, Txn[]>();
  for (const t of txns) {
    const k = root.get(merchantKey(t.merchant))!;
    const l = out.get(k) || []; l.push(t); out.set(k, l);
  }
  return out;
}

/** The other names a kept charge was also seen under (its twins, dropped by dedupe). */
const aliases = new WeakMap<Txn, string[]>();

/** The same charge seen twice (two imports, a card and its account): same amount within 3 days, from different sources. */
function dedupe(list: Txn[]): Txn[] {
  const sorted = [...list].sort((a, b) => a.date.localeCompare(b.date));
  const kept: Txn[] = [];
  for (const t of sorted) {
    const twin = kept.find(k => Math.abs(k.amount - t.amount) < 0.01 && Math.abs(daysBetween(k.date, t.date)) <= 3
      && (k.accountId !== t.accountId || k.merchant !== t.merchant));
    if (!twin) kept.push(t);
    else if (twin.merchant !== t.merchant) aliases.set(twin, [...(aliases.get(twin) || []), t.merchant]);
  }
  return kept;
}

/** Split one merchant's charges by amount: each group within `tol` of its running median. */
function byAmount(list: Txn[], tol: (amt: number) => number): Txn[][] {
  const sorted = [...list].sort((a, b) => a.amount - b.amount);   // most negative first
  const groups: Txn[][] = [];
  for (const t of sorted) {
    const amt = -t.amount;
    const g = groups.find(gr => { const m = median(gr.map(x => -x.amount)); return Math.abs(amt - m) <= tol(m); });
    if (g) g.push(t); else groups.push([t]);
  }
  return groups;
}

/** The beat the dates keep, if any: most gaps on it, a skipped one (twice the beat) forgiven. */
function beatOf(all: string[]): (typeof BEATS)[number] | null {
  // a second charge within 5 days (a retry, a split payment) is the same occurrence, except for a weekly beat
  const weekly = (ds: string[]) => ds.slice(1).map((d, i) => daysBetween(ds[i], d)).filter(g => g > 0);
  const dates = median(weekly(all)) <= 9 ? all : all.filter((d, i) => i === 0 || daysBetween(all[i - 1], d) > 5);
  if (dates.length < 2) return null;
  const gaps = dates.slice(1).map((d, i) => daysBetween(dates[i], d)).filter(g => g > 0);
  if (!gaps.length) return null;
  const mid = median(gaps);
  for (const b of BEATS) {
    if (dates.length < b.min) continue;
    if (Math.abs(mid - b.days) > b.slack) continue;
    const on = gaps.filter(g => Math.abs(g - b.days) <= b.slack).length;
    const skipped = gaps.filter(g => Math.abs(g - 2 * b.days) <= b.slack * 1.5).length;
    const off = gaps.length - on - skipped;
    if (on >= Math.max(1, b.min - 1) && off <= Math.floor(gaps.length * 0.25)) return b;
  }
  return null;
}

const close = (a: number, b: number, pct: number) => Math.abs(a - b) <= Math.max(0.5, Math.max(a, b) * pct);

/** One beat after its last charge, on the last charge's own day (where a late or moved charge would land). */
function nextBeat(r: Recurring, beat: (typeof BEATS)[number]): string {
  const k = r.cadence === 'monthly' ? 1 : r.cadence === 'quarterly' ? 3 : r.cadence === 'yearly' ? 12 : 0;
  return k ? addMonths(r.last, k, toDate(r.last).getDate()) : addDays(r.last, beat.days);
}

/** The day of the month it usually comes: 31 when it lands at month-end (the 28th–31st of each month). */
function usualDay(dates: string[]): number {
  const ends = dates.filter(d => { const x = toDate(d); return x.getDate() >= daysIn(x.getFullYear(), x.getMonth()) - 1; }).length;
  if (ends >= dates.length * 0.6) return 31;
  return Math.round(median(dates.map(d => toDate(d).getDate())));
}

/** The charges behind each line found (for joining a price change). */
const streamTxns = new WeakMap<Recurring, Txn[]>();

function streamOf(charges: Txn[], today: string, varies: boolean, everyday = false): Recurring | null {
  let list = [...charges].sort((a, b) => a.date.localeCompare(b.date));
  // older charges that didn't keep the beat (a bill that moved its date, a slow start) are dropped from the front until
  // the recent run keeps it
  let beat = beatOf(list.map(t => t.date));
  for (let k = 1; !beat && !everyday && list.length - k >= 4; k++) {   // everyday spending gets no second try
    beat = beatOf(list.slice(k).map(t => t.date));
    if (beat) list = list.slice(k);
  }
  if (!beat) return null;
  const dates = list.map(t => t.date);
  const amts = list.map(t => -t.amount);
  const last = dates[dates.length - 1];
  const lastAmount = round2(amts[amts.length - 1]);
  const n = amts.length;
  const settled = n < 2 || close(amts[n - 1], amts[n - 2], 0.03);
  // a bill that varies: its last six charges spread more than 10%, and the last two don't agree
  const recent = amts.slice(-6);
  const changes = varies && !settled && Math.max(...recent) > Math.min(...recent) * 1.1;
  const avg = changes ? round2(amts.slice(-3).reduce((s, a) => s + a, 0) / Math.min(3, n)) : lastAmount;
  // the price before the latest change, if it changed by more than 5% within the last 3 charges
  let prev: number | undefined;
  if (settled) for (let i = n - 2; i >= Math.max(0, n - 4); i--) if (!close(amts[i], amts[n - 1], 0.05)) { prev = round2(amts[i]); break; }
  const dom = usualDay(dates.slice(-3));   // the recent day: a charge that drifted from the 12th to the 20th is due on the 20th
  const next = beat.cadence === 'weekly' || beat.cadence === 'biweekly' ? addDays(last, beat.days)
    : addMonths(last, beat.cadence === 'monthly' ? 1 : beat.cadence === 'quarterly' ? 3 : 12, beat.cadence === 'monthly' ? dom : toDate(last).getDate());
  // stopped: past its next date by more than the slack and half a beat more
  const active = daysBetween(next, today) <= beat.slack + beat.days / 2;
  const names = [...new Set(list.flatMap(t => [t.merchant, ...(aliases.get(t) || [])]))];
  const counts = new Map<string, number>(); for (const t of list) counts.set(t.merchant, (counts.get(t.merchant) || 0) + 1);
  const merchant = [...counts].sort((a, b) => b[1] - a[1] || a[0].length - b[0].length)[0][0];
  const cats = new Map<string, number>(); for (const t of list.slice(-3)) cats.set(t.category, (cats.get(t.category) || 0) + 1);
  const line: Recurring = {
    id: `${merchantKey(merchant)}~${beat.cadence}~${Math.round(median(amts))}`,
    merchant, names, category: [...cats].sort((a, b) => b[1] - a[1])[0][0],
    avg, cadence: beat.cadence, months: [...new Set(dates.map(d => d.slice(0, 7)))], count: list.length,
    last, lastAmount, prevAmount: !changes ? prev : undefined,
    next, active, varies: changes, txns: [...list].reverse(),
  };
  streamTxns.set(line, list);
  return line;
}

/**
 * The recurring charges in `months` (load 13+ months so yearly ones show), as of `today`.
 * `ignore`: merchant names marked "Not recurring" (any of a line's names hides it).
 */
export function findRecurring(months: Record<string, Txn[]>, thisMonth: string, ignore: string[] = [], today?: string): Recurring[] {
  const now = today ?? (() => { const d = new Date(); return iso(d).slice(0, 7) === thisMonth ? iso(d) : `${thisMonth}-28`; })();
  const out: Recurring[] = [];
  const all = Object.entries(months).filter(([k]) => k <= thisMonth).flatMap(([, rows]) => rows)
    .filter(t => t.amount < 0 && !SKIP.has(t.category) && !t.toWallet && t.date <= now);
  for (const [, list] of groupByMerchant(all)) {
    const charges = dedupe(list);
    if (charges.length < 2) continue;
    const variable = charges.some(t => VARIABLE.has(t.category));
    const found: Recurring[] = [];
    // a subscription charges the same each time (±3%, at least 50¢); a bill varies (±40%). Everyday kinds of spending
    // need a 4th charge before a price that happens to repeat counts.
    const everyday = charges.some(t => EVERYDAY.has(t.category));
    const used = new Set<Txn>();
    for (const g of byAmount(charges, m => Math.max(0.5, m * 0.03))) {
      const r = g.length >= (everyday ? 4 : 2) ? streamOf(g, now, variable, everyday) : null;
      if (r) { found.push(r); streamTxns.get(r)!.forEach(t => used.add(t)); }
    }
    if (variable) {
      const rest = charges.filter(t => !used.has(t));
      for (const g of byAmount(rest, m => Math.max(5, m * 0.4))) {
        const r = g.length >= 3 ? streamOf(g, now, true) : null;
        if (r) found.push(r);
      }
    }
    // a bill whose price moved (51.79 → 42.53): its next charges, on its beat, within ±40%, carry it on
    if (variable) {
      const free = charges.filter(t => !found.some(r => streamTxns.get(r)!.includes(t)));
      for (let i = 0; i < found.length; i++) {
        let r = found[i];
        const beat = BEATS.find(b => b.cadence === r.cadence)!;
        for (let guard = 0; guard < 24; guard++) {
          const t = free.find(x => Math.abs(daysBetween(nextBeat(r, beat), x.date)) <= beat.slack + 2 && close(-x.amount, r.lastAmount, 0.4));
          if (!t) break;
          free.splice(free.indexOf(t), 1);
          const again = streamOf([...streamTxns.get(r)!, t], now, true);
          if (!again) break;
          r = again;
        }
        found[i] = r;
      }
    }
    // a price change splits a subscription in two (14.34 until July, 15.81 from August): one ended about a beat before
    // the other began, at the same beat, so they're one line again
    const lines = found.sort((a, b) => a.months[0].localeCompare(b.months[0]));
    for (let i = 0; i + 1 < lines.length; i++) {
      for (let j = i + 1; j < lines.length; j++) {
        const a = lines[i], b = lines[j];
        if (a.cadence !== b.cadence || a.varies || b.varies) continue;
        const firstB = charges.filter(t => streamTxns.get(b)!.includes(t)).map(t => t.date).sort()[0];
        const gap = daysBetween(a.last, firstB);
        const beat = BEATS.find(x => x.cadence === a.cadence)!;
        if (gap > 0 && Math.abs(gap - beat.days) <= beat.slack) {
          const merged = streamOf([...streamTxns.get(a)!, ...streamTxns.get(b)!], now, false);
          if (merged) { lines.splice(j, 1); lines[i] = merged; i--; break; }
        }
      }
    }
    out.push(...lines);
  }
  // a subscription that moved to another name (YOUTUBE → GOOGLE): the exact same price, on its beat, under any name
  const taken = new Set<Txn>(out.flatMap(r => streamTxns.get(r) || []));
  for (let i = 0; i < out.length; i++) {
    let r = out[i];
    if (r.active || r.varies || r.avg < 5) continue;
    const beat = BEATS.find(b => b.cadence === r.cadence)!;
    let txns = [...streamTxns.get(r)!];
    for (let guard = 0; guard < 24; guard++) {
      const want = nextBeat(r, beat);
      const t = all.find(x => !taken.has(x) && Math.abs(-x.amount - r.lastAmount) < 0.01 && Math.abs(daysBetween(want, x.date)) <= beat.slack + 2);
      if (!t) break;
      taken.add(t); txns = [...txns, t];
      const again = streamOf(txns, now, false);
      if (!again) break;
      r = again;
    }
    out[i] = r;
  }
  // a stopped line whose exact price, at its beat, carries on as another line (MOKA TAM BUS → INTELL MEMBER BUS): it
  // moved, it didn't stop
  for (let i = out.length - 1; i >= 0; i--) {
    const r = out[i];
    if (r.active || r.varies) continue;
    const beat = BEATS.find(b => b.cadence === r.cadence)!;
    const after = out.find(o => o !== r && o.active && o.cadence === r.cadence && Math.abs(streamTxns.get(o)![0] ? -streamTxns.get(o)![0].amount - r.lastAmount : 1) < 0.01
      && Math.abs(daysBetween(nextBeat(r, beat), streamTxns.get(o)![0].date)) <= beat.slack + 2);
    if (after) {
      // one line with both names and all its charges (the old name's history included)
      const joined = streamOf([...streamTxns.get(r)!, ...streamTxns.get(after)!], now, false);
      const keep = joined && joined.active ? joined : after;
      keep.names = [...new Set([...after.names, ...r.names])];
      if (keep.merchant !== after.merchant && keep === joined) keep.merchant = after.merchant;
      out[out.indexOf(after)] = keep;
      out.splice(i, 1);
    }
  }
  for (let i = out.length - 1; i >= 0; i--) if (out[i].avg < 1 || out[i].names.some(n => ignore.includes(n))) out.splice(i, 1);
  const key = (r: Recurring) => (r.active ? 0 : 1);
  return out.sort((a, b) => key(a) - key(b) || monthlyCost(b) - monthlyCost(a));
}

/** What it comes to per month (a yearly one spread over 12). */
export const monthlyCost = (r: Recurring) => round2(r.avg * PER_MONTH[r.cadence]);

/** "every 2 weeks", "yearly" … */
export const cadenceLabel = (c: Cadence) => ({ weekly: 'weekly', biweekly: 'every 2 weeks', monthly: 'monthly', quarterly: 'every 3 months', yearly: 'yearly' })[c];

/** The months to load for the Recurring screen: 14 back, so a yearly charge is seen twice. */
export const recurringFrom = (thisMonth: string) => shiftMonth(thisMonth, -14);
