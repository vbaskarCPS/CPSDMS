// src/planner/features/money/mailReceipts.ts — receipts from email. "Find receipts in email" (Money › Receipts) asks the
// planner-mail function (action 'receipts', features/mail/mail.ts scanReceipts) to look through the person's
// connected Gmail mailboxes for purchase emails, page by page; the function saves each one as a 'receipt' doc
// (from: 'email', photos: 0). Then they're matched to the bank's rows with the same rules as a photo receipt
// (receiptMatch.ts pickMatch) and linked the same way (receipts.ts linkReceipt: the row takes the receipt's category).
// What doesn't match waits in "Not matched", where it can be put aside as the company card or "not a receipt".
// The pure parts (where to start, the page loop, which match, which list) are tested in mailReceipts.test.ts.
import { getDoc, putDoc } from '../../lib/docs';
import { mailboxes as loadMailboxes, scanReceipts, type ReceiptScanPage } from '../mail/mail';
import { loadAccounts, loadMonths, money, todayIso, visibleMonths } from './lib';
import { linkReceipt, loadReceipts, saveReceipt } from './receipts';
import { awaitingMatch, foreignCurrency, pickMatch, shiftDay } from './receiptMatch';
import type { Account, MailReceiptPrefs, Receipt, Txn } from './types';

export const PREFS_KIND = 'moneyprefs', PREFS_KEY = 'mailReceipts';
/** The first time, email is read from this many months back; afterwards from the last look, less this many days
 *  (a receipt that arrived late, or a page the last look didn't finish). */
export const FIRST_MONTHS = 12, OVERLAP_DAYS = 3;

// ───────────── where to start ─────────────

export function monthsBack(iso: string, months: number): string {
  const y = +iso.slice(0, 4), m = +iso.slice(5, 7) - 1 - months, d = +iso.slice(8, 10);
  const last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();   // 31 Mar less a month → 28/29 Feb, not 3 Mar
  return new Date(Date.UTC(y, m, Math.min(d, last))).toISOString().slice(0, 10);
}

/** The day to read from: 12 months back for a mailbox never read (or one whose last look had a problem), otherwise its
 *  last look less 3 days. With several mailboxes, the earliest of them (one call reads them all). */
export function scanSince(prefs: MailReceiptPrefs | null, addresses: string[], today: string): string {
  const first = monthsBack(today, FIRST_MONTHS);
  const lastFor = (a: string) => (prefs?.boxes ? prefs.boxes[a.toLowerCase()] : prefs?.lastScan);
  const days = (addresses.length ? addresses : ['']).map(a => { const l = lastFor(a); return l ? shiftDay(l, -OVERLAP_DAYS) : first; });
  const since = days.sort()[0];
  return since < first ? first : since;
}

/** The prefs after a look: today for each mailbox read without a problem (one with a problem keeps its old day, so the
 *  next look reads what it missed). */
export function afterScan(prefs: MailReceiptPrefs | null, progress: ScanProgress, today: string): MailReceiptPrefs {
  const boxes = { ...(prefs?.boxes || {}) };
  for (const m of progress.mailboxes) if (!m.problem) boxes[m.address.toLowerCase()] = today;
  const anyClean = progress.mailboxes.some(m => !m.problem);
  return { ...(prefs || {}), ...(anyClean || !progress.mailboxes.length ? { lastScan: today } : {}), boxes };
}

// ───────────── the page loop ─────────────

export interface ScanProgress {
  scanned: number;   // emails read so far
  found: number;     // receipts saved so far
  pages: number;
  mailboxes: { address: string; scanned: number; found: number; problem?: string }[];
  done: boolean;
  since: string;
}
export type ScanCall = (o: { since: string; cursor?: string }) => Promise<ReceiptScanPage>;
const MAX_PAGES = 200;

/** Ask for pages until the function says there's no more, adding up what each page read and found (each page's
 *  counts are that page's own). Stops too if a page says "more" without a new cursor (it would only repeat). */
export async function runScan(call: ScanCall, since: string, onProgress: (p: ScanProgress) => void = () => undefined): Promise<ScanProgress> {
  const p: ScanProgress = { scanned: 0, found: 0, pages: 0, mailboxes: [], done: false, since };
  const seen = new Set<string>();
  let cursor: string | undefined;
  for (;;) {
    const page = await call({ since, ...(cursor ? { cursor } : {}) });
    p.pages++;
    p.scanned += page.scanned; p.found += page.found;
    for (const m of page.mailboxes) {
      let box = p.mailboxes.find(b => b.address.toLowerCase() === m.address.toLowerCase());
      if (!box) { box = { address: m.address, scanned: 0, found: 0 }; p.mailboxes.push(box); }
      box.scanned += m.scanned; box.found += m.found;
      if (m.problem) box.problem = m.problem;
    }
    const next = page.more ? page.cursor : undefined;
    if (!next || seen.has(next) || p.pages >= MAX_PAGES) { p.done = true; onProgress({ ...p, mailboxes: p.mailboxes.map(b => ({ ...b })) }); return p; }
    seen.add(next); cursor = next;
    onProgress({ ...p, mailboxes: p.mailboxes.map(b => ({ ...b })) });
  }
}

/** Look through the person's connected mailboxes for receipts (from the remembered day), and remember today. */
export async function scanEmail(onProgress?: (p: ScanProgress) => void): Promise<ScanProgress> {
  const today = todayIso();
  const [{ mailboxes }, prefs] = await Promise.all([loadMailboxes(), getDoc<MailReceiptPrefs>(PREFS_KIND, PREFS_KEY)]);
  const since = scanSince(prefs, mailboxes.map(m => m.address), today);
  const progress = await runScan(scanReceipts, since, onProgress);
  // read again just before writing: the other person may have looked meanwhile (household doc)
  const fresh = await getDoc<MailReceiptPrefs>(PREFS_KIND, PREFS_KEY).catch(() => prefs);
  await putDoc(PREFS_KIND, PREFS_KEY, afterScan(fresh, progress, today));
  return progress;
}

// ───────────── matching ─────────────

export const isEmailReceipt = (r: Receipt): boolean => r.from === 'email';

/** Which email receipts link to which bank rows: every waiting one (oldest first), with the same rules as a photo
 *  receipt (pickMatch), never a row another receipt already has, nor one picked earlier in this run. */
export function pickEmailMatches(all: Receipt[], rows: Txn[], accounts: Account[]): { r: Receipt; txn: Txn }[] {
  const taken = new Set(all.filter(r => r.txnId).map(r => r.txnId!));
  const out: { r: Receipt; txn: Txn }[] = [];
  for (const r of all.filter(x => isEmailReceipt(x) && awaitingMatch(x)).sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id))) {
    const pick = pickMatch(r, rows, accounts, taken);
    if (!pick) continue;
    taken.add(pick.txn.id);
    out.push({ r, txn: pick.txn });
  }
  return out;
}

/** Link every email receipt (last 13 months) whose bank row is a clear match. */
export async function matchEmailReceipts(): Promise<{ linked: Receipt[]; waiting: number }> {
  const all = await loadReceipts(monthsBack(todayIso(), FIRST_MONTHS + 1));
  const pending = all.filter(r => isEmailReceipt(r) && awaitingMatch(r));
  if (!pending.length) return { linked: [], waiting: 0 };
  const dates = pending.map(r => r.date).sort();
  const from = shiftDay(dates[0], -3), to = shiftDay(dates[dates.length - 1], 7);
  const [accounts, raw] = await Promise.all([loadAccounts(), loadMonths(from.slice(0, 7), to.slice(0, 7))]);
  const rows = Object.values(visibleMonths(raw, accounts)).flat();
  const linked: Receipt[] = [];
  for (const { r, txn } of pickEmailMatches(all, rows, accounts)) linked.push(await linkReceipt(r, txn, 'auto'));
  return { linked, waiting: pending.length - linked.length };
}

// ───────────── the lists ─────────────

const newestFirst = (a: Receipt, b: Receipt) => b.date.localeCompare(a.date) || (b.addedAt || '').localeCompare(a.addedAt || '');
/** "Not matched": email receipts without a bank row that haven't been put aside, newest first. */
export const unmatchedEmailReceipts = (list: Receipt[]): Receipt[] => list.filter(r => isEmailReceipt(r) && !r.txnId && !r.ignored).sort(newestFirst);
/** "Show hidden": the ones put aside (company card, not a receipt), newest first. */
export const hiddenEmailReceipts = (list: Receipt[]): Receipt[] => list.filter(r => isEmailReceipt(r) && !!r.ignored).sort(newestFirst);
/** The normal receipts list: photo receipts, and email receipts once they've matched. */
export const listedReceipts = (list: Receipt[]): Receipt[] => list.filter(r => !isEmailReceipt(r) || (!!r.txnId && !r.ignored));

/** A receipt put aside (or, with null, brought back). Pure: setIgnored saves it. */
export function withIgnored(r: Receipt, why: Receipt['ignored'] | null): Receipt {
  const next = { ...r };
  if (why) next.ignored = why; else delete next.ignored;
  return next;
}
export async function setIgnored(r: Receipt, why: Receipt['ignored'] | null): Promise<Receipt> {
  const next = withIgnored(r, why);
  await saveReceipt(next);
  return next;
}

/** The part of an address before the @ ("vijay.b" for vijay.b@gmail.com). */
export const mailboxName = (address: string | undefined): string => (address || '').split('@')[0];

/** A receipt's total as shown: "$42.17", or "30.00 USD" in another currency. */
export const receiptTotal = (r: Pick<Receipt, 'total' | 'currency'>): string => (foreignCurrency(r) ? `${r.total.toFixed(2)} ${r.currency!.toUpperCase()}` : money(r.total));
