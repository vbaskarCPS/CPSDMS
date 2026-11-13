// src/v2/app/DayChip.tsx — the top bar's day chip, for people who run the workerbook: green while today's day is live,
// orange when a day from before today is still open (last night not closed). Tapping it opens that day.
import React, { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { liveDay } from '../lib/liveDay';

const localDay = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const label = (iso: string, weekday: boolean) => new Date(`${iso}T12:00:00`).toLocaleDateString('en-CA', { ...(weekday ? { weekday: 'short' } : {}), month: 'short', day: 'numeric' });

export const DayChip: React.FC<{ centerId: string | null }> = ({ centerId }) => {
  const [live, setLive] = useState<string | null>(null);
  const loc = useLocation();
  useEffect(() => {
    if (!centerId) { setLive(null); return; }
    let gone = false;
    const look = async () => {
      const d = await liveDay(centerId);
      if (!gone) setLive(d);
    };
    void look();
    const t = window.setInterval(() => void look(), 300000);
    return () => { gone = true; window.clearInterval(t); };
  }, [centerId, loc.pathname]);
  if (!live) return null;
  const old = live < localDay();
  return (
    <Link to={`/app/workerbook/days/${live}`} className={`v2-pill v2-daychip ${old ? 'warn' : 'live'}`} title={old ? `${label(live, true)} is still open. Open it to close it.` : 'Today is live'}>
      <i aria-hidden="true" />{old
        ? <><span className="v2-hide-sm">{label(live, false)} still open · close it</span><span className="v2-show-sm">{label(live, false)} open</span></>
        : <>Live<span className="v2-hide-sm"> · {label(live, true)}</span></>}
    </Link>
  );
};
