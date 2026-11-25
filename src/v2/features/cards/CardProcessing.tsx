// src/v2/features/cards/CardProcessing.tsx — Card Processing: take a card over the phone for a spring or fall booking.
//   Process a card   the customer, where the work is, what they bought, and the card (typed into Bambora's own
//                    fields: the number never touches this app). The price typed is what is charged, tax included.
//   History          every attempt, by anyone: who sold what to whom, what was charged, and what Bambora answered
//   Receipt email    the one receipt every customer gets (a super admin edits it)
// For managers with the Card Processing permission. Nothing here writes to Master Bookings yet.
import React, { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { CheckCircle2, CircleHelp, CreditCard, Download, Mail, Plus, Save, Send, Trash2 } from 'lucide-react';
import { useLoad } from '../../lib/data';
import { CardIntroModal } from './CardIntro';
import { useAuth } from '../../lib/auth';
import { Btn, Card, ErrorBox, Field, Loading, Modal, Tabs, Tag } from '../../ui';
import {
  blankItem, cardOf, cardSales, chargeCard, customerName, isoDay, itemsToInput, newChargeKey, receiptTemplate, resendReceipt, salesCsv, saveReceiptTemplate,
  searchSales, seasonOptions, sendTestReceipt, serviceOptions, STATUS_LABEL, STATUS_TONE, type CardSale, type ChargeAnswer, type ItemDraft, type SaleStatus,
} from '../../lib/cardSales';
import {
  addressLine, cardName, checkSale, EMAIL_RE, itemLine, money, pct, PROVINCES, renderReceipt, sampleReceipt, type ReceiptTemplate, type Sale,
} from '../../../../supabase/functions/card-sale/sale';

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));
const when = (iso: string) => new Date(iso).toLocaleString('en-CA', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'America/Toronto' });

// ───────────── Bambora's card fields ─────────────
// The card number, expiry and CVV are typed into frames Bambora serves. All this app ever holds is a one-time token.
interface CardFieldsHandle { token: () => Promise<string> }
type FieldsState = 'loading' | 'ready' | 'failed';
interface Checkout { create: (kind: string, opts: unknown) => { mount: (sel: string) => void; unmount?: () => void }; createToken: (cb: (r: { token?: string; error?: { message?: string } }) => void) => void }
const SCRIPT_ID = 'bambora-checkout-script';
const SCRIPT_SRC = 'https://libs.na.bambora.com/customcheckout/1/customcheckout.js';

const CardFields = forwardRef<CardFieldsHandle, { disabled?: boolean }>(({ disabled }, ref) => {
  const [state, setState] = useState<FieldsState>('loading');
  const checkout = useRef<Checkout | null>(null);
  const uid = useRef(`cf${Math.random().toString(36).slice(2, 8)}`).current;

  useEffect(() => {
    let live = true;
    const made: { unmount?: () => void }[] = [];
    const start = () => {
      if (!live) return;
      try {
        const make = (window as unknown as { customcheckout?: () => Checkout }).customcheckout;
        if (!make) throw new Error('no library');
        const c = make();
        const style = { base: { color: '#111827', fontSize: '16px', fontFamily: 'Helvetica, Arial, sans-serif', '::placeholder': { color: '#9ca3af' } }, complete: { color: '#047857' }, error: { color: '#b91c1c' } };
        ([['card-number', 'num', '0000 0000 0000 0000'], ['expiry', 'exp', 'MM / YY'], ['cvv', 'cvv', '123']] as const).forEach(([kind, slot, placeholder]) => {
          const el = c.create(kind, { style, placeholder });
          el.mount(`#${uid}-${slot}`);
          made.push(el);
        });
        checkout.current = c;
        setState('ready');
      } catch { setState('failed'); }
    };
    if ((window as unknown as { customcheckout?: unknown }).customcheckout) start();
    else {
      let s = document.getElementById(SCRIPT_ID) as HTMLScriptElement | null;
      if (!s) { s = document.createElement('script'); s.id = SCRIPT_ID; s.src = SCRIPT_SRC; document.head.appendChild(s); }
      const fail = () => { if (live) setState('failed'); };
      s.addEventListener('load', start); s.addEventListener('error', fail);
      const el = s;
      return () => { live = false; el.removeEventListener('load', start); el.removeEventListener('error', fail); made.forEach(m => { try { m.unmount?.(); } catch { /* already gone */ } }); };
    }
    return () => { live = false; made.forEach(m => { try { m.unmount?.(); } catch { /* already gone */ } }); };
  }, [uid]);

  useImperativeHandle(ref, () => ({
    token: () => new Promise<string>((resolve, reject) => {
      const c = checkout.current;
      if (!c) { reject(new Error('The card fields haven’t loaded. Check your connection and reload the page.')); return; }
      c.createToken(r => (r?.token ? resolve(r.token) : reject(new Error(r?.error?.message || 'Check the card number, expiry and CVV.'))));
    }),
  }), []);

  return (
    <div style={disabled ? { opacity: .55, pointerEvents: 'none' } : undefined}>
      {state === 'failed' && <div className="v2-err" style={{ marginBottom: 10 }}>The card fields couldn’t load. Check your connection and reload the page.</div>}
      <div className="v2-field"><span className="v2-label">Card number</span><div id={`${uid}-num`} className="v2-cardfield" /></div>
      <div className="v2-grid2">
        <div className="v2-field"><span className="v2-label">Expiry</span><div id={`${uid}-exp`} className="v2-cardfield" /></div>
        <div className="v2-field"><span className="v2-label">CVV</span><div id={`${uid}-cvv`} className="v2-cardfield" /></div>
      </div>
      <div className="v2-note" style={{ marginTop: 0 }}>{state === 'loading' ? 'Loading the secure card fields…' : 'Typed straight into Bambora. The card number is never saved here.'}</div>
    </div>
  );
});
CardFields.displayName = 'CardFields';

// ───────────── Process a card ─────────────
const BLANK = { first_name: '', last_name: '', phone: '', email: '', address: '', city: '', province: '', postal_code: '', notes: '' };

export const CardProcess: React.FC = () => {
  const { profile } = useAuth();
  const seasons = useMemo(() => seasonOptions(), []);
  const nextId = useRef(2);
  const [f, setF] = useState({ ...BLANK });
  const [items, setItems] = useState<ItemDraft[]>([blankItem(1, seasons[0].key)]);
  const [cardKey, setCardKey] = useState(0);          // a new one clears the card fields
  const fields = useRef<CardFieldsHandle>(null);
  const [tried, setTried] = useState(false);
  const [confirm, setConfirm] = useState<Sale | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [warn, setWarn] = useState<string | null>(null);
  const [done, setDone] = useState<{ answer: ChargeAnswer; sale: Sale } | null>(null);
  const [dup, setDup] = useState<{ info: NonNullable<ChargeAnswer['duplicate']>; key: string; token: string; sale: Sale } | null>(null);
  const [tour, setTour] = useState(false);

  const set = (k: keyof typeof BLANK) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setF(p => ({ ...p, [k]: e.target.value }));
  const setItem = (id: number, patch: Partial<ItemDraft>) => setItems(rows => rows.map(r => (r.id === id ? { ...r, ...patch } : r)));
  const input = { ...f, items: itemsToInput(items) };
  const checked = checkSale(input);
  const prov = PROVINCES.find(p => p.code === f.province);
  const runningTotal = items.reduce((s, r) => s + (Number(r.price.replace(/[$,\s]/g, '')) || 0), 0);

  const reset = () => { setF({ ...BLANK }); setItems([blankItem(nextId.current++, seasons[0].key)]); setCardKey(k => k + 1); setTried(false); setErr(null); setWarn(null); setDone(null); };

  const finish = (answer: ChargeAnswer, sale: Sale, key: string, token: string) => {
    if (answer.duplicate) { setDup({ info: answer.duplicate, key, token, sale }); return; }
    if (answer.approved) { setDone({ answer, sale }); return; }
    setCardKey(k => k + 1);    // a token works once: the card is typed again for another try
    if (answer.unsure || answer.pending) setWarn(answer.message || 'The charge didn’t finish. Check History before trying again.');
    else setErr(`Declined: ${answer.message || 'the card was declined'}. Nothing was charged. Enter the card again to retry, or try another card.`);
  };
  const charge = async (sale: Sale) => {
    setBusy(true); setErr(null); setWarn(null);
    try {
      const token = await fields.current!.token();
      const key = newChargeKey();
      finish(await chargeCard(key, token, input), sale, key, token);
    } catch (e) { setErr(errText(e)); }
    finally { setBusy(false); setConfirm(null); }
  };
  const chargeAgain = async () => {
    if (!dup) return;
    const d = dup;
    setBusy(true); setErr(null);
    try { finish(await chargeCard(d.key, d.token, input, true), d.sale, d.key, d.token); }
    catch (e) { setErr(errText(e)); setCardKey(k => k + 1); }
    finally { setBusy(false); setDup(null); }
  };

  if (done) {
    const a = done.answer, s = done.sale;
    return (
      <div className="v2-main v2-narrow">
        <Card style={{ maxWidth: 620, margin: '10px auto' }}>
          <div className="v2-row" style={{ gap: 12, marginBottom: 12 }}>
            <CheckCircle2 size={34} color="#059669" />
            <div><div style={{ fontSize: 20, fontWeight: 800 }}>Approved · {money(s.total)}</div>
              <div className="v2-mut">{customerName(s)} · {a.last4 ? `${cardName(a.cardType)} ending ${a.last4}` : 'Card'}</div></div>
          </div>
          <table className="v2-table"><tbody>
            {s.items.map((i, n) => <tr key={n}><td>{itemLine(i)}</td><td style={{ textAlign: 'right' }}>{money(i.price)}</td></tr>)}
            <tr><td className="v2-mut">Subtotal</td><td style={{ textAlign: 'right' }}>{money(s.subtotal)}</td></tr>
            <tr><td className="v2-mut">{s.tax_name} ({pct(s.tax_rate)})</td><td style={{ textAlign: 'right' }}>{money(s.tax_amount)}</td></tr>
            <tr><td><b>Total charged</b></td><td style={{ textAlign: 'right' }}><b>{money(s.total)}</b></td></tr>
          </tbody></table>
          <div className="v2-note">Approval code {a.authCode || '—'} · Bambora transaction {a.transactionId || '—'}</div>
          {a.receipt === 'sent' && <div className="v2-ok" style={{ marginTop: 12 }}>Receipt emailed to {a.receiptTo}.</div>}
          {a.receipt === 'failed' && <div className="v2-err" style={{ marginTop: 12 }}>The card was charged, but the receipt email to {a.receiptTo} didn’t send. Send it again from History.</div>}
          {a.receipt === 'none' && <div className="v2-note" style={{ marginTop: 12 }}>No email address was entered, so no receipt was sent. You can send one from History.</div>}
          <div className="v2-row" style={{ marginTop: 16 }}><Btn kind="g" icon={Plus} onClick={reset}>New sale</Btn></div>
        </Card>
      </div>
    );
  }

  return (
    <div className="v2-main v2-narrow">
      <div className="v2-head"><span className="v2-h1">Process a card</span><span className="v2-mut">Sold by {profile?.full_name || 'you'}</span><span className="v2-spacer" />
        <Btn size="sm" icon={CircleHelp} onClick={() => setTour(true)}>How it works</Btn></div>
      {tour && <CardIntroModal grantedBy={null} onClose={() => setTour(false)} />}
      <div className="v2-cards-cols">
        <div>
          <Card title="Customer">
            <div className="v2-grid2">
              <Field label="First name"><input className="v2-input" value={f.first_name} onChange={set('first_name')} autoComplete="off" /></Field>
              <Field label="Last name"><input className="v2-input" value={f.last_name} onChange={set('last_name')} autoComplete="off" /></Field>
              <Field label="Phone"><input className="v2-input" value={f.phone} onChange={set('phone')} inputMode="tel" autoComplete="off" /></Field>
              <Field label="Email" hint="The receipt goes here."><input className="v2-input" value={f.email} onChange={set('email')} inputMode="email" autoComplete="off" /></Field>
            </div>
          </Card>
          <Card title="Service address">
            <Field label="Street address"><input className="v2-input" value={f.address} onChange={set('address')} autoComplete="off" /></Field>
            <div className="v2-grid3">
              <Field label="City"><input className="v2-input" value={f.city} onChange={set('city')} autoComplete="off" /></Field>
              <Field label="Province"><select className="v2-sel" value={f.province} onChange={set('province')}>
                <option value="">Pick…</option>{PROVINCES.map(p => <option key={p.code} value={p.code}>{p.name}</option>)}</select></Field>
              <Field label="Postal code"><input className="v2-input" value={f.postal_code} onChange={set('postal_code')} autoComplete="off" /></Field>
            </div>
          </Card>
          <Card title="What they bought" right={<span className="v2-mut v2-small">Prices include tax</span>}>
            {items.map(r => (
              <div key={r.id} className="v2-cards-item">
                <select className="v2-sel" aria-label="Service" value={r.service} onChange={e => setItem(r.id, { service: e.target.value })}>
                  <option value="">Service…</option>{serviceOptions.map(s => <option key={s.key} value={s.key}>{s.label}</option>)}</select>
                <select className="v2-sel" aria-label="Season" value={r.seasonKey} onChange={e => setItem(r.id, { seasonKey: e.target.value })}>
                  {seasons.map(s => <option key={s.key} value={s.key}>{s.label}</option>)}</select>
                <input className="v2-input" aria-label="Price" placeholder="Price" inputMode="decimal" value={r.price} onChange={e => setItem(r.id, { price: e.target.value })} />
                <button type="button" className="v2-gbtn" aria-label="Remove this service" disabled={items.length === 1} onClick={() => setItems(rows => rows.filter(x => x.id !== r.id))}><Trash2 size={15} /></button>
                {r.service === 'other' && <input className="v2-input" style={{ gridColumn: '1 / -1' }} aria-label="What is it" placeholder="What is it?" value={r.description} onChange={e => setItem(r.id, { description: e.target.value })} />}
              </div>
            ))}
            <Btn size="sm" icon={Plus} onClick={() => setItems(rows => [...rows, blankItem(nextId.current++, rows[rows.length - 1]?.seasonKey || seasons[0].key)])}>Add another service</Btn>
          </Card>
          <Card title="Card"><CardFields key={cardKey} ref={fields} disabled={busy} /></Card>
          <Card title="Note (optional)"><textarea className="v2-input" rows={2} value={f.notes} onChange={set('notes')} placeholder="Anything the office should know about this sale" /></Card>
        </div>
        <div className="v2-cards-side">
          <Card title="Charge">
            {checked.sale ? (
              <table className="v2-table"><tbody>
                {checked.sale.items.map((i, n) => <tr key={n}><td>{itemLine(i)}</td><td style={{ textAlign: 'right' }}>{money(i.price)}</td></tr>)}
                <tr><td className="v2-mut">Subtotal</td><td style={{ textAlign: 'right' }}>{money(checked.sale.subtotal)}</td></tr>
                <tr><td className="v2-mut">{checked.sale.tax_name} ({pct(checked.sale.tax_rate)})</td><td style={{ textAlign: 'right' }}>{money(checked.sale.tax_amount)}</td></tr>
                <tr><td><b>Total to charge</b></td><td style={{ textAlign: 'right' }}><b>{money(checked.sale.total)}</b></td></tr>
              </tbody></table>
            ) : (
              <div className="v2-mut" style={{ fontSize: 14 }}>{runningTotal > 0 ? <>Total so far <b style={{ color: '#111827' }}>{money(runningTotal)}</b>{prov ? `, ${prov.tax} ${pct(prov.rate)} included` : ''}</> : 'Fill in the sale to see the total.'}</div>
            )}
            {tried && checked.errors && <div className="v2-err" style={{ marginTop: 12 }}>{checked.errors.map((e, i) => <div key={i}>{e.charAt(0).toUpperCase() + e.slice(1)}</div>)}</div>}
            {err && <div className="v2-err" style={{ marginTop: 12 }}>{err}</div>}
            {warn && <div className="v2-warn" style={{ marginTop: 12 }}>{warn}</div>}
            <Btn kind="g" icon={CreditCard} style={{ width: '100%', justifyContent: 'center', marginTop: 14, padding: '12px 14px', fontSize: 16 }} disabled={busy}
              onClick={() => { setTried(true); setErr(null); setWarn(null); if (checked.sale) setConfirm(checked.sale); }}>
              {busy ? 'Charging…' : checked.sale ? `Charge ${money(checked.sale.total)}` : 'Charge'}
            </Btn>
            <div className="v2-note">You’ll confirm the amount before the card is charged.</div>
          </Card>
        </div>
      </div>

      {confirm && (
        <Modal title={`Charge ${money(confirm.total)}?`} onClose={() => { if (!busy) setConfirm(null); }}
          footer={<><Btn onClick={() => setConfirm(null)} disabled={busy}>Cancel</Btn><Btn kind="g" icon={CreditCard} onClick={() => charge(confirm)} disabled={busy}>{busy ? 'Charging…' : `Charge ${money(confirm.total)}`}</Btn></>}>
          <div style={{ fontSize: 15, lineHeight: 1.6 }}>
            <b>{customerName(confirm)}</b><br />{addressLine(confirm)}<br />
            {confirm.items.map((i, n) => <div key={n}>{itemLine(i)} · {money(i.price)}</div>)}
            <div className="v2-mut" style={{ marginTop: 8 }}>{confirm.tax_name} {pct(confirm.tax_rate)} included: {money(confirm.tax_amount)}. The card is charged as soon as you confirm.
              {confirm.email ? ` The receipt goes to ${confirm.email}.` : ' No email address, so no receipt is sent.'}</div>
          </div>
        </Modal>
      )}
      {dup && (
        <Modal title="This looks already charged" onClose={() => { if (!busy) { setDup(null); setCardKey(k => k + 1); } }}
          footer={<><Btn onClick={() => { setDup(null); setCardKey(k => k + 1); }} disabled={busy}>Don’t charge</Btn><Btn kind="r" onClick={chargeAgain} disabled={busy}>{busy ? 'Charging…' : `Charge ${money(dup.sale.total)} again`}</Btn></>}>
          <div style={{ fontSize: 15, lineHeight: 1.6 }}>
            {money(dup.info.total)} was approved for this customer at {when(dup.info.at)} by {dup.info.by}{dup.info.last4 ? ` (card ending ${dup.info.last4})` : ''}.
            <div className="v2-mut" style={{ marginTop: 8 }}>Nothing has been charged this time. Only charge again if this is a second, separate sale.</div>
          </div>
        </Modal>
      )}
    </div>
  );
};

// ───────────── History ─────────────
type Show = 'all' | 'approved' | 'other';
export const CardHistory: React.FC = () => {
  const today = useMemo(() => new Date(), []);
  const [from, setFrom] = useState(() => isoDay(new Date(today.getTime() - 30 * 86400000)));
  const [to, setTo] = useState(() => isoDay(today));
  const [q, setQ] = useState('');
  const [show, setShow] = useState<Show>('all');
  const [open, setOpen] = useState<CardSale | null>(null);
  const list = useLoad(() => cardSales(from, to), [from, to]);
  const all = list.data || [];
  const found = useMemo(() => searchSales(all, q), [all, q]);
  const rows = found.filter(s => (show === 'all' ? true : show === 'approved' ? s.status === 'approved' : s.status !== 'approved'));
  const approved = found.filter(s => s.status === 'approved');
  const sum = approved.reduce((t, s) => t + s.total, 0);
  const download = () => {
    const url = URL.createObjectURL(new Blob([`﻿${salesCsv(rows)}`], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a'); a.href = url; a.download = `card-sales-${from}-to-${to}.csv`; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  };
  return (
    <div className="v2-main">
      <div className="v2-head"><span className="v2-h1">History</span><span className="v2-mut">{approved.length} approved · {money(sum)}</span><span className="v2-spacer" />
        <Btn icon={Download} onClick={download} disabled={!rows.length}>Export</Btn></div>
      <div className="v2-row" style={{ marginBottom: 12 }}>
        <input className="v2-input" style={{ maxWidth: 300 }} placeholder="Search name, phone, email, address, card…" value={q} onChange={e => setQ(e.target.value)} />
        <label className="v2-row v2-small v2-mut" style={{ gap: 6 }}>From <input type="date" className="v2-input" style={{ width: 150 }} value={from} max={to} onChange={e => e.target.value && setFrom(e.target.value)} /></label>
        <label className="v2-row v2-small v2-mut" style={{ gap: 6 }}>To <input type="date" className="v2-input" style={{ width: 150 }} value={to} min={from} onChange={e => e.target.value && setTo(e.target.value)} /></label>
        <span className="v2-spacer" />
        <Tabs<Show> value={show} onChange={setShow} items={[{ key: 'all', label: 'All', count: found.length }, { key: 'approved', label: 'Approved', count: approved.length }, { key: 'other', label: 'Not approved', count: found.length - approved.length }]} />
      </div>
      <ErrorBox error={list.error} />
      {list.loading && !list.data ? <Loading /> : (
        <Card style={{ padding: 0 }}>
          <div className="v2-table-wrap">
            <table className="v2-table">
              <thead><tr><th>When</th><th>Customer</th><th>Where</th><th>Sold</th><th style={{ textAlign: 'right' }}>Charged</th><th>Card</th><th>Status</th><th>Sold by</th></tr></thead>
              <tbody>
                {rows.map(s => (
                  <tr key={s.id} className="click" onClick={() => setOpen(s)}>
                    <td style={{ whiteSpace: 'nowrap' }}>{when(s.created_at)}</td>
                    <td><b style={{ fontWeight: 600 }}>{customerName(s)}</b><div className="v2-mut v2-small">{[s.phone, s.email].filter(Boolean).join(' · ')}</div></td>
                    <td>{s.address}<div className="v2-mut v2-small">{[s.city, s.province].filter(Boolean).join(', ')}</div></td>
                    <td>{s.items.map((i, n) => <div key={n}>{itemLine(i)}</div>)}</td>
                    <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}><b>{money(s.total)}</b><div className="v2-mut v2-small">{s.tax_name} {money(s.tax_amount)}</div></td>
                    <td style={{ whiteSpace: 'nowrap' }}>{cardOf(s) || '—'}</td>
                    <td><Tag tone={STATUS_TONE[s.status]}>{STATUS_LABEL[s.status]}</Tag></td>
                    <td>{s.processed_by_name}</td>
                  </tr>
                ))}
                {rows.length === 0 && <tr><td colSpan={8} className="v2-mut" style={{ padding: 18 }}>{all.length ? 'Nothing matches.' : 'No cards have been processed in these dates.'}</td></tr>}
              </tbody>
            </table>
          </div>
        </Card>
      )}
      {open && <SaleDetail sale={open} onClose={() => setOpen(null)} onChanged={() => list.reload()} />}
    </div>
  );
};

const NOTE: Partial<Record<SaleStatus, string>> = {
  error: 'Bambora never answered, so this may or may not have been charged. Look it up in Bambora before charging the card again.',
  processing: 'This attempt never finished. Look it up in Bambora before charging the card again.',
};
const SaleDetail: React.FC<{ sale: CardSale; onClose: () => void; onChanged: () => void }> = ({ sale: s, onClose, onChanged }) => {
  const [email, setEmail] = useState(s.email || s.receipt_to || '');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const send = async () => {
    setBusy(true); setMsg(null);
    try { const r = await resendReceipt(s.id, email.trim()); setMsg({ ok: true, text: `Receipt sent to ${r.to}.` }); onChanged(); }
    catch (e) { setMsg({ ok: false, text: errText(e) }); }
    finally { setBusy(false); }
  };
  const fact = (l: string, v: React.ReactNode) => <tr><td className="v2-mut" style={{ whiteSpace: 'nowrap', width: 150 }}>{l}</td><td>{v || '—'}</td></tr>;
  return (
    <Modal title={<>{customerName(s)} · {money(s.total)} <Tag tone={STATUS_TONE[s.status]}>{STATUS_LABEL[s.status]}</Tag></>} onClose={onClose}>
      {s.status !== 'approved' && <div className={s.status === 'declined' ? 'v2-err' : 'v2-warn'} style={{ marginBottom: 12 }}>{s.status === 'declined' ? `Declined: ${s.message || 'no reason given'}. Nothing was charged.` : NOTE[s.status]}</div>}
      <table className="v2-table"><tbody>
        {fact('When', `${when(s.created_at)} ET`)}
        {fact('Sold by', s.processed_by_name)}
        {fact('Phone', s.phone)}
        {fact('Email', s.email)}
        {fact('Service address', addressLine(s))}
        {fact('Sold', s.items.map((i, n) => <div key={n}>{itemLine(i)} · {money(i.price)}</div>))}
        {fact('Charged', <>{money(s.total)} <span className="v2-mut">({money(s.subtotal)} + {s.tax_name} {pct(s.tax_rate)} {money(s.tax_amount)})</span></>)}
        {fact('Card', cardOf(s))}
        {fact('Approval code', s.auth_code)}
        {fact('Bambora transaction', s.transaction_id)}
        {fact('Receipt', s.receipt_sent_at ? `Sent to ${s.receipt_to} · ${when(s.receipt_sent_at)}` : s.receipt_error ? `Didn’t send to ${s.receipt_to}` : s.status === 'approved' ? 'Not sent' : '')}
        {s.notes && fact('Note', s.notes)}
      </tbody></table>
      {s.status === 'approved' && (
        <div style={{ marginTop: 14 }}>
          <span className="v2-label">Send the receipt{s.receipt_sent_at ? ' again' : ''}</span>
          <div className="v2-row"><input className="v2-input" style={{ flex: 1, minWidth: 200 }} value={email} onChange={e => setEmail(e.target.value)} placeholder="Email address" inputMode="email" />
            <Btn kind="g" icon={Send} onClick={send} disabled={busy || !EMAIL_RE.test(email.trim())}>{busy ? 'Sending…' : 'Send receipt'}</Btn></div>
          {msg && <div className={msg.ok ? 'v2-ok' : 'v2-err'} style={{ marginTop: 10 }}>{msg.text}</div>}
          <div className="v2-note">A refund is done in Bambora with the transaction number above.</div>
        </div>
      )}
    </Modal>
  );
};

// ───────────── Receipt email ─────────────
export const CardReceipt: React.FC = () => {
  const tpl = useLoad(receiptTemplate, []);
  const [draft, setDraft] = useState<ReceiptTemplate | null>(null);
  const [busy, setBusy] = useState<'save' | 'test' | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  useEffect(() => { if (tpl.data && !draft) setDraft({ subject: tpl.data.subject, greeting: tpl.data.greeting, closing: tpl.data.closing, footer: tpl.data.footer }); }, [tpl.data, draft]);
  const sample = useMemo(() => sampleReceipt(), []);
  const mail = useMemo(() => (draft ? renderReceipt(draft, sample) : null), [draft, sample]);
  if (tpl.error) return <div className="v2-main v2-narrow"><ErrorBox error={tpl.error} /></div>;
  if (!tpl.data || !draft || !mail) return <div className="v2-main v2-narrow"><Loading /></div>;
  const canEdit = tpl.data.can_edit;
  const saved = tpl.data;
  const dirty = draft.subject !== saved.subject || draft.greeting !== saved.greeting || draft.closing !== saved.closing || draft.footer !== saved.footer;
  const set = (k: keyof ReceiptTemplate) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => { setMsg(null); setDraft(d => ({ ...d!, [k]: e.target.value })); };
  const save = async () => {
    setBusy('save'); setMsg(null);
    try { await saveReceiptTemplate(draft); tpl.reload(); setMsg({ ok: true, text: 'Saved. Every receipt from now on uses it.' }); }
    catch (e) { setMsg({ ok: false, text: errText(e) }); } finally { setBusy(null); }
  };
  const test = async () => {
    setBusy('test'); setMsg(null);
    try { const r = await sendTestReceipt(); setMsg({ ok: true, text: `A test of the saved receipt was sent to ${r.to}.` }); }
    catch (e) { setMsg({ ok: false, text: errText(e) }); } finally { setBusy(null); }
  };
  return (
    <div className="v2-main v2-narrow">
      <div className="v2-head"><span className="v2-h1">Receipt email</span><span className="v2-mut">One receipt for every customer · from receipts@propertystars.app</span></div>
      <div className="v2-cards-cols">
        <div>
          <Card title="Wording" right={saved.updated_by ? <span className="v2-mut v2-small">Last changed by {saved.updated_by}</span> : undefined}>
            {!canEdit && <div className="v2-note" style={{ marginTop: 0, marginBottom: 10 }}>Only a super admin can change the receipt.</div>}
            <Field label="Subject"><input className="v2-input" value={draft.subject} onChange={set('subject')} disabled={!canEdit} /></Field>
            <Field label="Before the receipt" hint="{first_name}, {last_name} and {name} are filled in for each customer."><textarea className="v2-input" rows={4} value={draft.greeting} onChange={set('greeting')} disabled={!canEdit} /></Field>
            <Field label="After the receipt"><textarea className="v2-input" rows={4} value={draft.closing} onChange={set('closing')} disabled={!canEdit} /></Field>
            <Field label="Small print at the bottom" hint="For example the company name and tax registration number."><textarea className="v2-input" rows={2} value={draft.footer} onChange={set('footer')} disabled={!canEdit} /></Field>
            <div className="v2-note" style={{ marginTop: 0 }}>The services, tax, total, card, date and address are filled in from each sale and can’t be edited here.</div>
            {msg && <div className={msg.ok ? 'v2-ok' : 'v2-err'} style={{ marginTop: 10 }}>{msg.text}</div>}
            <div className="v2-row" style={{ marginTop: 12 }}>
              {canEdit && <Btn kind="g" icon={Save} onClick={save} disabled={!dirty || busy !== null || !draft.subject.trim()}>{busy === 'save' ? 'Saving…' : 'Save'}</Btn>}
              <Btn icon={Mail} onClick={test} disabled={busy !== null || dirty} title={dirty ? 'Save first: the test uses the saved receipt' : undefined}>{busy === 'test' ? 'Sending…' : 'Send me a test'}</Btn>
            </div>
          </Card>
        </div>
        <div>
          <Card title="What the customer gets" right={<span className="v2-mut v2-small">Sample sale</span>}>
            <div className="v2-small v2-mut" style={{ marginBottom: 8 }}>Subject: <b style={{ color: '#111827' }}>{mail.subject}</b></div>
            <iframe title="Receipt preview" sandbox="" srcDoc={mail.html} style={{ width: '100%', height: 620, border: '1px solid #e5e7eb', borderRadius: 10, background: '#fff' }} />
          </Card>
        </div>
      </div>
    </div>
  );
};
