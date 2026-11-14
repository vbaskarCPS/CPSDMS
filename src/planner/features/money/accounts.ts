// src/planner/features/money/accounts.ts — deleting an account for good (Money › Accounts): the bank stops filling it,
// its rows come out of every month, the receipts matched to those rows go back to waiting, and its doc goes. Archiving
// (which keeps everything) stays the gentle way. The months are read as stored, not as the screens show them, so rows
// hidden on screen (a connected account's CSV rows) go too and every other account's rows are written back untouched.
import { putDocs } from '../../lib/docs';
import { SignedOut } from '../../lib/auth';
import { loadMonths } from './lib';
import { listBanks, mapAccounts } from './plaid';
import { loadReceipts, receiptKey } from './receipts';
import { CASH_ACCOUNT_ID, type Account, type Receipt, type Txn } from './types';

/** How many rows an account has, across the months given. */
export function rowsOf(months: Record<string, Txn[]>, accountId: string): number {
  let n = 0;
  for (const rows of Object.values(months)) for (const t of rows) if (t.accountId === accountId) n++;
  return n;
}
/** The ids of an account's rows (for the receipts matched to them). */
export function rowIdsOf(months: Record<string, Txn[]>, accountId: string): Set<string> {
  const ids = new Set<string>();
  for (const rows of Object.values(months)) for (const t of rows) if (t.accountId === accountId) ids.add(t.id);
  return ids;
}

/** The months with one account's rows taken out. `changed`: the months that lost a row (the only ones to write);
 *  the others are handed back as they were, and what's left of a changed month keeps its order. */
export function withoutAccount(months: Record<string, Txn[]>, accountId: string): { months: Record<string, Txn[]>; changed: string[]; removed: number } {
  const out: Record<string, Txn[]> = {};
  const changed: string[] = [];
  let removed = 0;
  for (const m of Object.keys(months).sort()) {
    const rows = months[m] || [];
    const kept = rows.filter(t => t.accountId !== accountId);
    if (kept.length === rows.length) { out[m] = rows; continue; }
    out[m] = kept; changed.push(m); removed += rows.length - kept.length;
  }
  return { months: out, changed, removed };
}

/** The receipts that were matched to a row that's gone (their row, or one of the charges of a split order), each with
 *  the match taken off: back to waiting for the bank / not matched. A cash receipt on a removed row is cleared the
 *  same way. Receipts on other rows aren't returned. */
export function receiptsUnlinked(receipts: Receipt[], removedIds: Set<string>): Receipt[] {
  const out: Receipt[] = [];
  for (const r of receipts) {
    if (!(r.txnId && removedIds.has(r.txnId)) && !(r.txnMore || []).some(x => removedIds.has(x.id))) continue;
    const next: Receipt = { ...r };
    delete next.txnId; delete next.txnMonth; delete next.txnMore; delete next.matchedAt; delete next.matchedBy;
    out.push(next);
  }
  return out;
}

export const isCashWallet = (a: Pick<Account, 'id' | 'type'>) => a.id === CASH_ACCOUNT_ID || a.type === 'cash';
export const isBankLinked = (a: Pick<Account, 'plaid'>) => !!a.plaid && !a.plaid.removedAt;

/** Delete an account and everything in it. `onStep` says what it's doing, for the screen.
 *  A connected account is first taken off its bank (the same "Don't track this account" as on Connected banks), or
 *  the next sync would fill it again; if that fails, nothing is deleted. Then one write takes out its rows, unmatches
 *  the receipts on them and removes the account, so it all happens or none of it does. */
export async function deleteAccount(a: Account, onStep?: (step: 'bank' | 'rows') => void): Promise<{ removed: number; receipts: number }> {
  if (isCashWallet(a)) throw new Error('The cash wallet can’t be deleted. Archive it to hide it.');
  if (isBankLinked(a)) {
    onStep?.('bank');
    try {
      const item = (await listBanks()).items.find(i => i.itemId === a.plaid!.itemId);
      if (item) {   // not found: the bank was disconnected already
        const map: Record<string, string> = {};
        for (const b of item.accounts) map[b.plaidId] = !b.plannerId || b.plannerId === a.id ? 'skip' : b.plannerId;
        map[a.plaid!.plaidId] = 'skip';
        await mapAccounts(item.itemId, map);
      }
    } catch (e) {
      if (e instanceof SignedOut) throw e;
      throw new Error(`Couldn’t stop the bank filling this account, so nothing was deleted${e instanceof Error && e.message ? ` (${e.message})` : ''}. Try again.`);
    }
  }
  onStep?.('rows');
  const [raw, receipts] = await Promise.all([loadMonths(), loadReceipts()]);   // everything, as stored
  const cut = withoutAccount(raw, a.id);
  const loose = receiptsUnlinked(receipts, rowIdsOf(raw, a.id));
  await putDocs([
    ...cut.changed.map(m => ({ kind: 'txns', key: m, data: { rows: cut.months[m] } })),
    ...loose.map(r => ({ kind: 'receipt', key: receiptKey(r), data: r })),
    { kind: 'account', key: a.id, data: null },
  ]);
  return { removed: cut.removed, receipts: loose.length };
}
