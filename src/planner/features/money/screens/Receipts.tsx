// /money/receipts — every receipt and payment screenshot, newest first, with where each one stands: matched to its card
// charge, waiting for the bank, or cash. Opening the screen first matches any waiting receipt whose charge has come in.
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Banknote, Camera, Receipt as ReceiptIcon } from 'lucide-react';
import { Card, Empty, Header, Page, useToast } from '../../../ui/primitives';
import { CategoryIcon } from '../CategoryIcon';
import { dayLabel, money, monthKey, monthLabel, niceName, shiftMonth } from '../lib';
import { useMoney } from '../useMoney';
import { loadReceipts, matchPending } from '../receipts';
import { ReceiptSheet, receiptStatus } from '../ReceiptSheet';
import type { Receipt } from '../types';

export function Receipts() {
  const { accounts } = useMoney('0000', '0000');
  const [list, setList] = useState<Receipt[] | null>(null);
  const [open, setOpen] = useState<Receipt | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [toast, say] = useToast();

  useEffect(() => {
    let on = true;
    void (async () => {
      try {
        const res = await matchPending().catch(() => ({ linked: [] as Receipt[], waiting: 0 }));
        if (on && res.linked.length) say(`${res.linked.length} receipt${res.linked.length === 1 ? '' : 's'} matched to the bank`, 'good');
        const rs = await loadReceipts(shiftMonth(monthKey(), -24));
        if (on) setList(rs);
      } catch (e) { if (on) { setError(e instanceof Error ? e.message : 'Could not load'); setList([]); } }
    })();
    return () => { on = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const months = useMemo(() => {
    const out: { m: string; rows: Receipt[]; total: number }[] = [];
    for (const r of list || []) {
      const m = r.date.slice(0, 7);
      let g = out[out.length - 1];
      if (!g || g.m !== m) { g = { m, rows: [], total: 0 }; out.push(g); }
      g.rows.push(r); g.total += r.total;
    }
    return out;
  }, [list]);
  const waiting = (list || []).filter(r => r.payment === 'card' && !r.txnId).length;

  return (
    <Page>
      <Header title="Receipts" eyebrow="Money" back="/money" />
      <div className="mo-quick">
        <Link to="/money/receipt" className="pl-btn"><Camera /> Receipt</Link>
        <Link to="/money/cash" className="pl-btn"><Banknote /> Cash</Link>
      </div>
      {error && <p className="pl-error">{error}</p>}
      {waiting > 0 && <p className="pl-muted" style={{ fontSize: 13 }}>{waiting} waiting for the bank: they match by themselves when the charges come in, or tap one to pick.</p>}
      {list && list.length === 0 ? (
        <Card><Empty icon={<ReceiptIcon />} title="No receipts yet" blurb="Snap a receipt or a payment screenshot: the store, total and what was bought are read for you, and the card charge gets a better category." /></Card>
      ) : !list ? <p className="pl-muted">Loading…</p> : months.map(g => (
        <Card key={g.m}>
          <div className="mo-day"><span>{monthLabel(g.m)}</span><span>{money(g.total)}</span></div>
          <div className="pl-list">
            {g.rows.map(r => {
              const s = receiptStatus(r);
              return (
                <button key={r.id} type="button" className="mo-txn mo-rcpt-row" onClick={() => setOpen(r)}>
                  <CategoryIcon name={r.category} size={20} />
                  <div className="mo-txn__main">
                    <b>{niceName(r.merchant.toUpperCase())}</b>
                    <small>{dayLabel(r.date)} · {r.category}</small>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
                    <span className="mo-amt">{money(r.total)}</span>
                    <span className={`mo-status mo-status--${s.tone}`}>{s.label}</span>
                  </div>
                </button>
              );
            })}
          </div>
        </Card>
      ))}
      <ReceiptSheet receipt={open} others={list || []} accounts={accounts} onClose={() => setOpen(null)}
        onChange={(next, before) => {
          setList(l => {
            const rest = (l || []).filter(x => x.id !== before.id);
            return next ? [...rest, next].sort((a, b) => b.date.localeCompare(a.date) || b.addedAt.localeCompare(a.addedAt)) : rest;
          });
          setOpen(next);
          if (!next) say('Receipt removed', 'good');
        }} />
      {toast}
    </Page>
  );
}
