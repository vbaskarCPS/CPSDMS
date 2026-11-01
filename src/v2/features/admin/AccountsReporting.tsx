// src/v2/features/admin/AccountsReporting.tsx — Super Admin › Accounts Reporting.
// Every e-transfer sale of the saved payout days, checked against the bank receipts forwarded to
// payments@propertystars.app (Claude reads each forward and matches it: supabase/functions/_shared/etransfer.ts).
// Three lists: Matched · Unmatched client records (sales with no receipt yet) · Unmatched emails (receipts with
// no sale). Clear matches are made on their own; suggestions wait here for a person to confirm. Nothing here
// changes a payout.
import React, { useMemo, useState } from 'react';
import { Check, Link2, Mail, RefreshCw, Unlink, X } from 'lucide-react';
import { useAuth } from '../../lib/auth';
import { todayISO, useLoad } from '../../lib/data';
import {
  daysSince, etfConfirm, etfIgnore, etfLists, etfMatch, etfRecheck, etfReport, etfUnmatch, HOW_LABEL, money, PAYMENTS_ADDRESS, shortDate,
  type EtfReceipt, type EtfSale,
} from '../../lib/etransfers';
import { Btn, ErrorBox, Loading, Modal, Tabs, Tag } from '../../ui';

type List = 'matched' | 'clients' | 'emails';
const addDays = (iso: string, n: number) => { const d = new Date(`${iso}T12:00:00`); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };

export const AccountsReporting: React.FC = () => {
  const { centers, center } = useAuth();
  const [centerId, setCenterId] = useState<string>(center?.id || '');
  const [from, setFrom] = useState(() => addDays(todayISO(), -1));
  const [to, setTo] = useState(() => todayISO());
  const [list, setList] = useState<List>('clients');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [note, setNote] = useState<string | null>(null);
  const [pickFor, setPickFor] = useState<{ receipt?: EtfReceipt; sale?: EtfSale } | null>(null);
  const report = useLoad(() => etfReport(centerId || null, from, to), [centerId, from, to]);
  const lists = useMemo(() => report.data ? etfLists(report.data) : null, [report.data]);

  const act = async (key: string, fn: () => Promise<unknown>) => {
    setBusy(key); setError(null); setNote(null);
    try { await fn(); report.reload(); } catch (e) { setError(e); } finally { setBusy(null); }
  };
  const recheck = () => act('recheck', async () => {
    const r = await etfRecheck();
    setNote(r.done ? `Checked ${r.done} receipt${r.done === 1 ? '' : 's'}: ${r.matched} matched, ${r.review} to confirm, ${r.unmatched} still unmatched${r.errors ? `, ${r.errors} failed` : ''}.` : 'No unmatched receipts to check.');
  });

  return (
    <div className="v2-main v2-narrow">
      <div className="v2-head">
        <span className="v2-h1">Accounts Reporting</span><Tag tone="b">E-transfers</Tag>
        <span className="v2-spacer" />
        <Btn kind="o" size="sm" icon={RefreshCw} disabled={busy === 'recheck'} onClick={recheck}>{busy === 'recheck' ? 'Checking…' : 'Check again'}</Btn>
      </div>
      <div className="v2-card v2-etf-bar">
        <select className="v2-input" value={centerId} onChange={e => setCenterId(e.target.value)} aria-label="Centre">
          <option value="">All centres</option>
          {centers.map(c => <option key={c.id} value={c.id}>{c.display_name}</option>)}
        </select>
        <div className="v2-etf-dates">
          <input className="v2-input" type="date" value={from} max={to} onChange={e => setFrom(e.target.value)} aria-label="From" />
          <span className="v2-mut">–</span>
          <input className="v2-input" type="date" value={to} min={from} onChange={e => setTo(e.target.value)} aria-label="To" />
        </div>
        <div className="v2-etf-quick" role="group" aria-label="Quick ranges">
          {([['Today', 0, 0], ['Yesterday', 1, 1], ['7 days', 7, 0], ['30 days', 30, 0]] as const).map(([label, back, end]) => {
            const f = addDays(todayISO(), -back), t = addDays(todayISO(), -end), on = f === from && t === to;
            return <button key={label} type="button" className={on ? 'on' : ''} onClick={() => { setFrom(f); setTo(t); }}>{label}</button>;
          })}
        </div>
        <p className="v2-etf-how"><Mail size={13} aria-hidden /> Forward the bank’s e-transfer notices to <b>{PAYMENTS_ADDRESS}</b> — Claude reads each one and matches it to a sale; clear matches are made on their own, the rest wait below for you to confirm.</p>
      </div>

      <ErrorBox error={report.error || error} />
      {note && <div className="v2-ok" style={{ marginBottom: 10 }}>{note}</div>}
      {!lists ? <Loading /> : <>
        <div className="v2-grid4 v2-etf-totals" style={{ marginBottom: 12 }}>
          <Total label="E-transfers sold" value={money(lists.totals.expected)} sub={`${report.data!.sales.length} sales`} />
          <Total label="Received" value={money(lists.totals.received)} sub={`${lists.matched.length} matched`} tone="#047857" />
          <Total label="No receipt yet" value={money(lists.totals.waiting)} sub={`${lists.waiting.length} client records`} tone={lists.waiting.length ? '#b45309' : undefined} />
          <Total label="Receipts with no sale" value={money(lists.totals.unmatchedEmails)} sub={`${lists.openReceipts.length} emails`} tone={lists.openReceipts.length ? '#b91c1c' : undefined} />
        </div>

        <Tabs<List> value={list} onChange={setList} items={[
          { key: 'matched', label: 'Matched', count: lists.matched.length },
          { key: 'clients', label: 'Unmatched client records', count: lists.waiting.length },
          { key: 'emails', label: 'Unmatched emails', count: lists.openReceipts.length },
        ]} />

        {list === 'matched' && (
          <div className="v2-card" style={{ padding: 0 }}>
            <table className="v2-table v2-cards-sm">
              <thead><tr><th>Day</th><th>Client</th><th>Cart</th><th style={{ textAlign: 'right' }}>Sold</th><th>Receipt</th><th>How</th><th /></tr></thead>
              <tbody>
                {lists.matched.length === 0 && <tr><td colSpan={7} className="v2-mut">Nothing matched in these dates yet.</td></tr>}
                {lists.matched.map(s => (
                  <tr key={s.key}>
                    <td data-label="Day">{shortDate(s.day)}{!centerId && <div className="v2-small v2-mut">{s.center}</div>}</td>
                    <td className="lead"><b>{s.client || '—'}</b><div className="v2-small v2-mut">{s.address} · {s.route_code}</div></td>
                    <td data-label="Cart" className="v2-small">{s.cart}</td>
                    <td data-label="Sold" style={{ textAlign: 'right' }}><b>{money(s.amount)}</b>{s.split && <div className="v2-small v2-mut">part of {money(s.price)}</div>}</td>
                    <td data-label="Receipt" className="v2-small"><b>{s.match!.sender || s.match!.sender_email}</b> · {money(s.match!.amount)} · {shortDate(s.match!.sent_on)}
                      {s.match!.amount != null && Math.abs(Number(s.match!.amount) - s.amount) > 0.005 && <> <Tag tone="a">amount differs</Tag></>}
                      {s.match!.reference && <div className="v2-mut">Ref {s.match!.reference}</div>}</td>
                    <td data-label="How" className="v2-small" title={s.match!.reason || ''}>{HOW_LABEL[s.match!.how]}</td>
                    <td className="full" style={{ textAlign: 'right' }}>
                      <Btn kind="o" size="sm" icon={Unlink} disabled={!!busy} onClick={() => act(`u${s.match!.id}`, () => etfUnmatch(s.match!.id))}>Unmatch</Btn>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {list === 'clients' && (
          <div className="v2-card" style={{ padding: 0 }}>
            <table className="v2-table v2-cards-sm">
              <thead><tr><th>Day</th><th>Client</th><th>Cart</th><th style={{ textAlign: 'right' }}>Sold</th><th>Receipt</th><th /></tr></thead>
              <tbody>
                {lists.waiting.length === 0 && <tr><td colSpan={6} className="v2-mut">Every e-transfer in these dates has its receipt.</td></tr>}
                {lists.waiting.map(s => (
                  <tr key={s.key}>
                    <td data-label="Day">{shortDate(s.day)}{!centerId && <div className="v2-small v2-mut">{s.center}</div>}</td>
                    <td className="lead"><b>{s.client || '—'}</b><div className="v2-small v2-mut">{s.address} · {s.route_code}</div></td>
                    <td data-label="Cart" className="v2-small">{s.cart}</td>
                    <td data-label="Sold" style={{ textAlign: 'right' }}><b>{money(s.amount)}</b>{s.split && <div className="v2-small v2-mut">part of {money(s.price)}</div>}</td>
                    <td data-label="Receipt" className="v2-small">
                      {s.match ? <>
                        <Tag tone="b">Suggested</Tag> <b>{s.match.sender || s.match.sender_email}</b> · {money(s.match.amount)} · {shortDate(s.match.sent_on)}
                        <div className="v2-mut">{s.match.reason}</div>
                      </> : <span className="v2-mut">None yet · {daysSince(s.day)} day{daysSince(s.day) === 1 ? '' : 's'}</span>}
                    </td>
                    <td className="full" style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                      {s.match && <>
                        <Btn kind="g" size="sm" icon={Check} disabled={!!busy} onClick={() => act(`c${s.match!.id}`, () => etfConfirm(s.match!.id))}>Confirm</Btn>{' '}
                        <Btn kind="o" size="sm" icon={X} disabled={!!busy} onClick={() => act(`u${s.match!.id}`, () => etfUnmatch(s.match!.id))}>Not this</Btn>{' '}
                      </>}
                      <Btn kind="o" size="sm" icon={Link2} disabled={!!busy || lists.openReceipts.length === 0} onClick={() => setPickFor({ sale: s })}>Match…</Btn>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {list === 'emails' && <>
          <div className="v2-card" style={{ padding: 0 }}>
            <table className="v2-table v2-cards-sm">
              <thead><tr><th>Sent</th><th>From</th><th style={{ textAlign: 'right' }}>Amount</th><th>Message</th><th>Status</th><th /></tr></thead>
              <tbody>
                {lists.openReceipts.length === 0 && <tr><td colSpan={6} className="v2-mut">No receipts waiting for a sale.</td></tr>}
                {lists.openReceipts.map(r => (
                  <tr key={r.id}>
                    <td data-label="Sent">{shortDate(r.sent_on || r.received_at)}</td>
                    <td className="lead"><b>{r.sender || r.sender_email || r.subject || '—'}</b>
                      <div className="v2-small v2-mut">{[r.sender_email, r.bank, r.reference && `Ref ${r.reference}`].filter(Boolean).join(' · ')}</div></td>
                    <td data-label="Amount" style={{ textAlign: 'right' }}><b>{money(r.amount)}</b></td>
                    <td data-label="Message" className="v2-small">{r.memo || <span className="v2-mut">—</span>}</td>
                    <td data-label="Status" className="v2-small">
                      {r.status === 'error' ? <Tag tone="r">Couldn’t read</Tag> : r.sales.length ? <Tag tone="b">Suggested: {r.sales[0].client}</Tag> : <Tag tone="a">No sale found</Tag>}
                      {r.note && <div className="v2-mut">{r.note}</div>}
                    </td>
                    <td className="full" style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                      <Btn kind="o" size="sm" icon={Link2} disabled={!!busy} onClick={() => setPickFor({ receipt: r })}>Match…</Btn>{' '}
                      <Btn kind="o" size="sm" disabled={!!busy} onClick={() => act(`i${r.id}`, () => etfIgnore(r.id, true))}>Not ours</Btn>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {lists.notReceipts.length > 0 && (
            <details style={{ marginTop: 12 }}>
              <summary className="v2-small v2-mut" style={{ cursor: 'pointer' }}>Not e-transfer receipts ({lists.notReceipts.length}): not forwarded, not a deposit, or marked not ours</summary>
              <div className="v2-card" style={{ padding: 0, marginTop: 8 }}>
                <table className="v2-table v2-cards-sm">
                  <tbody>
                    {lists.notReceipts.map(r => (
                      <tr key={r.id}>
                        <td className="lead"><b>{r.subject || '(no subject)'}</b><div className="v2-small v2-mut">{r.forwarded_by} · {shortDate(r.received_at)}</div></td>
                        <td data-label="Why" className="v2-small">{r.status === 'ignored' ? 'Marked not ours' : r.note}</td>
                        <td className="full" style={{ textAlign: 'right' }}>
                          {r.status === 'ignored' && <Btn kind="o" size="sm" disabled={!!busy} onClick={() => act(`i${r.id}`, () => etfIgnore(r.id, false))}>Put back</Btn>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
          )}
        </>}
      </>}

      {pickFor && lists && (
        <PickMatch for={pickFor} sales={lists.waiting} receipts={lists.openReceipts} busy={!!busy} onClose={() => setPickFor(null)}
          onPick={(receiptId, key) => act('pick', async () => { await etfMatch(receiptId, key); setPickFor(null); })} />
      )}
    </div>
  );
};

const Total: React.FC<{ label: string; value: string; sub: string; tone?: string }> = ({ label, value, sub, tone }) => (
  <div className="v2-card" style={{ padding: '12px 14px', margin: 0 }}>
    <div className="v2-small v2-mut" style={{ fontWeight: 700, textTransform: 'uppercase', fontSize: 10.5 }}>{label}</div>
    <div style={{ fontSize: 20, fontWeight: 800, color: tone }}>{value}</div>
    <div className="v2-small v2-mut">{sub}</div>
  </div>
);

/** Pick the other side of a match by hand: a receipt for a sale, or a sale for a receipt (closest amounts first). */
const PickMatch: React.FC<{
  for: { receipt?: EtfReceipt; sale?: EtfSale }; sales: EtfSale[]; receipts: EtfReceipt[]; busy: boolean;
  onClose: () => void; onPick: (receiptId: string, saleKey: string) => void;
}> = ({ for: f, sales, receipts, busy, onClose, onPick }) => {
  const amount = Number(f.sale?.amount ?? f.receipt?.amount ?? 0);
  const near = <T extends { amount: number | null }>(a: T[]) => [...a].sort((x, y) => Math.abs(Number(x.amount || 0) - amount) - Math.abs(Number(y.amount || 0) - amount));
  return (
    <Modal title={f.sale ? `Which receipt paid for ${f.sale.client || 'this sale'}?` : `Which sale did ${f.receipt?.sender || 'this receipt'} pay for?`} onClose={onClose}>
      <div className="v2-small v2-mut" style={{ marginBottom: 8 }}>{money(amount)} · closest amounts first</div>
      <div className="v2-stack" style={{ gap: 6, maxHeight: '60vh', overflowY: 'auto' }}>
        {f.sale && near(receipts).map(r => (
          <button key={r.id} type="button" className="v2-pick" style={{ display: 'block', textAlign: 'left' }} disabled={busy} onClick={() => onPick(r.id, f.sale!.key)}>
            <b>{r.sender || r.sender_email || r.subject}</b> · <b>{money(r.amount)}</b> · {shortDate(r.sent_on || r.received_at)}
            {r.memo && <div className="v2-small v2-mut">“{r.memo}”</div>}
          </button>
        ))}
        {f.receipt && near(sales).map(s => (
          <button key={s.key} type="button" className="v2-pick" style={{ display: 'block', textAlign: 'left' }} disabled={busy} onClick={() => onPick(f.receipt!.id, s.key)}>
            <b>{s.client || '—'}</b> · <b>{money(s.amount)}</b> · {shortDate(s.day)}
            <div className="v2-small v2-mut">{s.address} · {s.route_code} · {s.cart}{s.center ? ` · ${s.center}` : ''}</div>
          </button>
        ))}
        {((f.sale && receipts.length === 0) || (f.receipt && sales.length === 0)) && <div className="v2-mut">Nothing to pick from in these dates.</div>}
      </div>
    </Modal>
  );
};
