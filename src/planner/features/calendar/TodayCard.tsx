// src/planner/features/calendar/TodayCard.tsx — Today: what's on today and tomorrow for the household.
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { CalendarDays, ChevronRight } from 'lucide-react';
import { calendarKey } from '../../lib/docs';
import { clock } from '../../lib/routine';
import { loadEvents } from './store';
import { addDays, eventsOn, WHO_LABEL, type CalEvent } from './types';

export function CalendarTodayCard() {
  const today = calendarKey(), tomorrow = addDays(today, 1);
  const [events, setEvents] = useState<CalEvent[] | null>(null);
  useEffect(() => { loadEvents(today, tomorrow).then(setEvents).catch(() => setEvents([])); }, [today, tomorrow]);
  const t = events ? eventsOn(events, today) : [], n = events ? eventsOn(events, tomorrow) : [];
  return (
    <Link to="/calendar" className="pl-card pl-stack" style={{ textDecoration: 'none', color: 'inherit', gap: 6 }}>
      <div className="pl-row"><h3 className="pl-grow pl-row" style={{ gap: 8 }}><CalendarDays aria-hidden style={{ width: 20, height: 20, color: 'var(--accent)' }} /> Calendar</h3><ChevronRight /></div>
      {events === null ? <p className="pl-muted" style={{ fontSize: 13 }}>Loading…</p> : t.length === 0 && n.length === 0 ? <p className="pl-muted" style={{ fontSize: 13 }}>Nothing on today or tomorrow. Tap to add.</p> : (
        <>
          {t.map(e => <p key={e.id} className={`cal__line is-${e.who}`}><span className="cal__time">{e.time ? clock(e.time) : 'all day'}</span><span className="pl-grow">{e.title}</span><small>{WHO_LABEL[e.who]}</small></p>)}
          {n.length > 0 && <p className="pl-muted" style={{ fontSize: 12, margin: '4px 0 0' }}>Tomorrow: {n.map(e => `${e.time ? clock(e.time) + ' ' : ''}${e.title}`).join(' · ')}</p>}
        </>
      )}
    </Link>
  );
}
