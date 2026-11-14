// /money/receipts — every receipt and payment screenshot, newest first, with where each one stands: matched to its card
// charge, waiting for the bank, or cash. Opening the screen first matches any waiting receipt whose charge has come in.
// "From your email" finds purchase emails in the person's connected mailboxes (mailReceipts.ts) and matches them to the
// bank; the ones that don't match wait in "Not matched", to be matched by hand or put aside (company card, not a receipt).
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Banknote, Camera, Mail, Receipt as ReceiptIcon } from 'lucide-react';
import { Button, Card, Empty, Header, Page, useToast } from '../../../ui/primitives';
import { mailboxes as loadMailboxes, type Mailbox } from '../../mail/mail';
import { CategoryIcon } from '../CategoryIcon';
import { dayLabel, money, monthKey, monthLabel, niceName, shiftMonth } from '../lib';
import { useMoney } from '../useMoney';
import { loadReceipts, matchPending } from '../receipts';
import { ReceiptSheet, receiptStatus } from '../ReceiptSheet';
import { hiddenEmailReceipts, isEmailReceipt, listedReceipts, mailboxName, matchEmailReceipts, receiptTotal, scanEmail, setIgnored, unmatchedEmailReceipts, type ScanProgress } from '../mailReceipts';
import type { Receipt } from '../types';

export function Receipts() {
  const { accounts } = useMoney('0000', '0000');
  const [list, setList] = useState<Receipt[] | null>(null);
  const [open, setOpen] = useState<Receipt | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [toast, say] = useToast();
  const [boxes, setBoxes] = useState<Mailbox[] | null>(null);
  const [scan, setScan] = useState<ScanProgress | null>(null);
  const [scanning, setScanning] = useState(false);
  const [scanNote, setScanNote] = useState<string | null>(null);
  const [showHidden, setShowHidden] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    let on = true;
    loadMailboxes().then(r => on && setBoxes(r.mailboxes)).catch(() => on && setBoxes([]));
    return () => { on = false; };
  }, []);

  async function findInEmail() {
    setScanning(true); setScan(null); setScanNote(null);
    try {
      const p = await scanEmail(setScan);
      const res = await matchEmailReceipts();
      setList(await loadReceipts(shiftMonth(monthKey(), -24)));
      const bad = p.mailboxes.filter(m => m.problem);
      setScanNote(`${p.found ? `${p.found} receipt${p.found === 1 ? '' : 's'} found` : 'No new receipts'} · ${res.linked.length} matched to the bank${res.waiting ? ` · ${res.waiting} not matched` : ''}`
        + (bad.length ? `. ${bad.map(m => `${mailboxName(m.address)}: ${m.problem}`).join(' · ')}` : ''));
    } catch (e) { setScanNote(e instanceof Error ? e.message : 'Email couldn’t be read. Try again.'); }
    finally { setScanning(false); }
  }
  async function ignore(r: Receipt, why: Receipt['ignored'] | null) {
    setBusyId(r.id);
    try {
      const next = await setIgnored(r, why);
      setList(l => (l || []).map(x => (x.id === r.id ? next : x)));
      say(why === 'company' ? 'Hidden: company card' : why ? 'Hidden: not a receipt' : 'Back in Not matched', 'good');
    } catch (e) { say(e instanceof Error ? e.message : 'Could not save', 'bad'); }
    finally { setBusyId(null); }
  }

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
    for (const r of listedReceipts(list || [])) {
      const m = r.date.slice(0, 7);
      let g = out[out.length - 1];
      if (!g || g.m !== m) { g = { m, rows: [], total: 0 }; out.push(g); }
      g.rows.push(r); g.total += r.total;
    }
    return out;
  }, [list]);
  const waiting = listedReceipts(list || []).filter(r => r.payment === 'card' && !r.txnId).length;
  const unmatched = useMemo(() => unmatchedEmailReceipts(list || []), [list]);
  const hidden = useMemo(() => hiddenEmailReceipts(list || []), [list]);
  const noBox = boxes !== null && boxes.length === 0;
  const emailRow = (r: Receipt, isHidden: boolean) => (
    <div key={r.id} className="mo-mailrcpt">
      <div className="mo-txn">
        <Mail className="mo-mailicon" aria-label="From email" />
        <div className="mo-txn__main">
          <b>{niceName(r.merchant.toUpperCase())}</b>
          <small>{dayLabel(r.date)}{r.paidBy === 'etransfer' && r.payee ? ` · to ${r.payee}` : ''}{r.email?.mailbox ? ` · ${mailboxName(r.email.mailbox)}` : ''}</small>
          {r.email?.subject && <small className="mo-mailrcpt__subj">{r.email.subject}</small>}
        </div>
        <span className="mo-amt">{receiptTotal(r)}</span>
      </div>
      <div className="mo-mailrcpt__acts">
        {isHidden ? (
          <>
            <span className="mo-status mo-status--muted">{r.ignored === 'company' ? 'Company card' : 'Not a receipt'}</span>
            <Button small ghost disabled={busyId === r.id} onClick={() => void ignore(r, null)}>Undo</Button>
          </>
        ) : (
          <>
            <Button small ghost disabled={busyId === r.id} onClick={() => void ignore(r, 'company')}>Company card</Button>
            <Button small ghost disabled={busyId === r.id} onClick={() => void ignore(r, 'not_receipt')}>Not a receipt</Button>
            <Button small primary disabled={busyId === r.id} onClick={() => setOpen(r)}>Match…</Button>
          </>
        )}
      </div>
    </div>
  );

  return (
    <Page>
      <Header title="Receipts" eyebrow="Money" back="/money" />
      <div className="mo-quick">
        <Link to="/money/receipt" className="pl-btn"><Camera /> Receipt</Link>
        <Link to="/money/cash" className="pl-btn"><Banknote /> Cash</Link>
      </div>
      {error && <p className="pl-error">{error}</p>}
      {waiting > 0 && <p className="pl-muted" style={{ fontSize: 13 }}>{waiting} waiting for the bank: they match by themselves when the charges come in, or tap one to pick.</p>}
      <Card>
        <p className="pl-eyebrow">From your email</p>
        <p className="pl-muted" style={{ fontSize: 13, marginTop: 4 }}>Order confirmations, receipts and e-transfers in your connected mailboxes, matched to the bank.</p>
        <div style={{ marginTop: 10 }}>
          <Button primary disabled={scanning || noBox || boxes === null} onClick={() => void findInEmail()}><Mail style={{ width: 16, height: 16 }} /> {scanning ? 'Looking…' : 'Find receipts in email'}</Button>
        </div>
        {noBox && <p className="pl-muted" style={{ fontSize: 13, marginTop: 8 }}>Connect a mailbox first in <Link to="/settings/mail">Settings › Email</Link>.</p>}
        {scanning && <p className="pl-muted" style={{ fontSize: 13, marginTop: 8 }}>{scan ? `Read ${scan.scanned} emails · ${scan.found} receipts` : 'Opening your mailboxes…'}{scan?.mailboxes.filter(m => m.problem).map(m => ` · ${mailboxName(m.address)}: ${m.problem}`).join('')}</p>}
        {!scanning && scanNote && <p style={{ fontSize: 13, marginTop: 8 }}>{scanNote}</p>}
        {(unmatched.length > 0 || hidden.length > 0) && (
          <>
            <div className="mo-day" style={{ marginTop: 12 }}><span>Not matched ({unmatched.length})</span>
              {hidden.length > 0 && <button type="button" className="mo-linkbtn" onClick={() => setShowHidden(v => !v)}>{showHidden ? 'Hide hidden' : `Show hidden (${hidden.length})`}</button>}</div>
            <div className="pl-list">{unmatched.map(r => emailRow(r, false))}</div>
            {showHidden && <div className="pl-list" style={{ opacity: 0.75 }}>{hidden.map(r => emailRow(r, true))}</div>}
          </>
        )}
      </Card>
      {list && listedReceipts(list).length === 0 ? (
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
                    <small>{isEmailReceipt(r) && <Mail className="mo-mailicon mo-mailicon--sm" aria-label="From email" />}{dayLabel(r.date)} · {r.category}</small>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
                    <span className="mo-amt">{receiptTotal(r)}</span>
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
