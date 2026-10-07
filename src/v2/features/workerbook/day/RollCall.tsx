// Today's roll call: who's here. In-city centers also take each worker's answer for after today —
// their next day (booked when the session starts), WDR, or Quit (they still work today).
// Once the session is live, anyone marked here late can be put on the live map under a manager.
import React, { useMemo, useState } from 'react';
import { Search, UserPlus } from 'lucide-react';
import { applyNextDays, fullName, updateRoster, type Day, type RosterRow } from '../../../lib/workerbook';
import { addLateArrival, type PlanManager } from '../../../lib/startSession';
import { Btn, ErrorBox, Modal, Tag } from '../../../ui';
import type { CenterType } from '../../../lib/crew';
import { dayContext } from './dayContext';

const addDays = (iso: string, n: number) => { const d = new Date(iso + 'T12:00'); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };
const short = (iso: string) => new Date(iso + 'T12:00').toLocaleDateString('en-CA', { weekday: 'short', month: 'short', day: 'numeric' });

export const RollCall: React.FC<{
  centerId: string; region: string; date: string; day: Day | null; rows: RosterRow[]; type: CenterType; live: boolean;
  managers: PlanManager[]; canEdit: boolean; onChanged: () => void; onWalkIn: () => void;
}> = ({ centerId, region, date, day, rows, type, live, managers, canEdit, onChanged, onWalkIn }) => {
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [late, setLate] = useState<RosterRow | null>(null);
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
  const mark = (r: RosterRow, att: 'showed' | 'no_show') => act(r, async () => {
    const next = r.attendance === att ? null : att;
    await updateRoster(r.id, { attendance: next });
    if (live && next === 'showed' && r.attendance !== 'showed') setLate(r);   // arrived after the start
  });
  const answer = (r: RosterRow, a: { next_day: string | null; next_action: 'book' | 'WDR' | 'Q' | null }) => act(r, async () => {
    await updateRoster(r.id, a);
    if (live && day) await applyNextDays(day.id, r.hire_id);   // after the start, it takes effect now
  });

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
                    <div className="nm">{fullName(r.hire.person)}{r.hire.person.lifetime_days === 0 && <> <Tag tone="v">FIRST DAY</Tag></>}</div>
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
      {inCity && <div className="v2-note" style={{ marginTop: 10 }}>Next days are booked{live ? ' right away' : ' when the session starts'}; WDR and Quit take effect after today.</div>}
      {late && <LateArrival centerId={centerId} region={region} date={date} row={late} managers={managers} onClose={() => setLate(null)} />}
    </div>
  );
};

/** Marked here after the session started: put them on the live map under a manager. */
const LateArrival: React.FC<{ centerId: string; region: string; date: string; row: RosterRow; managers: PlanManager[]; onClose: () => void }> =
  ({ centerId, region, date, row, managers, onClose }) => {
    const [mgr, setMgr] = useState(row.manager_id || managers[0]?.id || '');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<unknown>(null);
    const add = async () => {
      const m = managers.find(x => x.id === mgr);
      if (!m) return;
      setBusy(true); setError(null);
      try {
        const ctx = await dayContext(centerId, date, region);
        await addLateArrival(centerId, row, m, ctx.card, ctx.seasonYear, ctx.service);
        onClose();
      } catch (e) { setError(e); } finally { setBusy(false); }
    };
    return (
      <Modal title={`${fullName(row.hire.person)} arrived late`} onClose={onClose}
        footer={<><Btn kind="o" onClick={onClose}>Not now</Btn><Btn disabled={busy || !mgr} onClick={add}>{busy ? 'Adding…' : 'Put on the live map'}</Btn></>}>
        <p style={{ marginTop: 0 }}>The session has already started. Put {row.hire.person.first_name} on the live map so they can sign in and their manager can put them on a cart (Manage Team on the RM map).</p>
        <label className="v2-label" htmlFor="late-mgr">Manager</label>
        <select id="late-mgr" className="v2-sel" value={mgr} onChange={e => setMgr(e.target.value)}>
          {managers.map(m => <option key={m.id} value={m.id}>{m.full_name}</option>)}
        </select>
        <ErrorBox error={error} />
      </Modal>
    );
  };
