// src/planner/features/widgets/HabitWeek.tsx — the habit tracker on Today: this week's ticks for each habit in a small
// grid, the same seven days and the same reading of each day as the scorecard on the Habits page (features/habits:
// useHabits, streak.ts). It only shows; ticking is done in the Habits card or on the Habits page. Tap to open Habits.
// It keeps its own copy of the week, so it listens for a tick made in another block on the page (habits/ticked.ts).
import { Fragment, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { ChevronRight, Repeat } from 'lucide-react';
import { onHabitTicked } from '../habits';
import { dayState, isDue, lastDays, weekday } from '../habits/streak';
import { DAY_LETTER } from '../habits/types';
import { useHabits } from '../habits/useHabits';

const MOST = 8;   // rows; the rest are counted in a line underneath
const WORD = { done: 'done', mini: 'the small version', missed: 'missed', off: 'not due', future: 'still to come', open: 'still open today' };

export function HabitWeekCard() {
  const { today, active, logs, loading, reload } = useHabits();
  useEffect(() => onHabitTicked(() => { void reload(); }), [reload]);
  const week = lastDays(today, 7);
  const list = active.slice(0, MOST);
  // today is "open" until it's ticked: still time, so neither done nor missed
  const cell = (h: (typeof active)[number], k: string) => { const s = dayState(h, logs, k, today); return s === 'off' && k === today && isDue(h, k) && !logs[k]?.[h.id] ? 'open' : s; };
  return (
    <Link to="/habits" className="pl-card wg-week">
      <div className="pl-row"><Repeat aria-hidden /><b className="pl-grow">Habits this week</b><ChevronRight aria-hidden /></div>
      {loading && !active.length ? <p className="pl-muted">…</p> : !active.length ? <p className="pl-muted">No habits yet. Tap to start one.</p> : (
        <div className="wg-week__grid">
          <span />
          {week.map(k => <span key={k} className={`wg-week__dow ${k === today ? 'is-today' : ''}`} aria-hidden>{DAY_LETTER[weekday(k)]}</span>)}
          {list.map(h => (
            <Fragment key={h.id}>
              <span className="wg-week__name">{h.name}</span>
              {week.map(k => { const s = cell(h, k); return <i key={k} className={`wg-week__dot is-${s} ${k === today ? 'is-today' : ''}`} role="img" aria-label={`${k === today ? 'Today' : DAY_LETTER[weekday(k)]}: ${WORD[s]}`} />; })}
            </Fragment>
          ))}
        </div>
      )}
      {active.length > MOST && <p className="pl-muted wg-week__more">and {active.length - MOST} more</p>}
    </Link>
  );
}
