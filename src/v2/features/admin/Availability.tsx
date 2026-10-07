// src/v2/features/admin/Availability.tsx — managers are available by default; click a day to mark it off.
import React, { useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useAuth } from '../../lib/auth';
import { listUsers, listDaysOff, setDayOff, useLoad } from '../../lib/data';
import { Card, ErrorBox, Loading } from '../../ui';

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

export const Availability: React.FC = () => {
  const { center } = useAuth();
  const [month, setMonth] = useState(() => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1); });
  const from = iso(month);
  const to = iso(new Date(month.getFullYear(), month.getMonth() + 1, 0));
  const users = useLoad(listUsers, []);
  const off = useLoad(() => listDaysOff(from, to), [from, to]);
  const [error, setError] = useState<unknown>(null);
  const [pending, setPending] = useState<string | null>(null);

  const managers = useMemo(() => (users.data || []).filter(u => u.is_active && u.permissions.includes('route_manager')
    && (!center || u.center_ids.includes(center.id))), [users.data, center]);
  const offSet = useMemo(() => new Set((off.data || []).map(o => `${o.user_id}|${o.day}`)), [off.data]);
  const days = useMemo(() => {
    const n = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
    return Array.from({ length: n }, (_, i) => iso(new Date(month.getFullYear(), month.getMonth(), i + 1)));
  }, [month]);
  const lead = month.getDay();

  const flip = async (uid: string, day: string) => {
    const key = `${uid}|${day}`;
    setPending(key); setError(null);
    try { await setDayOff(uid, day, !offSet.has(key)); off.reload(); }
    catch (e) { setError(e); } finally { setPending(null); }
  };

  return (
    <div className="v2-main">
      <div className="v2-head"><span className="v2-h1">Availability</span>
        <button className="v2-gbtn" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))} aria-label="Previous month"><ChevronLeft size={16} /></button>
        <b>{month.toLocaleDateString('en-CA', { month: 'long', year: 'numeric' })}</b>
        <button className="v2-gbtn" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))} aria-label="Next month"><ChevronRight size={16} /></button>
        <span className="v2-spacer" /><span className="v2-mut v2-small">Route managers{center ? ` at ${center.display_name}` : ''} · available unless marked off</span>
      </div>
      <ErrorBox error={users.error || off.error || error} />
      {users.loading || off.loading ? <Loading /> : managers.length === 0 ? <div className="v2-card">No route managers at this center yet. Give someone the Route Manager permission in Users.</div> : (
        <div className="v2-grid3">
          {managers.map(m => (
            <Card key={m.id} title={<>{m.full_name} <span className="v2-mut" style={{ textTransform: 'none', letterSpacing: 0 }}>· {m.username}</span></>}>
              <div className="v2-cal">
                {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((d, i) => <div key={i} className="dow">{d}</div>)}
                {Array.from({ length: lead }, (_, i) => <div key={`b${i}`} />)}
                {days.map(day => {
                  const isOff = offSet.has(`${m.id}|${day}`);
                  return <button key={day} className={isOff ? 'off' : ''} disabled={pending === `${m.id}|${day}`} onClick={() => flip(m.id, day)}
                    aria-label={`${day} ${isOff ? 'off' : 'available'}`}>{Number(day.slice(8))}{isOff && <><br />off</>}</button>;
                })}
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
};
