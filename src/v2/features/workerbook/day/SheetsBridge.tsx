// src/v2/features/workerbook/day/SheetsBridge.tsx — a closed day's "Send to Google Sheets" card.
//
// Until Master Bookings lives in the app, each closed day goes to the center's Master Bookings
// sheet: its Logsheets rows and its Accounts rows (billed, e-transfer and card sales, cards masked
// to the last 4), the same rows the old Export to Google Sheets wrote. The card says whether the
// day has gone, shows the rows first, and warns before sending twice.
import React, { useState } from 'react';
import { CheckCircle2, ChevronDown, ChevronRight, ExternalLink, FileSpreadsheet, Send } from 'lucide-react';
import { useAuth } from '../../../lib/auth';
import { useLoad } from '../../../lib/data';
import { daySheetRows, sendDayToSheets, setCenterSheet, sheetInfo, sheetUrl, type DaySheetRows } from '../../../lib/sheetsBridge';
import { Btn, ErrorBox, Tag } from '../../../ui';

const money = (v: number) => `$${(Math.round(Number(v) * 100) / 100).toLocaleString('en-CA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const when = (iso: string) => new Date(iso).toLocaleString('en-CA', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;

export const SheetsBridge: React.FC<{ centerId: string; date: string }> = ({ centerId, date }) => {
  const { can } = useAuth();
  const info = useLoad(() => sheetInfo(centerId, date), [centerId, date]);
  const rows = useLoad(() => info.data?.saved ? daySheetRows(centerId, date) : Promise.resolve(null), [centerId, date, info.data?.saved]);
  const [open, setOpen] = useState(false);
  const [confirmAgain, setConfirmAgain] = useState(false);
  const [busy, setBusy] = useState<'send' | 'sheet' | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [done, setDone] = useState<string | null>(null);
  const [link, setLink] = useState('');

  const i = info.data;
  if (!i) return info.error ? <ErrorBox error={info.error} /> : null;
  const last = i.sends[0];
  const r = rows.data;
  const count = r ? r.logsheets.length + r.accounts.length : 0;
  // what has reached the sheet so far, across every send
  const sent = i.sends.reduce((a, s) => ({ logsheets: a.logsheets + s.logsheets, accounts: a.accounts + s.accounts }), { logsheets: 0, accounts: 0 });
  // a send that stopped after Logsheets: offer just the Accounts rows
  const accountsMissing = !!r && r.accounts.length > 0 && sent.logsheets >= r.logsheets.length && sent.accounts === 0;
  const partly = !!last && !!r && (sent.logsheets < r.logsheets.length || sent.accounts < r.accounts.length);

  const send = async (only?: 'accounts') => {
    if (!i.sheet_id || !r) return;
    setBusy('send'); setError(null); setDone(null);
    try {
      const d = await sendDayToSheets(centerId, date, i.sheet_id, only === 'accounts' ? { logsheets: [], accounts: r.accounts } : r);
      setDone(`Sent: ${plural(d.logsheets, 'Logsheets row')} and ${plural(d.accounts, 'Accounts row')}.`);
      setConfirmAgain(false);
    } catch (e) { setError(e); } finally { setBusy(null); info.reload(); }
  };
  const saveSheet = async () => {
    setBusy('sheet'); setError(null);
    try { await setCenterSheet(centerId, link); setLink(''); info.reload(); } catch (e) { setError(e); } finally { setBusy(null); }
  };

  return (
    <section className="v2-card" style={{ marginBottom: 14, ...(last ? {} : { borderColor: 'var(--amber)' }) }} aria-label="Master Bookings sheet">
      <div className="v2-row" style={{ gap: 8 }}>
        <FileSpreadsheet size={18} color="var(--green)" />
        <b>Master Bookings sheet</b>
        {!i.saved ? <Tag>Nothing to send</Tag>
          : partly ? <Tag tone="a">Partly sent {when(last.sent_at)}</Tag>
          : last ? <Tag tone="g">Sent {when(last.sent_at)}{last.by ? ` · ${last.by}` : ''}</Tag>
          : <Tag tone="a">Not sent yet</Tag>}
        <span className="v2-spacer" />
        {i.sheet_id && <a className="v2-link v2-small" style={{ whiteSpace: 'nowrap', display: 'inline-flex', alignItems: 'center', gap: 4, flexShrink: 0 }} href={sheetUrl(i.sheet_id)} target="_blank" rel="noreferrer">Open sheet <ExternalLink size={12} /></a>}
      </div>

      {!i.saved ? (
        <div className="v2-small v2-mut" style={{ marginTop: 6 }}>This day has no saved sales in the app (it was run before the app kept a copy), so there’s nothing to send.</div>
      ) : !i.sheet_id ? (
        <div style={{ marginTop: 10 }}>
          <div className="v2-small" style={{ marginBottom: 8 }}>No Master Bookings sheet is set for this center yet.{!can('sa_users') && ' Ask a Super Admin to add it.'}</div>
          {can('sa_users') && (
            <div className="v2-row" style={{ gap: 8 }}>
              <input className="v2-input" style={{ flex: 1, minWidth: 220 }} placeholder="Paste the Master Bookings sheet link" aria-label="Master Bookings sheet link"
                value={link} onChange={e => setLink(e.target.value)} />
              <Btn disabled={!link.trim() || !!busy} onClick={saveSheet}>{busy === 'sheet' ? 'Saving…' : 'Save'}</Btn>
            </div>
          )}
        </div>
      ) : (
        <>
          <div className="v2-small v2-mut" style={{ marginTop: 6 }}>
            Until Master Bookings is in the app, each closed day’s sales go to the sheet’s <b>Logsheets</b> tab, and billed, e-transfer and card sales to its <b>Accounts</b> tab (cards as the last 4 only).
          </div>
          <ErrorBox error={rows.error} />
          {r && (
            <button type="button" className="v2-link v2-small" style={{ marginTop: 8, display: 'inline-flex', alignItems: 'center', gap: 4, background: 'none', border: 0, padding: 0, cursor: 'pointer' }}
              onClick={() => setOpen(o => !o)} aria-expanded={open}>
              {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
              {plural(r.logsheets.length, 'Logsheets row')} · {plural(r.accounts.length, 'Accounts row')}
            </button>
          )}
          {open && r && <RowsPreview rows={r} />}
          {i.sends.length > 1 && (
            <div className="v2-small v2-mut" style={{ marginTop: 8 }}>
              Sent {i.sends.length} times: {i.sends.map(s => `${when(s.sent_at)} (${s.logsheets} + ${s.accounts})`).join(' · ')}. Check the sheet for doubled rows.
            </div>
          )}
          {done && <div className="v2-row v2-small" style={{ marginTop: 8, gap: 6, color: 'var(--green)' }}><CheckCircle2 size={15} /> {done}</div>}
          <ErrorBox error={error} />
          {can('workerbook') && r && count > 0 && (
            <div className="v2-row" style={{ marginTop: 10, gap: 8 }}>
              {accountsMissing && !confirmAgain ? (<>
                <Btn icon={Send} disabled={!!busy} onClick={() => send('accounts')}>{busy === 'send' ? 'Sending…' : `Send the ${plural(r.accounts.length, 'Accounts row')}`}</Btn>
                <span className="v2-small v2-mut">The Logsheets rows are already in.</span>
              </>) : last && !confirmAgain ? (
                <Btn kind="o" icon={Send} disabled={!!busy} onClick={() => setConfirmAgain(true)}>Send again…</Btn>
              ) : last && confirmAgain ? (
                <>
                  <span className="v2-small"><b>This adds every row again.</b> Only send again if the first send didn’t reach the sheet.</span>
                  <Btn kind="r" icon={Send} disabled={!!busy} onClick={() => send()}>{busy === 'send' ? 'Sending…' : 'Yes, send again'}</Btn>
                  <Btn kind="o" disabled={!!busy} onClick={() => setConfirmAgain(false)}>Cancel</Btn>
                </>
              ) : (
                <Btn icon={Send} disabled={!!busy} onClick={() => send()}>{busy === 'send' ? 'Sending…' : 'Send to Google Sheets'}</Btn>
              )}
              <span className="v2-small v2-mut">Uses your Google sign-in; your account needs edit access to the sheet.</span>
            </div>
          )}
        </>
      )}
    </section>
  );
};

const RowsPreview: React.FC<{ rows: DaySheetRows }> = ({ rows }) => (
  <div className="v2-stack" style={{ gap: 10, marginTop: 10 }}>
    {([['Logsheets', rows.logsheets], ['Accounts', rows.accounts]] as const).map(([tab, list]) => (
      <div key={tab}>
        <div className="v2-small" style={{ marginBottom: 4 }}><b>{tab}</b> <span className="v2-mut">({list.length})</span></div>
        {list.length === 0 ? <div className="v2-small v2-mut">No rows.</div> : (
          <div className="v2-table-wrap" style={{ maxHeight: 280, overflow: 'auto' }}>
            <table className="v2-table">
              <thead><tr><th>Route</th><th>Client</th><th>Address</th><th>Type</th><th style={{ textAlign: 'right' }}>Price</th><th>Payment</th>
                {tab === 'Accounts' && <th>Details</th>}<th>Contractor</th></tr></thead>
              <tbody>{list.map((x, n) => (
                <tr key={n}>
                  <td>{x.routeNumber || '—'}</td><td>{`${x.firstName} ${x.lastName}`.trim() || '—'}</td>
                  <td>{`${x.streetNum} ${x.streetName}`.trim() || '—'}</td><td>{x.clientType}</td>
                  <td style={{ textAlign: 'right' }}>{money(x.price)}</td><td className="v2-small">{x.paymentType}</td>
                  {tab === 'Accounts' && <td className="v2-small">{'paymentDetails' in x ? x.paymentDetails || '—' : ''}</td>}
                  <td className="v2-small">{x.contractorName}</td>
                </tr>))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    ))}
  </div>
);
