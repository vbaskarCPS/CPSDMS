// src/planner/features/habits/HabitRow.tsx — one habit on the list: check circle, name, streak, nudge.
import { useRef } from 'react';
import { Link } from 'react-router-dom';
import { Check, Flame, AlertTriangle } from 'lucide-react';
import type { Habit, HabitMark } from './types';
import { currentStreak, isDue, missedLastDue, type Logs } from './streak';

export function HabitRow({ h, logs, today, mark, linkTo = true }: { h: Habit; logs: Logs; today: string; mark: (id: string, m: HabitMark | undefined) => void; linkTo?: boolean }) {
  const m = logs[today]?.[h.id];
  const due = isDue(h, today);
  const streak = currentStreak(h, logs, today);
  const nudge = due && !m && missedLastDue(h, logs, today);
  const press = useRef<number | undefined>(undefined);
  const longPressed = useRef(false);

  const toggle = () => { if (longPressed.current) { longPressed.current = false; return; } mark(h.id, m ? undefined : 'done'); };
  const startPress = () => { longPressed.current = false; press.current = window.setTimeout(() => { longPressed.current = true; mark(h.id, m === 'mini' ? undefined : 'mini'); }, 500); };
  const endPress = () => window.clearTimeout(press.current);

  const main = (
    <>
      <span className="hb-row__name">{h.name}</span>
      {h.identity && <span className="hb-row__identity">{h.identity}</span>}
      <span className="hb-row__meta">
        <span className={`hb-streak ${streak ? '' : 'is-zero'}`}><Flame aria-hidden /> {streak} day{streak === 1 ? '' : 's'}</span>
        {nudge && <span className="hb-nudge"><AlertTriangle aria-hidden /> Missed yesterday — don't miss twice</span>}
        {!due && <span className="pl-muted" style={{ fontSize: 12 }}>Not today</span>}
      </span>
    </>
  );

  return (
    <div className={`hb-row ${due ? '' : 'is-off'}`}>
      <button type="button" className={`pl-check ${m === 'done' ? 'is-on' : ''} ${m === 'mini' ? 'is-mini' : ''}`} aria-label={m ? 'Done' : 'Mark done'} aria-pressed={!!m}
        onClick={toggle} onPointerDown={startPress} onPointerUp={endPress} onPointerLeave={endPress} onPointerCancel={endPress} onContextMenu={e => e.preventDefault()}>
        <Check />
      </button>
      {linkTo ? <Link to={`/habits/${h.id}`} className="hb-row__main">{main}</Link> : <div className="hb-row__main">{main}</div>}
      {h.twoMinute && <button type="button" className={`hb-mini ${m === 'mini' ? 'is-on' : ''}`} title={h.twoMinute} onClick={() => mark(h.id, m === 'mini' ? undefined : 'mini')}>2-min</button>}
    </div>
  );
}
