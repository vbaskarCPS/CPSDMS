// src/planner/features/widgets/Month.tsx — the mini calendar on Today: this month at a glance, like a page of a wall
// calendar (two rings on top), today circled, a dot under each day the household has something on. The events are read
// the way the Calendar reads them (features/calendar: loadEvents, eventsOn), repeats included. Tap to open the Calendar.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useDocsChanged } from '../../lib/useDocsChanged';
import { eventsOn, loadEvents } from '../calendar';
import { useCalendarDay } from './Countdown';
import { monthCells } from './widgets';

const DOW = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

export function MonthCard({ small }: { small: boolean }) {
  const today = useCalendarDay(), month = today.slice(0, 7);
  const cells = useMemo(() => monthCells(month), [month]);
  const [busy, setBusy] = useState<Set<string> | null>(null);   // the days with something on; null while it loads
  const load = useCallback(() => {
    const days = cells.filter((d): d is string => !!d);
    loadEvents(days[0], days[days.length - 1]).then(evs => setBusy(new Set(days.filter(d => eventsOn(evs, d).length > 0)))).catch(() => setBusy(b => b ?? new Set()));
  }, [cells]);
  useEffect(load, [load]);
  useDocsChanged(['event'], load);
  const name = new Date(`${month}-01T12:00:00`).toLocaleDateString([], { month: 'long' });
  const ahead = busy ? [...busy].filter(d => d >= today).length : 0;
  return (
    <Link to="/calendar" className={`pl-card wg-month ${small ? 'is-small' : ''}`} aria-label={`${name}: ${busy ? `${ahead} ${ahead === 1 ? 'day' : 'days'} with something on from today` : 'loading'}. Open the calendar`}>
      <span className="wg-month__rings" aria-hidden><i /><i /></span>
      <div className="wg-month__head" aria-hidden><b>{name}</b><small>{month.slice(0, 4)}</small></div>
      <div className="wg-month__grid" aria-hidden>
        {DOW.map((d, i) => <span key={`h${i}`} className="wg-month__dow">{d}</span>)}
        {cells.map((d, i) => (d
          ? <span key={d} className={`wg-month__day ${d === today ? 'is-today' : d < today ? 'is-gone' : ''} ${busy?.has(d) ? 'is-busy' : ''}`}><span>{Number(d.slice(8))}</span></span>
          : <span key={`g${i}`} />))}
      </div>
    </Link>
  );
}
