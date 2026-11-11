// src/planner/features/widgets/Countdown.tsx — a countdown on Today: the days left to a day the person picked, in big
// type inside a ring that fills over the last month; "today!" on the day. Once the day has gone by it tidies itself:
// it offers the next time round (a yearly one: a birthday, Christmas) or to be taken off the page.
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Check } from 'lucide-react';
import { calendarKey } from '../../lib/docs';
import { countdownView, nextTime, type Countdown } from './widgets';

/** Today's date, kept right while the planner stays open past midnight. */
export function useCalendarDay(): string {
  const [day, setDay] = useState(() => calendarKey());
  useEffect(() => {
    const check = () => setDay(calendarKey());
    const id = window.setInterval(check, 60_000);
    document.addEventListener('visibilitychange', check);
    return () => { window.clearInterval(id); document.removeEventListener('visibilitychange', check); };
  }, []);
  return day;
}

const R = 44, AROUND = 2 * Math.PI * R;
/** "Fri, Dec 25", with the year when it isn't this one. */
export const dayWords = (date: string, today: string): string =>
  new Date(`${date}T12:00:00`).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric', ...(date.slice(0, 4) !== today.slice(0, 4) ? { year: 'numeric' } : {}) });

/** `ready` = the saved arrangement has been read, so the tidy-up buttons can change it. */
export function CountdownCard({ w, small, ready, onMove, onRemove }: { w: Countdown; small: boolean; ready: boolean; onMove: (date: string) => void; onRemove: () => void }) {
  const today = useCalendarDay();
  const v = countdownView(w.date, today);
  const next = v.state === 'passed' ? nextTime(w, today) : null;
  // the ring: a sliver while the day is far off, filling through the last 30 days, whole on the day
  const fill = v.state === 'today' ? 1 : v.state === 'coming' ? Math.max(0.03, 1 - Math.min(v.days, 30) / 30) : 0;
  return (
    <section className={`pl-card wg-count is-${v.state} ${small ? 'is-small' : ''}`} aria-label={`${w.title}: ${v.state === 'coming' ? `${v.big} ${v.small}` : v.state === 'today' ? 'today' : v.small}`}>
      <div className="wg-count__ring" aria-hidden>
        <svg viewBox="0 0 100 100">
          <circle className="wg-count__dial" cx="50" cy="50" r={R} />
          {fill > 0 && <circle className="wg-count__arc" cx="50" cy="50" r={R} strokeDasharray={`${AROUND * fill} ${AROUND}`} transform="rotate(-90 50 50)" />}
        </svg>
        <b className={`wg-count__big ${v.big.length > 3 ? 'is-long' : v.big.length > 2 ? 'is-mid' : ''}`}>{v.state === 'passed' ? <Check /> : v.big}</b>
      </div>
      <div className="wg-count__text">
        <b className="wg-count__title">{w.title}</b>
        <small className="pl-muted">{v.small} · {dayWords(w.date, today)}</small>
        {v.state === 'passed' && (
          <div className="wg-count__tidy">
            {next
              ? <button type="button" className="pl-btn pl-btn--small pl-btn--primary" disabled={!ready} onClick={() => onMove(next)}>Count to {dayWords(next, today)}</button>
              : <Link to="/settings/widgets" className="pl-btn pl-btn--small">Pick a new day</Link>}
            <button type="button" className="pl-btn pl-btn--small pl-btn--ghost" disabled={!ready} onClick={onRemove}>Remove</button>
          </div>
        )}
      </div>
    </section>
  );
}
