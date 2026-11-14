// src/planner/features/money/ReceiptSheet.tsx — one receipt: its photos, what it says, where the money went, and the
// bank charge it matched (or the cash row it made). From here a waiting receipt is matched by hand, a card receipt that
// was really cash is moved to the cash wallet, the category is changed (the matched charge follows), or it's removed.
import { useEffect, useState } from 'react';
import { Banknote, Link2, Link2Off, Mail, Trash2 } from 'lucide-react';
import { Button, Sheet, useToast } from '../../ui/primitives';
import { SPENDING_CATEGORIES } from './categories';
import { CategoryIcon } from './CategoryIcon';
import { dayLabel, loadMonths, money, niceName } from './lib';
import { addCashRow, candidatesFor, linkReceipt, loadReceiptPhotos, removeReceipt, saveReceipt, setReceiptCategory, splitByCategory, unlinkReceipt, type Candidate } from './receipts';
import { mailboxName, receiptTotal } from './mailReceipts';
import { foreignCurrency } from './receiptMatch';
import type { Account, Receipt, Txn } from './types';

export function receiptStatus(r: Receipt): { label: string; tone: 'good' | 'amber' | 'muted' } {
  if (r.payment === 'cash') return { label: 'Cash', tone: 'muted' };
  if (r.txnId) return { label: 'Matched', tone: 'good' };
  if (r.ignored) return { label: r.ignored === 'company' ? 'Company card' : 'Not a receipt', tone: 'muted' };
  if (r.from === 'email') return { label: 'Not matched', tone: 'amber' };
  return { label: 'Waiting for the bank', tone: 'amber' };
}

export function ReceiptSheet({ receipt, others, accounts, onClose, onChange }: {
  receipt: Receipt | null; others: Receipt[]; accounts: Account[];
  onClose: () => void;
  /** The receipt after a change (null once removed). */
  onChange: (next: Receipt | null, before: Receipt) => void;
}) {
  const [photos, setPhotos] = useState<string[] | null>(null);
  const [cands, setCands] = useState<Candidate[] | null>(null);
  const [matched, setMatched] = useState<Txn | null>(null);
  const [busy, setBusy] = useState(false);
  const [sure, setSure] = useState(false);
  const [toast, say] = useToast();
  const r = receipt;
  const accName = (id: string) => accounts.find(a => a.id === id)?.name || 'Bank';

  useEffect(() => {
    setPhotos(null); setCands(null); setMatched(null); setSure(false);
    if (!r) return;
    let on = true;
    if (r.photos) loadReceiptPhotos(r.id).then(p => on && setPhotos(p)).catch(() => on && setPhotos([]));
    else setPhotos([]);
    if (r.payment === 'card' && !r.txnId) candidatesFor(r, others).then(c => on && setCands(c)).catch(() => on && setCands([]));
    if (r.txnId && r.txnMonth) loadMonths(r.txnMonth, r.txnMonth).then(m => on && setMatched((m[r.txnMonth!] || []).find(t => t.id === r.txnId) || null)).catch(() => undefined);
    return () => { on = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [r?.id, r?.txnId, r?.payment]);

  async function run(fn: () => Promise<Receipt | null>, msg: string) {
    if (!r) return;
    setBusy(true);
    try { const next = await fn(); onChange(next, r); say(msg, 'good'); }
    catch (e) { say(e instanceof Error ? e.message : 'Could not save', 'bad'); }
    finally { setBusy(false); }
  }
  const toCash = () => run(async () => {
    const row = await addCashRow({ date: r!.date, desc: r!.merchant, amount: r!.total, category: r!.category, note: r!.note });
    const next: Receipt = { ...r!, payment: 'cash', txnId: row.id, txnMonth: row.date.slice(0, 7), matchedAt: new Date().toISOString(), matchedBy: 'cash' };
    await saveReceipt(next);
    return next;
  }, 'Moved to the cash wallet');

  const split = r ? splitByCategory(r) : [];

  return (
    <Sheet open={!!r} onClose={onClose} title={r ? niceName(r.merchant.toUpperCase()) : ''}>
      {r && (
        <>
          <p className="pl-muted" style={{ fontSize: 13 }}>
            {dayLabel(r.date)}{r.time ? ` · ${r.time}` : ''} · <b style={{ color: 'var(--ink)' }}>{receiptTotal(r)}</b>
            {r.tax ? ` · tax ${money(r.tax)}` : ''}{r.tip ? ` · tip ${money(r.tip)}` : ''} · {r.payment === 'cash' ? 'cash' : r.paidBy === 'etransfer' ? `e-transfer${r.payee ? ` to ${r.payee}` : ''}` : r.paidBy === 'paypal' ? 'PayPal' : `card${r.cardLast4 ? ` ····${r.cardLast4}` : ''}`}
          </p>
          {r.email && (
            <p className="pl-muted" style={{ fontSize: 12, display: 'flex', alignItems: 'center', gap: 6 }}>
              <Mail style={{ width: 14, height: 14, flex: 'none', color: 'var(--accent)' }} />
              <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{mailboxName(r.email.mailbox)} · {r.email.subject}</span>
            </p>
          )}
          {foreignCurrency(r) && !r.txnId && <p className="mo-rcpt-warn">Paid in {r.currency!.toUpperCase()}: the bank’s charge is in dollars, so pick it by hand.</p>}

          {photos === null ? <p className="pl-muted" style={{ fontSize: 13 }}>Loading the photo…</p> : photos.length > 0 && (
            <div className="mo-rcpt-photos">{photos.map((p, i) => <img key={i} src={p} alt={`Receipt photo ${i + 1}`} />)}</div>
          )}

          <label className="pl-row" style={{ gap: 8 }}>
            <CategoryIcon name={r.category} size={18} />
            <select className="pl-input pl-grow" style={{ minHeight: 40 }} value={r.category} disabled={busy}
              onChange={e => void run(() => setReceiptCategory(r, e.target.value), r.txnId ? `${e.target.value} · the charge too` : e.target.value)}>
              {SPENDING_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </label>
          {split.length > 1 && (
            <p className="pl-muted" style={{ fontSize: 13 }}>Split: {split.map(s => `${s.category} ${money(s.amount)}`).join(' · ')}</p>
          )}
          {r.items.length > 0 && (
            <details className="mo-rcpt-lines">
              <summary>{r.items.length} line{r.items.length === 1 ? '' : 's'}</summary>
              {r.items.map((i, n) => <div key={n} className="mo-rcpt-line"><span className="pl-grow">{i.name}</span><small className="pl-muted">{i.category}</small><span className="mo-amt">{money(i.amount)}</span></div>)}
            </details>
          )}
          {r.note && <p style={{ fontSize: 14 }}>{r.note}</p>}

          <div className="mo-rcpt-match">
            {r.payment === 'cash' ? (
              <p><Banknote /> In the cash wallet, counted as {r.category}.</p>
            ) : r.txnId ? (
              <>
                <p><Link2 /> Matched{matched ? `: ${accName(matched.accountId)} · ${dayLabel(matched.date)} · ${money(Math.abs(matched.amount))}` : ''}{r.matchedBy === 'auto' ? ' (automatically)' : ''}</p>
                <Button small ghost disabled={busy} onClick={() => void run(() => unlinkReceipt(r), 'Unmatched')}><Link2Off style={{ width: 16, height: 16 }} /> Not this charge</Button>
              </>
            ) : cands === null ? <p className="pl-muted">Looking for the charge…</p> : cands.length === 0 ? (
              <>
                <p className="pl-muted">No matching charge yet. Card charges can take a few days; it matches by itself when the bank's row comes in.</p>
                <Button small ghost disabled={busy} onClick={() => void toCash()}><Banknote style={{ width: 16, height: 16 }} /> I paid cash</Button>
              </>
            ) : (
              <>
                <p><b>Which charge is it?</b></p>
                <div className="pl-list">
                  {cands.slice(0, 5).map(c => (
                    <div key={c.txn.id} className="mo-txn">
                      <div className="mo-txn__main"><b>{niceName(c.txn.merchant)}</b><small>{accName(c.txn.accountId)} · {dayLabel(c.txn.date)}{c.exact ? '' : foreignCurrency(r) ? ' · converted' : ' · with a tip'}</small></div>
                      <span className="mo-amt">{money(c.txn.amount)}</span>
                      <Button small primary disabled={busy} onClick={() => void run(() => linkReceipt(r, c.txn, 'hand'), `Matched · ${r.category}`)}>This one</Button>
                    </div>
                  ))}
                </div>
                <Button small ghost disabled={busy} onClick={() => void toCash()}><Banknote style={{ width: 16, height: 16 }} /> None, I paid cash</Button>
              </>
            )}
          </div>

          <Button block ghost danger disabled={busy} onClick={() => { if (!sure) { setSure(true); return; } void run(async () => { await removeReceipt(r); return null; }, 'Receipt removed'); }}>
            <Trash2 style={{ width: 16, height: 16 }} /> {sure ? (r.payment === 'cash' ? 'Tap again: remove it and its cash row' : 'Tap again to remove') : 'Remove receipt'}
          </Button>
        </>
      )}
      {toast}
    </Sheet>
  );
}
