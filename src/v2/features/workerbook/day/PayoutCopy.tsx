// A closed day: what was paid out — the day's numbers and each worker's finalized line
// (the same lines payslips are built from), plus who showed.
import React, { useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useLoad } from '../../../lib/data';
import { listLines } from '../../../lib/payslips';
import { fullName, type Day, type RosterRow } from '../../../lib/workerbook';
import { recalcDay } from '../../../lib/payoutEngine';
import { Btn, ErrorBox, Loading, Tag } from '../../../ui';
import { ContractorLink } from '../ContractorCard';

const money = (v: number) => `$${(Math.round(Number(v) * 100) / 100).toLocaleString('en-CA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export const PayoutCopy: React.FC<{ centerId: string; region: string; date: string; day: Day; rows: RosterRow[]; canEdit: boolean }> = ({ centerId, region, date, day, rows, canEdit }) => {
  const lines = useLoad(() => listLines(centerId, date, date), [centerId, date]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [note, setNote] = useState<string | null>(null);
  const unpaid = (lines.data || []).length > 0 && !(lines.data || []).some(l => l.payslip_id);
  const recalc = async () => {
    setBusy(true); setError(null); setNote(null);
    try {
      const r = await recalcDay(centerId, region, date);
      setNote(r.changed ? `${r.changed} line${r.changed === 1 ? '' : 's'} changed: ${money(r.before)} → ${money(r.after)}.` : 'Nothing changed; the pay already matches each worker’s days and Silver Hats.');
      lines.reload();
    } catch (e) { setError(e); } finally { setBusy(false); }
  };
  const s = day.summary;
  const total = (lines.data || []).reduce((a, l) => a + Number(l.total_payout), 0);
  const showed = rows.filter(r => r.attendance === 'showed');
  const ns = rows.filter(r => r.attendance === 'no_show');
  return (
    <div className="v2-stack" style={{ gap: 14 }}>
      {s && (
        <div className="v2-kpis" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))' }}>
          {[['Carts', String(s.carts)], ['Steps', String(s.steps)], ['Gross', money(s.gross)], ['Upsells', String(s.upsells)], ['Showed', `${s.showed} of ${s.booked}`], ['To NS list', String(s.no_shows ?? ns.length)]]
            .map(([l, v]) => <div key={l} className="v2-kpi-box v2-card" style={{ margin: 0 }}><span className="l">{l}</span><span className="n">{v}</span></div>)}
        </div>
      )}
      <section className="v2-card" style={{ padding: 0 }}>
        <div className="v2-row" style={{ padding: '12px 14px 6px' }}>
          <b>Payouts</b><span className="v2-mut v2-small">{(lines.data || []).length} worker lines · {money(total)}</span>
          <span className="v2-spacer" />
          {canEdit && unpaid && <Btn size="sm" kind="o" icon={RefreshCw} disabled={busy} onClick={recalc}
            title="Work the pay out again with each worker's days and Silver Hats as they are now">{busy ? 'Working out…' : 'Work out again'}</Btn>}
          <Link className="v2-link v2-small" to="/app/workerbook/payslips">Payslips ›</Link>
        </div>
        {day.summary && 'imported_from' in day.summary && <div className="v2-note" style={{ margin: '0 14px 6px' }}>Imported from the {String(day.summary.imported_from)}: the sheet’s inputs, with rates and pay worked out in the app.</div>}
        {note && <div className="v2-small" style={{ margin: '0 14px 8px', color: '#047857' }}>{note}</div>}
        <ErrorBox error={lines.error || error} />
        {lines.loading && !lines.data ? <Loading /> : (lines.data || []).length === 0 ? (
          <div className="v2-mut v2-small" style={{ padding: 14 }}>No payout lines for this day yet. If it was closed before payslips were in the app, build them on the Payslips page.</div>
        ) : (
          <div className="v2-table-wrap">
            <table className="v2-table">
              <thead><tr><th>CN #</th><th>Name</th><th>Manager</th><th style={{ textAlign: 'right' }}>Steps</th><th style={{ textAlign: 'right' }}>EQ</th>
                <th style={{ textAlign: 'right' }}>Rate</th><th style={{ textAlign: 'right' }}>Bonus</th><th style={{ textAlign: 'right' }}>Mach.</th><th style={{ textAlign: 'right' }}>Payout</th><th>Payslip</th></tr></thead>
              <tbody>{(lines.data || []).map(l => (
                <tr key={l.id}>
                  <td><b>{l.cn}</b></td><td><ContractorLink hireId={l.hire_id} onSaved={lines.reload}>{l.first_name} {l.last_name}</ContractorLink></td><td className="v2-small">{l.manager || '—'}</td>
                  <td style={{ textAlign: 'right' }}>{Number(l.steps).toFixed(1)}</td><td style={{ textAlign: 'right' }}>{Number(l.equiv).toFixed(2)}</td>
                  <td style={{ textAlign: 'right' }}>{Number(l.payout_rate)}</td><td style={{ textAlign: 'right' }}>{money(l.daily_bonus)}</td>
                  <td style={{ textAlign: 'right' }}>{money(l.mach_rent)}</td><td style={{ textAlign: 'right' }}><b>{money(l.total_payout)}</b></td>
                  <td>{l.payslip_id ? <Tag tone="g">On a payslip</Tag> : <Tag tone="a">Unpaid</Tag>}</td>
                </tr>))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      <section className="v2-card">
        <div className="v2-card-h">Attendance</div>
        <div className="v2-small"><b>Showed ({showed.length}):</b> {showed.length ? showed.map((r, i) => <React.Fragment key={r.id}>{i > 0 && ', '}<ContractorLink hireId={r.hire_id}>{fullName(r.hire.person)}</ContractorLink></React.Fragment>) : '—'}</div>
        {ns.length > 0 && <div className="v2-small" style={{ marginTop: 6 }}><b>No-show ({ns.length}):</b> {ns.map(r => fullName(r.hire.person)).join(', ')}</div>}
      </section>
    </div>
  );
};
