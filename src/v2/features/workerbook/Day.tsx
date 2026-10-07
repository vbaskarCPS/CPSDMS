// src/v2/features/workerbook/Day.tsx — one day at a center: who's booked, confirmed, and who showed.
import React, { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ChevronLeft, ChevronRight, Play, UserPlus, Wallet } from 'lucide-react';
import { useAuth } from '../../lib/auth';
import { todayISO, useLoad } from '../../lib/data';
import {
  getDay, listRoster, listCenterManagers, showedCounts, updateRoster, removeFromDay, moveBooking, fullName,
  type RosterRow,
} from '../../lib/workerbook';
import { Btn, ErrorBox, Loading, Tag } from '../../ui';
import { BookContractors } from './BookContractors';

const shift = (iso: string, n: number) => {
  const d = new Date(iso + 'T12:00'); d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

export const Day: React.FC = () => {
  const { date = todayISO() } = useParams();
  const { center, can } = useAuth();
  const nav = useNavigate();
  const [showBook, setShowBook] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const valid = /^\d{4}-\d{2}-\d{2}$/.test(date);

  const day = useLoad(() => center && valid ? getDay(center.id, date) : Promise.resolve(null), [center?.id, date]);
  const roster = useLoad(() => day.data ? listRoster(day.data.id) : Promise.resolve([] as RosterRow[]), [day.data?.id]);
  const managers = useLoad(() => center ? listCenterManagers(center.id) : Promise.resolve([]), [center?.id]);
  const shown = useLoad(() => showedCounts((roster.data || []).map(r => r.hire_id)), [roster.data]);

  const today = todayISO();
  const canMark = date <= today;
  const locked = day.data?.state === 'closed';
  const canEdit = can('workerbook') && !locked;

  const sorted = useMemo(() => [...(roster.data || [])].sort((a, b) =>
    (a.shuttle || '~').localeCompare(b.shuttle || '~', undefined, { numeric: true }) || a.hire.cn.localeCompare(b.hire.cn)), [roster.data]);
  const groups = canMark
    ? [{ key: 'open', label: 'Not marked yet', rows: sorted.filter(r => !r.attendance) },
       { key: 'showed', label: 'Showed', rows: sorted.filter(r => r.attendance === 'showed') },
       { key: 'ns', label: 'No-show', rows: sorted.filter(r => r.attendance === 'no_show') }]
    : [{ key: 'unconf', label: 'Unconfirmed', rows: sorted.filter(r => !r.confirmed_at) },
       { key: 'conf', label: 'Confirmed', rows: sorted.filter(r => r.confirmed_at) }];
  const n = (pred: (r: RosterRow) => boolean) => sorted.filter(pred).length;
  const daysOf = (r: RosterRow) => r.hire.person.lifetime_days + (shown.data?.[r.hire_id] || 0);

  const act = async (id: string, fn: () => Promise<void>) => {
    setBusyId(id); setError(null);
    try { await fn(); roster.reload(); } catch (e) { setError(e); } finally { setBusyId(null); }
  };

  if (!center) return <div className="v2-main v2-narrow"><div className="v2-card">Pick a command center first.</div></div>;
  if (!valid) return <div className="v2-main v2-narrow"><div className="v2-err">That isn’t a date.</div></div>;
  const pretty = new Date(date + 'T12:00').toLocaleDateString('en-CA', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });

  return (
    <div className="v2-main">
      <div className="v2-head">
        <Link to="/app/workerbook/days" className="v2-link">‹ Days</Link>
        <span className="v2-h1">{pretty}</span>
        {locked ? <Tag tone="g">Closed</Tag> : day.data?.state === 'live' ? <Tag tone="b">Live</Tag> : canMark ? <Tag tone="a">Payout day</Tag> : <Tag tone="b">Workerbook day</Tag>}
        <span className="v2-spacer" />
        <button className="v2-gbtn" onClick={() => nav(`/app/workerbook/days/${shift(date, -1)}`)} aria-label="Previous day"><ChevronLeft size={16} /></button>
        <button className="v2-gbtn" onClick={() => nav(`/app/workerbook/days/${shift(date, 1)}`)} aria-label="Next day"><ChevronRight size={16} /></button>
        {canEdit && <Btn kind="o" icon={UserPlus} onClick={() => setShowBook(true)}>Book contractors</Btn>}
        {can('workerbook') && day.data?.state === 'planned' && sorted.length > 0 && <Btn kind="g" icon={Play} onClick={() => nav(`/app/workerbook/days/${date}/start`)}>Start session</Btn>}
        {day.data?.state === 'live' && <Btn kind="o" onClick={() => nav(`/app/workerbook/days/${date}/start`)}>Session details</Btn>}
        {day.data?.state === 'live' && can('workerbook') && <Btn kind="g" icon={Wallet} onClick={() => nav(`/app/workerbook/days/${date}/payouts`)}>Payouts</Btn>}
      </div>

      <div className="v2-grid4" style={{ marginBottom: 14 }}>
        <div className="v2-card"><div className="v2-card-h">Booked</div><div className="v2-kpi">{sorted.length}</div></div>
        <div className="v2-card"><div className="v2-card-h">Confirmed</div><div className="v2-kpi" style={{ color: '#059669' }}>{n(r => !!r.confirmed_at)}</div></div>
        {canMark ? <>
          <div className="v2-card"><div className="v2-card-h">Showed</div><div className="v2-kpi">{n(r => r.attendance === 'showed')}</div></div>
          <div className="v2-card"><div className="v2-card-h">No-show</div><div className="v2-kpi" style={{ color: '#b91c1c' }}>{n(r => r.attendance === 'no_show')}</div></div>
        </> : <>
          <div className="v2-card"><div className="v2-card-h">Unconfirmed</div><div className="v2-kpi" style={{ color: '#b45309' }}>{n(r => !r.confirmed_at)}</div></div>
          <div className="v2-card"><div className="v2-card-h">First day</div><div className="v2-kpi">{n(r => daysOf(r) === 0)}</div></div>
        </>}
      </div>

      <ErrorBox error={day.error || roster.error || error} />
      {locked && <div className="v2-note" style={{ marginBottom: 10 }}>This day is closed. Only the Super Admin can change it.</div>}
      {day.loading || roster.loading ? <Loading /> : sorted.length === 0 ? (
        <div className="v2-card" style={{ textAlign: 'center', padding: 30 }}>
          Nobody is booked on this day yet.{canEdit && <div style={{ marginTop: 12 }}><Btn icon={UserPlus} onClick={() => setShowBook(true)}>Book contractors</Btn></div>}
        </div>
      ) : (
        <>
        <div className="v2-stack v2-only-narrow" style={{ gap: 10 }}>
          {groups.map(g => g.rows.length === 0 ? null : (
            <React.Fragment key={g.key}>
              <div className="v2-card-h" style={{ margin: '4px 0 0' }}>{g.label} · {g.rows.length}</div>
              {g.rows.map(r => {
                const busy = busyId === r.id;
                const cell = r.hire.person.cell_phone;
                return (
                  <div key={r.id} className="v2-card" style={{ opacity: busy ? 0.5 : 1 }}>
                    <div className="v2-row" style={{ justifyContent: 'space-between', flexWrap: 'nowrap' }}>
                      <div><b>{fullName(r.hire.person)}</b>{daysOf(r) === 0 && <> <Tag tone="v">FIRST DAY</Tag></>}
                        <div className="v2-small v2-mut">{r.hire.cn} · shuttle {r.shuttle || '—'} · {daysOf(r)} days{r.hire.ns_count ? ` · ${r.hire.ns_count} NS` : ''}</div></div>
                      {cell && <a className="v2-btn o sm" href={`tel:${cell.replace(/[^\d+]/g, '')}`}>Call</a>}
                    </div>
                    <div className="v2-row" style={{ marginTop: 10, gap: 8 }}>
                      <label className="v2-chip" style={{ gap: 8 }}>
                        <input type="checkbox" checked={!!r.confirmed_at} disabled={!canEdit || busy}
                          onChange={e => act(r.id, () => updateRoster(r.id, { confirmed: e.target.checked }))} />Confirmed
                      </label>
                      {canMark && <>
                        <button className={`v2-chip${r.attendance === 'showed' ? ' on' : ''}`} disabled={!canEdit || busy}
                          onClick={() => act(r.id, () => updateRoster(r.id, { attendance: r.attendance === 'showed' ? null : 'showed' }))}>Showed</button>
                        <button className={`v2-chip${r.attendance === 'no_show' ? ' on' : ''}`} disabled={!canEdit || busy}
                          onClick={() => act(r.id, () => updateRoster(r.id, { attendance: r.attendance === 'no_show' ? null : 'no_show' }))}>No-show</button>
                      </>}
                    </div>
                  </div>
                );
              })}
            </React.Fragment>
          ))}
        </div>
        <div className="v2-card v2-only-wide" style={{ padding: 0 }}>
          <div className="v2-table-wrap">
            <table className="v2-table" style={{ minWidth: 1020 }}>
              <thead><tr>
                <th>Shuttle</th><th>CN #</th><th>Name</th><th>Cell</th><th>Manager</th><th>Team</th>
                <th style={{ textAlign: 'center' }}>Conf</th>{canMark && <th>Attendance</th>}
                <th style={{ textAlign: 'right' }}>Days</th><th style={{ textAlign: 'right' }}>NS</th><th>Move / remove</th>
              </tr></thead>
              <tbody>
                {groups.map(g => g.rows.length === 0 ? null : (
                  <React.Fragment key={g.key}>
                    <tr><td colSpan={canMark ? 11 : 10} className="v2-group">{g.label} · {g.rows.length}</td></tr>
                    {g.rows.map(r => {
                      const busy = busyId === r.id;
                      const d = daysOf(r);
                      return (
                        <tr key={r.id} style={{ opacity: busy ? 0.5 : 1 }}>
                          <td>{r.shuttle || '—'}</td>
                          <td><b>{r.hire.cn}</b></td>
                          <td><b>{fullName(r.hire.person)}</b>{d === 0 && <> <Tag tone="v">FIRST DAY</Tag></>}</td>
                          <td>{r.hire.person.cell_phone ? <a className="v2-link" href={`tel:${r.hire.person.cell_phone.replace(/[^\d+]/g, '')}`}>{r.hire.person.cell_phone}</a> : '—'}</td>
                          <td>
                            <select className="v2-sel" style={{ padding: '5px 8px', minWidth: 130 }} disabled={!canEdit || busy} value={r.manager_id || ''}
                              aria-label="Manager" onChange={e => act(r.id, () => updateRoster(r.id, { manager_id: e.target.value || null }))}>
                              <option value="">—</option>
                              {(managers.data || []).map(m => <option key={m.id} value={m.id}>{m.full_name}</option>)}
                            </select>
                          </td>
                          <td><input className="v2-input" style={{ padding: '5px 8px', width: 74 }} disabled={!canEdit || busy} defaultValue={r.team || ''} aria-label="Team"
                            onBlur={e => { const v = e.target.value.trim(); if (v !== (r.team || '')) act(r.id, () => updateRoster(r.id, { team: v || null })); }} /></td>
                          <td style={{ textAlign: 'center' }}>
                            <input type="checkbox" checked={!!r.confirmed_at} disabled={!canEdit || busy} aria-label="Confirmed"
                              onChange={e => act(r.id, () => updateRoster(r.id, { confirmed: e.target.checked }))} />
                            {r.confirmed_via && r.confirmed_via !== 'staff' && <div className="v2-small v2-mut">{r.confirmed_via}</div>}
                          </td>
                          {canMark && (
                            <td>
                              <div className="v2-row" style={{ gap: 4, flexWrap: 'nowrap' }}>
                                <button className={`v2-chip${r.attendance === 'showed' ? ' on' : ''}`} disabled={!canEdit || busy}
                                  onClick={() => act(r.id, () => updateRoster(r.id, { attendance: r.attendance === 'showed' ? null : 'showed' }))}>Showed</button>
                                <button className={`v2-chip${r.attendance === 'no_show' ? ' on' : ''}`} disabled={!canEdit || busy}
                                  onClick={() => act(r.id, () => updateRoster(r.id, { attendance: r.attendance === 'no_show' ? null : 'no_show' }))}>No-show</button>
                              </div>
                            </td>
                          )}
                          <td style={{ textAlign: 'right' }}>{d}</td>
                          <td style={{ textAlign: 'right', color: r.hire.ns_count ? '#b91c1c' : undefined }}>{r.hire.ns_count}</td>
                          <td>
                            <div className="v2-row" style={{ gap: 4, flexWrap: 'nowrap' }}>
                              <input type="date" className="v2-input" style={{ padding: '4px 6px', width: 140 }} disabled={!canEdit || busy || !!r.attendance}
                                aria-label="Move to date" min={today}
                                onChange={e => { const to = e.target.value; if (to && to !== date) act(r.id, () => moveBooking(r, center.id, to)); }} />
                              <button className="v2-btn r sm" disabled={!canEdit || busy || !!r.attendance} aria-label={`Remove ${fullName(r.hire.person)} from this day`}
                                onClick={() => act(r.id, () => removeFromDay(r.id))}>Remove</button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </React.Fragment>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        </>
      )}
      <div className="v2-note">Ticking Conf records a staff confirmation. Email and text confirmations and the shuttle push come in a later step.</div>

      {showBook && <BookContractors centerId={center.id} date={date} bookedHireIds={new Set(sorted.map(r => r.hire_id))}
        onClose={() => setShowBook(false)} onBooked={() => { setShowBook(false); day.reload(); roster.reload(); }} />}
    </div>
  );
};
