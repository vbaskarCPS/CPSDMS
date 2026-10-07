// Today's roll call, before the session starts: who's here. In-city centers also take each
// worker's answer for after today — their next day (booked when the session starts), WDR, or
// Quit (they still work today). Once the session starts, the day page shows payouts instead.
import React, { useMemo, useState } from 'react';
import { Search, UserPlus } from 'lucide-react';
import { fullName, updateRoster, type RosterRow } from '../../../lib/workerbook';
import { Btn, ErrorBox, Tag } from '../../../ui';
import type { CenterType } from '../../../lib/crew';
import { ContractorLink } from '../ContractorCard';

const addDays = (iso: string, n: number) => { const d = new Date(iso + 'T12:00'); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };
const short = (iso: string) => new Date(iso + 'T12:00').toLocaleDateString('en-CA', { weekday: 'short', month: 'short', day: 'numeric' });

export const RollCall: React.FC<{
  date: string; rows: RosterRow[]; type: CenterType; canEdit: boolean; onChanged: () => void; onWalkIn: () => void;
}> = ({ date, rows, type, canEdit, onChanged, onWalkIn }) => {
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const inCity = type === 'in_city';
  const tomorrow = addDays(date, 1);

  const shown = useMemo(() => {
    const t = q.trim().toLowerCase();
    const order = (r: RosterRow) => (r.attendance === null ? 0 : r.attendance === 'showed' ? 1 : 2);
    return rows.filter(r => !t || fullName(r.hire.person).toLowerCase().includes(t) || r.hire.cn.toLowerCase().startsWith(t) || (r.shuttle || '').toLowerCase().includes(t))
      .sort((a, b) => order(a) - order(b) || (a.shuttle || '~').localeCompare(b.shuttle || '~', undefined, { numeric: true }) || fullName(a.hire.person).localeCompare(fullName(b.hire.person)));
  }, [rows, q]);
  const here = rows.filter(r => r.attendance === 'showed').length;
  const ns = rows.filter(r => r.attendance === 'no_show').length;
  const waiting = rows.length - here - ns;
  const unanswered = inCity ? rows.filter(r => r.attendance === 'showed' && !r.next_action && !r.next_day).length : 0;

  const act = async (r: RosterRow, fn: () => Promise<unknown>) => {
    setBusy(r.id); setError(null);
    try { await fn(); onChanged(); } catch (e) { setError(e); } finally { setBusy(null); }
  };
  const mark = (r: RosterRow, att: 'showed' | 'no_show') => act(r, () => updateRoster(r.id, { attendance: r.attendance === att ? null : att }));
  const answer = (r: RosterRow, a: { next_day: string | null; next_action: 'book' | 'WDR' | 'Q' | null }) => act(r, () => updateRoster(r.id, a));

  return (
    <div>
      <div className="v2-row" style={{ gap: 10, marginBottom: 12, flexWrap: 'wrap' }}>
        <div style={{ position: 'relative', flex: '1 1 240px', maxWidth: 360 }}>
          <Search size={14} style={{ position: 'absolute', left: 10, top: 11, color: '#6b7280' }} />
          <input className="v2-input" style={{ paddingLeft: 30 }} placeholder="Name, CN # or shuttle" value={q} onChange={e => setQ(e.target.value)} aria-label="Search roll call" />
        </div>
        <span className="v2-pill" style={{ color: 'var(--ink)' }}><b>{here}</b>&nbsp;here</span>
        {inCity && <span className="v2-pill" style={{ color: 'var(--ink)' }}><b>{ns}</b>&nbsp;no-show</span>}
        <span className="v2-pill" style={{ color: 'var(--ink)' }}><b>{waiting}</b>&nbsp;to check in</span>
        {unanswered > 0 && <span className="v2-pill" style={{ color: '#fbbf24' }}>{unanswered} without a next day</span>}
        <span className="v2-spacer" />
        {canEdit && <Btn kind="o" icon={UserPlus} onClick={onWalkIn}>Walk-in</Btn>}
      </div>
      <ErrorBox error={error} />
      {rows.length === 0 ? <div className="v2-card" style={{ textAlign: 'center', padding: 30 }}>Nobody is booked today. Add walk-ins as they arrive.</div> : (
        <div className="v2-rollcall">
          {shown.map(r => {
            const isHere = r.attendance === 'showed';
            return (
              <div key={r.id} className={`v2-card v2-rc${isHere ? ' here' : r.attendance === 'no_show' ? ' ns' : ''}`} style={{ opacity: busy === r.id ? 0.55 : 1 }}>
                <div className="v2-row" style={{ flexWrap: 'nowrap', gap: 10 }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="nm"><ContractorLink hireId={r.hire_id} onSaved={onChanged}>{fullName(r.hire.person)}</ContractorLink>{r.hire.person.lifetime_days === 0 && <> <Tag tone="v">FIRST DAY</Tag></>}</div>
                    <div className="v2-small v2-mut">{r.hire.cn}{r.shuttle ? ` · ${r.shuttle}` : ''}{r.hire.ns_count ? ` · ${r.hire.ns_count} NS` : ''}</div>
                  </div>
                  <button className={`v2-rc-btn here${isHere ? ' on' : ''}`} disabled={!canEdit || !!busy} onClick={() => mark(r, 'showed')}>Here</button>
                  {inCity && <button className={`v2-rc-btn ns${r.attendance === 'no_show' ? ' on' : ''}`} disabled={!canEdit || !!busy} onClick={() => mark(r, 'no_show')}>No-show</button>}
                </div>
                {inCity && isHere && (
                  <div className="v2-rc-next">
                    <span className="v2-small v2-mut">After today:</span>
                    <button className={`v2-chip sm${r.next_action !== 'WDR' && r.next_action !== 'Q' && r.next_day === tomorrow ? ' on' : ''}`} disabled={!canEdit || !!busy}
                      onClick={() => answer(r, { next_day: tomorrow, next_action: 'book' })}>{short(tomorrow)}</button>
                    <input type="date" className="v2-input" style={{ width: 140, height: 30, padding: '2px 6px' }} min={addDays(date, 1)} disabled={!canEdit || !!busy}
                      aria-label={`Next day for ${fullName(r.hire.person)}`}
                      value={r.next_action !== 'WDR' && r.next_action !== 'Q' && r.next_day && r.next_day !== tomorrow ? r.next_day : ''}
                      onChange={e => e.target.value && answer(r, { next_day: e.target.value, next_action: 'book' })} />
                    <button className={`v2-chip sm${r.next_action === 'WDR' ? ' on' : ''}`} disabled={!canEdit || !!busy} onClick={() => answer(r, { next_day: null, next_action: 'WDR' })}>WDR</button>
                    <button className={`v2-chip sm${r.next_action === 'Q' ? ' on' : ''}`} disabled={!canEdit || !!busy} onClick={() => answer(r, { next_day: null, next_action: 'Q' })}>Quit</button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
      {inCity && <div className="v2-note" style={{ marginTop: 10 }}>Next days are booked when the session starts; WDR and Quit take effect after today.</div>}
    </div>
  );
};
