// A closed day: what was paid out — the day's numbers and each worker's finalized line
// (the same lines payslips are built from), plus who showed.
import React from 'react';
import { Link } from 'react-router-dom';
import { useLoad } from '../../../lib/data';
import { listLines } from '../../../lib/payslips';
import { fullName, type Day, type RosterRow } from '../../../lib/workerbook';
import { ErrorBox, Loading, Tag } from '../../../ui';

const money = (v: number) => `$${(Math.round(Number(v) * 100) / 100).toLocaleString('en-CA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export const PayoutCopy: React.FC<{ centerId: string; date: string; day: Day; rows: RosterRow[] }> = ({ centerId, date, day, rows }) => {
  const lines = useLoad(() => listLines(centerId, date, date), [centerId, date]);
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
          <span className="v2-spacer" /><Link className="v2-link v2-small" to="/app/workerbook/payslips">Payslips ›</Link>
        </div>
        <ErrorBox error={lines.error} />
        {lines.loading && !lines.data ? <Loading /> : (lines.data || []).length === 0 ? (
          <div className="v2-mut v2-small" style={{ padding: 14 }}>No payout lines for this day yet. If it was closed before payslips were in the app, build them on the Payslips page.</div>
        ) : (
          <div className="v2-table-wrap">
            <table className="v2-table">
              <thead><tr><th>CN #</th><th>Name</th><th>Manager</th><th style={{ textAlign: 'right' }}>Steps</th><th style={{ textAlign: 'right' }}>EQ</th>
                <th style={{ textAlign: 'right' }}>Rate</th><th style={{ textAlign: 'right' }}>Bonus</th><th style={{ textAlign: 'right' }}>Mach.</th><th style={{ textAlign: 'right' }}>Payout</th><th>Payslip</th></tr></thead>
              <tbody>{(lines.data || []).map(l => (
                <tr key={l.id}>
                  <td><b>{l.cn}</b></td><td>{l.first_name} {l.last_name}</td><td className="v2-small">{l.manager || '—'}</td>
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
        <div className="v2-small"><b>Showed ({showed.length}):</b> {showed.map(r => fullName(r.hire.person)).join(', ') || '—'}</div>
        {ns.length > 0 && <div className="v2-small" style={{ marginTop: 6 }}><b>No-show ({ns.length}):</b> {ns.map(r => fullName(r.hire.person)).join(', ')}</div>}
      </section>
    </div>
  );
};
