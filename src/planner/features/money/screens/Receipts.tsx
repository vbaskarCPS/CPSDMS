// /money/receipts — every receipt and payment screenshot, newest first, with where each one stands: matched to its card
// charge, waiting for the bank, or cash. Opening the screen first matches any waiting receipt whose charge has come in.
// "From your email" finds purchase emails in the person's connected mailboxes (mailReceipts.ts) and matches them to the
// bank; the ones that don't match wait in "Not matched", to be matched by hand or put aside (company card, not a receipt).
// Emails that add up to one card charge can be matched together (suggested, or picked with "Combine"); a company card
// is remembered by its last four digits; emails older than the card's rows in the planner aren't listed (receiptGroups.ts).
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Banknote, Camera, Layers, Mail, Receipt as ReceiptIcon } from 'lucide-react';
import { Button, Card, Empty, Header, Page, useToast } from '../../../ui/primitives';
import { mailboxes as loadMailboxes, type Mailbox } from '../../mail/mail';
import { CategoryIcon } from '../CategoryIcon';
import { dayLabel, money, monthKey, monthLabel, niceName, shiftMonth } from '../lib';
import { useMoney } from '../useMoney';
import { loadReceipts, matchPending } from '../receipts';
import { ReceiptSheet, receiptStatus } from '../ReceiptSheet';
import { payeeLabel } from '../receiptMatch';
import { emailLists, hiddenEmailReceipts, isEmailReceipt, listedReceipts, loadMatchContext, mailboxName, markCompany, matchEmailReceipts, matchGroup, receiptTotal, scanEmail, ScanStopped, setIgnored, unmarkCompany, type MatchContext, type ScanProgress } from '../mailReceipts';
import { chargesFor, suggestGroups } from '../receiptGroups';
import type { Receipt, Txn } from '../types';

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
  const [ctx, setCtx] = useState<MatchContext | null>(null);          // the bank's rows, for groups and card history
  const [combine, setCombine] = useState(false);                      // ticking emails to match as one charge
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [skipped, setSkipped] = useState<Set<string>>(new Set());     // suggestions answered "Not these" (this visit)

  useEffect(() => {
    let on = true;
    loadMailboxes().then(r => on && setBoxes(r.mailboxes)).catch(() => on && setBoxes([]));
    return () => { on = false; };
  }, []);

  async function findInEmail() {
    setScanning(true); setScan(null); setScanNote(null);
    try {
      const p = await scanEmail(setScan);
      const fresh = await loadMatchContext().catch(() => ctx);
      if (fresh) setCtx(fresh);
      const res = await matchEmailReceipts(fresh || undefined);
      setList(await loadReceipts(shiftMonth(monthKey(), -24)));
      const bad = p.mailboxes.filter(m => m.problem);
      setScanNote(`${p.found ? `${p.found} receipt${p.found === 1 ? '' : 's'} found` : 'No new receipts'} · ${res.linked.length} matched to the bank${res.waiting ? ` · ${res.waiting} not matched` : ''}`
        + (bad.length ? `. ${bad.map(m => `${mailboxName(m.address)}: ${m.problem}`).join(' · ')}` : ''));
    } catch (e) {
      // stopped part-way: what was read is saved, so match that much and show it
      if (e instanceof ScanStopped) { await matchEmailReceipts().catch(() => undefined); setList(await loadReceipts(shiftMonth(monthKey(), -24)).catch(() => list ?? [])); }
      setScanNote(e instanceof Error ? e.message : 'Email couldn’t be read. Try again.');
    }
    finally { setScanning(false); }
  }
  async function ignore(r: Receipt, why: Receipt['ignored'] | null) {
    setBusyId(r.id);
    try {
      const all = list || [];
      // "Company card" remembers the card by its last four digits and takes its other receipts along; Undo brings them back
      const res = why === 'company' ? await markCompany(r, all, accounts)
        : !why && r.ignored === 'company' ? await unmarkCompany(r, all, accounts)
        : { changed: [await setIgnored(r, why)], card: null };
      const by = new Map(res.changed.map(x => [x.id, x]));
      setList(l => (l || []).map(x => by.get(x.id) || x));
      const more = res.changed.length - 1;
      say(why === 'company' ? (res.card ? `Company card ····${res.card}${more > 0 ? `: ${more} more put aside` : ' remembered'}` : 'Hidden: company card')
        : why ? 'Hidden: not a receipt'
        : res.card ? `····${res.card} is no longer a company card${more > 0 ? `: ${more + 1} back in Not matched` : ''}` : 'Back in Not matched', 'good');
    } catch (e) { say(e instanceof Error ? e.message : 'Could not save', 'bad'); }
    finally { setBusyId(null); }
  }
  /** Several emails that are one card charge: link them all to it. */
  async function matchTogether(rs: Receipt[], txn: Txn) {
    setBusyId(txn.id);
    try {
      const next = await matchGroup(rs, txn);
      const by = new Map(next.map(x => [x.id, x]));
      setList(l => (l || []).map(x => by.get(x.id) || x));
      setPicked(new Set()); setCombine(false);
      say(`${next.length} emails matched to the ${money(Math.abs(txn.amount))} charge`, 'good');
    } catch (e) { say(e instanceof Error ? e.message : 'Could not save', 'bad'); }
    finally { setBusyId(null); }
  }

  useEffect(() => {
    let on = true;
    void (async () => {
      try {
        const res = await matchPending().catch(() => ({ linked: [] as Receipt[], waiting: 0 }));
        // the bank's rows (for groups and how far back each card goes), then the email receipts: company cards put
        // aside, clear matches linked
        const c = await loadMatchContext().catch(() => null);
        if (on && c) setCtx(c);
        const mail = c ? await matchEmailReceipts(c).catch(() => ({ linked: [] as Receipt[], waiting: 0, company: 0 })) : { linked: [] as Receipt[], waiting: 0, company: 0 };
        const matched = res.linked.length + mail.linked.length;
        if (on && (matched || mail.company)) say([matched ? `${matched} receipt${matched === 1 ? '' : 's'} matched to the bank` : '', mail.company ? `${mail.company} on a company card put aside` : ''].filter(Boolean).join(' · '), 'good');
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
  const lists = useMemo(() => emailLists(list || [], ctx?.history || []), [list, ctx]);
  const unmatched = lists.unmatched;
  const hidden = useMemo(() => hiddenEmailReceipts(list || []), [list]);
  const taken = useMemo(() => new Set((list || []).filter(r => r.txnId).map(r => r.txnId!)), [list]);
  // emails that add up to one charge (orders billed together), and the charges for a group ticked by hand
  const groups = useMemo(() => (ctx ? suggestGroups(unmatched, ctx.rows, taken).filter(g => !skipped.has(g.txn.id)) : []), [ctx, unmatched, taken, skipped]);
  const chosen = useMemo(() => unmatched.filter(r => picked.has(r.id)), [unmatched, picked]);
  const charges = useMemo(() => (ctx && chosen.length >= 2 ? chargesFor(chosen, ctx.rows, taken) : []), [ctx, chosen, taken]);
  const accName = (id: string) => accounts.find(a => a.id === id)?.name || 'Bank';
  const olderFrom = lists.older.length ? [...new Map(lists.older.map(o => [o.account.id, o.account])).values()] : [];
  const tick = (id: string) => setPicked(p => { const n = new Set(p); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const noBox = boxes !== null && boxes.length === 0;
  const emailRow = (r: Receipt, isHidden: boolean) => (
    <div key={r.id} className="mo-mailrcpt">
      <div className="mo-txn">
        <Mail className="mo-mailicon" aria-label="From email" />
        <div className="mo-txn__main">
          <b>{niceName(r.merchant.toUpperCase())}</b>
          <small>{dayLabel(r.date)}{r.paidBy === 'etransfer' && r.payee ? ` · to ${payeeLabel(r.payee)}` : ''}{r.cardLast4 ? ` · card ····${r.cardLast4}` : ''}{r.email?.mailbox ? ` · ${mailboxName(r.email.mailbox)}` : ''}</small>
          {r.email?.subject && <small className="mo-mailrcpt__subj">{r.email.subject}</small>}
        </div>
        <span className="mo-amt">{receiptTotal(r)}</span>
      </div>
      <div className="mo-mailrcpt__acts">
        {isHidden ? (
          <>
            <span className="mo-status mo-status--muted">{r.ignored === 'company' ? `Company card${r.cardLast4 ? ` ····${r.cardLast4}` : ''}` : 'Not a receipt'}</span>
            <Button small ghost disabled={busyId === r.id} onClick={() => void ignore(r, null)}>Undo</Button>
          </>
        ) : combine ? (
          <label className="pl-row" style={{ gap: 8, fontSize: 13 }}>
            <input type="checkbox" checked={picked.has(r.id)} onChange={() => tick(r.id)} style={{ width: 20, height: 20 }} /> Part of the charge
          </label>
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
        {groups.length > 0 && (
          <>
            <div className="mo-day" style={{ marginTop: 12 }}><span>Add up to one charge ({groups.length})</span></div>
            <div className="pl-list">
              {groups.map(g => (
                <div key={g.txn.id} className="mo-mailrcpt">
                  <div className="mo-txn">
                    <Layers className="mo-mailicon" aria-hidden />
                    <div className="mo-txn__main">
                      <b>{niceName(g.txn.merchant)} · {money(Math.abs(g.txn.amount))}</b>
                      <small>Charged {dayLabel(g.txn.date)} · {accName(g.txn.accountId)} · {g.receipts.length} emails add up to it</small>
                      {g.receipts.map(r => <small key={r.id} className="mo-mailrcpt__subj">{dayLabel(r.date)} · {receiptTotal(r)} · {r.email?.subject || niceName(r.merchant.toUpperCase())}</small>)}
                    </div>
                  </div>
                  <div className="mo-mailrcpt__acts">
                    <Button small ghost disabled={busyId === g.txn.id} onClick={() => setSkipped(x => new Set(x).add(g.txn.id))}>Not these</Button>
                    <Button small primary disabled={busyId === g.txn.id} onClick={() => void matchTogether(g.receipts, g.txn)}>Match together</Button>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
        {(unmatched.length > 0 || hidden.length > 0) && (
          <>
            <div className="mo-day" style={{ marginTop: 12 }}><span>Not matched ({unmatched.length})</span>
              <span style={{ display: 'flex', gap: 12 }}>
                {unmatched.length > 1 && <button type="button" className="mo-linkbtn" onClick={() => { setCombine(v => !v); setPicked(new Set()); }}>{combine ? 'Done combining' : 'Combine'}</button>}
                {hidden.length > 0 && <button type="button" className="mo-linkbtn" onClick={() => setShowHidden(v => !v)}>{showHidden ? 'Hide hidden' : `Show hidden (${hidden.length})`}</button>}
              </span></div>
            {combine && (
              <div className="mo-rcpt-match" style={{ marginBottom: 8 }}>
                {chosen.length < 2 ? <p className="pl-muted">Tick the emails that were billed as one card charge (the charge usually posts a day later).</p> : (
                  <>
                    <p><b>{chosen.length} emails · {money(chosen.reduce((s, r) => s + r.total, 0))}</b>{charges.length ? ': which charge is it?' : ''}</p>
                    {charges.length === 0 ? <p className="pl-muted">No charge near that total from 2 days before to a week after. Tick or untick emails, or wait for the bank.</p> : (
                      <div className="pl-list">
                        {charges.map(c => (
                          <button key={c.txn.id} type="button" className="mo-txn mo-rcpt-row" disabled={busyId === c.txn.id} onClick={() => void matchTogether(chosen, c.txn)}>
                            <div className="mo-txn__main">
                              <b>{niceName(c.txn.merchant)}</b>
                              <small>{dayLabel(c.txn.date)} · {accName(c.txn.accountId)}</small>
                            </div>
                            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
                              <span className="mo-amt">{money(Math.abs(c.txn.amount))}</span>
                              <span className={`mo-status mo-status--${c.diff === 0 ? 'good' : 'amber'}`}>{c.diff === 0 ? 'Exact' : `${money(Math.abs(c.diff))} ${c.diff > 0 ? 'more' : 'less'}`}</span>
                            </div>
                          </button>
                        ))}
                      </div>
                    )}
                  </>
                )}
              </div>
            )}
            <div className="pl-list">{unmatched.map(r => emailRow(r, false))}</div>
            {showHidden && <div className="pl-list" style={{ opacity: 0.75 }}>{hidden.map(r => emailRow(r, true))}</div>}
          </>
        )}
        {lists.older.length > 0 && <p className="pl-muted" style={{ fontSize: 12, marginTop: 8 }}>{lists.older.length} older email{lists.older.length === 1 ? '' : 's'} not listed: from before {olderFrom.map(a => `${a.name} starts here (${dayLabel(a.first)})`).join(', ')}. They match if older statements are added.</p>}
        {lists.same.length > 0 && <p className="pl-muted" style={{ fontSize: 12, marginTop: 4 }}>{lists.same.length} not listed: the same purchase as another email (an order and its shipping emails).</p>}
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
