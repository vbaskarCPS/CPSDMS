// src/planner/features/money/mailReceipts.ts — receipts from email. "Find receipts in email" (Money › Receipts) asks the
// planner-mail function (action 'receipts', features/mail/mail.ts scanReceipts) to look through the person's
// connected Gmail mailboxes for purchase emails, page by page; the function saves each one as a 'receipt' doc
// (from: 'email', photos: 0). Then they're matched to the bank's rows with the same rules as a photo receipt
// (receiptMatch.ts pickMatch) and linked the same way (receipts.ts linkReceipt: the row takes the receipt's category).
// What doesn't match waits in "Not matched", where it can be put aside as the company card or "not a receipt".
// The pure parts (where to start, the page loop, which match, which list) are tested in mailReceipts.test.ts.
import { getDoc, putDoc, putDocs } from '../../lib/docs';
import { SignedOut } from '../../lib/auth';
import { MailProblem, mailboxes as loadMailboxes, scanReceipts, type ReceiptScanPage } from '../mail/mail';
import { loadAccounts, loadMonths, money, todayIso, visibleMonths } from './lib';
import { linkGroup, linkReceipt, loadReceipts, receiptKey, saveReceipt } from './receipts';
import { beforeHistory, companyCard, historyFloor, historyStarts, liveRows, onCompanyCard, sameAsAnother, type CardHistory, type SameAs } from './receiptGroups';
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
export function scanSince(prefs: MailReceiptPrefs | null, addresses: string[], today: string, floor?: string | null): string {
  // never from before the bank's own rows begin (`floor`): an older email has nothing to match
  const back = monthsBack(today, FIRST_MONTHS), first = floor && floor > back && floor <= today ? floor : back;
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
/** How long to wait before asking for the same page again, each time it fails (seconds). After the last, it stops. */
export const RETRY_WAITS = [2, 5, 10, 20, 30];
/** The look stopped part-way (the connection kept dropping). What was read up to then is saved on the server, so
 *  tapping again carries on from there (emails already read are skipped). */
export class ScanStopped extends Error {
  constructor(readonly progress: ScanProgress) {
    super(`The connection dropped after ${progress.scanned} email${progress.scanned === 1 ? '' : 's'}${progress.found ? ` (${progress.found} receipt${progress.found === 1 ? '' : 's'} saved)` : ''}. Nothing is lost: tap again to carry on.`);
  }
}
export interface ScanOptions {
  /** Is this failure worth asking again for (a dropped connection), or final (signed out, email not set up)? */
  retry?: (e: unknown) => boolean;
  /** Wait before asking again (the app also waits for the screen to come back). */
  wait?: (seconds: number) => Promise<void>;
}

/** Ask for pages until the function says there's no more, adding up what each page read and found (each page's
 *  counts are that page's own). Stops too if a page says "more" without a new cursor (it would only repeat).
 *  A page that fails on the way (the phone lost its connection, the screen went off) is asked for again, the same
 *  page, a few times with a longer wait each time; if it still fails the look stops with ScanStopped. */
export async function runScan(call: ScanCall, since: string, onProgress: (p: ScanProgress) => void = () => undefined, opts: ScanOptions = {}): Promise<ScanProgress> {
  const p: ScanProgress = { scanned: 0, found: 0, pages: 0, mailboxes: [], done: false, since };
  const seen = new Set<string>();
  const copy = () => ({ ...p, mailboxes: p.mailboxes.map(b => ({ ...b })) });
  let cursor: string | undefined;
  for (;;) {
    let page: ReceiptScanPage | undefined;
    for (let attempt = 0; !page; attempt++) {
      try { page = await call({ since, ...(cursor ? { cursor } : {}) }); }
      catch (e) {
        if (!opts.retry || !opts.retry(e)) throw e;
        if (attempt >= RETRY_WAITS.length) throw new ScanStopped(copy());
        await (opts.wait ? opts.wait(RETRY_WAITS[attempt]) : Promise.resolve());
      }
    }
    p.pages++;
    p.scanned += page.scanned; p.found += page.found;
    for (const m of page.mailboxes) {
      let box = p.mailboxes.find(b => b.address.toLowerCase() === m.address.toLowerCase());
      if (!box) { box = { address: m.address, scanned: 0, found: 0 }; p.mailboxes.push(box); }
      box.scanned += m.scanned; box.found += m.found;
      if (m.problem) box.problem = m.problem;
    }
    const next = page.more ? page.cursor : undefined;
    if (!next || seen.has(next) || p.pages >= MAX_PAGES) { p.done = true; onProgress(copy()); return p; }
    seen.add(next); cursor = next;
    onProgress(copy());
  }
}

/** Wait, and if the planner isn't on screen (another app, the screen off) wait until it is: a request sent from the
 *  background is the one that fails. */
async function waitForScreen(seconds: number): Promise<void> {
  await new Promise(r => setTimeout(r, seconds * 1000));
  if (typeof document === 'undefined' || document.visibilityState === 'visible') return;
  await new Promise<void>(r => { const back = () => { if (document.visibilityState === 'visible') { document.removeEventListener('visibilitychange', back); r(); } }; document.addEventListener('visibilitychange', back); });
}
/** Keep the screen on while it reads (where the phone allows it); returns how to let go. */
async function keepAwake(): Promise<() => void> {
  try {
    const lock = await (navigator as Navigator & { wakeLock?: { request(kind: 'screen'): Promise<{ release(): Promise<void> }> } }).wakeLock?.request('screen');
    return () => { void lock?.release().catch(() => undefined); };
  } catch { return () => undefined; }
}

/** Look through the person's connected mailboxes for receipts (from the remembered day), and remember today. */
export async function scanEmail(onProgress?: (p: ScanProgress) => void): Promise<ScanProgress> {
  const today = todayIso();
  const [{ mailboxes }, prefs, ctx] = await Promise.all([loadMailboxes(), getDoc<MailReceiptPrefs>(PREFS_KIND, PREFS_KEY), loadMatchContext().catch(() => null)]);
  const since = scanSince(prefs, mailboxes.map(m => m.address), today, ctx ? historyFloor(ctx.history) : null);
  const letGo = await keepAwake();
  let progress: ScanProgress;
  // a plain failure (the request never got there, or the server hiccuped) is asked again; "sign in again" and
  // "email isn't set up" are final
  try { progress = await runScan(scanReceipts, since, onProgress, { retry: e => !(e instanceof MailProblem) && !(e instanceof SignedOut), wait: waitForScreen }); }
  finally { letGo(); }
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

/** What matching needs from the bank: the accounts, every row matching may use (what the screens show, less an
 *  archived account's), and how far back each account's rows go. */
export interface MatchContext { accounts: Account[]; rows: Txn[]; history: CardHistory[] }
export async function loadMatchContext(): Promise<MatchContext> {
  const [accounts, raw] = await Promise.all([loadAccounts(), loadMonths()]);
  const rows = liveRows(Object.values(visibleMonths(raw, accounts)).flat(), accounts);
  return { accounts, rows, history: historyStarts(rows, accounts) };
}

/** The company cards: the remembered ones, and the card of any receipt put aside by hand as "Company card" (so a
 *  receipt marked before cards were remembered counts too). */
export function companyCards(prefs: MailReceiptPrefs | null, all: Receipt[], accounts: Account[]): string[] {
  const byHand = all.filter(r => isEmailReceipt(r) && r.ignored === 'company' && r.ignoredBy !== 'card').map(r => companyCard(r, accounts)).filter((c): c is string => !!c);
  return [...new Set([...(prefs?.companyCards || []).filter(c => /^\d{4}$/.test(c)), ...byHand])].sort();
}

/** Tidy the email receipts (last 13 months): put aside the ones paid on a company card, then link every one whose
 *  bank row is a clear match. */
export async function matchEmailReceipts(ctx?: MatchContext): Promise<{ linked: Receipt[]; waiting: number; company: number }> {
  let all = await loadReceipts(monthsBack(todayIso(), FIRST_MONTHS + 1));
  if (!all.some(r => isEmailReceipt(r) && awaitingMatch(r))) return { linked: [], waiting: 0, company: 0 };
  const c = ctx || await loadMatchContext();
  const prefs = await getDoc<MailReceiptPrefs>(PREFS_KIND, PREFS_KEY).catch(() => null);
  const cards = companyCards(prefs, all, c.accounts);
  if (cards.join() !== (prefs?.companyCards || []).join()) await putDoc(PREFS_KIND, PREFS_KEY, { ...(prefs || {}), companyCards: cards }).catch(() => undefined);
  const aside = onCompanyCard(all, cards).map(r => ({ ...r, ignored: 'company' as const, ignoredBy: 'card' as const }));
  if (aside.length) {
    await putDocs(aside.map(r => ({ kind: 'receipt', key: receiptKey(r), data: r })));
    const by = new Map(aside.map(r => [r.id, r]));
    all = all.map(r => by.get(r.id) || r);
  }
  const pending = all.filter(r => isEmailReceipt(r) && awaitingMatch(r));
  const linked: Receipt[] = [];
  for (const { r, txn } of pickEmailMatches(all, c.rows, c.accounts)) linked.push(await linkReceipt(r, txn, 'auto'));
  return { linked, waiting: pending.length - linked.length, company: aside.length };
}

/** "Company card" on a receipt. When the email shows the card's last four digits (and it isn't one of the planner's
 *  own accounts), the card is remembered and every other waiting receipt paid on it is put aside too, now and after
 *  each later look. Returns every receipt that changed. */
export async function markCompany(r: Receipt, all: Receipt[], accounts: Account[]): Promise<{ changed: Receipt[]; card: string | null }> {
  const card = companyCard(r, accounts);
  const first: Receipt = { ...withIgnored(r, 'company') };
  delete first.ignoredBy;
  const rest = card ? onCompanyCard(all.filter(o => o.id !== r.id), [card]).map(o => ({ ...o, ignored: 'company' as const, ignoredBy: 'card' as const })) : [];
  await putDocs([first, ...rest].map(x => ({ kind: 'receipt', key: receiptKey(x), data: x })));
  if (card) {
    const prefs = await getDoc<MailReceiptPrefs>(PREFS_KIND, PREFS_KEY).catch(() => null);
    if (!(prefs?.companyCards || []).includes(card)) await putDoc(PREFS_KIND, PREFS_KEY, { ...(prefs || {}), companyCards: [...(prefs?.companyCards || []), card].sort() });
  }
  return { changed: [first, ...rest], card };
}
/** Undo of "Company card". If its card was remembered, the card is forgotten and everything put aside because of the
 *  card comes back with it. */
export async function unmarkCompany(r: Receipt, all: Receipt[], accounts: Account[]): Promise<{ changed: Receipt[]; card: string | null }> {
  const prefs = await getDoc<MailReceiptPrefs>(PREFS_KIND, PREFS_KEY).catch(() => null);
  const c = companyCard(r, accounts);
  const card = c && companyCards(prefs, all, accounts).includes(c) ? c : null;
  const back = (x: Receipt): Receipt => { const n = withIgnored(x, null); delete n.ignoredBy; return n; };
  const others = card ? all.filter(o => o.id !== r.id && isEmailReceipt(o) && o.ignored === 'company' && o.cardLast4 === card) : [];
  const changed = [r, ...others].map(back);
  await putDocs(changed.map(x => ({ kind: 'receipt', key: receiptKey(x), data: x })));
  if (card && (prefs?.companyCards || []).includes(card)) await putDoc(PREFS_KIND, PREFS_KEY, { ...(prefs || {}), companyCards: (prefs?.companyCards || []).filter(x => x !== card) });
  return { changed, card };
}

/** Link a group of receipts to the one charge they add up to. */
export const matchGroup = (rs: Receipt[], txn: Txn): Promise<Receipt[]> => linkGroup(rs, txn, 'hand');

// ───────────── the lists ─────────────

const newestFirst = (a: Receipt, b: Receipt) => b.date.localeCompare(a.date) || (b.addedAt || '').localeCompare(a.addedAt || '');
/** The email receipts with no bank row, sorted into where they show (each newest first):
 *  `unmatched` = waiting for a match or to be put aside ("Not matched");
 *  `same`      = the same money as another email (an order and its shipping emails, or two mailboxes): not listed;
 *  `older`     = from before the card's rows begin in the planner, with the account they are too old for: not listed. */
export interface EmailLists { unmatched: Receipt[]; same: { r: Receipt; why: SameAs }[]; older: { r: Receipt; account: CardHistory }[] }
export function emailLists(list: Receipt[], history: CardHistory[] = []): EmailLists {
  const dup = sameAsAnother(list);
  const out: EmailLists = { unmatched: [], same: [], older: [] };
  for (const r of [...list].sort(newestFirst)) {
    if (!isEmailReceipt(r) || r.txnId || r.ignored) continue;
    const why = dup.get(r.id), old = why ? null : beforeHistory(r, history);
    if (why) out.same.push({ r, why }); else if (old) out.older.push({ r, account: old }); else out.unmatched.push(r);
  }
  return out;
}
/** "Not matched": see emailLists. */
export const unmatchedEmailReceipts = (list: Receipt[], history: CardHistory[] = []): Receipt[] => emailLists(list, history).unmatched;
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
