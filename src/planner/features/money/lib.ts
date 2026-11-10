// src/planner/features/money/lib.ts — money formatting, months, merchant normalizing, loading and
// saving the finance docs, and the sums the screens show.
import { getDocs, putDoc, putDocs } from '../../lib/docs';
import { categorize } from '../../lib/ai';
import { builtinCategory, CATEGORY_NAMES, SPENDING_CATEGORIES } from './categories';
import { CASH_ACCOUNT_ID, type Account, type Budget, type Rule, type Txn, type TxnMonth } from './types';

// ── formatting ──
const cad = new Intl.NumberFormat('en-CA', { style: 'currency', currency: 'CAD', minimumFractionDigits: 2, maximumFractionDigits: 2 });
export function money(n: number, opts: { sign?: boolean; whole?: boolean } = {}): string {
  const v = Math.abs(n);
  const s = opts.whole ? `$${Math.round(v).toLocaleString('en-CA')}` : cad.format(v);
  if (n < -0.004) return `−${s}`;
  if (opts.sign && n > 0.004) return `+${s}`;
  return s;
}
export const round2 = (n: number) => Math.round(n * 100) / 100;
/** "COSTCO WHOLESAL" → "Costco Wholesal" (merchant names are kept upper case). */
export const niceName = (s: string) => s.replace(/\b\w+/g, w => w[0] + w.slice(1).toLowerCase());

// ── months & dates ──
export const monthKey = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
export function shiftMonth(m: string, by: number): string {
  const [y, mo] = m.split('-').map(Number);
  const d = new Date(y, mo - 1 + by, 1);
  return monthKey(d);
}
export function monthLabel(m: string): string {
  const [y, mo] = m.split('-').map(Number);
  return new Date(y, mo - 1, 1).toLocaleDateString('en-CA', { month: 'long', year: 'numeric' });
}
export function daysInMonth(m: string): number { const [y, mo] = m.split('-').map(Number); return new Date(y, mo, 0).getDate(); }
export function dayLabel(iso: string): string {
  const [y, mo, d] = iso.split('-').map(Number);
  return new Date(y, mo - 1, d).toLocaleDateString('en-CA', { weekday: 'short', month: 'short', day: 'numeric' });
}
export const todayIso = () => { const d = new Date(); return `${monthKey(d)}-${String(d.getDate()).padStart(2, '0')}`; };

// ── merchants ── (shared with the planner-plaid edge function, so CSV and bank rows agree)
export { maskNumbers, normalizeMerchant } from '../../../../supabase/functions/_shared/plannerMoney';
import { hideReplaced } from '../../../../supabase/functions/_shared/plannerMoney';

/** FNV-1a; good enough to spot the same bank line twice. */
export function hash(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  let h2 = 0x9747b28c;
  for (let i = s.length - 1; i >= 0; i--) { h2 ^= s.charCodeAt(i); h2 = Math.imul(h2, 0x01000193) >>> 0; }
  return h.toString(36) + h2.toString(36);
}
export const txnId = (accountId: string, date: string, desc: string, amount: number, balance: number | undefined, n = 0) =>
  hash(`${accountId}|${date}|${desc.trim().toUpperCase()}|${amount.toFixed(2)}|${balance === undefined ? '' : balance.toFixed(2)}|${n}`);

// ── loading ──
export async function loadAccounts(): Promise<Account[]> {
  const docs = await getDocs<Account>('account');
  return docs.map(d => d.data).sort((a, b) => a.order - b.order || a.name.localeCompare(b.name));
}
export async function saveAccount(a: Account): Promise<void> { await putDoc('account', a.id, a); }

export async function loadMonths(from?: string, to?: string): Promise<Record<string, Txn[]>> {
  const docs = await getDocs<TxnMonth>('txns', from, to);
  const out: Record<string, Txn[]> = {};
  for (const d of docs) out[d.key] = d.data.rows || [];
  return out;
}
export async function loadRules(): Promise<Record<string, string>> {
  const docs = await getDocs<Rule>('rule');
  const out: Record<string, string> = {};
  for (const d of docs) if (d.data?.category) out[d.key] = d.data.category;
  return out;
}
export async function loadBudget(): Promise<Budget> {
  const docs = await getDocs<Budget>('budget', 'current', 'current');
  return docs[0]?.data || {};
}

/** Decide categories: the user's rules, then the built-in ones, then one AI call for the rest. */
export async function categorizeAll(txns: Txn[], rules: Record<string, string>): Promise<{ counts: Record<string, number> }> {
  const counts = { rule: 0, builtin: 0, ai: 0, other: 0 };
  const unknown = new Set<string>();
  for (const t of txns) {
    const r = rules[t.merchant];
    if (r) { t.category = r; t.source = 'rule'; counts.rule++; continue; }
    const b = builtinCategory(t.merchant, t.desc);
    if (b) { t.category = b; t.source = 'builtin'; counts.builtin++; continue; }
    unknown.add(t.merchant);
  }
  let ai: Record<string, string> = {};
  if (unknown.size) {
    try { ai = await categorize([...unknown].slice(0, 200), CATEGORY_NAMES); } catch { ai = {}; }
  }
  for (const t of txns) {
    if (t.source === 'rule' || t.source === 'builtin') continue;
    const c = ai[t.merchant];
    if (c && CATEGORY_NAMES.includes(c) && c !== 'Other') { t.category = c; t.source = 'ai'; counts.ai++; }
    else { t.category = 'Other'; t.source = 'ai'; counts.other++; }
  }
  return { counts };
}

/** Merge new rows into their months (existing ids win) and write the changed months. */
export async function mergeTxns(rows: Txn[], existing: Record<string, Txn[]>): Promise<{ added: number; dupes: number; months: string[] }> {
  const byMonth: Record<string, Txn[]> = {};
  for (const r of rows) (byMonth[r.date.slice(0, 7)] ||= []).push(r);
  let added = 0, dupes = 0;
  const docs: { kind: string; key: string; data: TxnMonth }[] = [];
  for (const [m, list] of Object.entries(byMonth)) {
    const cur = existing[m] || [];
    const ids = new Set(cur.map(t => t.id));
    const fresh = list.filter(t => { if (ids.has(t.id)) { dupes++; return false; } ids.add(t.id); added++; return true; });
    if (!fresh.length) continue;
    const merged = [...cur, ...fresh].sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
    docs.push({ kind: 'txns', key: m, data: { rows: merged } });
  }
  await putDocs(docs);
  return { added, dupes, months: docs.map(d => d.key) };
}

/** Set a category on some transactions (by id) across months and save the months touched. The months
 *  are read again just before writing, so rows the bank sync added in the meantime aren't lost (and rows
 *  hidden on screen, like a connected account's CSV rows, are written back untouched). */
export async function recategorize(months: Record<string, Txn[]>, ids: Set<string>, category: string): Promise<string[]> {
  const keys: string[] = [];
  for (const [m, rows] of Object.entries(months)) {
    let hit = false;
    for (const t of rows) if (ids.has(t.id)) { t.category = category; t.source = 'manual'; hit = true; }
    if (hit) keys.push(m);
  }
  if (!keys.length) return [];
  keys.sort();
  const fresh = await loadMonths(keys[0], keys[keys.length - 1]);
  const docs: { kind: string; key: string; data: TxnMonth }[] = [];
  for (const m of keys) {
    const rows = fresh[m] || [];
    for (const t of rows) if (ids.has(t.id)) { t.category = category; t.source = 'manual'; }
    docs.push({ kind: 'txns', key: m, data: { rows } });
  }
  await putDocs(docs);
  return keys;
}

/** What the screens show: a connected account's CSV rows are hidden (see hideReplaced), and once cash spending is
 *  logged (the cash wallet's cashSince), an ATM withdrawal is shown as a transfer into the wallet: the cash
 *  rows are the spending, so the withdrawal mustn't count too. Display only; writes go through loadMonths. */
export function visibleMonths(months: Record<string, Txn[]>, accounts: Account[]): Record<string, Txn[]> {
  const linked: Record<string, { removedAt?: string }> = {};
  for (const a of accounts) if (a.plaid) linked[a.id] = { removedAt: a.plaid.removedAt };
  const since = accounts.find(a => a.id === CASH_ACCOUNT_ID)?.cashSince;
  if (!Object.keys(linked).length && !since) return months;
  const out: Record<string, Txn[]> = {};
  for (const [m, rows] of Object.entries(months)) {
    let list = Object.keys(linked).length ? hideReplaced(rows, linked) : rows;
    if (since) list = list.map(t => (isWithdrawalToWallet(t, since) ? { ...t, category: 'Transfers', toWallet: true } : t));
    out[m] = list;
  }
  return out;
}
/** An ATM/cash withdrawal from a bank account on or after the day cash tracking started. */
export const isWithdrawalToWallet = (t: Txn, since: string) =>
  t.accountId !== CASH_ACCOUNT_ID && t.amount < 0 && t.category === 'Cash' && t.date >= since;

// ── sums ──
export const isSpending = (t: Txn) => t.amount < 0 && SPENDING_CATEGORIES.includes(t.category);
export const isIncome = (t: Txn) => t.amount > 0 && t.category === 'Income';

export function sumByCategory(rows: Txn[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const t of rows) if (isSpending(t)) out[t.category] = round2((out[t.category] || 0) - t.amount);
  return out;
}
export function totals(rows: Txn[]) {
  let spent = 0, income = 0;
  for (const t of rows) { if (isSpending(t)) spent -= t.amount; if (isIncome(t)) income += t.amount; }
  return { spent: round2(spent), income: round2(income), net: round2(income - spent) };
}
export function dailySpend(rows: Txn[], m: string): number[] {
  const out = new Array(daysInMonth(m)).fill(0);
  for (const t of rows) if (isSpending(t) && t.date.startsWith(m)) out[Number(t.date.slice(8, 10)) - 1] -= t.amount;
  return out.map(round2);
}
export const budgetTotal = (b: Budget) => round2(Object.entries(b).filter(([k]) => SPENDING_CATEGORIES.includes(k)).reduce((s, [, v]) => s + (Number(v) || 0), 0));
