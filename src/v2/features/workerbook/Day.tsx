// src/v2/features/workerbook/Day.tsx — one day at a center. What the page is depends on the day:
//
//   today, not started   Roll call (who's here; in-city: next day / WDR / Quit) → Start session
//   started (live)       The session = the day's payouts (late arrivals onto the live map; Close day)
//   closed               The payout copy: the day's numbers and each worker's finalized line
//   tomorrow             Confirmations + a draft of the teams (pre-fills Start session)
//   later                Bookings: move or remove people; confirm from two days ahead
//   earlier, never run   The bookings as they were (read only)
import React, { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ChevronLeft, ChevronRight, ListChecks, Lock, Play, UserPlus, UserRoundPlus } from 'lucide-react';
import { useAuth } from '../../lib/auth';
import { todayISO, useLoad } from '../../lib/data';
import { getCenterType } from '../../lib/crew';
import { availableManagers } from '../../lib/startSession';
import {
  getDay, listRoster, showedCounts, updateRoster, removeFromDay, moveBooking, fullName, type RosterRow,
} from '../../lib/workerbook';
import { Btn, ErrorBox, Loading, Tag } from '../../ui';
import { BookContractors } from './BookContractors';
import { CloseDay } from './CloseDay';
import { RollCall } from './day/RollCall';
import { PlanTomorrow } from './day/PlanTomorrow';
import { PayoutCopy } from './day/PayoutCopy';
import { LateArrivals } from './day/LateArrivals';
import { SessionPayouts } from './Payouts';
import { ContractorLink } from './ContractorCard';

const shift = (iso: string, n: number) => {
  const d = new Date(iso + 'T12:00'); d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
type Mode = 'rollcall' | 'session' | 'copy' | 'plan' | 'future' | 'past';
const MODE_TAG: Record<Mode, { label: string; tone: 'g' | 'a' | 'b' | 'v' | 'r' }> = {
  rollcall: { label: 'Roll call', tone: 'a' }, session: { label: 'Live session · payouts', tone: 'b' }, copy: { label: 'Closed · payout copy', tone: 'g' },
  plan: { label: 'Next day · confirmations & draft', tone: 'v' }, future: { label: 'Workerbook day', tone: 'v' }, past: { label: 'No session was run', tone: 'r' },
};

export const Day: React.FC = () => {
  const { date = todayISO() } = useParams();
  const { center, can } = useAuth();
  const nav = useNavigate();
  const [showBook, setShowBook] = useState(false);
  const [showClose, setShowClose] = useState(false);
  const [showLate, setShowLate] = useState(false);
  const [lateTick, setLateTick] = useState(0);   // re-reads the payouts after someone is put on the map
  const valid = /^\d{4}-\d{2}-\d{2}$/.test(date);

  const day = useLoad(() => center && valid ? getDay(center.id, date) : Promise.resolve(null), [center?.id, date]);
  const roster = useLoad(() => day.data ? listRoster(day.data.id) : Promise.resolve([] as RosterRow[]), [day.data?.id]);
  const managers = useLoad(() => center ? availableManagers(center.id, date) : Promise.resolve([]), [center?.id, date]);
  const ctype = useLoad(() => center ? getCenterType(center.id) : Promise.resolve('in_city' as const), [center?.id]);

  const today = todayISO();
  const tomorrow = shift(today, 1);
  const state = day.data?.state;
  const mode: Mode = state === 'closed' ? 'copy' : state === 'live' ? 'session'
    : date === today ? 'rollcall' : date === tomorrow ? 'plan' : date > tomorrow ? 'future' : 'past';
  const canEdit = can('workerbook') && mode !== 'copy' && mode !== 'past';
  const rows = roster.data || [];
  const reload = () => { day.reload(); roster.reload(); };
  // Only the first load (or a new date) shows the spinner; a reload after a change keeps the page
  // mounted, so open dialogs (e.g. a late arrival) survive it.
  const firstLoad = (day.loading && (day.data?.day ?? null) !== date) || (roster.loading && !roster.data) || (ctype.loading && !ctype.data);

  if (!center) return <div className="v2-main v2-narrow"><div className="v2-card">Pick a command center first.</div></div>;
  if (!valid) return <div className="v2-main v2-narrow"><div className="v2-err">That isn’t a date.</div></div>;
  const pretty = new Date(date + 'T12:00').toLocaleDateString('en-CA', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
  const tag = MODE_TAG[mode];

  return (
    <div className="v2-main">
      <div className="v2-head">
        <Link to="/app/workerbook/days" className="v2-link">‹ Calendar</Link>
        <span className="v2-h1">{pretty}</span>
        <Tag tone={tag.tone}>{tag.label}</Tag>
        <span className="v2-spacer" />
        <button className="v2-gbtn" onClick={() => nav(`/app/workerbook/days/${shift(date, -1)}`)} aria-label="Previous day"><ChevronLeft size={16} /></button>
        <button className="v2-gbtn" onClick={() => nav(`/app/workerbook/days/${shift(date, 1)}`)} aria-label="Next day"><ChevronRight size={16} /></button>
        {(mode === 'plan' || mode === 'future') && can('workerbook') && <Btn kind="o" icon={UserPlus} onClick={() => setShowBook(true)}>Book contractors</Btn>}
        {mode === 'rollcall' && can('workerbook') && rows.length > 0 &&
          <Btn kind="g" icon={Play} onClick={() => nav(`/app/workerbook/days/${date}/start`)}>Start session</Btn>}
        {mode === 'session' && <>
          <Btn kind="o" icon={ListChecks} onClick={() => nav(`/app/workerbook/days/${date}/start`)}>Session details</Btn>
          {can('workerbook') && <Btn kind="o" icon={UserRoundPlus} onClick={() => setShowLate(true)}>Late arrival</Btn>}
          {can('workerbook') && <Btn kind="o" icon={Lock} onClick={() => setShowClose(true)}>Close day</Btn>}
        </>}
      </div>

      <ErrorBox error={day.error || roster.error} />
      {firstLoad ? <Loading /> : (
        <>
          {mode === 'rollcall' && (
            <RollCall rows={rows} date={date} type={ctype.data || 'in_city'} canEdit={canEdit} onChanged={roster.reload} onWalkIn={() => setShowBook(true)} />
          )}
          {mode === 'session' && <SessionPayouts key={lateTick} centerId={center.id} centerName={center.display_name} date={date} />}
          {mode === 'plan' && <PlanTomorrow rows={rows} managers={managers.data || []} canEdit={canEdit} onChanged={roster.reload} />}
          {mode === 'copy' && day.data && <PayoutCopy centerId={center.id} region={center.region} date={date} day={day.data} rows={rows} canEdit={can('workerbook')} />}
          {(mode === 'future' || mode === 'past') && (
            <BookingList centerId={center.id} date={date} today={today} rows={rows} canEdit={canEdit} onChanged={roster.reload} onBook={() => setShowBook(true)} />
          )}
        </>
      )}

      {showLate && <LateArrivals centerId={center.id} region={center.region} date={date} rows={rows} managers={managers.data || []}
        onClose={() => setShowLate(false)} onBook={() => setShowBook(true)} onAdded={() => { setShowLate(false); setLateTick(t => t + 1); roster.reload(); }} />}
      {showClose && day.data && <CloseDay centerId={center.id} date={date} pretty={pretty} onClose={() => setShowClose(false)}
        onClosed={() => { setShowClose(false); reload(); }} />}
      {showBook && <BookContractors centerId={center.id} date={date} bookedHireIds={new Set(rows.map(r => r.hire_id))}
        onClose={() => setShowBook(false)} onBooked={() => { setShowBook(false); reload(); }} />}
    </div>
  );
};

/** Later days: who's booked; move them to another day or remove them. Confirming opens two days ahead. */
const BookingList: React.FC<{ centerId: string; date: string; today: string; rows: RosterRow[]; canEdit: boolean; onChanged: () => void; onBook: () => void }> =
  ({ centerId, date, today, rows, canEdit, onChanged, onBook }) => {
    const [busyId, setBusyId] = useState<string | null>(null);
    const [error, setError] = useState<unknown>(null);
    const shown = useLoad(() => showedCounts(rows.map(r => r.hire_id)), [rows]);
    const canConfirm = canEdit && date <= shift(today, 2);
    const sorted = useMemo(() => [...rows].sort((a, b) =>
      (a.shuttle || '~').localeCompare(b.shuttle || '~', undefined, { numeric: true }) || a.hire.cn.localeCompare(b.hire.cn)), [rows]);
    const daysOf = (r: RosterRow) => r.hire.person.lifetime_days + (shown.data?.[r.hire_id] || 0);
    const act = async (id: string, fn: () => Promise<void>) => {
      setBusyId(id); setError(null);
      try { await fn(); onChanged(); } catch (e) { setError(e); } finally { setBusyId(null); }
    };
    const confirmed = rows.filter(r => r.confirmed_at).length;

    return (
      <>
        <div className="v2-row" style={{ gap: 8, marginBottom: 12 }}>
          <span className="v2-pill" style={{ color: 'var(--ink)' }}><b>{rows.length}</b>&nbsp;booked</span>
          <span className="v2-pill" style={{ color: 'var(--ink)' }}><b>{confirmed}</b>&nbsp;confirmed</span>
          <span className="v2-pill" style={{ color: 'var(--ink)' }}><b>{rows.filter(r => daysOf(r) === 0).length}</b>&nbsp;first-day</span>
        </div>
        <ErrorBox error={error} />
        {rows.length === 0 ? (
          <div className="v2-card" style={{ textAlign: 'center', padding: 30 }}>
            Nobody is booked on this day.{canEdit && <div style={{ marginTop: 12 }}><Btn icon={UserPlus} onClick={onBook}>Book contractors</Btn></div>}
          </div>
        ) : (
          <div className="v2-card" style={{ padding: 0 }}>
            <div className="v2-table-wrap">
              <table className="v2-table">
                <thead><tr><th>Shuttle</th><th>CN #</th><th>Name</th><th>Cell</th>
                  <th style={{ textAlign: 'center' }} title={canConfirm ? '' : 'Confirming opens two days ahead'}>Conf</th>
                  <th style={{ textAlign: 'right' }}>Days</th><th style={{ textAlign: 'right' }}>NS</th>{canEdit && <th>Move / remove</th>}</tr></thead>
                <tbody>
                  {sorted.map(r => {
                    const busy = busyId === r.id; const d = daysOf(r);
                    return (
                      <tr key={r.id} style={{ opacity: busy ? 0.5 : 1 }}>
                        <td>{r.shuttle || '—'}</td><td><b>{r.hire.cn}</b></td>
                        <td><b><ContractorLink hireId={r.hire_id} onSaved={onChanged}>{fullName(r.hire.person)}</ContractorLink></b>{d === 0 && <> <Tag tone="v">FIRST DAY</Tag></>}</td>
                        <td>{r.hire.person.cell_phone ? <a className="v2-link" href={`tel:${r.hire.person.cell_phone.replace(/[^\d+]/g, '')}`}>{r.hire.person.cell_phone}</a> : '—'}</td>
                        <td style={{ textAlign: 'center' }}>
                          <input type="checkbox" checked={!!r.confirmed_at} disabled={!canConfirm || busy} aria-label="Confirmed"
                            onChange={e => act(r.id, () => updateRoster(r.id, { confirmed: e.target.checked }))} />
                        </td>
                        <td style={{ textAlign: 'right' }}>{d}</td>
                        <td style={{ textAlign: 'right', color: r.hire.ns_count ? '#b91c1c' : undefined }}>{r.hire.ns_count}</td>
                        {canEdit && <td>
                          <div className="v2-row" style={{ gap: 4, flexWrap: 'nowrap' }}>
                            <input type="date" className="v2-input" style={{ padding: '4px 6px', width: 140 }} disabled={busy} aria-label="Move to date" min={today}
                              onChange={e => { const to = e.target.value; if (to && to !== date) act(r.id, () => moveBooking(r, centerId, to)); }} />
                            <button className="v2-btn r sm" disabled={busy} aria-label={`Remove ${fullName(r.hire.person)} from this day`}
                              onClick={() => act(r.id, () => removeFromDay(r.id))}>Remove</button>
                          </div>
                        </td>}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
        {canEdit && !canConfirm && <div className="v2-note" style={{ marginTop: 10 }}>Confirming opens two days ahead. Tomorrow’s page has confirmations and the draft teams.</div>}
      </>
    );
  };
