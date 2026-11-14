// src/planner/features/money/transfers.ts — sorting what the planner calls 'Transfers'. Tested in transfers.test.ts.
//
// Every bank row with TRANSFER, TFR or WIRE in it (or that the bank itself labels a transfer) lands in 'Transfers',
// which is left out of spending. That one category mixes very different things, so each row is given a kind:
//  - own:            money moved between the household's own accounts ("TFR-TO 6456622": the number ends in the last
//                    four digits of one of their accounts). Rightly a transfer; nothing to do.
//  - unknownAccount: the same wording, to an account number the planner doesn't know yet → "Is ····6622 one of yours?"
//  - card:           a payment to a credit card ("TFR-TO C/C") → should be 'Credit card payment'.
//  - sent:           an Interac e-transfer sent to someone ("SEND E-TFR ***9K5"): real spending (rent, a babysitter).
//  - reversal:       a sent e-transfer that came back ("CANCEL E-TFR", "RECLAIM E-TFR"): it and the one it cancels are
//                    left out together.
//  - received:       an e-transfer coming in ("E-TRANSFER ***3KW").
//  - other:          not a transfer at all: a car loan, the dump ("KENORA TRANSFER STATION"), a hydro bill, a shop.
// Nothing here changes a row: sortTransfers only says what the Transfers screen should show and suggest. The person's
// answers are kept in one doc (TransferPrefs) so the next months follow the same choices.
import { builtinCategoryNoTransfer, CARD_PAYMENT } from '../../../../supabase/functions/_shared/plannerMoney';
import { round2 } from './lib';
import type { Account, Receipt, Txn } from './types';

export type TransferKind = 'own' | 'card' | 'sent' | 'received' | 'reversal' | 'unknownAccount' | 'other';

/** A remembered category for sent e-transfers: by who it went to (name, lower case) or by amount (within ±6%). */
export interface SentRule { payee?: string; amount?: number; category: string }
/** kind 'moneyprefs', key 'transfers': the last-four digits confirmed as theirs / not theirs, and the remembered
 *  categories for e-transfers. */
export interface TransferPrefs { own?: string[]; notOwn?: string[]; sentRules?: SentRule[] }
export const TRANSFER_PREFS_KEY = 'transfers';

/** How close two amounts have to be to count as "the same payment" (rent that went up a little is still rent). */
const BAND = 0.06;

// ───────────── reading the bank's text ─────────────

// "TFR-TO 6456622", "HH071 TFR-FR 6095623", "TFR-TO ###1817", "SSV TO: 6456622", "PTS TO: 6456622", "FR: ****5623"
const ACCOUNT_MOVE = /(?:\bTFR-?(?:TO|FR)|\b(?:TO|FR|FRM|FROM)\s*:)\s*[#*X]*\s*(\d+)\b/;
/** The last four digits when the text is a move to or from an account number, else null ("C/C" isn't a number). */
export function accountEnding(desc: string): string | null {
  const m = ACCOUNT_MOVE.exec(desc.toUpperCase());
  return m && m[1].length >= 4 ? m[1].slice(-4) : null;
}

const ETRANSFER = /\bE-?\s?(?:TFR|TRANSFER)\b|\bETFR\b/;
const CAME_BACK = /\b(?:CANCEL|RECLAIM|REVERS)/;
const TO_CARD = /\bTFR-?TO\s+C\/C\b/;
/** Worded as a payment to a credit card ("TFR-TO C/C", "PAYMENT - THANK YOU"). */
export const isCardPayment = (s: string) => TO_CARD.test(s.toUpperCase()) || CARD_PAYMENT.test(s.toUpperCase());
/** The short code the bank puts after an e-transfer ("***9K5"); a masked card number ("****4421") isn't one. */
export function etransferCode(desc: string): string | null {
  const m = /(?:^|[^*])\*{3}([A-Za-z0-9]{2,8})\b/.exec(desc);
  return m ? m[1] : null;
}

/** What kind of 'Transfers' row this is. `own`: the last-four digits known to be theirs (see ownEndings). */
export function transferKind(t: Txn, own: Set<string>): TransferKind {
  const s = `${t.desc} ${t.merchant}`.toUpperCase();
  if (ETRANSFER.test(s) && !/\bFEE\b/.test(s)) {
    if (CAME_BACK.test(s)) return t.amount > 0 ? 'reversal' : 'other';
    return t.amount < 0 ? 'sent' : 'received';
  }
  if (isCardPayment(s)) return 'card';
  const ending = accountEnding(t.desc);
  if (ending) return own.has(ending) ? 'own' : 'unknownAccount';
  return 'other';
}

/** The last-four digits that are theirs: every tracked account's, plus the ones they said yes to. */
export function ownEndings(accounts: Account[], prefs: TransferPrefs = {}): Set<string> {
  return new Set([...accounts.map(a => a.last4).filter((s): s is string => !!s), ...(prefs.own || [])]);
}

/** A row the sorting looks at: under 'Transfers' for real (an ATM withdrawal shown as a move into the cash wallet is
 *  'Cash' underneath, and isn't touched). */
const isTransferRow = (t: Txn) => t.category === 'Transfers' && !t.toWallet;

// ───────────── small helpers ─────────────

const toDate = (iso: string) => { const [y, m, d] = iso.split('-').map(Number); return new Date(y, m - 1, d); };
const daysBetween = (a: string, b: string) => Math.round((toDate(b).getTime() - toDate(a).getTime()) / 86_400_000);
const median = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); const n = s.length; return n ? (n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2) : 0; };
const abs = (t: Txn) => Math.abs(t.amount);
const sum = (rows: Txn[]) => round2(rows.reduce((s, t) => s + abs(t), 0));
const newestFirst = (rows: Txn[]) => [...rows].sort((a, b) => b.date.localeCompare(a.date) || a.id.localeCompare(b.id));
const within = (a: number, b: number) => Math.abs(a - b) <= Math.max(a, b) * BAND;
const dollars = (n: number) => `$${Math.round(n).toLocaleString('en-CA')}`;
const payeeKey = (name: string) => name.trim().replace(/\s+/g, ' ').toLowerCase();

/** About once a month: three or more, and the usual gap between them is a month (a skipped month is forgiven). */
function aboutMonthly(rows: Txn[]): boolean {
  if (rows.length < 3) return false;
  const dates = rows.map(t => t.date).sort();
  const gaps = dates.slice(1).map((d, i) => daysBetween(dates[i], d)).filter(g => g > 0);
  if (gaps.length < 2) return false;
  const mid = median(gaps);
  return mid >= 24 && mid <= 38;
}
/** Most of them fall around the turn of the month (the 25th to the 5th), where rent does. */
function turnOfMonth(rows: Txn[]): boolean {
  const near = rows.filter(t => { const d = Number(t.date.slice(8, 10)); return d >= 25 || d <= 5; }).length;
  return near >= rows.length * 0.6;
}
/** Split by amount: each group within ±6% of its running middle amount. */
function byAmount(rows: Txn[]): Txn[][] {
  const groups: Txn[][] = [];
  for (const t of [...rows].sort((a, b) => abs(a) - abs(b))) {
    const g = groups.find(gr => within(abs(t), median(gr.map(abs))));
    if (g) g.push(t); else groups.push([t]);
  }
  return groups;
}

// ───────────── e-transfers sent ─────────────

/** The sent e-transfers that stood, the ones that were cancelled (with the row that brought the money back), and any
 *  money-back row whose sent one wasn't found. A reversal cancels the sent row of the same amount with the same ***
 *  code (up to 60 days before); failing that, the latest one of the same amount in the 30 days before. */
function standingSent(rows: Txn[], own: Set<string>) {
  const sent = rows.filter(t => transferKind(t, own) === 'sent');
  const back = rows.filter(t => transferKind(t, own) === 'reversal').sort((a, b) => a.date.localeCompare(b.date));
  const gone = new Set<Txn>();
  const cancelled: { sent: Txn; back: Txn }[] = [];
  const stray: Txn[] = [];
  for (const r of back) {
    const same = sent.filter(s => !gone.has(s) && Math.abs(abs(s) - r.amount) < 0.01 && s.date <= r.date)
      .sort((a, b) => b.date.localeCompare(a.date));
    const code = etransferCode(r.desc);
    const hit = (code && same.find(s => etransferCode(s.desc) === code && daysBetween(s.date, r.date) <= 60))
      || same.find(s => daysBetween(s.date, r.date) <= 30);
    if (hit) { gone.add(hit); cancelled.push({ sent: hit, back: r }); } else stray.push(r);
  }
  return { live: sent.filter(s => !gone.has(s)), cancelled, stray };
}

/** Who each sent e-transfer went to, from the receipts read from email that are linked to a bank row. */
function payees(receipts: Receipt[]): Map<string, { name: string; email?: string }> {
  const out = new Map<string, { name: string; email?: string }>();
  for (const r of receipts) if (r.txnId && r.paidBy === 'etransfer' && r.payee?.name?.trim()) out.set(r.txnId, r.payee);
  return out;
}

/** The remembered rule for one sent e-transfer: by who it went to first, then the closest remembered amount. */
function ruleFor(t: Txn, rules: SentRule[], payee?: string): SentRule | null {
  const ok = rules.filter(r => r && typeof r.category === 'string' && r.category && r.category !== 'Transfers');
  if (payee) { const p = ok.find(r => r.payee && r.payee === payeeKey(payee)); if (p) return p; }
  const near = ok.filter(r => !r.payee && typeof r.amount === 'number' && r.amount > 0 && Math.abs(abs(t) - r.amount) <= r.amount * BAND)
    .sort((a, b) => Math.abs(abs(t) - a.amount!) - Math.abs(abs(t) - b.amount!));
  return near[0] || null;
}

export interface Remembered { txn: Txn; category: string; rule: SentRule }
/** The sent e-transfers still under 'Transfers' that a remembered choice would categorize (cancelled ones left out).
 *  Nothing is changed here: the screen offers them ("3 new e-transfers match what you chose before") and applies on a tap. */
export function applySentRules(rows: Txn[], prefs: TransferPrefs, receipts: Receipt[] = []): Remembered[] {
  const rules = prefs.sentRules || [];
  if (!rules.length) return [];
  const who = payees(receipts);
  const out: Remembered[] = [];
  for (const t of standingSent(rows.filter(isTransferRow), new Set()).live) {
    const rule = ruleFor(t, rules, who.get(t.id)?.name);
    if (rule) out.push({ txn: t, category: rule.category, rule });
  }
  return out.sort((a, b) => b.txn.date.localeCompare(a.txn.date));
}

export interface SentGroup {
  /** Unique on the screen: 'payee:sam lee', 'amount:1750.00', 'rest'. */
  key: string;
  /** How it was grouped: by who it went to, by a steady monthly amount, or what's left (unrelated, shown singly). */
  by: 'payee' | 'amount' | 'rest';
  /** "To Sam Lee", "About $1,750 each month (11×)", "Other e-transfers". */
  label: string;
  payee?: { name: string; email?: string };
  /** by 'amount': the middle amount of the group. */
  amount?: number;
  /** A steady amount about once a month. */
  monthly: boolean;
  rows: Txn[];          // newest first
  count: number;
  total: number;
  /** The category to offer first, or null to let the person choose. */
  suggest: string | null;
}

/** 'Housing' for a monthly payment over $900 around the turn of the month (rent); otherwise no guess. */
function suggestSent(rows: Txn[], monthly: boolean): string | null {
  return monthly && median(rows.map(abs)) > 900 && turnOfMonth(rows) ? 'Housing' : null;
}

function groupSent(live: Txn[], who: Map<string, { name: string; email?: string }>): SentGroup[] {
  const groups: SentGroup[] = [];
  const make = (g: Pick<SentGroup, 'key' | 'by' | 'label' | 'payee' | 'amount' | 'monthly' | 'suggest'>, rows: Txn[]) =>
    groups.push({ ...g, rows: newestFirst(rows), count: rows.length, total: sum(rows) });
  // 1. by who it went to
  const named = new Map<string, Txn[]>();
  const unnamed: Txn[] = [];
  for (const t of live) {
    const p = who.get(t.id);
    if (!p) { unnamed.push(t); continue; }
    const k = payeeKey(p.name);
    named.set(k, [...(named.get(k) || []), t]);
  }
  for (const [k, rows] of named) {
    const payee = who.get(rows[0].id)!;
    const steady = rows.every(t => within(abs(t), median(rows.map(abs))));
    const monthly = steady && aboutMonthly(rows);
    make({ key: `payee:${k}`, by: 'payee', label: `To ${payee.name.trim().replace(/\s+/g, ' ')}`, payee, monthly, suggest: suggestSent(rows, monthly) }, rows);
  }
  // 2. by a steady amount that comes back about monthly
  const rest: Txn[] = [];
  for (const rows of byAmount(unnamed)) {
    if (!aboutMonthly(rows)) { rest.push(...rows); continue; }
    const amount = round2(median(rows.map(abs)));
    make({ key: `amount:${amount.toFixed(2)}`, by: 'amount', label: `About ${dollars(amount)} each month (${rows.length}×)`, amount, monthly: true, suggest: suggestSent(rows, true) }, rows);
  }
  groups.sort((a, b) => b.total - a.total);
  // 3. what's left
  if (rest.length) make({ key: 'rest', by: 'rest', label: 'Other e-transfers', monthly: false, suggest: null }, rest);
  return groups;
}

/** The prefs with this group's choice remembered (by who it went to, or by its amount), replacing an older choice for
 *  the same person or the same amount. The leftover group ("Other e-transfers") has nothing to remember by. */
export function rememberSent(prefs: TransferPrefs, group: Pick<SentGroup, 'by' | 'payee' | 'amount'>, category: string): TransferPrefs {
  const old = prefs.sentRules || [];
  if (group.by === 'payee' && group.payee?.name) {
    const payee = payeeKey(group.payee.name);
    return { ...prefs, sentRules: [...old.filter(r => r.payee !== payee), { payee, category }] };
  }
  if (group.by === 'amount' && group.amount) {
    const amount = group.amount;
    return { ...prefs, sentRules: [...old.filter(r => r.payee || !r.amount || !within(r.amount, amount)), { amount, category }] };
  }
  return prefs;
}

// ───────────── not transfers at all ─────────────

/** A round-up savings app: money put aside, so it stays a transfer. */
const SAVINGS_APP = /\b(?:MOKA|INTELL)\s+TRANSFER\b/;
/** The bank covering an overdraft from another of their accounts: money moved, not spent. */
const OVERDRAFT_COVER = /\bCOVER\s+OVERDR/;

/** The category to offer for a row that isn't a transfer: what the built-in rules say once the word TRANSFER is ignored. */
function suggestOther(t: Txn, allIn: boolean): string {
  const s = `${t.merchant} ${t.desc}`.toUpperCase();
  if (SAVINGS_APP.test(s) || OVERDRAFT_COVER.test(s)) return 'Transfers';
  if (/\bFORD CREDIT\b/.test(s)) return 'Transport';          // the car loan
  if (/\bHYDRO?\s?ONE\b/.test(s)) return 'Utilities';          // "HYDR ONE REM"
  const b = builtinCategoryNoTransfer(t.merchant, t.desc);
  if (b && b !== 'Credit card payment' && (b !== 'Income' || allIn)) return b;
  if (allIn && /\bWIRE\b/.test(s)) return 'Income';            // a wire coming in
  return 'Other';
}

export interface OtherGroup {
  key: string;
  /** The merchant as the planner names it, or "Account ····1234 (not yours)". */
  label: string;
  merchant: string;
  /** Set for moves to or from an account they said isn't theirs. */
  account?: string;
  rows: Txn[];          // newest first
  count: number;
  total: number;
  /** Every row is money coming in. */
  moneyIn: boolean;
  /** The category to offer; 'Transfers' means "leave it" (see keep). */
  suggest: string;
  /** Best left as a transfer (money put aside): no action needed. */
  keep: boolean;
}

// ───────────── the whole picture ─────────────

export interface TransferSort {
  /** Between their own accounts: stays as it is. `total` counts each move once: money going out, plus money coming in
   *  from an account the planner doesn't track (a move between two tracked accounts shows on both). */
  own: { count: number; total: number; byEnding: { ending: string; name?: string; count: number; total: number }[] };
  /** Account numbers to ask about: "Is ····6622 one of yours?" */
  unknownAccounts: { ending: string; count: number; total: number; /** money sent to it, and money that came from it */ sent: number; back: number; first: string; last: string; sample: string }[];
  /** Payments to a credit card, to be changed to 'Credit card payment'. Newest first. */
  card: Txn[];
  sent: {
    groups: SentGroup[];
    /** Sent and taken back: both rows left as they are. */
    cancelled: { sent: Txn; back: Txn }[];
    /** New ones that match a choice made before (not in `groups`). */
    remembered: Remembered[];
  };
  /** E-transfers that came in: 'Income' is offered, the person chooses. `returned`: a sent one that came back whose
   *  sent row wasn't found (nothing is offered). */
  received: { txn: Txn; suggest: string | null; returned?: boolean }[];
  other: OtherGroup[];
  totals: { own: number; card: number; sent: number; received: number };
}

/**
 * Everything under 'Transfers' (pass 12–14 months of rows; others are ignored), sorted into what the screen shows.
 * `receipts`: the receipts read from email, which say who an e-transfer went to.
 */
export function sortTransfers(all: Txn[], accounts: Account[], prefs: TransferPrefs = {}, receipts: Receipt[] = []): TransferSort {
  const rows = all.filter(isTransferRow);
  const own = ownEndings(accounts, prefs);
  const notOwn = new Set((prefs.notOwn || []).filter(e => !own.has(e)));
  const kinds = new Map<Txn, TransferKind>(rows.map(t => [t, transferKind(t, own)]));
  const of = (k: TransferKind) => rows.filter(t => kinds.get(t) === k);

  // between their own accounts
  const tracked = new Map(accounts.filter(a => a.last4).map(a => [a.last4!, a.name]));
  const ownRows = of('own');
  const ends = new Map<string, Txn[]>();
  for (const t of ownRows) { const e = accountEnding(t.desc)!; ends.set(e, [...(ends.get(e) || []), t]); }
  const byEnding = [...ends].map(([ending, list]) => ({ ending, name: tracked.get(ending), count: list.length, total: sum(list) }))
    .sort((a, b) => b.total - a.total);
  const moved = sum(ownRows.filter(t => t.amount < 0 || !tracked.has(accountEnding(t.desc)!)));

  // account numbers not known yet → asked about; the ones they said no to → "not transfers"
  const asks = new Map<string, Txn[]>();
  const strangers = new Map<string, Txn[]>();
  for (const t of of('unknownAccount')) {
    const e = accountEnding(t.desc)!;
    const into = notOwn.has(e) ? strangers : asks;
    into.set(e, [...(into.get(e) || []), t]);
  }
  const unknownAccounts = [...asks].map(([ending, list]) => {
    const dates = list.map(t => t.date).sort();
    return { ending, count: list.length, total: sum(list), sent: sum(list.filter(t => t.amount < 0)), back: sum(list.filter(t => t.amount > 0)), first: dates[0], last: dates[dates.length - 1], sample: newestFirst(list)[0].desc };
  }).sort((a, b) => b.total - a.total);

  // e-transfers
  const { live, cancelled, stray } = standingSent(rows, own);
  const who = payees(receipts);
  const remembered = applySentRules(rows, prefs, receipts);
  const held = new Set(remembered.map(r => r.txn));
  const groups = groupSent(live.filter(t => !held.has(t)), who);
  const received = [
    ...of('received').map(txn => ({ txn, suggest: 'Income' as string | null })),
    ...stray.map(txn => ({ txn, suggest: null, returned: true })),
  ].sort((a, b) => b.txn.date.localeCompare(a.txn.date));

  // not transfers at all, by merchant
  const merchants = new Map<string, Txn[]>();
  for (const t of of('other')) merchants.set(t.merchant, [...(merchants.get(t.merchant) || []), t]);
  const other: OtherGroup[] = [...merchants].map(([merchant, list]) => {
    const moneyIn = list.every(t => t.amount > 0);
    const suggest = suggestOther(newestFirst(list)[0], moneyIn);
    return { key: `m:${merchant}`, label: merchant, merchant, rows: newestFirst(list), count: list.length, total: sum(list), moneyIn, suggest, keep: suggest === 'Transfers' };
  });
  for (const [ending, list] of strangers) {
    other.push({ key: `acct:${ending}`, label: `Account ····${ending} (not yours)`, merchant: list[0].merchant, account: ending, rows: newestFirst(list),
      count: list.length, total: sum(list), moneyIn: list.every(t => t.amount > 0), suggest: 'Other', keep: false });
  }
  other.sort((a, b) => Number(a.keep) - Number(b.keep) || b.total - a.total);

  const card = newestFirst(of('card'));
  return {
    own: { count: ownRows.length, total: moved, byEnding },
    unknownAccounts,
    card,
    sent: { groups, cancelled, remembered },
    received,
    other,
    totals: { own: moved, card: sum(card), sent: sum(live), received: sum(of('received')) },
  };
}

/** The answer to "Is ····6622 one of yours?", kept in the prefs (a yes takes it off the no list, and the other way). */
export function answerAccount(prefs: TransferPrefs, ending: string, yes: boolean): TransferPrefs {
  const without = (list: string[] | undefined) => (list || []).filter(e => e !== ending);
  return yes ? { ...prefs, own: [...without(prefs.own), ending], notOwn: without(prefs.notOwn) }
    : { ...prefs, own: without(prefs.own), notOwn: [...without(prefs.notOwn), ending] };
}
