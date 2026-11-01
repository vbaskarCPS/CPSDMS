// src/v2/features/admin/CardCharges.tsx — Accounts Reporting › Credit cards: every card charge the app
// attempted in the dates, grouped into the tries for one sale, with double charges first so they can be
// refunded (in Bambora, by transaction ID — the app never refunds on its own).
import React, { useMemo, useState } from 'react';
import { AlertTriangle, Copy } from 'lucide-react';
import { useLoad } from '../../lib/data';
import { cardsReport, cardTotals, groupCharges, type Charge, type ChargeGroup } from '../../lib/cards';
import { money, shortDate } from '../../lib/etransfers';
import { Btn, ErrorBox, Loading, Tabs, Tag } from '../../ui';

type View = 'look' | 'all' | 'declined';
const time = (iso: string) => new Date(iso).toLocaleTimeString('en-CA', { hour: 'numeric', minute: '2-digit', timeZone: 'America/Vancouver' });
const FLAG: Record<ChargeGroup['flag'], { label: string; tone: 'g' | 'a' | 'b' | 'r' | 'v' }> = {
  double: { label: 'Charged more than once', tone: 'r' }, stuck: { label: 'Never finished', tone: 'a' }, declined: { label: 'Declined', tone: 'v' }, ok: { label: 'Charged', tone: 'g' },
};

export const CardCharges: React.FC<{ centerId: string; from: string; to: string }> = ({ centerId, from, to }) => {
  const [view, setView] = useState<View>('look');
  const report = useLoad(() => cardsReport(from, to, centerId || null), [centerId, from, to]);
  const groups = useMemo(() => (report.data ? groupCharges(report.data) : null), [report.data]);
  const totals = useMemo(() => (groups ? cardTotals(groups) : null), [groups]);
  if (report.error) return <ErrorBox error={report.error} />;
  if (!groups || !totals) return <Loading />;
  const rows = view === 'look' ? groups.filter(g => g.flag === 'double' || g.flag === 'stuck') : view === 'declined' ? groups.filter(g => g.flag === 'declined') : groups;
  return (
    <>
      <div className="v2-grid4 v2-etf-totals v2-cards-totals">
        <Total label="Charged" value={money(totals.charged)} sub={`${totals.approvedCount} approved charge${totals.approvedCount === 1 ? '' : 's'}`} tone="#047857" />
        <Total label="Charged more than once" value={money(totals.doubleAmount)} sub={totals.doubles ? `${totals.doubles} to refund` : 'none'} tone={totals.doubles ? '#b91c1c' : undefined} />
        <Total label="Declined tries" value={String(totals.declinedCount)} sub="across all sales" tone={totals.declinedCount ? '#b45309' : undefined} />
        <Total label="Never finished" value={String(totals.stuck)} sub="started, no answer from Bambora" tone={totals.stuck ? '#b45309' : undefined} />
      </div>
      <p className="v2-small v2-mut" style={{ margin: '0 0 10px' }}>
        Tries are grouped by client, amount and day. A sale with a decline and then an approval is one charge; two approvals for the same amount is a double charge. Refunds are made in Bambora — the transaction IDs are here to copy.
        {centerId && ' Charges are matched to a centre through its saved sale; a sale not yet saved shows under All centres.'}
      </p>
      <Tabs<View> value={view} onChange={setView} items={[
        { key: 'look', label: 'Needs a look', count: groups.filter(g => g.flag === 'double' || g.flag === 'stuck').length },
        { key: 'all', label: 'All charges', count: groups.length },
        { key: 'declined', label: 'Declined', count: groups.filter(g => g.flag === 'declined').length },
      ]} />
      <div className="v2-card" style={{ padding: 0 }}>
        <table className="v2-table v2-cards-sm">
          <thead><tr><th>Day</th><th>Client</th><th>Card</th><th style={{ textAlign: 'right' }}>Amount</th><th>Tries</th><th>Status</th></tr></thead>
          <tbody>
            {rows.length === 0 && <tr><td colSpan={6} className="v2-mut">{view === 'look' ? 'Nothing to look at: no double charges and nothing stuck in these dates.' : 'No card charges in these dates.'}</td></tr>}
            {rows.map(g => (
              <tr key={g.id} className={g.flag === 'double' ? 'v2-cards-double' : ''}>
                <td data-label="Day">{shortDate(g.day)}</td>
                <td className="lead"><b>{g.client || '—'}</b>
                  <div className="v2-small v2-mut">{g.sale ? <>{g.sale.route_code} · {g.sale.address} · {g.sale.center} · sold {money(g.sale.price)}</> : 'No saved sale with this name that day'}</div>
                  {g.sameCard.length > 0 && <div className="v2-small v2-mut">Same card also charged {g.sameCard.map(c => money(Number(c.amount))).join(', ')} that day (other sales)</div>}</td>
                <td data-label="Card" className="v2-small">{g.card || '—'}</td>
                <td data-label="Amount" style={{ textAlign: 'right' }}><b>{money(g.amount)}</b>{g.flag === 'double' && <div className="v2-small" style={{ color: '#b91c1c' }}>×{g.approved.length} = {money(g.amount * g.approved.length)}</div>}</td>
                <td data-label="Tries" className="v2-small"><Tries tries={g.tries} /></td>
                <td data-label="Status"><Tag tone={FLAG[g.flag].tone}>{g.flag === 'double' ? <><AlertTriangle size={11} style={{ verticalAlign: -1 }} /> {FLAG[g.flag].label}</> : FLAG[g.flag].label}</Tag>
                  {g.flag === 'double' && <div className="v2-small v2-mut" style={{ marginTop: 4 }}>Refund {g.approved.length - 1} of these in Bambora</div>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
};

const Tries: React.FC<{ tries: Charge[] }> = ({ tries }) => {
  const [copied, setCopied] = useState<string | null>(null);
  const copy = (id: string) => { navigator.clipboard?.writeText(id).then(() => { setCopied(id); setTimeout(() => setCopied(null), 1500); }).catch(() => undefined); };
  return (
    <div className="v2-stack" style={{ gap: 3 }}>
      {tries.map(t => (
        <div key={t.key} className="v2-row" style={{ gap: 6, flexWrap: 'wrap' }}>
          <span style={{ color: t.status === 'approved' ? '#047857' : t.status === 'processing' ? '#b45309' : '#b91c1c', fontWeight: 700 }}>{t.status === 'approved' ? '✓' : t.status === 'processing' ? '…' : '✗'}</span>
          <span>{time(t.at)}</span>
          <span className="v2-mut">{t.status === 'approved' ? `Approved · auth ${t.auth_code || '—'}` : t.status === 'processing' ? 'Started, no answer' : (t.message || 'Declined')}</span>
          {t.transaction_id && (
            <Btn kind="o" size="sm" icon={Copy} onClick={() => copy(t.transaction_id!)} title="Copy the Bambora transaction ID" style={{ minHeight: 24, padding: '0 6px' }}>
              {copied === t.transaction_id ? 'Copied' : `#${t.transaction_id}`}
            </Btn>
          )}
        </div>
      ))}
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
