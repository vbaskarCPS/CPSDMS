// src/v2/features/workerbook/Days.tsx — Workerbook's home: the calendar. A day becomes a payout day once a
// session is started on it; until then it's a Workerbook day (bookings and confirmations).
import React, { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { BedDouble, ChevronLeft, ChevronRight, Contact, FileText, SlidersHorizontal } from 'lucide-react';
import { useAuth } from '../../lib/auth';
import { todayISO, useLoad } from '../../lib/data';
import { listHires, monthCells, monthSummary, STATUS_LISTS, type DaySummary } from '../../lib/workerbook';
import { Btn, ErrorBox, Loading } from '../../ui';

export const Days: React.FC = () => {
  const { center } = useAuth();
  const nav = useNavigate();
  const [month, setMonth] = useState(() => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1); });
  const cells = useMemo(() => monthCells(month.getFullYear(), month.getMonth()), [month]);
  const from = cells.find(Boolean) as string;
  const to = cells[cells.length - 1] as string;
  const sum = useLoad(() => center ? monthSummary(center.id, from, to) : Promise.resolve([] as DaySummary[]), [center?.id, from, to]);
  const hires = useLoad(() => listHires(month.getFullYear()), [month.getFullYear()]);
  const byDay = useMemo(() => new Map((sum.data || []).map(d => [d.day, d])), [sum.data]);
  const today = todayISO();

  const counts = useMemo(() => {
    const m: Record<string, number> = {};
    for (const h of hires.data || []) if (!center || h.center_id === center.id) m[h.status] = (m[h.status] || 0) + 1;
    return m;
  }, [hires.data, center]);

  if (!center) return <div className="v2-main v2-narrow"><div className="v2-card">Pick a command center first.</div></div>;

  return (
    <div className="v2-main">
      <div className="v2-head">
        <span className="v2-h1">{month.toLocaleDateString('en-CA', { month: 'long', year: 'numeric' })}</span>
        <button className="v2-gbtn" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))} aria-label="Previous month"><ChevronLeft size={16} /></button>
        <button className="v2-gbtn" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))} aria-label="Next month"><ChevronRight size={16} /></button>
        <Btn kind="o" size="sm" onClick={() => { const d = new Date(); setMonth(new Date(d.getFullYear(), d.getMonth(), 1)); }}>Today</Btn>
        <span className="v2-spacer" />
        <div className="v2-row v2-wb-links" style={{ gap: 6 }}>
          <Btn kind="o" size="sm" icon={FileText} onClick={() => nav('/app/workerbook/payslips')}>Payslips</Btn>
          <Btn kind="o" size="sm" icon={Contact} onClick={() => nav('/app/workerbook/contractors')}>Contractors</Btn>
          <Btn kind="o" size="sm" icon={BedDouble} onClick={() => nav('/app/workerbook/crew')}>Crew list</Btn>
          <Btn kind="o" size="sm" icon={SlidersHorizontal} onClick={() => nav('/app/workerbook/rate-cards')}>Rate cards</Btn>
        </div>
        <Btn onClick={() => nav(`/app/workerbook/days/${today}`)}>Open today</Btn>
      </div>

      <div className="v2-tiles" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))', marginBottom: 14 }}>
        <button className="v2-card" style={{ textAlign: 'left' }} onClick={() => nav('/app/workerbook/contractors?status=active')}>
          <div className="v2-card-h" style={{ marginBottom: 2 }}>Active</div><div className="v2-kpi">{counts.active || 0}</div>
        </button>
        {STATUS_LISTS.map(s => (
          <button key={s.code} className="v2-card" style={{ textAlign: 'left' }} onClick={() => nav(`/app/workerbook/contractors?status=${s.code}`)} title={s.label}>
            <div className="v2-card-h" style={{ marginBottom: 2 }}>{s.code}</div><div className="v2-kpi">{counts[s.code] || 0}</div>
          </button>
        ))}
      </div>

      <ErrorBox error={sum.error} />
      {sum.loading ? <Loading /> : (
        <div className="v2-card">
          <div className="v2-days">
            {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(d => <div key={d} className="dow">{d}</div>)}
            {cells.map((iso, i) => {
              if (!iso) return <div key={`b${i}`} />;
              const s = byDay.get(iso);
              const isToday = iso === today;
              const payout = s?.state === 'live' || s?.state === 'closed';   // a session was started that day
              const kind = `${isToday ? 'today ' : ''}${s?.state === 'closed' ? 'closed' : s?.state === 'live' ? 'payout' : s ? 'booked' : ''}`;
              return (
                <button key={iso} className={`v2-dayc ${kind}`} onClick={() => nav(`/app/workerbook/days/${iso}`)}
                  aria-label={`${iso}${s ? `, ${s.booked} booked` : ''}`}>
                  <span className="n">{Number(iso.slice(8))}{s?.state === 'live' && <span className="pill live">Live</span>}{s?.state === 'closed' && <span className="pill closed">Closed</span>}</span>
                  {s && payout
                    ? <><span className="l1">{s.showed} showed</span><span className="l2">{s.booked} booked{s.noShow ? ` · ${s.noShow} NS` : ''}</span></>
                    : s ? <><span className="l1">{s.booked} booked</span><span className="l2">{s.confirmed} confirmed{s.firstDay ? ` · ${s.firstDay} first-day` : ''}</span></>
                      : null}
                </button>
              );
            })}
          </div>
        </div>
      )}
      <div className="v2-note">Click any day to open it. Blue days are Workerbook days (booked, not started); a day turns into a payout day once its session is started.</div>
    </div>
  );
};
