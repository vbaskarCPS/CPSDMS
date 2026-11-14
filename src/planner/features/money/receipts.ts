// src/planner/features/money/receipts.ts — receipts and cash. A receipt (or a screenshot of a payment) is read by the AI
// and saved as a 'receipt' doc with a small black-and-white copy of each photo ('receiptimg'). Paid by card: it's matched
// to the bank's row (same amount, a few days either side, a similar name) and that row takes the receipt's category,
// which is usually better than a guess from the merchant name (Costco → Groceries or Shopping, by what was bought).
// Paid in cash: it becomes a row in the cash wallet, an account of its own, so cash spending shows in the budget.
import { getDocs, putDocs } from '../../lib/docs';
import { uid } from '../../ui/primitives';
import { loadAccounts, loadMonths, mergeTxns, normalizeMerchant, recategorize, round2, saveAccount, todayIso, visibleMonths } from './lib';
import { awaitingMatch, foreignCurrency, looseCandidates, matchCandidates, pickMatch, shiftDay, type Candidate } from './receiptMatch';
import { CASH_ACCOUNT_ID, type Account, type Receipt, type Txn, type TxnMonth } from './types';
export { splitByCategory, type Candidate } from './receiptMatch';

// ───────────── storage ─────────────

export const receiptKey = (r: Pick<Receipt, 'date' | 'id'>) => `${r.date}~${r.id}`;
const photoKey = (id: string, n: number) => `${id}~${n}`;

/** Receipts dated from `from` to `to` (YYYY-MM or YYYY-MM-DD; both optional), newest first. */
export async function loadReceipts(from?: string, to?: string): Promise<Receipt[]> {
  const docs = await getDocs<Receipt>('receipt', from, to ? `${to}~￿` : undefined);
  return docs.map(d => d.data).filter(r => r && r.id).sort((a, b) => b.date.localeCompare(a.date) || b.addedAt.localeCompare(a.addedAt));
}

/** Save a receipt (and, when its date changed, take it off its old key). */
export async function saveReceipt(r: Receipt, oldKey?: string): Promise<void> {
  const key = receiptKey(r);
  await putDocs([{ kind: 'receipt', key, data: r }, ...(oldKey && oldKey !== key ? [{ kind: 'receipt', key: oldKey, data: null }] : [])]);
}
export async function saveReceiptPhotos(id: string, dataUrls: string[]): Promise<void> {
  await putDocs(dataUrls.map((dataUrl, i) => ({ kind: 'receiptimg', key: photoKey(id, i), data: { dataUrl } })));
}
export async function loadReceiptPhotos(id: string): Promise<string[]> {
  const docs = await getDocs<{ dataUrl: string }>('receiptimg', `${id}~`, `${id}~￿`);
  return docs.map(d => d.data?.dataUrl).filter((s): s is string => !!s);
}

// ───────────── the cash wallet ─────────────

/** The cash wallet, made the first time cash is logged (counting cash from that day). */
export async function ensureWallet(firstDay: string): Promise<Account> {
  const accounts = await loadAccounts();
  const found = accounts.find(a => a.id === CASH_ACCOUNT_ID);
  if (found) {
    if (found.archived || !found.cashSince) { const a = { ...found, archived: false, cashSince: found.cashSince || firstDay }; await saveAccount(a); return a; }
    return found;
  }
  const a: Account = { id: CASH_ACCOUNT_ID, name: 'Cash', type: 'cash', order: Math.max(0, ...accounts.map(x => x.order + 1)), cashSince: firstDay };
  await saveAccount(a);
  return a;
}

/** Log cash spending: a row in the cash wallet. */
export async function addCashRow(c: { date: string; desc: string; amount: number; category: string; note?: string }): Promise<Txn> {
  await ensureWallet(c.date);
  const desc = c.desc.trim() || 'Cash';
  const row: Txn = { id: `cash_${uid()}`, date: c.date, desc, merchant: normalizeMerchant(desc), amount: -round2(Math.abs(c.amount)), accountId: CASH_ACCOUNT_ID, category: c.category, source: 'manual' };
  if (c.note?.trim()) row.note = c.note.trim();
  const m = c.date.slice(0, 7);
  await mergeTxns([row], await loadMonths(m, m));
  return row;
}

/** Change a cash row (amount, date, words, category), moving it to another month if its date did. */
export async function updateCashRow(id: string, month: string, next: { date: string; desc: string; amount: number; category: string; note?: string }): Promise<Txn | null> {
  const nm = next.date.slice(0, 7);
  const fresh = await loadMonths(month < nm ? month : nm, month < nm ? nm : month);
  const old = (fresh[month] || []).find(t => t.id === id);
  if (!old) return null;
  const desc = next.desc.trim() || 'Cash';
  const row: Txn = { ...old, date: next.date, desc, merchant: normalizeMerchant(desc), amount: -round2(Math.abs(next.amount)), category: next.category, source: 'manual' };
  if (next.note?.trim()) row.note = next.note.trim(); else delete row.note;
  const docs: { kind: string; key: string; data: TxnMonth }[] = [];
  const without = (fresh[month] || []).filter(t => t.id !== id);
  if (nm === month) docs.push({ kind: 'txns', key: month, data: { rows: [...without, row].sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id)) } });
  else {
    docs.push({ kind: 'txns', key: month, data: { rows: without } });
    docs.push({ kind: 'txns', key: nm, data: { rows: [...(fresh[nm] || []), row].sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id)) } });
  }
  await putDocs(docs);
  return row;
}

/** Take a cash row out of its month (only cash rows: the bank's rows are the bank's). */
export async function removeCashRow(id: string, month: string): Promise<void> {
  if (!id.startsWith('cash_')) return;
  const fresh = await loadMonths(month, month);
  const rows = fresh[month] || [];
  if (!rows.some(t => t.id === id)) return;
  await putDocs([{ kind: 'txns', key: month, data: { rows: rows.filter(t => t.id !== id) } }]);
}

// ───────────── linking ─────────────

/** Link a card receipt to its bank row and give the row the receipt's category (kept by the bank sync, like a hand pick). */
export async function linkReceipt(r: Receipt, txn: Txn, by: 'auto' | 'hand'): Promise<Receipt> {
  const next: Receipt = { ...r, txnId: txn.id, txnMonth: txn.date.slice(0, 7), matchedAt: new Date().toISOString(), matchedBy: by };
  await saveReceipt(next);
  if (txn.category !== r.category || txn.source !== 'manual') await recategorize({ [txn.date.slice(0, 7)]: [{ ...txn }] }, new Set([txn.id]), r.category);
  return next;
}
export async function unlinkReceipt(r: Receipt): Promise<Receipt> {
  const next: Receipt = { ...r };
  delete next.txnId; delete next.txnMonth; delete next.matchedAt; delete next.matchedBy;
  await saveReceipt(next);
  return next;
}

/** A new category for a receipt, and for its row (bank or cash). */
export async function setReceiptCategory(r: Receipt, category: string): Promise<Receipt> {
  const next = { ...r, category };
  await saveReceipt(next);
  if (r.txnId && r.txnMonth) await recategorize({ [r.txnMonth]: [{ id: r.txnId } as Txn] }, new Set([r.txnId]), category);
  return next;
}

/** Remove a receipt, its photos, and (for cash) the row it made. */
export async function removeReceipt(r: Receipt): Promise<void> {
  await putDocs([{ kind: 'receipt', key: receiptKey(r), data: null }, ...Array.from({ length: r.photos }, (_, i) => ({ kind: 'receiptimg', key: photoKey(r.id, i), data: null }))]);
  if (r.payment === 'cash' && r.txnId && r.txnMonth) await removeCashRow(r.txnId, r.txnMonth);
}

/** The bank rows a receipt could match right now (for the "which one?" list). */
export async function candidatesFor(r: Receipt, others: Receipt[]): Promise<Candidate[]> {
  const from = shiftDay(r.date, -2), to = shiftDay(r.date, 7);
  const [accounts, raw] = await Promise.all([loadAccounts(), loadMonths(from.slice(0, 7), to.slice(0, 7))]);
  const rows = Object.values(visibleMonths(raw, accounts)).flat();
  const taken = new Set(others.filter(o => o.id !== r.id && o.txnId).map(o => o.txnId!));
  // another currency: the bank's amount is converted, so look by the store's name instead of the amount
  return foreignCurrency(r) ? looseCandidates(r, rows, taken) : matchCandidates(r, rows, accounts, taken);
}

/** Link every waiting card receipt (last 75 days) whose bank row has come in and is a clear match. Run when the money
 *  screens open: bank rows arrive later than receipts (the daily bank sync, or an import). */
export async function matchPending(): Promise<{ linked: Receipt[]; waiting: number }> {
  const since = shiftDay(todayIso(), -75);
  const all = await loadReceipts(since);
  const pending = all.filter(awaitingMatch).sort((a, b) => a.date.localeCompare(b.date));
  if (!pending.length) return { linked: [], waiting: 0 };
  const from = shiftDay(pending[0].date, -3), to = shiftDay(pending[pending.length - 1].date, 7);
  const [accounts, raw] = await Promise.all([loadAccounts(), loadMonths(from.slice(0, 7), to.slice(0, 7))]);
  const rows = Object.values(visibleMonths(raw, accounts)).flat();
  const taken = new Set(all.filter(r => r.txnId).map(r => r.txnId!));
  const linked: Receipt[] = [];
  for (const r of pending) {
    const pick = pickMatch(r, rows, accounts, taken);   // the same rules as receipts from email (mailReceipts.ts)
    if (!pick) continue;
    taken.add(pick.txn.id);
    linked.push(await linkReceipt(r, pick.txn, 'auto'));
  }
  return { linked, waiting: pending.length - linked.length };
}
